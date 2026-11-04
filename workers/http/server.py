#!/usr/bin/env python3
"""A persistent, bounded HTTP target with three normal response delimiters."""
from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
import os
import signal
import socket
import threading
import time
from urllib.parse import urlsplit

MAX_BODY_BYTES = 1024 * 1024
PREVIEW_BYTES = 256
PRINT_LOCK = threading.Lock()
METHODS = ("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
ALLOW = ", ".join(METHODS)
FIXED_PATTERN = b"0123456789abcdef"


def emit(event: str, **fields: object) -> None:
    with PRINT_LOCK:
        print(json.dumps({"time_ns": time.time_ns(), "event": event, **fields}, ensure_ascii=False), flush=True)


def body_fields(body: bytes) -> dict[str, object]:
    return {"body_length": len(body), "body_preview_hex": body[:PREVIEW_BYTES].hex(),
            "body_truncated": len(body) > PREVIEW_BYTES}


class Server(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True
    block_on_close = False
    request_queue_size = 16

    def __init__(self, address: tuple[str, int], response_body: bytes | None = None,
                 response_length: int = 64, response_mode: str = "fixed"):
        self.legacy_body = response_body
        self.response_length = len(response_body) if response_body is not None else response_length
        self.response_mode = "legacy" if response_body is not None else response_mode
        self.fixed_body = (FIXED_PATTERN * ((self.response_length + len(FIXED_PATTERN) - 1) // len(FIXED_PATTERN)))[:self.response_length]
        self.connections: set[socket.socket] = set()
        self.connection_lock = threading.Lock()
        self.slots = threading.BoundedSemaphore(64)
        super().__init__(address, Handler)

    def response_body(self, method: str, request_body: bytes) -> bytes:
        if self.legacy_body is not None:
            return request_body if method == "POST" else self.legacy_body
        if self.response_mode == "random":
            return os.urandom(self.response_length)
        return self.fixed_body

    def get_request(self) -> tuple[socket.socket, tuple[str, int]]:
        connection, peer = super().get_request()
        connection.settimeout(5)
        with self.connection_lock:
            self.connections.add(connection)
        return connection, peer

    def process_request(self, request: socket.socket, client_address: tuple[str, int]) -> None:
        if not self.slots.acquire(blocking=False):
            try:
                request.sendall(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            finally:
                self.shutdown_request(request)
            emit("connection_rejected", reason="connection_limit", peer=client_address)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request: socket.socket, client_address: tuple[str, int]) -> None:
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()

    def shutdown_request(self, request: socket.socket) -> None:
        with self.connection_lock:
            self.connections.discard(request)
        super().shutdown_request(request)

    def close_connections(self) -> None:
        with self.connection_lock:
            connections = list(self.connections)
        for connection in connections:
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            connection.close()

    def handle_error(self, request: socket.socket, client_address: tuple[str, int]) -> None:
        emit("connection_error", peer=client_address, reason="connection_closed_or_invalid_request")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "ProtocolTargetLabHTTP/0.2.0"
    sys_version = ""

    def log_message(self, format: str, *args: object) -> None:
        # All output uses the bounded JSON events below.
        pass

    def _length(self) -> int | None:
        if self.headers.get("Transfer-Encoding") is not None:
            self.send_error(501, "Chunked request bodies are not supported")
            return None
        lengths = self.headers.get_all("Content-Length", [])
        if len(lengths) > 1 or (lengths and (not lengths[0].isascii() or not lengths[0].isdigit())):
            self.send_error(400, "Invalid Content-Length")
            return None
        if lengths and len(lengths[0]) > 10:
            self.send_error(413, "Request body exceeds 1048576 bytes")
            return None
        value = int(lengths[0]) if lengths else 0
        if value > MAX_BODY_BYTES:
            self.send_error(413, "Request body exceeds 1048576 bytes")
            return None
        return value

    def handle_expect_100(self) -> bool:
        if self.command not in METHODS:
            self.send_error(405, "Method not allowed")
            return False
        if self._length() is None:
            return False
        self.send_response_only(100)
        self.end_headers()
        return True

    def send_error(self, code: int, message: str | None = None, explain: str | None = None) -> None:
        self.close_connection = True
        body = ((message or self.responses.get(code, ("Error",))[0]) + "\n").encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        if code == 405:
            self.send_header("Allow", ALLOW)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        if getattr(self, "command", "") != "HEAD":
            self.wfile.write(body)
        emit("request_rejected", status=code, reason=message, peer=self.client_address,
             method=getattr(self, "command", ""), **body_fields(body))

    def _respond(self) -> None:
        size = self._length()
        if size is None:
            return
        try:
            request_body = self.rfile.read(size)
        except (TimeoutError, OSError):
            self.send_error(408, "Request body timed out")
            return
        if len(request_body) != size:
            self.send_error(400, "Incomplete request body")
            return
        try:
            path = urlsplit(self.path).path
        except ValueError:
            self.send_error(400, "Invalid request target")
            return
        emit("request", method=self.command, path=self.path[:2048],
             path_length=len(self.path), path_truncated=len(self.path) > 2048,
             peer=self.client_address, **body_fields(request_body))
        if path not in ("/ok", "/chunked", "/close"):
            self.send_error(404, "Unknown target path")
            return
        server: Server = self.server  # type: ignore[assignment]
        body = server.response_body(self.command, request_body)
        mode = {"/ok": "content-length", "/chunked": "chunked", "/close": "close"}[path]
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        if self.command == "OPTIONS":
            self.send_header("Allow", ALLOW)
        if mode == "content-length":
            self.send_header("Content-Length", str(len(body)))
        elif mode == "chunked":
            self.send_header("Transfer-Encoding", "chunked")
        else:
            self.send_header("Connection", "close")
            self.close_connection = True
        self.end_headers()
        if self.command != "HEAD":
            if mode == "chunked":
                # Two chunks make delimiter handling visible without artificial delays.
                split = max(1, len(body) // 2)
                for offset in range(0, len(body), split):
                    chunk = body[offset:offset + split]
                    self.wfile.write(f"{len(chunk):X}\r\n".encode("ascii") + chunk + b"\r\n")
                self.wfile.write(b"0\r\n\r\n")
            else:
                self.wfile.write(body)
            self.wfile.flush()
        emit("response", method=self.command, path=path, peer=self.client_address,
             status=200, framing=mode, body_sent=self.command != "HEAD", **body_fields(body))

    do_GET = _respond
    do_HEAD = _respond
    do_POST = _respond
    do_PUT = _respond
    do_PATCH = _respond
    do_DELETE = _respond
    do_OPTIONS = _respond

    def _method_not_allowed(self) -> None:
        self.send_error(405, "Method not allowed")

    def __getattr__(self, name: str):
        # BaseHTTPRequestHandler dispatches unknown methods via do_<METHOD>.
        if name.startswith("do_"):
            return self._method_not_allowed
        raise AttributeError(name)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind-ip", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=18090)
    content = parser.add_mutually_exclusive_group()
    content.add_argument("--response-body", help="Legacy UTF-8 body and POST echo compatibility mode")
    content.add_argument("--response-length", type=int, help="Generated body bytes, default 64 (0..1048576)")
    parser.add_argument("--response-mode", choices=("fixed", "random"), help="Generated body mode, default fixed")
    args = parser.parse_args()
    try:
        ipaddress.IPv4Address(args.bind_ip)
    except ipaddress.AddressValueError:
        parser.error("--bind-ip must be an IPv4 address")
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    if args.response_body is not None and args.response_mode is not None:
        parser.error("--response-body cannot be combined with --response-mode")
    body = args.response_body.encode("utf-8") if args.response_body is not None else None
    if body is not None and len(body) > 65536:
        parser.error("--response-body must not exceed 65536 UTF-8 bytes")
    length = args.response_length if args.response_length is not None else 64
    if not 0 <= length <= MAX_BODY_BYTES:
        parser.error("--response-length must be between 0 and 1048576")
    server = Server((args.bind_ip, args.port), body, length, args.response_mode or "fixed")
    stopping = threading.Event()

    def stop(_signum: int, _frame: object) -> None:
        if not stopping.is_set():
            stopping.set()
            def shutdown() -> None:
                server.close_connections()
                server.shutdown()
            threading.Thread(target=shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    emit("ready", bind_ip=args.bind_ip, port=args.port, protocol="HTTP/1.1",
         max_body_bytes=MAX_BODY_BYTES, max_connections=64, methods=list(METHODS),
         response_length=server.response_length, response_mode=server.response_mode,
         legacy_post_echo=body is not None)
    try:
        server.serve_forever(poll_interval=0.1)
    finally:
        server.close_connections()
        server.server_close()
        emit("stopped")


if __name__ == "__main__":
    main()
