#!/usr/bin/env python3
"""Probe an already-started HTTP target; never changes its configuration."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import http.client
import json
from pathlib import Path
import socket
import time


def request(host: str, port: int, method: str, path: str, body: bytes | None = None) -> dict[str, object]:
    connection = http.client.HTTPConnection(host, port, timeout=5)
    started = time.monotonic()
    try:
        connection.request(method, path, body=body)
        response = connection.getresponse()
        data = response.read()
        return {"method": method, "path": path, "status": response.status,
                "version": response.version, "headers": dict(response.getheaders()),
                "body_hex": data.hex(), "body_length": len(data),
                "seconds": time.monotonic() - started}
    finally:
        connection.close()


def probe(host: str, port: int, expected: bytes) -> dict[str, object]:
    results: list[dict[str, object]] = []
    def check(name: str, result: dict[str, object], condition: bool) -> None:
        result["name"] = name
        result["passed"] = condition
        results.append(result)

    for round_number in (1, 2):
        for path in ("/ok", "/chunked", "/close"):
            result = request(host, port, "GET", path)
            headers = {k.lower(): v for k, v in result["headers"].items()}
            framing = {
                "/ok": headers.get("content-length") == str(len(expected)) and "transfer-encoding" not in headers,
                "/chunked": headers.get("transfer-encoding", "").lower() == "chunked" and "content-length" not in headers,
                "/close": headers.get("connection", "").lower() == "close" and "content-length" not in headers and "transfer-encoding" not in headers,
            }[path]
            check(f"round-{round_number}-get-{path[1:]}", result,
                  result["status"] == 200 and result["version"] == 11 and result["body_hex"] == expected.hex() and framing)
            result = request(host, port, "HEAD", path)
            headers = {k.lower(): v for k, v in result["headers"].items()}
            correct_head = {
                "/ok": headers.get("content-length") == str(len(expected)),
                "/chunked": headers.get("transfer-encoding", "").lower() == "chunked",
                "/close": headers.get("connection", "").lower() == "close",
            }[path]
            check(f"round-{round_number}-head-{path[1:]}", result,
                  result["status"] == 200 and result["body_length"] == 0 and correct_head)
            body = b"public-http-echo-\x00-\xff-" + str(round_number).encode("ascii")
            result = request(host, port, "POST", path, body)
            check(f"round-{round_number}-post-{path[1:]}", result,
                  result["status"] == 200 and result["body_hex"] == body.hex())
    connection = http.client.HTTPConnection(host, port, timeout=5)
    try:
        previous_socket = None
        for _ in range(2):
            connection.request("GET", "/ok")
            response = connection.getresponse()
            data = response.read()
            check("same-connection-repeat", {"status": response.status, "body_hex": data.hex()},
                  response.status == 200 and data == expected and connection.sock is not None
                  and (previous_socket is None or previous_socket is connection.sock))
            previous_socket = connection.sock
    finally:
        connection.close()
    result = request(host, port, "GET", "/unknown")
    check("unknown-path", result, result["status"] == 404)
    # Read the raw stream to prove HEAD emits no bytes after the headers.
    for path in ("/ok", "/chunked", "/close"):
        with socket.create_connection((host, port), timeout=5) as sock:
            sock.settimeout(2)
            sock.sendall(f"HEAD {path} HTTP/1.1\r\nHost: target.test\r\nConnection: close\r\n\r\n".encode("ascii"))
            raw = b""
            while True:
                part = sock.recv(4096)
                if not part:
                    break
                raw += part
            header, sep, remainder = raw.partition(b"\r\n\r\n")
            check(f"raw-head-{path[1:]}", {"response_hex": raw.hex(), "body_length": len(remainder)},
                  bool(sep) and header.startswith(b"HTTP/1.1 200 ") and not remainder)
    return {"scenario": "http-basic", "observed_at": datetime.now(timezone.utc).isoformat(),
            "target": {"host": host, "port": port}, "expected_body_hex": expected.hex(),
            "passed": all(r["passed"] for r in results), "checks": results}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", required=True)
    parser.add_argument("--port", type=int, default=18090)
    parser.add_argument("--body", default="hello", help="Expected configured UTF-8 response body")
    parser.add_argument("--output", type=Path, help="Optional JSON evidence file (must not exist)")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    try:
        report = probe(args.host, args.port, args.body.encode("utf-8"))
    except (OSError, ValueError, http.client.HTTPException) as error:
        report = {"scenario": "http-basic", "passed": False, "error": str(error)}
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("x") as stream:
            json.dump(report, stream, indent=2)
            stream.write("\n")
    print(json.dumps(report, indent=2))
    raise SystemExit(0 if report["passed"] else 1)


if __name__ == "__main__":
    main()
