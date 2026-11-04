"""Validate the public native compatibility patch and fail-closed source assertions."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[2];PATCH=ROOT/'third-party/iec104/patches'
class NativePatchTests(unittest.TestCase):
    def test_pristine_patch_and_repeat_rejected(self):
        meta=json.loads((PATCH/'source.json').read_text());(ROOT/'build').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='iec104-patch-test-',dir=ROOT/'build') as work:
            target=Path(work)/meta['source_file'];target.parent.mkdir(parents=True)
            with tarfile.open(ROOT/'third-party/iec104/c104-2.2.1.tar.gz') as archive:target.write_bytes(archive.extractfile('c104-2.2.1/'+meta['source_file']).read())
            p=subprocess.run([sys.executable,str(PATCH/'apply.py'),work],capture_output=True,text=True);self.assertEqual(p.returncode,0,p.stderr)
            self.assertEqual(hashlib.sha256(target.read_bytes()).hexdigest(),meta['patched_sha256'])
            p=subprocess.run([sys.executable,str(PATCH/'apply.py'),work],capture_output=True,text=True);self.assertNotEqual(p.returncode,0);self.assertIn('source hash mismatch',p.stderr)
    def test_source_drift_refuses_without_write(self):
        meta=json.loads((PATCH/'source.json').read_text());(ROOT/'build').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='iec104-patch-test-',dir=ROOT/'build') as work:
            target=Path(work)/meta['source_file'];target.parent.mkdir(parents=True);target.write_text('unexpected\n')
            p=subprocess.run([sys.executable,str(PATCH/'apply.py'),work],capture_output=True,text=True);self.assertNotEqual(p.returncode,0);self.assertIn('source hash mismatch',p.stderr);self.assertEqual(target.read_text(),'unexpected\n')
if __name__=='__main__':unittest.main()
