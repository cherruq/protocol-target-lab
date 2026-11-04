#!/usr/bin/env python3
"""MIT. Root-owned, bounded, explicit-reconnect IEC101 PTY/TCP helper.

No FT1.2 parser or synthetic acknowledgements. This is a local byte transport,
not SSH, a physical serial driver, or a protocol health probe.
"""
import argparse
import contextlib
import errno
import fcntl
import grp
import ipaddress
import json
import os
from pathlib import Path
import select
import signal
import socket
import stat
import struct
import subprocess
import sys
import termios
import time
import tty
import uuid
from collections import deque

ROOT = Path("/run/protocol-target-lab/serial")
LIMIT = 65536
TIMEOUT = 3.0


class HelperError(Exception):
    pass


class UsageError(HelperError):
    pass


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise UsageError(message)


def validate_config(host, single_port, double_port):
    try:
        address = ipaddress.IPv4Address(host)
    except (ValueError, TypeError) as exc:
        raise HelperError("host must be a literal IPv4 address") from exc
    if address.is_unspecified or address.is_multicast or str(address) == "255.255.255.255":
        raise HelperError("host must be a reachable unicast IPv4, not wildcard/multicast/broadcast")
    if any(type(port) is not int or not 1 <= port <= 65535 for port in (single_port, double_port)):
        raise HelperError("both TCP ports must be integers from 1 to 65535")
    if single_port == double_port:
        raise HelperError("single and double TCP ports must differ")
    return {"host": str(address), "single_port": single_port, "double_port": double_port}


def start_ticks(text):
    # comm may itself contain spaces and parentheses; field22 follows final ')'.
    return int(text[text.rindex(")") + 2:].split()[19])


def process_matches(owner):
    try:
        pid = owner["pid"]
        if (type(pid) is not int or pid <= 1 or type(owner["uid"]) is not int
                or owner["uid"] != 0 or type(owner["start_ticks"]) is not int
                or not isinstance(owner["argv"], list)
                or not all(isinstance(arg, str) for arg in owner["argv"])
                or not isinstance(owner["nonce"], str)):
            return False
        proc = Path(f"/proc/{pid}")
        actual_ticks = start_ticks((proc / "stat").read_text())
        uids = next(line.split()[1:] for line in (proc / "status").read_text().splitlines() if line.startswith("Uid:"))
        argv = (proc / "cmdline").read_bytes().split(b"\0")[:-1]
        expected = [arg.encode() for arg in owner["argv"]]
        nonce = owner["nonce"]
        return (actual_ticks == owner["start_ticks"] and uids == ["0"] * 4
                and len(nonce) == 32 and all(c in "0123456789abcdef" for c in nonce)
                and argv == expected and b"_serve" in argv
                and b"--nonce" in argv and nonce.encode() in argv)
    except (OSError, ValueError, KeyError, TypeError, StopIteration):
        return False


def _secure_dirs():
    for path in (Path("/run"), ROOT.parent, ROOT):
        try:
            path.mkdir(mode=0o755)
            os.chmod(path, 0o755)
        except FileExistsError:
            pass
        info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise HelperError(f"unsafe directory ownership/type/permissions: {path}")


def _secure_file(name):
    path = ROOT / name
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        os.close(fd)
        raise HelperError(f"unsafe lock file: {path}")
    return fd


@contextlib.contextmanager
def control_lock():
    fd = _secure_file("control.lock")
    try:
        deadline = time.monotonic() + 4
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise HelperError("another serial helper command is in progress")
                time.sleep(.02)
        yield
    finally:
        os.close(fd)


def lifetime_held():
    fd = _secure_file("lifetime.lock")
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return False
        except BlockingIOError:
            return True
    finally:
        os.close(fd)


