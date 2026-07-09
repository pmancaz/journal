use tauri::Manager;

#[cfg(target_os = "macos")]
use objc2::{
  msg_send, sel,
  runtime::{AnyObject, Bool},
};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
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
        if let Some(main_window) = app.get_webview_window("main") {
          // This keeps the packaged macOS app from showing the inline word
          // completion and substitution helpers that make the journal feel
          // heavier than a plain writing surface.
          disable_native_text_assistance(&main_window)?;
        }
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
