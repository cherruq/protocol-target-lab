"""MIT. Non-root unit/real-FD tests; privileged lifecycle is verified separately."""
import contextlib
import json
import os
from pathlib import Path
import select
import socket
import stat
import subprocess
import sys
import tempfile
import termios
import threading
import time
import types
import unittest
from unittest import mock

import iec101_serial as helper


class SerialHelperTests(unittest.TestCase):
    def test_targets_are_literal_unicast_and_distinct_ports(self):
        for host in ("127.0.0.1", "192.0.2.28"):
            self.assertEqual(helper.validate_config(host, 1, 65535)["host"], host)
        for host in ("0.0.0.0", "224.0.0.1", "255.255.255.255", "localhost", "::1", "127.000.0.1"):
            with self.assertRaises(helper.HelperError):
                helper.validate_config(host, 18661, 18662)
        for ports in ((0, 2), (1, 65536), (1, 1), (True, 2), (1.5, 2)):
            with self.assertRaises(helper.HelperError):
                helper.validate_config("127.0.0.1", *ports)

    def test_pid_birth_uid_nonce_and_exact_isolated_cmdline_guard(self):
        raw_stat = Path("/proc/self/stat").read_text()
        ticks = helper.start_ticks(raw_stat)
        nonce = "a" * 32
        argv = ["/usr/bin/python3", "-I", "/root/helper.py", "_serve", "--nonce", nonce]
        owner = {"pid": 1234, "uid": 0, "start_ticks": ticks, "nonce": nonce, "argv": argv}
        files = {"stat": raw_stat, "status": "Name:\ttest\nUid:\t0\t0\t0\t0\n",
                 "cmdline": b"\0".join(a.encode() for a in argv) + b"\0"}

        class FakePath:
            def __init__(self, name): self.name = str(name)
            def __truediv__(self, name): return FakePath(name)
            def read_text(self): return files[self.name]
            def read_bytes(self): return files[self.name]

        with mock.patch.object(helper, "Path", FakePath):
            self.assertTrue(helper.process_matches(owner))
            for changed in ({**owner, "start_ticks": ticks + 1}, {**owner, "uid": 1000},
                            {**owner, "nonce": "b" * 32}, {**owner, "argv": ["sleep", "1000"]},
                            {**owner, "argv": [1]}, {**owner, "pid": 1}):
                self.assertFalse(helper.process_matches(changed))
            files["status"] = "Uid:\t0\t1000\t0\t0\n"
            self.assertFalse(helper.process_matches(owner))

    def test_owned_link_cleanup_never_removes_replacement_or_target(self):
        with tempfile.TemporaryDirectory(prefix="plab-helper-unit-") as directory:
            root = Path(directory)
            target = root / "target"
            target.write_text("keep")
            link = root / "iec101-a"
            link.symlink_to(target)
            identity = helper.path_identity(link)
            self.assertTrue(helper.unlink_owned(link, identity))
            self.assertEqual(target.read_text(), "keep")
            link.symlink_to(target)
            old = helper.path_identity(link)
            link.unlink()
            link.symlink_to(root / "unrelated")
            self.assertFalse(helper.unlink_owned(link, old))
            self.assertEqual(os.readlink(link), str(root / "unrelated"))

    def test_stale_pid_status_is_readonly_and_stop_never_signals_reused_pid(self):
        state = {"owner": {"pid": 12345}, "config": {}, "paths": {}}
        regular_root = types.SimpleNamespace(st_uid=0, st_mode=stat.S_IFREG | 0o644)
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.object(helper.os, "geteuid", return_value=0))
            stack.enter_context(mock.patch.object(helper.os, "stat", return_value=regular_root))
            stack.enter_context(mock.patch.object(helper, "_secure_dirs"))
            stack.enter_context(mock.patch.object(helper, "control_lock", return_value=contextlib.nullcontext()))
            stack.enter_context(mock.patch.object(helper, "read_state", return_value=state))
            stack.enter_context(mock.patch.object(helper, "process_matches", return_value=False))
            stack.enter_context(mock.patch.object(helper, "lifetime_held", return_value=False))
            cleanup = stack.enter_context(mock.patch.object(helper, "cleanup_state"))
            pidfd = stack.enter_context(mock.patch.object(helper.os, "pidfd_open"))
            result = helper.command("status")
            self.assertTrue(result["stale"])
            cleanup.assert_not_called()
            self.assertTrue(helper.command("stop")["stopped"])
            cleanup.assert_called_once_with(state)
            pidfd.assert_not_called()

    def test_partial_write_keeps_original_absolute_deadline_and_buffer_bound(self):
        pending = helper.Pending()
        pending.append(b"abc", 10)
        pending.append(b"de", 11)
        seen = []

        def once(data):
            if seen:
                raise BlockingIOError()
            seen.append(bytes(data[:1]))
            return 1

        pending.flush(once, 12)
        self.assertEqual(seen, [b"a"])
        self.assertEqual(pending.size, 4)
        self.assertTrue(pending.expired(13))
        with self.assertRaises(helper.HelperError):
            pending.flush(lambda data: len(data), 13)
        pending.clear()
        pending.append(b"x" * helper.LIMIT, 20)
        with self.assertRaises(helper.HelperError):
            pending.append(b"x", 20)

    def test_actual_raw_pty_bidirectional_bytes_9600_8n1(self):
        master, slave = os.openpty()
        try:
            helper.raw_pty(slave)
            for fd in (master, slave): os.set_blocking(fd, False)
            attrs = termios.tcgetattr(slave)
            self.assertEqual(attrs[4:6], [termios.B9600, termios.B9600])
            self.assertFalse(attrs[3] & (termios.ICANON | termios.ECHO))
            self.assertEqual(attrs[2] & termios.CSIZE, termios.CS8)
            self.assertFalse(attrs[2] & (termios.PARENB | termios.CSTOPB))
            payload = b"\0\x11\x13\r\n\xff\x68\x16"
            for source, destination in ((slave, master), (master, slave)):
                os.write(source, payload)
                self.assertTrue(select.select([destination], [], [], .5)[0])
                self.assertEqual(os.read(destination, 1024), payload)
        finally:
            os.close(master)
            os.close(slave)

    def test_stop_halfcloses_and_waits_for_target_cleanup_eof(self):
        client, peer = socket.socketpair()
        client.setblocking(False)
        eof_seen = threading.Event()

        def target():
            try:
                self.assertEqual(peer.recv(1024), b"")
                eof_seen.set()
                time.sleep(.02)
                peer.sendall(b"last-response")
            finally:
                peer.close()

        worker = threading.Thread(target=target)
        worker.start()
        try:
            helper.finish_tcp_sessions([client])
            self.assertTrue(eof_seen.is_set())
            self.assertEqual(client.recv(1024), b"")
        finally:
            client.close()
            worker.join(timeout=1)
        self.assertFalse(worker.is_alive())

    def test_real_fd_offline_drop_no_replay_and_stable_pty_on_disconnect(self):
        with mock.patch.object(helper.os, "fchown"), mock.patch.object(helper.grp, "getgrnam", return_value=types.SimpleNamespace(gr_gid=os.getgid())):
            channel = helper.Channel("iec101-a", "127.0.0.1", 18661)
        peers = []
        try:
            target = channel.target
            os.write(channel.slave, b"offline-before")
            channel.read_pty()
            self.assertEqual(channel.offline_dropped, 14)
            self.assertEqual(channel.to_tcp.size, 0)
            first, peer = socket.socketpair()
            peers.append(peer)
            first.setblocking(False)
            peer.setblocking(False)
            channel.sock, channel.connected = first, True
            os.write(channel.slave, b"online\0")
            channel.read_pty()
            channel.to_tcp.flush(first.send, time.monotonic())
            self.assertEqual(peer.recv(1024), b"online\0")
            peer.send(b"reply\xff")
            channel.read_tcp()
            channel.to_pty.flush(lambda data: os.write(channel.master, data), time.monotonic())
            self.assertEqual(os.read(channel.slave, 1024), b"reply\xff")
            peer.close()
            channel.read_tcp()
            self.assertFalse(channel.connected)
            self.assertEqual(channel.target, target)
            os.write(channel.slave, b"stale-after")
            channel.read_pty()
            second, peer = socket.socketpair()
            peers.append(peer)
            second.setblocking(False)
            peer.setblocking(False)
            channel.discard_pty()
            channel.sock, channel.connected = second, True
            with self.assertRaises(BlockingIOError): peer.recv(1024)
            os.write(channel.slave, b"fresh")
            channel.read_pty()
            channel.to_tcp.flush(second.send, time.monotonic())
            self.assertEqual(peer.recv(1024), b"fresh")
            with mock.patch.object(helper.socket, "socket", side_effect=AssertionError("active channel must not reconnect")):
                channel.connect()
            self.assertEqual(channel.target, target)
        finally:
            channel.close()
            for peer in peers: peer.close()

    @unittest.skipIf(os.geteuid() == 0, "non-root permission case")
    def test_nonroot_status_rejected_without_creating_runtime(self):
        result = subprocess.run([sys.executable, "-I", str(Path(helper.__file__).resolve()), "status"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn("requires root", json.loads(result.stderr)["error"])
        self.assertFalse(result.stdout)


if __name__ == "__main__":
    unittest.main()