def read_state():
    try:
        fd = os.open(ROOT / "state.json", os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    except FileNotFoundError:
        return None
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
            raise HelperError("unsafe serial state file")
        raw = os.read(fd, 65537)
        if len(raw) > 65536:
            raise HelperError("serial state file exceeds its bound")
        state = json.loads(raw)
        if state.get("schema") != 1 or not isinstance(state.get("owner"), dict):
            raise HelperError("invalid serial ownership metadata; refusing to guess")
        validate_config(**state["config"])
        return state
    except (ValueError, KeyError, TypeError) as exc:
        raise HelperError("invalid serial state; refusing unsafe cleanup") from exc
    finally:
        os.close(fd)


def write_state(state):
    temp = ROOT / (".state-" + state["owner"]["nonce"] + ".tmp")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    try:
        raw = json.dumps(state, sort_keys=True).encode()
        offset = 0
        while offset < len(raw):
            offset += os.write(fd, raw[offset:])
        os.fsync(fd)
        os.replace(temp, ROOT / "state.json")
    finally:
        os.close(fd)
        with contextlib.suppress(FileNotFoundError):
            temp.unlink()


def path_identity(path):
    info = path.lstat()
    return {"dev": info.st_dev, "ino": info.st_ino, "ctime_ns": info.st_ctime_ns,
            "uid": info.st_uid, "target": os.readlink(path) if stat.S_ISLNK(info.st_mode) else None}


def unlink_owned(path, identity):
    if identity and path_identity_or_none(path) == identity:
        path.unlink()
        return True
    return False


def path_identity_or_none(path):
    try:
        return path_identity(path)
    except FileNotFoundError:
        return None


def cleanup_state(state):
    # Only these exact paths and recorded inodes belong to this generation.
    for name in ("iec101-a", "iec101-b", "control.sock"):
        unlink_owned(ROOT / name, state.get("paths", {}).get(name))
    current = read_state()
    if current and current["owner"] == state["owner"]:
        (ROOT / "state.json").unlink()


def _rpc(state, action):
    if path_identity_or_none(ROOT / "control.sock") != state.get("paths", {}).get("control.sock"):
        raise HelperError("control socket ownership changed")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
        sock.settimeout(1)
        sock.connect(str(ROOT / "control.sock"))
        sock.sendall(json.dumps({"nonce": state["owner"]["nonce"], "action": action}).encode() + b"\n")
        data = bytearray()
        deadline = time.monotonic() + 1
        while b"\n" not in data:
            sock.settimeout(max(.001, deadline - time.monotonic()))
            if time.monotonic() >= deadline:
                raise HelperError("absolute control response deadline exceeded")
            chunk = sock.recv(4096)
            if not chunk or len(data) + len(chunk) > 32768:
                raise HelperError("invalid or oversized control response")
            data.extend(chunk)
        response = json.loads(data.split(b"\n", 1)[0])
        if response.get("owner") != state["owner"]:
            raise HelperError("serial control identity mismatch")
        return response


class Pending:
    def __init__(self):
        self.parts = deque()
        self.size = 0

    def append(self, data, now):
        if self.size + len(data) > LIMIT or len(self.parts) >= 1024:
            raise HelperError("bounded transport buffer exceeded")
        self.parts.append([bytes(data), 0, now + TIMEOUT])
        self.size += len(data)

    def flush(self, writer, now):
        for _ in range(16):
            if not self.parts:
                break
            data, offset, deadline = self.parts[0]
            if now >= deadline:
                raise HelperError("absolute transport write deadline exceeded")
            try:
                count = writer(memoryview(data)[offset:])
            except BlockingIOError:
                break
            if count <= 0:
                raise HelperError("transport write returned zero bytes")
            self.size -= count
            if offset + count == len(data):
                self.parts.popleft()
            else:
                self.parts[0][1] += count

    def clear(self):
        self.parts.clear()
        self.size = 0

    def expired(self, now):
        return bool(self.parts and now >= self.parts[0][2])


def raw_pty(slave):
    tty.setraw(slave, termios.TCSANOW)
    attrs = termios.tcgetattr(slave)
    attrs[2] = (attrs[2] & ~(termios.PARENB | termios.CSTOPB | termios.CSIZE)) | termios.CS8 | termios.CREAD | termios.CLOCAL
    attrs[4] = attrs[5] = termios.B9600
    termios.tcsetattr(slave, termios.TCSANOW, attrs)


def finish_tcp_sessions(sockets):
    """Bounded shared EOF wait lets the target reap its unique native slots."""
    active = set(sockets)
    received = {sock: 0 for sock in active}
    deadline = time.monotonic() + TIMEOUT
    for sock in list(active):
        try:
            sock.shutdown(socket.SHUT_WR)
        except OSError:
            active.discard(sock)
    while active:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        readable, _, _ = select.select(list(active), [], [], remaining)
        for sock in readable:
            try:
                data = sock.recv(16384)
                received[sock] += len(data)
                if not data or received[sock] >= LIMIT:
                    active.discard(sock)
            except OSError:
                active.discard(sock)


class Channel:
    def __init__(self, name, host, port):
        self.name, self.host, self.port = name, host, port
        self.master, self.slave = os.openpty()
        self.sock = None
        self.connecting = False
        self.connected = False
        self.connect_deadline = 0
        self.last_error = None
        self.to_tcp, self.to_pty = Pending(), Pending()
        self.offline_dropped = 0
        try:
            raw_pty(self.slave)
            os.set_blocking(self.master, False)
            os.fchown(self.slave, 0, grp.getgrnam("dialout").gr_gid)
            os.fchmod(self.slave, 0o660)
            self.target = os.ttyname(self.slave)
        except BaseException:
            self.close()
            raise

    def discard_pty(self):
        # Drain/drop, never preserve a prior master's offline control bytes.
        for _ in range(16):
            try:
                chunk = os.read(self.master, 4096)
            except BlockingIOError:
                break
            self.offline_dropped += len(chunk)
        termios.tcflush(self.slave, termios.TCIOFLUSH)

    def disconnect(self, error):
        if self.sock:
            self.sock.close()
        self.sock = None
        self.connected = self.connecting = False
        self.last_error = str(error)[:256]
        self.to_tcp.clear()
        self.to_pty.clear()
        self.discard_pty()

    def connect(self):
        if self.connected or self.connecting:
            return
        self.discard_pty()
        self.last_error = None
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setblocking(False)
        self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        try:
            result = self.sock.connect_ex((self.host, self.port))
        except OSError as exc:
            self.disconnect(exc)
            return
        if result not in (0, errno.EINPROGRESS, errno.EWOULDBLOCK):
            self.disconnect(os.strerror(result))
            return
        self.connecting = True
        self.connect_deadline = time.monotonic() + TIMEOUT

    def connect_ready(self):
        error = self.sock.getsockopt(socket.SOL_SOCKET, socket.SO_ERROR)
        if error:
            self.disconnect(os.strerror(error))
            return
        self.discard_pty()
        self.connected, self.connecting = True, False

    def read_pty(self):
        for _ in range(4):
            try:
                data = os.read(self.master, 16384)
            except BlockingIOError:
                break
            if not data:
                raise HelperError("PTY master closed unexpectedly")
            if self.connected:
                try:
                    self.to_tcp.append(data, time.monotonic())
                except HelperError as exc:
                    self.disconnect(exc)
            else:
                self.offline_dropped += len(data)

    def read_tcp(self):
        try:
            data = self.sock.recv(16384)
            if not data:
                self.disconnect("TCP disconnected; explicit start required to reconnect")
            else:
                self.to_pty.append(data, time.monotonic())
        except BlockingIOError:
            return
        except (OSError, HelperError) as exc:
            self.disconnect(exc)

    def snapshot(self):
        info = os.fstat(self.slave)
        return {"path": str(ROOT / self.name), "target": self.target,
                "connected": self.connected, "connecting": self.connecting,
                "host": self.host, "port": self.port, "last_error": self.last_error,
                "offline_dropped_bytes": self.offline_dropped,
                "pending_to_tcp": self.to_tcp.size, "pending_to_pty": self.to_pty.size,
                "uid": info.st_uid, "gid": info.st_gid, "mode": oct(stat.S_IMODE(info.st_mode))}

    def close(self):
        if self.sock:
            self.sock.close()
            self.sock = None
        for name in ("master", "slave"):
            fd = getattr(self, name, None)
            if fd is not None:
                os.close(fd)
                setattr(self, name, None)


class Daemon:
    def __init__(self, config, nonce, argv):
        self.config = config
        self.state = {"schema": 1, "config": config, "paths": {}, "owner": {
            "pid": os.getpid(), "uid": os.geteuid(), "start_ticks": start_ticks(Path("/proc/self/stat").read_text()),
            "nonce": nonce, "argv": argv}}
        self.channels, self.controls = [], {}
        self.listener = None
        self.lifetime = None
        self.stopping = False

    def snapshot(self):
        return {"running": not self.stopping, "owner": self.state["owner"],
                "config": self.config, "channels": {name: ch.snapshot() for name, ch in zip(("single", "double"), self.channels)},
                "automatic_reconnect": False, "physical_serial_verified": False}

    def setup(self):
        self.lifetime = _secure_file("lifetime.lock")
        fcntl.flock(self.lifetime, fcntl.LOCK_EX | fcntl.LOCK_NB)
        write_state(self.state)
        for name, port in (("iec101-a", self.config["single_port"]), ("iec101-b", self.config["double_port"])):
            channel = Channel(name, self.config["host"], port)
            self.channels.append(channel)
            os.symlink(channel.target, ROOT / name)
            self.state["paths"][name] = path_identity(ROOT / name)
            write_state(self.state)
            channel.connect()
        self.listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.listener.bind(str(ROOT / "control.sock"))
        os.chmod(ROOT / "control.sock", 0o600)
        self.listener.listen(4)
        self.listener.setblocking(False)
        self.state["paths"]["control.sock"] = path_identity(ROOT / "control.sock")
        write_state(self.state)

    def accept_control(self):
        conn, _ = self.listener.accept()
        if len(self.controls) >= 4 or struct.unpack("3i", conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))[1] != 0:
            conn.close()
            return
        conn.setblocking(False)
        self.controls[conn] = {"input": bytearray(), "output": None, "deadline": time.monotonic() + 1}

    def control_read(self, conn):
        entry = self.controls[conn]
        data = conn.recv(4096)
        if not data or len(data) + len(entry["input"]) > 4096:
            raise HelperError("invalid control input")
        entry["input"].extend(data)
        if b"\n" not in entry["input"]:
            return
        request = json.loads(entry["input"].split(b"\n", 1)[0])
        if set(request) != {"nonce", "action"} or request["nonce"] != self.state["owner"]["nonce"]:
            raise HelperError("invalid control identity")
        action = request["action"]
        if action == "reconnect":
            for channel in self.channels:
                channel.connect()
        elif action == "stop":
            self.stopping = True
        elif action != "status":
            raise HelperError("invalid control action")
        entry["output"] = bytearray(json.dumps(self.snapshot()).encode() + b"\n")

    def tick(self):
        reads, writes = [self.listener], []
        sockets = {}
        for channel in self.channels:
            reads.append(channel.master)
            if channel.to_pty.size:
                writes.append(channel.master)
            if channel.sock:
                sockets[channel.sock] = channel
                if channel.connected:
                    reads.append(channel.sock)
                if channel.connecting or channel.to_tcp.size:
                    writes.append(channel.sock)
        for conn, entry in self.controls.items():
            (writes if entry["output"] is not None else reads).append(conn)
        readable, writable, _ = select.select(reads, writes, [], .02)
        if self.listener in readable:
            with contextlib.suppress(BlockingIOError):
                self.accept_control()
        for channel in self.channels:
            if channel.master in readable:
                channel.read_pty()
            sock = channel.sock
            if sock in readable:
                channel.read_tcp()
            if sock and sock is channel.sock and sock in writable:
                try:
                    if channel.connecting:
                        channel.connect_ready()
                    elif channel.connected:
                        channel.to_tcp.flush(channel.sock.send, time.monotonic())
                except (OSError, HelperError) as exc:
                    channel.disconnect(exc)
            if channel.master in writable:
                try:
                    channel.to_pty.flush(lambda data: os.write(channel.master, data), time.monotonic())
                except HelperError as exc:
                    channel.disconnect(exc)
            now = time.monotonic()
            if (channel.connecting and now >= channel.connect_deadline) or channel.to_tcp.expired(now) or channel.to_pty.expired(now):
                channel.disconnect("absolute connect/write deadline exceeded")
        for conn in list(self.controls):
            try:
                entry = self.controls[conn]
                if conn in readable:
                    self.control_read(conn)
                if conn in writable and entry["output"] is not None:
                    count = conn.send(entry["output"])
                    del entry["output"][:count]
                    if not entry["output"]:
                        raise EOFError()
                if time.monotonic() >= entry["deadline"]:
                    raise EOFError()
            except (OSError, ValueError, TypeError, HelperError, EOFError):
                conn.close()
                del self.controls[conn]

    def run(self, ready_fd):
        try:
            self.setup()
            deadline = time.monotonic() + TIMEOUT
            stable_since = None
            while True:
                if self.stopping or time.monotonic() >= deadline or any(c.last_error for c in self.channels):
                    raise HelperError("initial dual TCP connection failed")
                self.tick()
                if all(c.connected for c in self.channels):
                    if stable_since is None:
                        stable_since = time.monotonic()
                    elif time.monotonic() - stable_since >= .03:
                        break
                else:
                    stable_since = None
            os.write(ready_fd, json.dumps({"ready": True}).encode() + b"\n")
            os.close(ready_fd)
            ready_fd = None
            while not self.stopping:
                self.tick()
        finally:
            if ready_fd is not None:
                with contextlib.suppress(OSError):
                    os.write(ready_fd, b'{"ready":false}\n')
                    os.close(ready_fd)
            for conn in self.controls:
                conn.close()
            if self.listener:
                self.listener.close()
            finish_tcp_sessions([channel.sock for channel in self.channels if channel.sock and channel.connected])
            for channel in self.channels:
                channel.close()
            cleanup_state(self.state)
            if self.lifetime is not None:
                os.close(self.lifetime)


