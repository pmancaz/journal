import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import setup_timeline as setup


class DownloadTests(unittest.TestCase):
    def test_interrupted_download_cannot_install_a_partial_file(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'model.onnx'
            def interrupted(url, path):
                path.write_bytes(b'partial bytes')
                raise OSError('Network interruption')
            with patch.object(setup.urllib.request, 'urlretrieve', side_effect=interrupted):
                with self.assertRaises(OSError): setup.download_checked('fixture://model', target)
            self.assertFalse(target.exists())
            self.assertEqual(list(Path(folder).iterdir()), [])

    def test_bad_replacement_preserves_previously_valid_model(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'model.onnx'; target.write_bytes(b'previous valid data')
            def download(url, path): path.write_bytes(b'bad replacement')
            with patch.object(setup.urllib.request, 'urlretrieve', side_effect=download):
                with self.assertRaisesRegex(RuntimeError, 'checksum'):
                    setup.download_checked('fixture://model', target, checksum=hashlib.sha256(b'expected data').hexdigest())
            self.assertEqual(target.read_bytes(), b'previous valid data')
            self.assertEqual(len(list(Path(folder).iterdir())), 1)

    def test_tokenizer_must_be_valid_json_before_install(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'tokenizer.json'
            def download(url, path): path.write_bytes(b'{incomplete')
            with patch.object(setup.urllib.request, 'urlretrieve', side_effect=download):
                with self.assertRaises(ValueError): setup.download_checked('fixture://tokenizer', target, json_file=True)
            self.assertFalse(target.exists())

    def test_verified_download_installs_and_cleans_up_temporary_file(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'model.onnx'; content = b'complete fixture model'
            def download(url, path): path.write_bytes(content)
            with patch.object(setup.urllib.request, 'urlretrieve', side_effect=download):
                setup.download_checked('fixture://model', target, checksum=hashlib.sha256(content).hexdigest())
            self.assertEqual(target.read_bytes(), content)
            self.assertEqual(len(list(Path(folder).iterdir())), 1)


if __name__ == '__main__': unittest.main()
