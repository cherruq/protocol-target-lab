#!/usr/bin/env python3
"""Read-only, bounded real DNS workspace verification; stdout is one JSON report."""
import argparse
import json
import secrets
import signal
import struct
import sys
import time
from dns_wire import TYPE_IDS, canonical_name, decode, exchange, preview, query, validate_config
from legacy_fixtures import selected_fixtures
from legacy_client import run_fixture


class Deadline(Exception):
    pass

class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise ValueError(message)


def run_check(host, port, transport, name, qtype, expected, rcode, round_number):
    ident, wire = query(name, qtype)
    request = dict(transport=transport, name=name, qtype=qtype, transaction_id=ident, **preview(wire))
    if transport == "TCP":
        request["frame_length"] = len(wire)
    check = dict(name=f"{transport}/{name[:48]}/{qtype}/round-{round_number}", passed=False, request=request)
    started = time.monotonic()
    try:
        response_wire = exchange(host, port, transport, wire)
        response = decode(response_wire)
        check["response"] = dict(response, wire=preview(response_wire))
        if response["transaction_id"] != ident or response["flags"] & 0x8000 == 0 or response["flags"] & 0x7a00:
            raise ValueError("DNS transaction ID, QR, opcode or TC mismatch")
        if response["question"] != dict(name=name, qtype=qtype, klass=1) or response["rcode"] != rcode:
            raise ValueError("DNS question or rcode mismatch")
        actual = [(r["name"], r["type_id"], r["klass"], r["value"], r["ttl"]) for r in response["answers"]]
        if sorted(actual) != sorted(expected):
            raise ValueError("DNS answer RRset/address/TTL mismatch")
        check["passed"] = True
    except (OSError, ValueError, TypeError, UnicodeError, struct.error) as exc:
        check["error"] = str(exc)[:1024]
    check["seconds"] = round(time.monotonic() - started, 6)
    return check


def main():
    started = time.monotonic()
    report = dict(passed=False, checks=[])
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(Deadline("overall DNS test deadline exceeded (30 seconds)")))
    signal.alarm(30)
    try:
        parser = Parser(description=__doc__)
        parser.add_argument("--host", required=True)
        parser.add_argument("--port", required=True, type=int)
        parser.add_argument("--method", choices=("UDP", "TCP", "TLS", "ALL"), default="ALL")
        parser.add_argument("--path", default="ALL")
        parser.add_argument("--config-json", required=True)
        parser.add_argument("--tls-port", type=int)
        parser.add_argument("--health", action="store_true")
        args = parser.parse_args()
        if args.health:
            # Exit inside Docker before the manager's 3-second exec deadline.
            signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(Deadline("DNS health deadline exceeded (2 seconds)")))
            signal.alarm(2)
        config = validate_config(json.loads(args.config_json))
        if not 1 <= args.port <= 65535:
            raise ValueError("port: expected 1..65535")
        tls_port = args.tls_port if args.tls_port is not None else (1853 if args.health else config["tls_port"])
        if not 1 <= tls_port <= 65535:
            raise ValueError("tls_port: expected 1..65535")
        enabled = [t for t in ("UDP", "TCP", "TLS") if config[t.lower() + "_enabled"]]
        transports = enabled if args.method == "ALL" else [args.method]
        if any(t not in enabled for t in transports):
            raise ValueError("selected transport is disabled in applied configuration")
        if config["response_profile"] == "legacy-fixtures":
            for transport in transports:
                fixtures = selected_fixtures(config, transport, args.path)
                if args.health:
                    fixtures = fixtures[:1]
                for round_number in ((1,) if args.health else (1, 2)):
                    for fixture in fixtures:
                        report["checks"].append(run_fixture(args.host, tls_port if transport == "TLS" else args.port,
                                                            transport, fixture, config, round_number))
            if not report["checks"]:
                raise ValueError("path: select a fixture available for an enabled transport and current fixture_set")
            report["target"] = dict(host=args.host[:253], port=args.port, tls_port=tls_port,
                                    transports=transports, response_profile="legacy-fixtures", fixture_set=config["fixture_set"])
            return finish_report(report, started)
        names = sorted({r["name"] for r in config["records"]})
        if args.path != "ALL":
            selected = canonical_name(args.path)
            if selected not in names:
                raise ValueError("path: select ALL or a configured name")
            names = [selected]
        unknown = "missing-" + secrets.token_hex(8) + ".invalid"
        while unknown in names:
            unknown = "missing-" + secrets.token_hex(8) + ".invalid"
        for transport in transports:
            port = tls_port if transport == "TLS" else args.port
            if args.health:
                r = config["records"][0]
                expected = [(r["name"], TYPE_IDS[r["record_type"]], 1, x["value"], x["ttl"]) for x in config["records"] if x["name"] == r["name"] and x["record_type"] == r["record_type"]]
                report["checks"].append(run_check(args.host, port, transport, r["name"], TYPE_IDS[r["record_type"]], expected, 0, 1))
                continue
            for round_number in (1, 2):
                for name in names:
                    kinds = {r["record_type"] for r in config["records"] if r["name"] == name}
                    for kind in sorted(kinds):
                        expected = [(name, TYPE_IDS[kind], 1, r["value"], r["ttl"]) for r in config["records"] if r["name"] == name and r["record_type"] == kind]
                        report["checks"].append(run_check(args.host, port, transport, name, TYPE_IDS[kind], expected, 0, round_number))
                    absent = "A" if "A" not in kinds else "AAAA" if "AAAA" not in kinds else "TXT"
                    report["checks"].append(run_check(args.host, port, transport, name, TYPE_IDS[absent], [], 0, round_number))
                report["checks"].append(run_check(args.host, port, transport, unknown, 1, [], 3, round_number))
        report["target"] = dict(host=args.host[:253], port=args.port, tls_port=tls_port, transports=transports, names=names)
    except (ValueError, TypeError, OSError, Deadline) as exc:
        report["error"] = str(exc)[:1024]
    finally:
        signal.alarm(0)
    return finish_report(report, started)


def finish_report(report, started):
    passed = sum(c["passed"] for c in report["checks"])
    report["summary"] = dict(total=len(report["checks"]), passed=passed, failed=len(report["checks"]) - passed)
    report["passed"] = bool(report["checks"]) and passed == len(report["checks"]) and "error" not in report
    report["seconds"] = round(time.monotonic() - started, 6)
    output = json.dumps(report, separators=(",", ":"))
    if len(output.encode()) > 768 * 1024:
        # Preserve all semantic results for maximum-length names. Wire bytes are supplementary.
        for check in report["checks"]:
            for packet in (check["request"], check.get("response", {}).get("wire", {})):
                if "hex" in packet:
                    packet["hex"] = ""
                    packet["truncated"] = packet["length"] > 0
        report["wire_previews_omitted"] = "report byte budget"
        output = json.dumps(report, separators=(",", ":"))
    if len(output.encode()) > 768 * 1024:
        report = dict(passed=False, checks=[], summary=report["summary"], seconds=report["seconds"], error="DNS report exceeded 768 KiB limit")
        output = json.dumps(report, separators=(",", ":"))
    print(output, flush=True)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