def spawn(config, script):
    parent, child = socket.socketpair()
    nonce = uuid.uuid4().hex
    argv = [sys.executable, "-I", script, "_serve", "--nonce", nonce, "--ready-fd", str(child.fileno()),
            "--host", config["host"], "--single-port", str(config["single_port"]), "--double-port", str(config["double_port"])]
    process = subprocess.Popen(argv, pass_fds=(child.fileno(),), stdin=subprocess.DEVNULL,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    child.close()
    try:
        deadline = time.monotonic() + 5
        response = bytearray()
        while b"\n" not in response:
            parent.settimeout(max(.001, deadline - time.monotonic()))
            if time.monotonic() >= deadline:
                raise HelperError("initial helper readiness deadline exceeded")
            chunk = parent.recv(4096)
            if not chunk or len(response) + len(chunk) > 4096:
                raise HelperError("invalid helper readiness response")
            response.extend(chunk)
        if not json.loads(response.split(b"\n", 1)[0]).get("ready"):
            raise HelperError("initial helper connection/setup failed; no protocol ACK is inferred")
        state = read_state()
        if not state or state["owner"]["argv"] != argv or not process_matches(state["owner"]) or not lifetime_held():
            raise HelperError("new helper ownership check failed")
        result = _rpc(state, "status")
        if not all(channel["connected"] for channel in result["channels"].values()):
            raise HelperError("initial TCP connection closed before readiness completed")
        return result
    except BaseException:
        if process.poll() is None:
            process.terminate()  # This unreaped direct child cannot have a reused PID.
            try:
                process.wait(timeout=4)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
        state = read_state()
        if state and state["owner"].get("nonce") == nonce and not lifetime_held():
            cleanup_state(state)
        raise
    finally:
        parent.close()


def stop_owned(state):
    # pidfd pins process identity if the IPC path is damaged. Never os.kill a stored PID.
    pidfd = os.pidfd_open(state["owner"]["pid"])
    try:
        if not process_matches(state["owner"]) or not lifetime_held():
            raise HelperError("helper identity changed before stop")
        with contextlib.suppress(OSError, ValueError, HelperError):
            _rpc(state, "stop")
        if not select.select([pidfd], [], [], .5)[0]:
            if not process_matches(state["owner"]):
                raise HelperError("helper identity changed before signal")
            signal.pidfd_send_signal(pidfd, signal.SIGTERM)
        if not select.select([pidfd], [], [], 4)[0]:
            raise HelperError("owned helper did not stop within its deadline")
    finally:
        os.close(pidfd)
    if lifetime_held():
        raise HelperError("serial lifetime lock remains held")
    cleanup_state(state)
    return {"running": False, "stopped": True}


def command(action, config=None):
    if os.geteuid() != 0:
        raise PermissionError("serial start/status/stop requires root")
    script = str(Path(__file__).resolve())
    info = os.stat(script)
    if info.st_uid != 0 or info.st_mode & 0o022 or not stat.S_ISREG(info.st_mode):
        raise HelperError("install the helper as a root-owned, non-writable script before use")
    _secure_dirs()
    with control_lock():
        state = read_state()
        alive = bool(state and process_matches(state["owner"]) and lifetime_held())
        if not state and lifetime_held():
            raise HelperError("lifetime lock is held without ownership metadata")
        if action == "status":
            if alive:
                return _rpc(state, "status")
            return {"running": False, "stale": bool(state), "owner": state["owner"] if state else None}
        if state and not alive:
            if lifetime_held():
                raise HelperError("lifetime lock is held without matching PID/nonce ownership; refusing cleanup")
            cleanup_state(state)  # No signal: stale/reused PIDs cannot affect another process.
            state = None
        if action == "stop":
            return stop_owned(state) if alive else {"running": False, "stopped": True}
        if alive:
            if state["config"] != config:
                raise HelperError("target changed; explicitly stop then start with the new target")
            _rpc(state, "reconnect")
            deadline = time.monotonic() + TIMEOUT + .5
            while True:
                result = _rpc(state, "status")
                if not any(ch["connecting"] for ch in result["channels"].values()):
                    if not all(ch["connected"] for ch in result["channels"].values()):
                        raise HelperError("explicit reconnect failed; PTYs remain stable and disconnected")
                    return result
                if time.monotonic() >= deadline:
                    raise HelperError("explicit reconnect deadline exceeded")
                time.sleep(.02)
        if lifetime_held():
            raise HelperError("another helper generation holds the lifetime lock")
        if any((ROOT / name).exists() or (ROOT / name).is_symlink() for name in ("iec101-a", "iec101-b", "control.sock")):
            raise HelperError("unowned serial paths exist; refusing to replace them")
        return spawn(config, script)


def main():
    parser = Parser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    for action in ("start", "_serve"):
        cmd = sub.add_parser(action)
        cmd.add_argument("--host", required=True)
        cmd.add_argument("--single-port", required=True, type=int)
        cmd.add_argument("--double-port", required=True, type=int)
        if action == "_serve":
            cmd.add_argument("--nonce", required=True)
            cmd.add_argument("--ready-fd", required=True, type=int)
    sub.add_parser("status")
    sub.add_parser("stop")
    try:
        args = parser.parse_args()
        config = validate_config(args.host, args.single_port, args.double_port) if args.action in ("start", "_serve") else None
        if args.action == "_serve":
            if os.geteuid() != 0 or len(args.nonce) != 32 or any(c not in "0123456789abcdef" for c in args.nonce):
                raise HelperError("invalid daemon root identity")
            daemon = Daemon(config, args.nonce, [arg.decode() for arg in Path("/proc/self/cmdline").read_bytes().split(b"\0")[:-1]])
            signal.signal(signal.SIGTERM, lambda *_: setattr(daemon, "stopping", True))
            signal.signal(signal.SIGINT, lambda *_: setattr(daemon, "stopping", True))
            daemon.run(args.ready_fd)
            return 0
        result = command(args.action, config)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (HelperError, PermissionError, OSError, ValueError, KeyError) as exc:
        print(json.dumps({"error": str(exc)[:512]}), file=sys.stderr)
        return 2 if isinstance(exc, (PermissionError, UsageError)) else 1


if __name__ == "__main__":
    raise SystemExit(main())
