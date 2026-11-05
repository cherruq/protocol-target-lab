"""Exercise package lifecycle scripts against staged paths, never the installed service."""
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class NativeStorePackageTests(unittest.TestCase):
    def fixture(self, task):
        base = pathlib.Path(task)
        state, config, defaults = base / 'state', base / 'config', base / 'defaults'
        state.mkdir()
        config.mkdir()
        defaults.write_text('PLAB_PROFINET_IMAGE=local/image:test\n')
        (config / 'instances.json').write_text('{"deployment_id":"saved"}')
        (state / 'deployment-id').write_text('saved-deployment-identity')
        (state / 'profinet').mkdir()
        (state / 'profinet' / 'profinet-demo.json').write_bytes(b'trusted native volume receipt must survive')
        return base, state, config, defaults

    def postrm(self, base, state, config, defaults):
        text = (ROOT / 'packaging/debian/postrm').read_text()
        text = text.replace('/etc/default/protocol-target-lab', str(defaults))
        text = text.replace('/etc/protocol-target-lab', str(config))
        text = text.replace('/var/lib/protocol-target-lab', str(state))
        text = text.replace('/run/systemd/system', str(base / 'absent-systemd'))
        text = text.replace('/run/protocol-target-lab', str(base / 'absent-run'))
        script = base / 'postrm'
        script.write_text(text)
        return subprocess.run(['sh', str(script), 'purge'], capture_output=True, text=True, timeout=5)

    def test_purge_preserves_native_receipt_and_deployment_identity(self):
        with tempfile.TemporaryDirectory(prefix='plab-profinet-package-') as task:
            base, state, config, defaults = self.fixture(task)
            receipt = state / 'profinet/profinet-demo.json'
            before = receipt.read_bytes()
            result = self.postrm(base, state, config, defaults)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(receipt.read_bytes(), before)
            self.assertEqual((state / 'deployment-id').read_text(), 'saved-deployment-identity')
            self.assertFalse(config.exists())
            self.assertFalse(defaults.exists())

    def test_unknown_helper_receipt_still_refuses_purge(self):
        with tempfile.TemporaryDirectory(prefix='plab-profinet-package-') as task:
            base, state, config, defaults = self.fixture(task)
            helper = state / 'igmp-links'
            helper.mkdir()
            (helper / 'foreign.json').write_bytes(b'preserve')
            result = self.postrm(base, state, config, defaults)
            self.assertNotEqual(result.returncode, 0)
            self.assertTrue(config.exists())
            self.assertTrue(defaults.exists())
            self.assertEqual((helper / 'foreign.json').read_bytes(), b'preserve')
            self.assertTrue((state / 'deployment-id').exists())

    def test_purge_does_not_follow_native_metadata_symlink(self):
        with tempfile.TemporaryDirectory(prefix='plab-profinet-package-') as task:
            base, state, config, defaults = self.fixture(task)
            outside = base / 'outside'
            outside.mkdir()
            sentinel = outside / 'native.bin'
            sentinel.write_bytes(b'untouched native bytes')
            receipt = state / 'profinet/profinet-demo.json'
            receipt.unlink()
            (state / 'profinet').rmdir()
            (state / 'profinet').symlink_to(outside, target_is_directory=True)
            result = self.postrm(base, state, config, defaults)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(sentinel.read_bytes(), b'untouched native bytes')
            self.assertTrue((state / 'deployment-id').exists())

    def test_upgrade_does_not_stop_protocol_workers(self):
        with tempfile.TemporaryDirectory(prefix='plab-profinet-package-') as task:
            base = pathlib.Path(task)
            text = (ROOT / 'packaging/debian/prerm').read_text()
            calls = base / 'unexpected-stop'
            fake = base / 'plabctl'
            fake.write_text('#!/bin/sh\nprintf unexpected > "' + str(calls) + '"\nexit 1\n')
            fake.chmod(0o755)
            text = text.replace('/usr/bin/plabctl', str(fake))
            script = base / 'prerm'
            script.write_text(text)
            result = subprocess.run(['sh', str(script), 'upgrade'], capture_output=True, timeout=5)
            self.assertEqual(result.returncode, 0)
            self.assertFalse(calls.exists())


if __name__ == '__main__':
    unittest.main()
