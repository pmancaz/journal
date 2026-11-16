use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
  fs,
  io::Write,
  path::{Path, PathBuf},
  sync::atomic::{AtomicBool, Ordering},
  time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager, Runtime};

#[cfg(target_os = "macos")]
use objc2::{
  msg_send, sel,
  runtime::{AnyObject, Bool},
};

#[cfg(target_os = "macos")]
use objc2_foundation::{NSFileCoordinator, NSFileCoordinatorWritingOptions, NSFileVersion, NSString, NSURL};
#[cfg(target_os = "macos")]
use objc2::AnyThread;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JournalDocument {
  full_html: String,
  revision: String,
  modified_at: u64,
  path: String,
  display_name: String,
  conflict_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GuardedWriteResult {
  status: String,
  document: Option<JournalDocument>,
  report: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryEntry {
  path: String,
  kind: String,
  created_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryDraft {
  path: String,
  kind: String,
  created_at: u64,
  full_html: String,
}

fn unix_milliseconds(time: SystemTime) -> u64 {
  time.duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

fn content_revision(contents: &str) -> String {
  format!("{:x}", Sha256::digest(contents.as_bytes()))
}

#[cfg(target_os = "macos")]
fn unresolved_conflict_count(path: &Path) -> usize {
  let path_string = NSString::from_str(&path.to_string_lossy());
  let url = NSURL::fileURLWithPath(&path_string);
  NSFileVersion::unresolvedConflictVersionsOfItemAtURL(&url)
    .map(|versions| versions.len())
    .unwrap_or(0)
}

#[cfg(not(target_os = "macos"))]
fn unresolved_conflict_count(_path: &Path) -> usize { 0 }

fn read_journal_from_path(path: &Path) -> Result<JournalDocument, String> {
  let full_html = fs::read_to_string(path)
    .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
  let metadata = fs::metadata(path)
    .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;

  Ok(JournalDocument {
    revision: content_revision(&full_html),
    full_html,
    modified_at: metadata.modified().map(unix_milliseconds).unwrap_or_default(),
    path: path.to_string_lossy().into_owned(),
    display_name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
    conflict_count: unresolved_conflict_count(path),
  })
}

fn atomic_replace(path: &Path, contents: &str) -> Result<(), String> {
  let parent = path.parent().ok_or_else(|| "The journal path has no parent folder.".to_string())?;
  // A unique file prevents simultaneous writes from sharing a temporary name.
  // Dropping an unfinished NamedTempFile also removes it after an error.
  let mut temporary = tempfile::NamedTempFile::new_in(parent)
    .map_err(|error| format!("Could not create the safe-save file: {error}"))?;
  if let Ok(metadata) = fs::metadata(path) {
    temporary.as_file().set_permissions(metadata.permissions())
      .map_err(|error| format!("Could not preserve file permissions: {error}"))?;
  }
  temporary.write_all(contents.as_bytes())
    .map_err(|error| format!("Could not write the safe-save file: {error}"))?;
  temporary.as_file().sync_all()
    .map_err(|error| format!("Could not finish the safe-save file: {error}"))?;
  temporary.persist(path)
    .map_err(|error| format!("Could not replace the journal with its safe-save file: {error}"))?;
  fs::File::open(parent).and_then(|folder| folder.sync_all())
    .map_err(|error| format!("Could not finish saving the journal folder: {error}"))?;
  Ok(())
}

#[cfg(target_os = "macos")]
struct JournalFileLock(fs::File);

#[cfg(target_os = "macos")]
impl JournalFileLock {
  fn acquire(path: &Path) -> Result<Self, String> {
    use std::os::fd::AsRawFd;
    use std::os::unix::fs::DirBuilderExt;
    // A stable sidecar lock survives atomic replacement of the journal itself.
    // Keep it locally, outside Dropbox, and never delete a lock another process
    // might still have open. The operating system releases it if the app exits.
    let root = std::env::temp_dir().join("pc-journal-file-locks");
    fs::DirBuilder::new().recursive(true).mode(0o700).create(&root).map_err(|e| e.to_string())?;
    let lock_path = root.join(content_revision(&path.to_string_lossy()));
    let file = fs::OpenOptions::new().read(true).write(true).create(true).truncate(false)
      .open(lock_path).map_err(|e| e.to_string())?;
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } != 0 {
      return Err(format!("Could not lock the journal for saving: {}", std::io::Error::last_os_error()));
    }
    Ok(Self(file))
  }
}

#[cfg(target_os = "macos")]
impl Drop for JournalFileLock {
  fn drop(&mut self) {
    use std::os::fd::AsRawFd;
    unsafe { libc::flock(self.0.as_raw_fd(), libc::LOCK_UN); }
  }
}

fn coordinated_write<T>(path: &Path, write: impl FnOnce(&Path) -> T) -> Result<T, String> {
  // Resolve aliases before choosing the lock, so two paths to the same file
  // cannot accidentally acquire different locks.
  let target = if path.exists() { fs::canonicalize(path) } else {
    path.parent().ok_or_else(|| "Missing parent folder".to_string())?
      .canonicalize().map(|parent| parent.join(path.file_name().unwrap_or_default()))
  }.map_err(|error| format!("Could not locate the journal: {error}"))?;
  #[cfg(target_os = "macos")]
  {
    use std::cell::RefCell;
    let _lock = JournalFileLock::acquire(&target)?;
    let coordinator = NSFileCoordinator::initWithFilePresenter(NSFileCoordinator::alloc(), None);
    let url = NSURL::fileURLWithPath(&NSString::from_str(&target.to_string_lossy()));
    let operation = RefCell::new(Some(write));
    let outcome = RefCell::new(None);
    let accessor = block2::RcBlock::new(|url: std::ptr::NonNull<NSURL>| {
      // Apple's coordinator can supply an updated URL after a provider move.
      let coordinated_path = unsafe { url.as_ref() }.path().map(|s| PathBuf::from(s.to_string()));
      if let Some(operation) = operation.borrow_mut().take() {
        *outcome.borrow_mut() = Some(operation(coordinated_path.as_deref().unwrap_or(&target)));
      }
    });
    let mut error = None;
    // Both the revision check and replacement happen inside this single access
    // window, shared with macOS file presenters and cooperating sync providers.
    coordinator.coordinateWritingItemAtURL_options_error_byAccessor(
      &url, NSFileCoordinatorWritingOptions::ForReplacing, Some(&mut error), &accessor,
    );
    if let Some(error) = error { return Err(format!("Could not coordinate journal saving: {error}")); }
    let result = outcome.borrow_mut().take().ok_or_else(|| "The file coordinator did not allow writing.".to_string());
    result
  }
  #[cfg(not(target_os = "macos"))]
  { Ok(write(&target)) }
}

fn file_error_report(operation: &str, path: &Path, revision: &str, detail: &str) -> String {
  [
    "PC Journal error report".to_string(),
    format!("Time: {}", unix_milliseconds(SystemTime::now())),
    format!("Operation: {operation}"),
    format!("File: {}", path.display()),
    format!("Revision: {revision}"),
    "Device: Patrick’s Mac".to_string(),
    String::new(),
    detail.to_string(),
  ].join("\n")
}

#[tauri::command]
fn read_journal_document(path: String) -> Result<JournalDocument, String> {
  read_journal_from_path(Path::new(&path))
}

#[tauri::command]
fn create_journal_document(path: String, full_html: String) -> Result<JournalDocument, String> {
  let target = Path::new(&path);
  coordinated_write(target, |target| atomic_replace(target, &full_html))??;
  read_journal_from_path(target)
}

fn guarded_write_uncoordinated(
  path: String,
  expected_revision: String,
  full_html: String,
) -> GuardedWriteResult {
  let target = Path::new(&path);
  let remote = match read_journal_from_path(target) {
    Ok(document) => document,
    Err(detail) => return GuardedWriteResult {
      status: "failed".into(),
      document: None,
      report: Some(file_error_report("save journal", target, &expected_revision, &detail)),
    },
  };

  // The caller holds the local lock and macOS coordination for this entire
  // check-and-replace operation. A stale editor is rejected before replacement.
  if remote.revision != expected_revision || remote.conflict_count > 0 {
    return GuardedWriteResult {
      status: "remoteChanged".into(),
      report: Some(file_error_report(
        "save journal",
        target,
        &expected_revision,
        "The file changed after this editor opened it. The write was rejected. The editor will preserve the newest local draft separately.",
      )),
      document: Some(remote),
    };
  }

  if let Err(detail) = atomic_replace(target, &full_html) {
    return GuardedWriteResult {
      status: "failed".into(),
      document: Some(remote),
      report: Some(file_error_report("save journal", target, &expected_revision, &detail)),
    };
  }

  match read_journal_from_path(target) {
    Ok(document) => GuardedWriteResult {
      status: "saved".into(),
      document: Some(document),
      report: None,
    },
    Err(detail) => GuardedWriteResult {
      status: "failed".into(),
      document: None,
      report: Some(file_error_report("verify saved journal", target, &expected_revision, &detail)),
    },
  }
}

fn guarded_write_path(path: String, expected_revision: String, full_html: String) -> GuardedWriteResult {
  match coordinated_write(Path::new(&path), |target| {
    guarded_write_uncoordinated(target.to_string_lossy().into_owned(), expected_revision.clone(), full_html)
  }) {
    Ok(result) => result,
    Err(error) => GuardedWriteResult {
      status: "failed".into(), document: None,
      report: Some(file_error_report("save journal", Path::new(&path), &expected_revision, &error)),
    },
  }
}

#[tauri::command]
async fn guarded_write_journal(path: String, expected_revision: String, full_html: String) -> GuardedWriteResult {
  // Waiting for a sync provider must not freeze the app's UI thread.
  let report_path = path.clone();
  let report_revision = expected_revision.clone();
  tauri::async_runtime::spawn_blocking(move || guarded_write_path(path, expected_revision, full_html))
    .await.unwrap_or_else(|error| GuardedWriteResult {
      status: "failed".into(), document: None,
      report: Some(file_error_report("save journal", Path::new(&report_path), &report_revision, &error.to_string())),
    })
}

fn recovery_root<R: Runtime>(app: &tauri::AppHandle<R>, document_path: &str) -> Result<PathBuf, String> {
  let id = format!("{:x}", Sha256::digest(document_path.as_bytes()));
  let root = app.path().app_data_dir()
    .map_err(|error| format!("Could not find the app recovery folder: {error}"))?
    .join("recovery")
    .join(id);
  fs::create_dir_all(&root)
    .map_err(|error| format!("Could not create the app recovery folder: {error}"))?;
  Ok(root)
}

fn recovery_entries(root: &Path) -> Vec<RecoveryEntry> {
  let mut entries = fs::read_dir(root).into_iter().flatten().flatten()
    .filter_map(|item| {
      let path = item.path();
      if path.extension().and_then(|value| value.to_str()) != Some("html") { return None }
      let name = path.file_stem()?.to_string_lossy();
      let kind = if name.starts_with("conflict-") {
        "conflict"
      } else if name.starts_with("snapshot-") {
        "snapshot"
      } else if name == "latest-draft" {
        "draft"
      } else {
        return None
      };
      let created_at = item.metadata().ok()?.modified().map(unix_milliseconds).unwrap_or_default();
      Some(RecoveryEntry {
        path: path.to_string_lossy().into_owned(),
        kind: kind.into(),
        created_at,
      })
    })
    .collect::<Vec<_>>();
  entries.sort_by(|left, right| right.created_at.cmp(&left.created_at));
  entries
}

fn prune_snapshots(root: &Path) {
  let thirty_days = Duration::from_secs(30 * 24 * 60 * 60);
  let now = SystemTime::now();
  let snapshots = recovery_entries(root).into_iter()
    .filter(|entry| entry.kind == "snapshot")
    .collect::<Vec<_>>();

  for (index, entry) in snapshots.iter().enumerate() {
    let age = now.duration_since(UNIX_EPOCH + Duration::from_millis(entry.created_at)).unwrap_or_default();
    // Keep at least 50 recent snapshots and every snapshot from the last 30
    // days. Conflict copies never pass through this pruning function.
    if index >= 50 && age > thirty_days {
      let _ = fs::remove_file(&entry.path);
    }
  }
}

#[tauri::command]
async fn write_journal_recovery<R: Runtime>(
  app: tauri::AppHandle<R>,
  document_path: String,
  kind: String,
  full_html: String,
) -> Result<String, String> {
  // Hashing, scanning backups and flushing files to disk can take longer on a
  // synced or busy drive. Keep that work off the Mac window's event thread so
  // the editor can continue receiving keystrokes while a recovery copy saves.
  tauri::async_runtime::spawn_blocking(move || {
    let root = recovery_root(&app, &document_path)?;
    write_recovery_at(&root, &kind, &full_html)
  }).await.map_err(|error| format!("Recovery worker failed: {error}"))?
}

fn write_recovery_at(root: &Path, kind: &str, full_html: &str) -> Result<String, String> {
  if !["draft", "snapshot", "conflict"].contains(&kind) {
    return Err("Unknown recovery copy category.".into());
  }
  let revision = content_revision(full_html);
  let target = if kind == "draft" {
    root.join("latest-draft.html")
  } else {
    root.join(format!("{kind}-{}-{}.html", unix_milliseconds(SystemTime::now()), &revision[..12]))
  };
  // A conflict must remain a conflict even if a snapshot has identical text.
  // Otherwise normal snapshot cleanup could remove the promised retained copy.
  if kind != "draft" {
    let suffix = format!("-{}.html", &revision[..12]);
    if let Some(entry) = recovery_entries(root).into_iter().find(|entry| {
      entry.kind == kind && entry.path.ends_with(&suffix)
        && fs::read_to_string(&entry.path).ok().as_deref() == Some(full_html)
    }) { return Ok(entry.path); }
  }
  atomic_replace(&target, full_html)?;
  if kind == "snapshot" { prune_snapshots(root) }
  Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
fn list_journal_recovery<R: Runtime>(
  app: tauri::AppHandle<R>,
  document_path: String,
) -> Result<Vec<RecoveryEntry>, String> {
  Ok(recovery_entries(&recovery_root(&app, &document_path)?))
}

#[tauri::command]
fn read_latest_journal_draft<R: Runtime>(
  app: tauri::AppHandle<R>,
  document_path: String,
) -> Result<Option<RecoveryDraft>, String> {
  let root = recovery_root(&app, &document_path)?;
  let target = root.join("latest-draft.html");
  if !target.exists() { return Ok(None) }

  let metadata = fs::metadata(&target)
    .map_err(|error| format!("Could not inspect the latest recovery draft: {error}"))?;
  let full_html = fs::read_to_string(&target)
    .map_err(|error| format!("Could not read the latest recovery draft: {error}"))?;
  Ok(Some(RecoveryDraft {
    path: target.to_string_lossy().into_owned(),
    kind: "draft".into(),
    created_at: metadata.modified().map(unix_milliseconds).unwrap_or_default(),
    full_html,
  }))
}

#[cfg(test)]
mod document_safety_tests {
  use super::*;

  fn temporary_test_folder(label: &str) -> PathBuf {
    let unique = format!(
      "pc-journal-{label}-{}-{}",
      std::process::id(),
      unix_milliseconds(SystemTime::now()),
    );
    let folder = std::env::temp_dir().join(unique);
    fs::create_dir_all(&folder).expect("create isolated journal test folder");
    folder
  }

  #[test]
  fn revision_hash_is_stable_and_sensitive_to_content() {
    assert_eq!(content_revision("revision A"), content_revision("revision A"));
    assert_ne!(content_revision("revision A"), content_revision("revision B"));
    assert_eq!(content_revision("revision A").len(), 64);
  }

  #[test]
  fn stale_device_write_is_rejected_without_replacing_newer_text() {
    let folder = temporary_test_folder("two-device");
    let journal = folder.join("synthetic-journal.html");
    let revision_a = "<html><head></head><body><h1>A</h1><p>start</p></body></html>";
    let revision_b = "<html><head></head><body><h1>A</h1><p>saved by device one</p></body></html>";
    let stale_device_text = "<html><head></head><body><h1>A</h1><p>stale device two</p></body></html>";
    fs::write(&journal, revision_a).expect("write revision A");
    let hash_a = content_revision(revision_a);

    let first = guarded_write_path(
      journal.to_string_lossy().into_owned(),
      hash_a.clone(),
      revision_b.into(),
    );
    assert_eq!(first.status, "saved");

    let stale = guarded_write_path(
      journal.to_string_lossy().into_owned(),
      hash_a,
      stale_device_text.into(),
    );
    assert_eq!(stale.status, "remoteChanged");
    assert!(stale.report.unwrap_or_default().contains("write was rejected"));
    assert_eq!(fs::read_to_string(&journal).unwrap(), revision_b);
    let _ = fs::remove_dir_all(folder);
  }

  #[test]
  fn concurrent_writers_cannot_both_replace_the_same_revision() {
    use std::sync::{Arc, Barrier};
    let folder = temporary_test_folder("concurrent-writers");
    let path = folder.join("journal.html");
    fs::write(&path, "original").unwrap();
    let gate = Arc::new(Barrier::new(3));
    let workers = ["writer A", "writer B"].map(|text| {
      let path = path.clone();
      let gate = gate.clone();
      std::thread::spawn(move || {
        gate.wait();
        guarded_write_path(path.to_string_lossy().into_owned(), content_revision("original"), text.into())
      })
    });
    gate.wait();
    let results = workers.map(|worker| worker.join().unwrap());
    assert_eq!(results.iter().filter(|r| r.status == "saved").count(), 1);
    assert_eq!(results.iter().filter(|r| r.status == "remoteChanged").count(), 1);
    let winner = results.iter().find(|r| r.status == "saved").unwrap().document.as_ref().unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), winner.full_html);
    fs::remove_dir_all(folder).unwrap();
  }

  #[test]
  fn matching_conflict_survives_snapshot_deduplication_and_pruning() {
    let folder = temporary_test_folder("recovery-categories");
    let snapshot = write_recovery_at(&folder, "snapshot", "same writing").unwrap();
    let conflict = write_recovery_at(&folder, "conflict", "same writing").unwrap();
    assert_ne!(snapshot, conflict);
    assert_eq!(write_recovery_at(&folder, "conflict", "same writing").unwrap(), conflict);
    // Make the snapshot eligible for deletion without changing system time.
    let old = SystemTime::now() - Duration::from_secs(31 * 24 * 60 * 60);
    fs::File::options().write(true).open(&snapshot).unwrap()
      .set_times(fs::FileTimes::new().set_modified(old)).unwrap();
    for index in 0..50 {
      fs::write(folder.join(format!("snapshot-recent-{index}.html")), "recent").unwrap();
    }
    prune_snapshots(&folder);
    assert!(!Path::new(&snapshot).exists());
    assert_eq!(fs::read_to_string(&conflict).unwrap(), "same writing");
    fs::remove_dir_all(folder).unwrap();
  }

  #[test]
  fn atomic_save_preserves_private_file_permissions() {
    use std::os::unix::fs::PermissionsExt;
    let folder = temporary_test_folder("permissions");
    let path = folder.join("journal.html");
    fs::write(&path, "before").unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    atomic_replace(&path, "after").unwrap();
    assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
    assert_eq!(fs::read_dir(&folder).unwrap().count(), 1);
    fs::remove_dir_all(folder).unwrap();
  }

  #[test]
  fn failure_report_contains_operation_path_and_revision() {
    let missing = temporary_test_folder("error-report").join("missing.html");
    let result = guarded_write_path(
      missing.to_string_lossy().into_owned(),
      "known-revision".into(),
      "draft".into(),
    );
    let report = result.report.unwrap_or_default();
    assert_eq!(result.status, "failed");
    assert!(report.contains("Operation: save journal"));
    assert!(report.contains("missing.html"));
    assert!(report.contains("Revision: known-revision"));
  }
}

#[cfg(target_os = "macos")]
fn disable_selector_if_supported(target: *mut AnyObject, selector_name: &str, selector: objc2::runtime::Sel) {
  if target.is_null() {
    return
  }

  unsafe {
    let target = &*target;
    let responds: bool = msg_send![target, respondsToSelector: selector];

    // We only send these messages when the native object actually supports
    // them, which avoids crashing on selectors that are not present on older
    // macOS text objects.
    if responds {
      match selector_name {
        "setContinuousSpellCheckingEnabled:" => {
          let _: () = msg_send![target, setContinuousSpellCheckingEnabled: Bool::NO];
        }
        "setGrammarCheckingEnabled:" => {
          let _: () = msg_send![target, setGrammarCheckingEnabled: Bool::NO];
        }
        "setAutomaticQuoteSubstitutionEnabled:" => {
          let _: () = msg_send![target, setAutomaticQuoteSubstitutionEnabled: Bool::NO];
        }
        "setAutomaticDashSubstitutionEnabled:" => {
          let _: () = msg_send![target, setAutomaticDashSubstitutionEnabled: Bool::NO];
        }
        "setAutomaticTextReplacementEnabled:" => {
          let _: () = msg_send![target, setAutomaticTextReplacementEnabled: Bool::NO];
        }
        "setAutomaticSpellingCorrectionEnabled:" => {
          let _: () = msg_send![target, setAutomaticSpellingCorrectionEnabled: Bool::NO];
        }
        "setAutomaticTextCompletionEnabled:" => {
          let _: () = msg_send![target, setAutomaticTextCompletionEnabled: Bool::NO];
        }
        "setSmartInsertDeleteEnabled:" => {
          let _: () = msg_send![target, setSmartInsertDeleteEnabled: Bool::NO];
        }
        _ => {}
      }
    }
  }
}

#[cfg(target_os = "macos")]
fn disable_native_text_assistance_for_target(target: *mut AnyObject) {
  disable_selector_if_supported(
    target,
    "setContinuousSpellCheckingEnabled:",
    sel!(setContinuousSpellCheckingEnabled:),
  );
  disable_selector_if_supported(
    target,
    "setGrammarCheckingEnabled:",
    sel!(setGrammarCheckingEnabled:),
  );
  disable_selector_if_supported(
    target,
    "setAutomaticQuoteSubstitutionEnabled:",
    sel!(setAutomaticQuoteSubstitutionEnabled:),
  );
  disable_selector_if_supported(
    target,
    "setAutomaticDashSubstitutionEnabled:",
    sel!(setAutomaticDashSubstitutionEnabled:),
  );
  disable_selector_if_supported(
    target,
    "setAutomaticTextReplacementEnabled:",
    sel!(setAutomaticTextReplacementEnabled:),
  );
  disable_selector_if_supported(
    target,
    "setAutomaticSpellingCorrectionEnabled:",
    sel!(setAutomaticSpellingCorrectionEnabled:),
  );
  disable_selector_if_supported(
    target,
    "setAutomaticTextCompletionEnabled:",
    sel!(setAutomaticTextCompletionEnabled:),
  );
  disable_selector_if_supported(
    target,
    "setSmartInsertDeleteEnabled:",
    sel!(setSmartInsertDeleteEnabled:),
  );
}

#[cfg(target_os = "macos")]
fn disable_native_text_assistance<R: tauri::Runtime>(
  webview_window: &tauri::WebviewWindow<R>,
) -> tauri::Result<()> {
  webview_window.with_webview(|webview| unsafe {
    let webview_target = webview.inner().cast::<AnyObject>();
    let window_target = webview.ns_window().cast::<AnyObject>();

    // The bundled macOS app can re-enable native text helpers at the WebKit
    // layer, so we switch them off on the webview itself.
    disable_native_text_assistance_for_target(webview_target);

    // Some of the text helpers live on the active responder rather than the
    // WKWebView object, so we also disable them there when available.
    let first_responder: *mut AnyObject = msg_send![&*window_target, firstResponder];
    disable_native_text_assistance_for_target(first_responder);
  })
}

#[cfg(target_os = "macos")]
static MAC_QUIT_REQUEST: std::sync::OnceLock<Box<dyn Fn() -> bool + Send + Sync>> = std::sync::OnceLock::new();

#[cfg(target_os = "macos")]
extern "C" fn application_should_terminate(
  _delegate: &AnyObject,
  _selector: objc2::runtime::Sel,
  _application: *mut AnyObject,
) -> usize {
  // AppKit's normal Quit menu and Dock Quit bypass Tauri's ExitRequested event.
  // NSTerminateCancel (0) keeps WebKit alive while the editor saves; the normal
  // finish_journal_close command then exits after successful preservation.
  if MAC_QUIT_REQUEST.get().map(|request| request()).unwrap_or(false) { 0 } else { 1 }
}

#[cfg(target_os = "macos")]
fn install_mac_quit_guard<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
  use objc2::runtime::{AnyClass, ClassBuilder};
  let handle = app.clone();
  MAC_QUIT_REQUEST.set(Box::new(move || {
    if close_needs_save(&handle) {
      let _ = handle.emit("journal-close-requested", ());
      true
    } else { false }
  })).map_err(|_| "The native quit guard was already installed.".to_string())?;

  unsafe {
    let application: *mut AnyObject = msg_send![objc2::class!(NSApplication), sharedApplication];
    let delegate: *mut AnyObject = msg_send![&*application, delegate];
    let delegate = delegate.as_ref().ok_or("macOS did not provide an application delegate.")?;
    let name = std::ffi::CStr::from_bytes_with_nul(b"PCJournalSavingDelegate\0").unwrap();
    let class = if let Some(class) = AnyClass::get(name) { class } else {
      // Add no fields and inherit every existing Tauri delegate method. Only
      // the termination decision changes; file-open and window events remain
      // owned by Tauri. This runs once on the main thread during app setup.
      let mut subclass = ClassBuilder::new(name, delegate.class()).ok_or("Could not register the saving delegate.")?;
      subclass.add_method(sel!(applicationShouldTerminate:), application_should_terminate
        as extern "C" fn(_, _, _) -> _);
      subclass.register()
    };
    // The subclass has the same instance layout, so existing delegate state
    // remains valid and its original destructor is inherited unchanged.
    AnyObject::set_class(delegate, class);
    // Reassign the same delegate so AppKit refreshes its optional-method cache.
    let _: () = msg_send![&*application, setDelegate: delegate];
  }
  Ok(())
}

// Closing the window and Cmd+Q use the same handshake with the editor. The
// app stays alive if saving fails, so its copyable error report remains visible.
#[derive(Default)]
struct CloseGuard {
  ready: AtomicBool,
  approved: AtomicBool,
}

#[tauri::command]
fn enable_journal_close_guard(state: tauri::State<'_, CloseGuard>) {
  state.ready.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn finish_journal_close<R: Runtime>(app: tauri::AppHandle<R>, state: tauri::State<'_, CloseGuard>) {
  state.approved.store(true, Ordering::SeqCst);
  app.exit(0);
}

fn close_needs_save<R: Runtime>(app: &tauri::AppHandle<R>) -> bool {
  let guard = app.state::<CloseGuard>();
  guard.ready.load(Ordering::SeqCst) && !guard.approved.load(Ordering::SeqCst)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(CloseGuard::default())
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        if close_needs_save(window.app_handle()) {
          api.prevent_close();
          let _ = window.emit("journal-close-requested", ());
        }
      }
    })
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .invoke_handler(tauri::generate_handler![
      enable_journal_close_guard,
      finish_journal_close,
      read_journal_document,
      create_journal_document,
      guarded_write_journal,
      write_journal_recovery,
      list_journal_recovery,
      read_latest_journal_draft,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      #[cfg(target_os = "macos")]
      {
        install_mac_quit_guard(app.handle()).map_err(std::io::Error::other)?;
        if let Some(main_window) = app.get_webview_window("main") {
          // This keeps the packaged macOS app from showing the inline word
          // completion and substitution helpers that make the journal feel
          // heavier than a plain writing surface.
          disable_native_text_assistance(&main_window)?;
        }
      }

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      if let tauri::RunEvent::ExitRequested { api, .. } = event {
        if close_needs_save(app) {
          api.prevent_exit();
          let _ = app.emit("journal-close-requested", ());
        }
      }
    });
}
