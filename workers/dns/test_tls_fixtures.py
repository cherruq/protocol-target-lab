"""Real socket/TLS and source-preservation regressions for DNS extensions."""
import json
from pathlib import Path
import shutil
import socket
import socketserver
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import unittest

from dns_wire import connect_stream, tls_context, validate_config
from legacy_fixtures import CATALOG

ROOT = Path(__file__).resolve().parent
BASE = dict(bind_ip="127.0.0.1", port=15353, udp_enabled=True, tcp_enabled=True,
            records=[dict(name="device.test", record_type="A", value="192.0.2.28", ttl=60)])


def unused_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class ConfigTests(unittest.TestCase):
    def test_defaults_and_tls_only(self):
        old = validate_config(BASE)
        self.assertFalse(old["tls_enabled"])
        self.assertEqual(old["response_profile"], "standard")
        self.assertTrue(validate_config(dict(BASE, udp_enabled=False, tcp_enabled=False, tls_enabled=True))["tls_enabled"])

    def test_invalid_transports_ports_profiles_and_conflicting_fixture_sets(self):
        for changes in [dict(tls_enabled=1), dict(tls_port=True), dict(tls_port=0), dict(tls_enabled=True, tls_port=15353),
                        dict(response_profile="fake"),
                        dict(response_profile="legacy-fixtures", fixture_set="short"),
                        dict(udp_enabled=False, tcp_enabled=False), dict(response_profile=None)]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate_config(dict(BASE, **changes))
        self.assertEqual(validate_config(dict(BASE, response_profile="legacy-fixtures", fixture_set="short", tcp_enabled=False))["fixture_set"], "short")

    def test_dormant_fixture_survives_switch_to_standard_without_mutation(self):
        for fixture_set in ("short", "wrong-id"):
            active = validate_config(dict(BASE, response_profile="legacy-fixtures", fixture_set=fixture_set, tcp_enabled=False))
            dormant_input = dict(active, response_profile="standard", tcp_enabled=True, tls_enabled=True)
            dormant = validate_config(dormant_input)
            self.assertEqual(dormant, dormant_input)
            self.assertEqual(dormant["fixture_set"], fixture_set)
            reactivated = validate_config(dict(dormant, response_profile="legacy-fixtures", tcp_enabled=False, tls_enabled=False))
            self.assertEqual(reactivated, active)

    def test_all_57_original_scenarios_have_distinct_public_ids(self):
        self.assertEqual(len(CATALOG), 57)
        self.assertEqual(len({f.id for f in CATALOG}), 57)
        self.assertEqual(sum(f.transport == "UDP" and f.fixture_set == "final" for f in CATALOG), 35)
        self.assertEqual(sum(f.transport == "STREAM" for f in CATALOG), 20)
        self.assertEqual([f.trigger for f in CATALOG if f.fixture_set == "short"], [f.trigger for f in CATALOG if f.fixture_set == "wrong-id"])

    def test_mutually_exclusive_udp_sets_retain_distinct_real_responses(self):
        observed = []
        for fixture_set in ("short", "wrong-id"):
            config = dict(BASE, response_profile="legacy-fixtures", fixture_set=fixture_set, tcp_enabled=False)
            port = unused_port()
            with tempfile.TemporaryDirectory(prefix="plab-dns-udp-fixture-") as task_dir:
                with open(Path(task_dir) / "server.log", "w+") as log:
                    process = subprocess.Popen([sys.executable, "-B", str(ROOT / "server.py"), "--config-json", json.dumps(config),
                                                "--internal-port", str(port), "--internal-bind", "127.0.0.1"],
                                               stdout=log, stderr=subprocess.STDOUT)
                    try:
                        deadline = time.monotonic() + 3
                        while time.monotonic() < deadline:
                            log.flush()
                            if "ready" in Path(task_dir, "server.log").read_text():
                                break
                            if process.poll() is not None:
                                self.fail("UDP fixture server exited")
                            time.sleep(0.02)
                        result = subprocess.run([sys.executable, "-B", str(ROOT / "client.py"), "--host", "127.0.0.1", "--port", str(port),
                                                 "--config-json", json.dumps(config)], capture_output=True, text=True, timeout=5)
                        report = json.loads(result.stdout)
                        self.assertEqual(result.returncode, 0, report)
                        self.assertEqual(report["summary"], dict(total=2, passed=2, failed=0))
                        observed.append(report["checks"][0]["response"]["datagrams"][0]["sha256"])
                    finally:
                        if process.poll() is None:
                            process.terminate()
                            try:
                                process.wait(3)
                            except subprocess.TimeoutExpired:
                                process.kill()
                                process.wait()
        self.assertNotEqual(*observed)

    def test_health_stalled_tls_handshake_exits_before_manager_deadline(self):
        stop = threading.Event()
        class Stalled(socketserver.BaseRequestHandler):
            def handle(self):
                stop.wait(4)
        class Server(socketserver.ThreadingTCPServer):
            daemon_threads = True
        with Server(("127.0.0.1", 0), Stalled) as server:
            threading.Thread(target=server.serve_forever, daemon=True).start()
            try:
                config = dict(BASE, udp_enabled=False, tcp_enabled=False, tls_enabled=True,
                              tls_port=server.server_address[1])
                started = time.monotonic()
                result = subprocess.run([sys.executable, "-B", str(ROOT / "client.py"), "--host", "127.0.0.1", "--port", "15353",
                                         "--tls-port", str(server.server_address[1]), "--config-json", json.dumps(config), "--health"],
                                        capture_output=True, text=True, timeout=3)
                self.assertLess(time.monotonic() - started, 2.5)
                self.assertEqual(result.returncode, 1)
                self.assertFalse(json.loads(result.stdout)["passed"])
            finally:
                stop.set()
                server.shutdown()

    @unittest.skipUnless(shutil.which("dnsmasq"), "native dnsmasq is required for this independent TLS proxy test")
    def test_legacy_short_switches_to_standard_with_dormant_fixture_and_all_transports(self):
        port, tls_port = unused_port(), unused_port()
        legacy = dict(BASE, port=port, tcp_enabled=False, fixture_set="short", response_profile="legacy-fixtures")
        standard = dict(legacy, response_profile="standard", tcp_enabled=True, tls_enabled=True, tls_port=tls_port)
        for config in (legacy, standard):
            with self.subTest(profile=config["response_profile"]):
                self.exercise_native_profile(config, port, tls_port)

    def exercise_native_profile(self, config, port, tls_port):
        with tempfile.TemporaryDirectory(prefix="plab-dns-standard-tls-") as task_dir:
            with open(Path(task_dir) / "server.log", "w+") as log:
                process = subprocess.Popen([sys.executable, "-B", str(ROOT / "server.py"), "--config-json", json.dumps(config),
                                            "--internal-port", str(port), "--internal-tls-port", str(tls_port),
                                            "--internal-bind", "127.0.0.1", "--dnsmasq", shutil.which("dnsmasq")],
                                           stdout=log, stderr=subprocess.STDOUT)
                try:
                    for _ in range(60):
                        if process.poll() is not None:
                            log.seek(0)
                            self.fail("native DNS server exited: " + log.read())
                        if not config.get("tls_enabled"):
                            if "ready" in Path(task_dir, "server.log").read_text():
                                break
                            time.sleep(0.05)
                        else:
                            try:
                                with connect_stream("127.0.0.1", tls_port, "TLS"):
                                    break
                            except OSError:
                                time.sleep(0.05)
                    time.sleep(0.05)
                    command = [sys.executable, "-B", str(ROOT / "client.py"), "--host", "127.0.0.1", "--port", str(port),
                               "--config-json", json.dumps(config), "--tls-port", str(tls_port)]
                    counts = (18, 3) if config["response_profile"] == "standard" else (2, 1)
                    for extra, expected in [([], counts[0]), (["--health"], counts[1])]:
                        result = subprocess.run(command + extra, capture_output=True, text=True, timeout=10)
                        report = json.loads(result.stdout)
                        self.assertEqual(result.returncode, 0, report)
                        self.assertEqual(report["summary"], dict(total=expected, passed=expected, failed=0))
                        if config["response_profile"] == "standard":
                            self.assertEqual(report["target"]["transports"], ["UDP", "TCP", "TLS"])
                finally:
                    if process.poll() is None:
                        process.terminate()
                        try:
                            process.wait(3)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait()


class LiveFixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="plab-dns-tls-fixtures-")
        cls.port = unused_port()
        cls.tls_port = unused_port()
        cls.config = dict(BASE, port=cls.port, tls_enabled=True, tls_port=cls.tls_port, response_profile="legacy-fixtures")
        cls.log = open(Path(cls.temp.name) / "server.log", "w+")
        cls.process = subprocess.Popen([sys.executable, "-B", str(ROOT / "server.py"), "--config-json", json.dumps(cls.config),
                                       "--internal-bind", "127.0.0.1", "--internal-port", str(cls.port),
                                       "--internal-tls-port", str(cls.tls_port)], stdout=cls.log, stderr=subprocess.STDOUT)
        try:
            for _ in range(60):
                if cls.process.poll() is not None:
                    raise RuntimeError("DNS fixture server exited before ready")
                try:
                    with connect_stream("127.0.0.1", cls.tls_port, "TLS"):
                        break
                except OSError:
                    time.sleep(0.05)
            else:
                raise RuntimeError("DNS fixture server readiness timeout")
        except BaseException:
            cls.tearDownClass()
            raise

    @classmethod
    def tearDownClass(cls):
        if cls.process.poll() is None:
            cls.process.terminate()
            try:
                cls.process.wait(3)
            except subprocess.TimeoutExpired:
                cls.process.kill()
                cls.process.wait()
        cls.log.close()
        cls.temp.cleanup()

    def client(self, *extra):
        result = subprocess.run([sys.executable, "-B", str(ROOT / "client.py"), "--host", "127.0.0.1", "--port", str(self.port),
                                 "--config-json", json.dumps(self.config), "--tls-port", str(self.tls_port), *extra],
                                capture_output=True, text=True, timeout=35)
        report = json.loads(result.stdout)
        self.assertEqual(result.returncode, 0, report)
        self.assertTrue(report["passed"], report)
        return report

    def test_all_real_udp_tcp_tls_fixtures_two_rounds(self):
        report = self.client("--method", "ALL", "--path", "ALL")
        self.assertEqual(report["summary"], dict(total=150, passed=150, failed=0))
        self.assertLess(report["seconds"], 25)
        for check in report["checks"]:
            if check["response"].get("expected_silence"):
                self.assertIn("before", check["same_connection_positive_controls"])
                self.assertIn("after", check["same_connection_positive_controls"])

    def test_health_checks_all_enabled_transports_within_three_seconds(self):
        started = time.monotonic()
        report = self.client("--health")
        self.assertEqual(report["summary"]["total"], 3)
        self.assertLess(time.monotonic() - started, 3)

    def test_plaintext_rejected_on_tls_and_accept_loop_remains_responsive(self):
        with socket.create_connection(("127.0.0.1", self.tls_port), timeout=2) as sock:
            sock.sendall(b"not a TLS record")
            try:
                self.assertEqual(sock.recv(100), b"")
            except ConnectionResetError:
                pass
        self.client("--health")

    def test_trust_and_hostname_validation_are_enabled(self):
        with socket.create_connection(("127.0.0.1", self.tls_port), timeout=2) as sock:
            with self.assertRaises(ssl.SSLCertVerificationError):
                ssl.create_default_context().wrap_socket(sock, server_hostname="protocol-target-lab.test")
        with socket.create_connection(("127.0.0.1", self.tls_port), timeout=2) as sock:
            with self.assertRaises(ssl.SSLCertVerificationError):
                tls_context().wrap_socket(sock, server_hostname="wrong.test")

    def test_slow_handshake_does_not_block_other_tls_clients(self):
        with socket.create_connection(("127.0.0.1", self.tls_port), timeout=2):
            self.client("--health")


if __name__ == "__main__":
    unittest.main()
