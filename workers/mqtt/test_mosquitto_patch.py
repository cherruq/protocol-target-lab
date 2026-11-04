"""Verify the shipped source backport applies exactly and fails closed on drift."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
PATCHES=ROOT/'third-party/mosquitto/patches'

class BackportTests(unittest.TestCase):
    def test_apply_pristine_archive_and_reject_second_application(self):
        (ROOT/'build').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='mqtt-patch-test-',dir=ROOT/'build') as work:
            source=Path(work)/'lib/packet_mosq.c';source.parent.mkdir()
            with tarfile.open(ROOT/'third-party/mosquitto/mosquitto-2.0.18.tar.gz') as archive:
                source.write_bytes(archive.extractfile('mosquitto-2.0.18/lib/packet_mosq.c').read())
            result=subprocess.run([sys.executable,str(PATCHES/'apply.py'),work],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            meta=json.loads((PATCHES/'source.json').read_text())
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),meta['patched_sha256'])
            again=subprocess.run([sys.executable,str(PATCHES/'apply.py'),work],capture_output=True,text=True)
            self.assertNotEqual(again.returncode,0)
            self.assertIn('source hash mismatch',again.stderr)
    def test_reject_modified_source_before_patching(self):
        (ROOT/'build').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='mqtt-patch-test-',dir=ROOT/'build') as work:
            source=Path(work)/'lib/packet_mosq.c';source.parent.mkdir();source.write_text('unexpected source\n')
            result=subprocess.run([sys.executable,str(PATCHES/'apply.py'),work],capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            self.assertIn('source hash mismatch',result.stderr)
            self.assertEqual(source.read_text(),'unexpected source\n')

if __name__=='__main__':unittest.main()
