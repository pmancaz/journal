import json
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import install_timeline_schedule as schedule


class ScheduleTests(unittest.TestCase):
    def fixture(self, root):
        state = root / 'state'; state.mkdir()
        runtime = root / 'python'; runtime.write_text('fixture'); runtime.chmod(0o700)
        config = {'pythonPath': str(runtime), 'dailyEnabled': True, 'hour': 12, 'minute': 0}
        (state / 'config.json').write_text(json.dumps(config))
        agent = root / 'Library/LaunchAgents/com.pcjournal.native-preview.timeline.plist'
        agent.parent.mkdir(parents=True)
        agent.write_bytes(plistlib.dumps({'Label': 'old working agent'}))
        app = root / 'journal.app'
        worker = app / 'Contents/Resources/Timeline/timeline_worker.py'
        worker.parent.mkdir(parents=True); worker.write_text('fixture')
        return state, app, agent, worker

    def test_invalid_replacement_does_not_unload_working_agent(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            state, app, agent, worker = self.fixture(root)
            original = agent.read_bytes(); config = (state / 'config.json').read_bytes()
            worker.unlink()
            with patch.object(Path, 'home', return_value=root), patch.object(schedule.subprocess, 'run') as run:
                with self.assertRaises(FileNotFoundError): schedule.install(state, app, 13, 30)
                run.assert_not_called()
            self.assertEqual(agent.read_bytes(), original)
            self.assertEqual((state / 'config.json').read_bytes(), config)

    def test_launchd_failure_restores_previous_schedule_and_configuration(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            state, app, agent, _ = self.fixture(root)
            original = agent.read_bytes(); config = (state / 'config.json').read_bytes()
            calls = []
            def run(args, **kwargs):
                calls.append(args)
                if args[1] == 'bootstrap' and kwargs.get('check'):
                    raise subprocess.CalledProcessError(5, args)
                return subprocess.CompletedProcess(args, 0)
            with patch.object(Path, 'home', return_value=root), patch.object(schedule.subprocess, 'run', side_effect=run):
                with self.assertRaises(subprocess.CalledProcessError): schedule.install(state, app, 13, 30)
            self.assertEqual(agent.read_bytes(), original)
            self.assertEqual((state / 'config.json').read_bytes(), config)
            self.assertEqual(sum(args[1] == 'bootstrap' for args in calls), 2)

    def test_failed_rollback_reports_that_the_previous_job_is_not_running(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            state, app, agent, _ = self.fixture(root)
            original = agent.read_bytes()
            def run(args, **kwargs):
                if args[1] == 'bootstrap':
                    if kwargs.get('check'):
                        raise subprocess.CalledProcessError(5, args)
                    return subprocess.CompletedProcess(args, 5)
                return subprocess.CompletedProcess(args, 0)
            with patch.object(Path, 'home', return_value=root), patch.object(schedule.subprocess, 'run', side_effect=run):
                with self.assertRaisesRegex(RuntimeError, 'could not restore'):
                    schedule.install(state, app, 13, 30)
            self.assertEqual(agent.read_bytes(), original)

    def test_success_records_new_time_and_exact_local_worker(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            state, app, agent, worker = self.fixture(root)
            with patch.object(Path, 'home', return_value=root), patch.object(schedule.subprocess, 'run'):
                schedule.install(state, app, 13, 30)
            value = plistlib.loads(agent.read_bytes())
            self.assertEqual(value['StartCalendarInterval'], {'Hour': 13, 'Minute': 30})
            self.assertEqual(value['ProgramArguments'][1], str(worker))
            self.assertEqual(json.loads((state / 'config.json').read_text())['hour'], 13)
            self.assertEqual((state / 'config.json').stat().st_mode & 0o777, 0o600)

    def test_disabling_works_when_runtime_was_removed(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            state, app, agent, _ = self.fixture(root)
            (root / 'python').unlink()
            with patch.object(Path, 'home', return_value=root), patch.object(schedule.subprocess, 'run'):
                schedule.install(state, app, enabled=False)
            self.assertFalse(agent.exists())
            self.assertFalse(json.loads((state / 'config.json').read_text())['dailyEnabled'])


if __name__ == '__main__': unittest.main()
