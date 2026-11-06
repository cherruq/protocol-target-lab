"""Public, fixed laboratory response fixtures migrated from http_peer.py.

The three generated-body paths remain separate. These fixtures intentionally
include malformed wire data; they are not a general HTTP server profile.
"""
from __future__ import annotations

import base64
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

GENERATED_PATHS = ("/ok", "/chunked", "/close")
SCENARIO_PATHS = (
    "/head", "/health", "/chunk-extension", "/split-length", "/flood",
    "/no-content", "/not-modified", "/informational", "/truncated",
    "/chunk-truncated", "/invalid-status", "/status-099", "/invalid-chunk",
    "/conflicting-length", "/negative-length", "/informational-error",
    "/only-informational", "/not-found", "/server-error", "/stall",
    "/auth/basic", "/auth/cookie", "/auth/header", "/auth/query",
)
PATHS = GENERATED_PATHS + SCENARIO_PATHS


def tls_file(name: str) -> Path:
    beside = Path(__file__).resolve().parent / "tls" / name
    return beside if beside.exists() else Path(__file__).resolve().parent.parent / "tls" / name


def authorized(target: str, headers: dict[str, str]) -> bool:
    parsed = urlsplit(target)
    if parsed.path == "/auth/basic":
        return headers.get("authorization") == "Basic " + base64.b64encode(b"lab-user:public-test-only").decode("ascii")
    if parsed.path == "/auth/cookie":
        return headers.get("cookie") == "lab=value"
    if parsed.path == "/auth/header":
        return headers.get("x-lab") == "public"
    if parsed.path == "/auth/query":
        return parse_qs(parsed.query).get("lab key") == ["a+b&c"]
    return True


def response_parts(path: str, method: str, accepted: bool = True) -> list[tuple[float, bytes]]:
    header = b"HTTP/1.1 200 OK\r\n"
    chunked = header + b"Transfer-Encoding: chunked\r\n\r\n"
    normal = header + b"Content-Length: 5\r\n\r\nhello"
    cases = {
        "/head": [(0, header + b"Content-Length: 123\r\n\r\n"), (5, b"")],
        "/health": [(0, header + b"Content-Length: 5\r\n\r\n" if method == "HEAD" else normal)],
        "/truncated": [(0, header + b"Content-Length: 10\r\n\r\nabc")],
        "/chunk-truncated": [(0, chunked + b"5\r\nhello\r\n")],
        "/invalid-status": [(0, b"BOGUS 200 OK\r\nContent-Length: 0\r\n\r\n")],
        "/status-099": [(0, b"HTTP/1.1 099 Bad\r\n\r\n")],
        "/invalid-chunk": [(0, chunked + b"ZZ\r\nhello\r\n0\r\n\r\n")],
        "/conflicting-length": [(0, header + b"Content-Length: 5\r\nContent-Length: 9\r\n\r\nhello")],
        "/negative-length": [(0, header + b"Content-Length: -1\r\n\r\n")],
        "/chunk-extension": [(0, chunked + b"5;foo=bar\r\nhello\r\n0\r\nX-Final: yes\r\n\r\n")],
        "/no-content": [(0, b"HTTP/1.1 204 No Content\r\n\r\n"), (5, b"")],
        "/not-modified": [(0, b"HTTP/1.1 304 Not Modified\r\nContent-Length: 123\r\n\r\n"), (5, b"")],
        "/informational": [(0, b"HTTP/1.1 100 Continue\r\n\r\n"), (0.2, normal)],
        "/informational-error": [(0, b"HTTP/1.1 100 Continue\r\n\r\n"), (0.2, b"HTTP/1.1 500 Error\r\nContent-Length: 0\r\n\r\n")],
        "/only-informational": [(0, b"HTTP/1.1 100 Continue\r\n\r\n")],
        "/split-length": [(0, b"HTTP/1.1 200"), (0.2, b" OK\r\nContent-Length: 5\r\n"), (0.2, b"\r\nhe"), (0.2, b"llo")],
        "/not-found": [(0, b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")],
        "/server-error": [(0, b"HTTP/1.1 500 Error\r\nContent-Length: 0\r\n\r\n")],
        "/stall": [(30, normal)],
        "/flood": [(0.6, header + b"Connection: close\r\nContent-Length: 5\r\n\r\nhello")],
    }
    if path.startswith("/auth/"):
        payload = normal if accepted else b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n"
        return [(0.6, payload.replace(b"\r\n\r\n", b"\r\nConnection: close\r\n\r\n", 1))]
    return cases[path]
