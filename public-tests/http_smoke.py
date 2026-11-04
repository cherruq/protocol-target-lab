#!/usr/bin/env python3
"""Probe an already-started HTTP target; never changes its configuration."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import http.client
import json
from pathlib import Path
import socket
import time

METHODS = ("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
PATHS = ("/ok", "/chunked", "/close")
MAX_BODY_BYTES = 1024 * 1024
PREVIEW_BYTES = 256
FIXED_PATTERN = b"0123456789abcdef"


def body_fields(body: bytes) -> dict[str, object]:
    return {"body_length": len(body), "body_sha256": hashlib.sha256(body).hexdigest(),
            "body_preview_hex": body[:PREVIEW_BYTES].hex(), "body_truncated": len(body) > PREVIEW_BYTES}


def request(host: str, port: int, method: str, path: str, body: bytes | None = None) -> dict[str, object]:
    connection = http.client.HTTPConnection(host, port, timeout=5)
    started = time.monotonic()
    try:
        connection.request(method, path, body=body)
        response = connection.getresponse()
        data = response.read(MAX_BODY_BYTES + 1)
        return {"method": method, "path": path, "status": response.status,
                "version": response.version, "headers": dict(response.getheaders()),
                **body_fields(data), "seconds": time.monotonic() - started}
    finally:
        connection.close()


def allowed(headers: dict[str, str]) -> bool:
    return tuple(item.strip() for item in headers.get("allow", "").split(",")) == METHODS


def framing_ok(path: str, headers: dict[str, str], length: int) -> bool:
    return {
        "/ok": headers.get("content-length") == str(length) and "transfer-encoding" not in headers,
        "/chunked": headers.get("transfer-encoding", "").lower() == "chunked" and "content-length" not in headers,
        "/close": headers.get("connection", "").lower() == "close" and "content-length" not in headers and "transfer-encoding" not in headers,
    }[path]


def probe(host: str, port: int, expected: bytes | None = None,
          response_length: int = 64, response_mode: str = "fixed") -> dict[str, object]:
    legacy = expected is not None
    generated = (FIXED_PATTERN * ((response_length + len(FIXED_PATTERN) - 1) // len(FIXED_PATTERN)))[:response_length]
    configured = expected if legacy else generated
    expected_length = len(configured)
    results: list[dict[str, object]] = []
    random_samples: list[str] = []
    previous_random: dict[tuple[str, str], str] = {}

    def check(name: str, result: dict[str, object], condition: bool) -> None:
        result["name"] = name
        result["passed"] = condition
        results.append(result)

    def body_ok(result: dict[str, object], method: str, sent: bytes | None = None) -> bool:
        if method == "HEAD":
            return result["body_length"] == 0
        wanted = sent if legacy and method == "POST" else configured
        if not legacy and response_mode == "random":
            random_samples.append(str(result["body_sha256"]))
            return result["body_length"] == response_length
        return result["body_length"] == len(wanted) and result["body_sha256"] == hashlib.sha256(wanted).hexdigest()

    for round_number in (1, 2):
        for path in PATHS:
            for method in METHODS:
                sent = (b"public-http-request-\x00-\xff-" + str(round_number).encode("ascii")) if method in ("POST", "PUT", "PATCH", "DELETE", "OPTIONS") else None
                result = request(host, port, method, path, sent)
                headers = {k.lower(): v for k, v in result["headers"].items()}
                length = len(sent) if legacy and method == "POST" else expected_length
                check(f"round-{round_number}-{method.lower()}-{path[1:]}", result,
                      result["status"] == 200 and result["version"] == 11
                      and headers.get("content-type", "").lower() == "application/octet-stream"
                      and framing_ok(path, headers, length) and body_ok(result, method, sent)
                      and (method != "OPTIONS" or allowed(headers)))
                if not legacy and response_mode == "random" and method != "HEAD":
                    key = (method, path)
                    current_hash = str(result["body_sha256"])
                    if key in previous_random and response_length >= 2:
                        samples = [previous_random[key], current_hash]
                        # Natural short random collisions are allowed. Retry a few
                        # times before diagnosing a cached/constant response.
                        retries_valid = True
                        for _ in range(3):
                            if len(set(samples)) > 1:
                                break
                            retry = request(host, port, method, path, sent)
                            retries_valid = retries_valid and retry["status"] == 200 and retry["body_length"] == response_length
                            samples.append(str(retry["body_sha256"]))
                        check(f"random-pair-{method.lower()}-{path[1:]}",
                              {"sample_count": len(samples), "distinct_hashes": len(set(samples))},
                              retries_valid and len(set(samples)) > 1)
                    previous_random[key] = current_hash

    connection = http.client.HTTPConnection(host, port, timeout=5)
    try:
        previous_socket = None
        for round_number in (1, 2):
            connection.request("GET", "/ok")
            response = connection.getresponse()
            data = response.read(MAX_BODY_BYTES + 1)
            result = {"status": response.status, **body_fields(data)}
            check(f"same-connection-repeat-{round_number}", result,
                  response.status == 200 and body_ok(result, "GET") and connection.sock is not None
                  and (previous_socket is None or previous_socket is connection.sock))
            previous_socket = connection.sock
    finally:
        connection.close()

    for method in METHODS:
        result = request(host, port, method, "/unknown")
        check(f"unknown-path-{method.lower()}", result, result["status"] == 404)
    for method in ("TRACE", "CONNECT", "BREW"):
        result = request(host, port, method, "/ok")
        headers = {k.lower(): v for k, v in result["headers"].items()}
        check(f"unsupported-{method.lower()}", result, result["status"] == 405 and allowed(headers))

    # Read the raw stream to prove HEAD emits no bytes after the headers.
    for path in PATHS:
        with socket.create_connection((host, port), timeout=5) as sock:
            sock.settimeout(2)
            sock.sendall(f"HEAD {path} HTTP/1.1\r\nHost: target.test\r\nConnection: close\r\n\r\n".encode("ascii"))
            raw = b""
            while len(raw) <= 8192:
                part = sock.recv(min(4096, 8193 - len(raw)))
                if not part:
                    break
                raw += part
            header, sep, remainder = raw.partition(b"\r\n\r\n")
            check(f"raw-head-{path[1:]}", {"response_length": len(raw),
                  "response_sha256": hashlib.sha256(raw).hexdigest(),
                  "response_preview_hex": raw[:PREVIEW_BYTES].hex(),
                  "response_truncated": len(raw) > PREVIEW_BYTES, "body_length": len(remainder)},
                  bool(sep) and header.startswith(b"HTTP/1.1 200 ") and not remainder and len(raw) <= 8192)

    if not legacy and response_mode == "random":
        # Empty/one-byte responses can repeat naturally. With larger bodies, reject
        # an implementation that returns one constant value across all requests.
        check("random-response-variation", {"sample_count": len(random_samples),
              "distinct_hashes": len(set(random_samples)), "statistical_check_skipped": response_length < 2},
              response_length < 2 or len(set(random_samples)) > 1)
    return {"scenario": "http-basic", "observed_at": datetime.now(timezone.utc).isoformat(),
            "target": {"host": host, "port": port}, "legacy": legacy,
            "response_mode": "legacy" if legacy else response_mode,
            "response_length": expected_length, "configured_body": body_fields(configured) if legacy or response_mode == "fixed" else None,
            "passed": all(r["passed"] for r in results), "checks": results}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", required=True)
    parser.add_argument("--port", type=int, default=18090)
    content = parser.add_mutually_exclusive_group()
    content.add_argument("--body", help="Expected legacy UTF-8 response body; POST must echo its request")
    content.add_argument("--response-length", type=int, help="Expected generated body length, default 64")
    parser.add_argument("--response-mode", choices=("fixed", "random"), help="Expected generated body mode, default fixed")
    parser.add_argument("--output", type=Path, help="Optional JSON evidence file (must not exist)")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    if args.body is not None and args.response_mode is not None:
        parser.error("--body cannot be combined with --response-mode")
    length = args.response_length if args.response_length is not None else 64
    if not 0 <= length <= MAX_BODY_BYTES:
        parser.error("--response-length must be between 0 and 1048576")
    try:
        report = probe(args.host, args.port, args.body.encode("utf-8") if args.body is not None else None,
                       length, args.response_mode or "fixed")
    except (OSError, ValueError, http.client.HTTPException) as error:
        report = {"scenario": "http-basic", "passed": False, "error": str(error)[:2000]}
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("x") as stream:
            json.dump(report, stream, indent=2)
            stream.write("\n")
    print(json.dumps(report, indent=2))
    raise SystemExit(0 if report["passed"] else 1)


if __name__ == "__main__":
    main()
