"""Install this app's local daily job; never schedules a Codex/cloud task."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile


def _atomic_bytes(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(data)
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def install(root, app, hour=12, minute=0, enabled=True):
    root, app = Path(root), Path(app)
    if not 0 <= hour < 24 or not 0 <= minute < 60:
        raise ValueError('Invalid local time')
    config_path = root / 'config.json'
    original_config = config_path.read_bytes()
    config = json.loads(original_config)
    label = 'com.pcjournal.native-preview.timeline'
    domain = f'gui/{os.getuid()}'
    path = Path.home() / 'Library/LaunchAgents' / f'{label}.plist'
    original_agent = path.read_bytes() if path.exists() else None
    content = None
    if enabled:
        worker = app / 'Contents/Resources/Timeline/timeline_worker.py'
        if not worker.is_file():
            raise FileNotFoundError(worker)
        if not os.access(config['pythonPath'], os.X_OK):
            raise FileNotFoundError('The local analysis Python runtime is missing or not executable.')
        content = {'Label': label, 'ProgramArguments': [config['pythonPath'], str(worker), '--state-dir', str(root)],
                   'StartCalendarInterval': {'Hour': hour, 'Minute': minute}, 'ProcessType': 'Background', 'Nice': 10,
                   'StandardOutPath': str(root / 'scheduled.log'), 'StandardErrorPath': str(root / 'scheduled.log'),
                   'EnvironmentVariables': {'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1', 'PYTHONUNBUFFERED': '1'}}
    config.update(dailyEnabled=enabled, hour=hour, minute=minute)
    # Validate the replacement before unloading a working daily job. Restore
    # both files and the prior agent if launchd rejects the new registration.
    try:
        subprocess.run(['/bin/launchctl', 'bootout', f'{domain}/{label}'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if enabled:
            _atomic_bytes(path, plistlib.dumps(content))
            subprocess.run(['/bin/launchctl', 'bootstrap', domain, str(path)], check=True)
        else:
            path.unlink(missing_ok=True)
        _atomic_bytes(config_path, json.dumps(config, indent=2).encode())
    except Exception as failure:
        restored = True
        subprocess.run(['/bin/launchctl', 'bootout', f'{domain}/{label}'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if original_agent is not None:
            _atomic_bytes(path, original_agent)
            restored = subprocess.run(['/bin/launchctl', 'bootstrap', domain, str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
        else:
            path.unlink(missing_ok=True)
        _atomic_bytes(config_path, original_config)
        if not restored:
            raise RuntimeError('The new daily job failed and macOS could not restore the previous job. Its saved configuration was preserved; re-enable it when launchd is available.') from failure
        raise
    if enabled:
        print(f'Daily local timeline sync enabled at {hour:02}:{minute:02}.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--state-dir', required=True)
    parser.add_argument('--app', default='/Applications/journal.app')
    parser.add_argument('--hour', type=int, default=12)
    parser.add_argument('--minute', type=int, default=0)
    parser.add_argument('--disable', action='store_true')
    args = parser.parse_args()
    if not 0 <= args.hour < 24 or not 0 <= args.minute < 60:
        parser.error('Invalid local time')
    install(args.state_dir, args.app, args.hour, args.minute, not args.disable)
