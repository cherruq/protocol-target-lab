#!/usr/bin/env python3
"""Run bounded HTTP checks against an existing target and emit one JSON report."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import http.client
import io
import json
from pathlib import Path
import signal
import socket
import sys
import time

# In the image the public smoke module is copied beside this program. During
# source-tree development resolve that same public module without installation.
try:
    import http_smoke as smoke
except ModuleNotFoundError:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "public-tests"))
    import http_smoke as smoke

SOCKET_TIMEOUT = 3
DEADLINE_SECONDS = 30
PATHS = ("/ok", "/chunked", "/close")


class DeadlineExceeded(Exception):
    """Kept separate from OSError so per-request handling cannot swallow it."""


class ConfigurationError(Exception):
    pass


class Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise ConfigurationError(message)


def empty_response() -> dict[str, object]:
    return {"status": None, "headers": {}, **smoke.body_fields(b"")}


def header_fields(headers: list[tuple[str, str]]) -> dict[str, object]:
    bounded: dict[str, str] = {}
    budget = 8192
    truncated = False
    original_length = 0
    for index, (key, value) in enumerate(headers):
        original_length += len(key) + len(value)
        if index >= 32 or budget <= 0:
            truncated = True
            continue
        short_key = key[:256]
        short_value = value[:min(2048, max(0, budget - len(short_key)))]
        truncated = truncated or short_key != key or short_value != value
        bounded[short_key] = short_value
        budget -= len(short_key) + len(short_value)
    return {"headers": bounded, "headers_original_length": original_length,
            "headers_truncated": truncated}


def request_description(host: str, port: int, method: str, path: str) -> tuple[dict[str, object], bytes]:
    body = (b"protocol-target-lab client request: " + method.encode("ascii")) if method in ("POST", "PUT", "PATCH", "DELETE", "OPTIONS") else b""
    headers = {"Host": f"{host}:{port}", "Accept-Encoding": "identity",
               "Connection": "close", "Content-Length": str(len(body))}
    return {"method": method, "path": path, "headers": headers,
            "body_length": len(body), "body_preview_hex": body[:smoke.PREVIEW_BYTES].hex(),
            "body_truncated": len(body) > smoke.PREVIEW_BYTES}, body


def raw_head(host: str, port: int, description: dict[str, object]) -> dict[str, object]:
    headers = description["headers"]
    wire = (f"HEAD {description['path']} HTTP/1.1\r\n" +
            "".join(f"{name}: {value}\r\n" for name, value in headers.items()) + "\r\n").encode("ascii")
    with socket.create_connection((host, port), timeout=SOCKET_TIMEOUT) as sock:
        sock.settimeout(SOCKET_TIMEOUT)
        sock.sendall(wire)
        incoming = b""
        while b"\r\n\r\n" not in incoming:
            part = sock.recv(4096)
            if not part:
                raise http.client.BadStatusLine("Response headers were incomplete")
            incoming += part
            if len(incoming) > 65536:
                raise http.client.HTTPException("Response headers exceed 65536 bytes")
        header, _, body = incoming.partition(b"\r\n\r\n")
        status_line, separator, header_lines = header.partition(b"\r\n")
        pieces = status_line.split(b" ", 2)
        if len(pieces) < 2 or not pieces[1].isdigit():
            raise http.client.BadStatusLine(status_line.decode("ascii", errors="replace"))
        response_headers = dict(http.client.parse_headers(io.BytesIO(header_lines + b"\r\n\r\n"))) if separator else {}
        while len(body) <= smoke.MAX_BODY_BYTES:
            part = sock.recv(min(4096, smoke.MAX_BODY_BYTES + 1 - len(body)))
            if not part:
                break
            body += part
        return {"status": int(pieces[1]), "version": 11 if pieces[0] == b"HTTP/1.1" else 10,
                **header_fields(list(response_headers.items())), **smoke.body_fields(body)}


def exchange(host: str, port: int, description: dict[str, object], body: bytes) -> dict[str, object]:
    method, path = description["method"], description["path"]
    if method == "HEAD":
        return raw_head(host, port, description)
    connection = http.client.HTTPConnection(host, port, timeout=SOCKET_TIMEOUT)
    try:
        connection.request(method, path, body=body, headers=description["headers"])
        response = connection.getresponse()
        data = response.read(smoke.MAX_BODY_BYTES + 1)
        return {"status": response.status, "version": response.version,
                **header_fields(response.getheaders()), **smoke.body_fields(data)}
    finally:
        connection.close()


def validate(response: dict[str, object], method: str, path: str, request_body: bytes,
             length: int, mode: str, legacy: bytes | None) -> list[str]:
    errors = []
    headers = {key.lower(): value for key, value in response["headers"].items()}
    if response.get("headers_truncated"):
        errors.append("Response headers exceed the bounded report limits")
    if response["status"] != 200:
        errors.append(f"Expected HTTP 200, received {response['status']}")
    if response.get("version") != 11:
        errors.append("Expected HTTP/1.1")
    if headers.get("content-type", "").lower() != "application/octet-stream":
        errors.append("Expected application/octet-stream")
    expected_length = len(request_body) if legacy is not None and method == "POST" else (len(legacy) if legacy is not None else length)
    if not smoke.framing_ok(path, headers, expected_length):
        errors.append("Response framing does not match the selected path and expected length")
    if method == "OPTIONS" and not smoke.allowed(headers):
        errors.append("OPTIONS Allow does not list the seven supported methods")
    if method == "HEAD":
        if response["body_length"] != 0:
            errors.append("HEAD sent body bytes")
        return errors
    if response["body_length"] != expected_length:
        errors.append(f"Expected {expected_length} body bytes, received {response['body_length']}")
    if legacy is not None:
        expected = request_body if method == "POST" else legacy
        if response["body_sha256"] != hashlib.sha256(expected).hexdigest():
            errors.append("Legacy body or POST echo does not match")
    elif mode == "fixed":
        expected = (smoke.FIXED_PATTERN * ((length + len(smoke.FIXED_PATTERN) - 1) // len(smoke.FIXED_PATTERN)))[:length]
        if response["body_sha256"] != hashlib.sha256(expected).hexdigest():
            errors.append("Fixed response bytes do not match the configured pattern")
    return errors


def parse_arguments() -> argparse.Namespace:
    parser = Parser(description=__doc__, add_help=False)
    parser.add_argument("--host", required=True)
    parser.add_argument("--port", type=int, default=18090)
    parser.add_argument("--method", choices=(*smoke.METHODS, "ALL"), default="GET")
    parser.add_argument("--path", choices=PATHS, default="/ok")
    content = parser.add_mutually_exclusive_group()
    content.add_argument("--legacy-body")
    content.add_argument("--response-length", type=int)
    parser.add_argument("--response-mode", choices=("fixed", "random"))
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    if not args.host or len(args.host) > 253 or any(c in args.host for c in "\r\n\0"):
        parser.error("--host must be a nonempty host name or address without control characters")
    if args.legacy_body is not None and args.response_mode is not None:
        parser.error("--legacy-body cannot be combined with --response-mode")
    args.response_length = args.response_length if args.response_length is not None else 64
    args.response_mode = args.response_mode or "fixed"
    if not 0 <= args.response_length <= smoke.MAX_BODY_BYTES:
        parser.error("--response-length must be between 0 and 1048576")
    if args.legacy_body is not None and len(args.legacy_body.encode("utf-8")) > 65536:
        parser.error("--legacy-body must not exceed 65536 UTF-8 bytes")
    return args


def main() -> None:
    started = time.monotonic()
    checks: list[dict[str, object]] = []
    current_request: dict[str, object] = {"method": None, "path": None, "headers": {},
        "body_length": 0, "body_preview_hex": "", "body_truncated": False}
    report: dict[str, object] = {"client": "protocol-target-lab-http", "client_schema": 1,
        "observed_at": datetime.now(timezone.utc).isoformat(), "checks": checks}

    def expired(_signum: int, _frame: object) -> None:
        raise DeadlineExceeded("HTTP client exceeded its 30-second overall deadline")

    signal.signal(signal.SIGALRM, expired)
    signal.alarm(DEADLINE_SECONDS)
    try:
        args = parse_arguments()
        legacy = args.legacy_body.encode("utf-8") if args.legacy_body is not None else None
        report.update({"target": {"host": args.host, "port": args.port}, "path": args.path,
            "method": args.method, "response_length": len(legacy) if legacy is not None else args.response_length,
            "response_mode": "legacy" if legacy is not None else args.response_mode})
        methods = smoke.METHODS if args.method == "ALL" else (args.method,)
        for method in methods:
            def perform(name: str) -> dict[str, object]:
                nonlocal current_request
                current_request, body = request_description(args.host, args.port, method, args.path)
                result: dict[str, object] = {"name": name, "passed": False,
                    "request": current_request, "response": empty_response()}
                check_started = time.monotonic()
                try:
                    response = exchange(args.host, args.port, current_request, body)
                    result["response"] = response
                    errors = validate(response, method, args.path, body, args.response_length,
                                      args.response_mode, legacy)
                    if errors:
                        result["error"] = "; ".join(errors)
                    else:
                        result["passed"] = True
                except (OSError, ValueError, http.client.HTTPException) as error:
                    result["error"] = str(error)[:2000]
                result["seconds"] = time.monotonic() - check_started
                checks.append(result)
                return result

            initial = [perform(f"{method.lower()}-{args.path[1:]}-{round_number}") for round_number in (1, 2)]
            if legacy is None and args.response_mode == "random" and args.response_length >= 2 and method != "HEAD" and all(result["passed"] for result in initial):
                first_hash = initial[0]["response"]["body_sha256"]
                if first_hash == initial[1]["response"]["body_sha256"]:
                    varied = False
                    for retry in (1, 2, 3):
                        result = perform(f"{method.lower()}-{args.path[1:]}-random-retry-{retry}")
                        if result["passed"] and result["response"]["body_sha256"] != first_hash:
                            varied = True
                            break
                    if not varied:
                        initial[1]["passed"] = False
                        initial[1]["error"] = "Random body did not vary after up to three additional requests"
    except (ConfigurationError, DeadlineExceeded, OSError, ValueError) as error:
        checks.append({"name": "client-error", "passed": False, "request": current_request,
                       "response": empty_response(), "error": str(error)[:2000]})
    except Exception as error:
        # Unexpected exceptions also produce a useful container result, not a traceback.
        checks.append({"name": "client-error", "passed": False, "request": current_request,
                       "response": empty_response(), "error": f"{type(error).__name__}: {str(error)[:1800]}"})
    finally:
        signal.alarm(0)
    passed = sum(result["passed"] is True for result in checks)
    report.update({"passed": bool(checks) and passed == len(checks),
                   "summary": {"total": len(checks), "passed": passed, "failed": len(checks) - passed},
                   "seconds": time.monotonic() - started})
    print(json.dumps(report, ensure_ascii=False, separators=(",", ":")), flush=True)
    raise SystemExit(0 if report["passed"] else 1)


if __name__ == "__main__":
    main()
