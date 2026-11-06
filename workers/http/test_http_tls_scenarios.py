"""Real HTTP/TLS sockets and negative fixture verification, without Docker."""
import argparse
import contextlib
import http.client
import json
from pathlib import Path
import socket
import socketserver
import ssl
import subprocess
import sys
import threading
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import server
import client
from scenarios import SCENARIO_PATHS, response_parts, tls_file


@contextlib.contextmanager
def running(tls=False, **kwargs):
    context = None
    if tls:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(tls_file("lab.crt"), tls_file("lab.key"))
    instance = server.Server(("127.0.0.1", 0), tls=context, **kwargs)
    thread = threading.Thread(target=instance.serve_forever, kwargs={"poll_interval": 0.02})
    thread.start()
    try:
        yield instance
    finally:
        instance.close_connections()
        instance.shutdown()
        instance.server_close()
        thread.join(2)
        if thread.is_alive(): raise AssertionError("HTTP server did not stop")


def args_for(instance, path, tls=False):
    return argparse.Namespace(host="127.0.0.1", port=instance.server_port, path=path,
                              tls=tls, legacy_body=None, response_length=64, response_mode="fixed")


class RealHttpTests(unittest.TestCase):
    def test_all_generated_methods_and_delimiters_plain_and_tls(self):
        for tls in (False, True):
            with running(tls) as target:
                for path in ("/ok", "/chunked", "/close"):
                    for method in client.smoke.METHODS:
                        with self.subTest(tls=tls, method=method, path=path):
                            desc, body = client.request_description("127.0.0.1", target.server_port, method, path)
                            received = client.exchange("127.0.0.1", target.server_port, desc, body, tls)
                            self.assertEqual([], client.validate(received, method, path, body, 64, "fixed", None))
                            if tls:
                                self.assertIn(received["tls"]["version"], ("TLSv1.2", "TLSv1.3"))
                                self.assertEqual(received["tls"]["verified_server_name"], "protocol-target-lab.test")

    def test_all_fixed_scenarios_plain_and_tls(self):
        for tls in (False, True):
            with running(tls) as target:
                for path in SCENARIO_PATHS:
                    with self.subTest(tls=tls, path=path):
                        result = client.scenario_check(args_for(target, path, tls), 1)
                        self.assertTrue(result["passed"], result)
                        if tls:
                            self.assertIn(result["response"]["tls"]["version"], ("TLSv1.2", "TLSv1.3"))
                        if path == "/stall":
                            self.assertIn("early-quiet", result["name"])
                            self.assertIn("does not await", result["expected_behavior"])
                        if path.startswith("/auth/"):
                            result = client.scenario_check(args_for(target, path, tls), 1, False)
                            self.assertTrue(result["passed"], result)

    def test_actual_client_cli_tls_and_health_random(self):
        with running(True, response_length=128, response_mode="random") as target:
            run = subprocess.run([sys.executable, str(Path(client.__file__)), "--host", "127.0.0.1", "--port", str(target.server_port),
                                  "--tls", "--health", "--response-length", "128", "--response-mode", "random"], capture_output=True, text=True, timeout=5)
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
            result = json.loads(run.stdout)
            self.assertEqual(result["summary"], {"total": 1, "passed": 1, "failed": 0})

    def test_health_deadline_exits_against_real_silent_socket(self):
        class Silent(socketserver.BaseRequestHandler):
            def handle(self):
                self.request.recv(4096)
                self.server.release.wait(4)
        with socketserver.TCPServer(("127.0.0.1", 0), Silent) as target:
            target.release = threading.Event()
            thread = threading.Thread(target=target.serve_forever, kwargs={"poll_interval": 0.02})
            thread.start()
            try:
                started = time.monotonic()
                run = subprocess.run([sys.executable, "-B", str(Path(client.__file__)), "--host", "127.0.0.1", "--port", str(target.server_address[1]),
                                      "--health"], capture_output=True, text=True, timeout=3)
                self.assertLess(time.monotonic() - started, 2.5)
                self.assertEqual(run.returncode, 1, run.stdout + run.stderr)
                result = json.loads(run.stdout)
                self.assertFalse(result["passed"])
                self.assertIn("2-second", result["checks"][-1]["error"])
            finally:
                target.release.set()
                target.shutdown()
                thread.join(2)

    def test_legacy_body_post_echo_over_tls(self):
        with running(True, response_body=b"legacy-body") as target:
            for method in ("GET", "HEAD", "POST"):
                desc, body = client.request_description("127.0.0.1", target.server_port, method, "/ok")
                received = client.exchange("127.0.0.1", target.server_port, desc, body, True)
                self.assertEqual([], client.validate(received, method, "/ok", body, 0, "fixed", b"legacy-body"))

    def test_stalled_tls_handshake_does_not_block_accept_loop(self):
        with running(True) as target:
            with socket.create_connection(target.server_address, timeout=2):
                started = time.monotonic()
                client.healthy(args_for(target, "/ok", True))
                self.assertLess(time.monotonic() - started, 1)

    def test_tls_hostname_must_verify(self):
        with running(True) as target:
            context = ssl.create_default_context(cafile=str(tls_file("lab.crt")))
            with socket.create_connection(target.server_address, timeout=2) as sock:
                with self.assertRaises(ssl.SSLCertVerificationError):
                    context.wrap_socket(sock, server_hostname="wrong.invalid")

    def test_plaintext_not_misreported_as_tls_success(self):
        with running() as target:
            result = client.scenario_check(args_for(target, "/invalid-status", True), 1)
            self.assertFalse(result["passed"])

    def test_arbitrary_error_not_accepted_as_expected_malformed_response(self):
        class Wrong(socketserver.BaseRequestHandler):
            def handle(self):
                self.request.recv(4096)
                self.request.sendall(b"HTTP/1.1 500 Error\r\nContent-Length: 0\r\n\r\n")
        with socketserver.TCPServer(("127.0.0.1", 0), Wrong) as wrong:
            wrong.server_port = wrong.server_address[1]
            thread = threading.Thread(target=wrong.serve_forever, kwargs={"poll_interval": 0.02})
            thread.start()
            try:
                result = client.scenario_check(args_for(wrong, "/invalid-chunk"), 1)
                self.assertFalse(result["passed"])
                self.assertIn("differs", result["error"])
            finally:
                wrong.shutdown()
                thread.join(2)

    def test_shutdown_interrupts_30_second_stall_and_five_second_header_hold(self):
        for path in ("/stall", "/head"):
            with running() as target:
                sock = socket.create_connection(target.server_address, timeout=2)
                try:
                    sock.sendall(f"GET {path} HTTP/1.1\r\nHost: lab\r\n\r\n".encode())
                    time.sleep(0.05)
                    started = time.monotonic()
                    target.close_connections()
                    target.shutdown()
                    self.assertLess(time.monotonic() - started, 1)
                finally:
                    sock.close()

    def test_independent_fixture_vectors(self):
        self.assertEqual(response_parts("/truncated", "GET"), [(0, b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nabc")])
        self.assertEqual(response_parts("/status-099", "GET"), [(0, b"HTTP/1.1 099 Bad\r\n\r\n")])
        self.assertEqual(b"".join(p for _, p in response_parts("/split-length", "GET")), b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello")
        self.assertEqual(response_parts("/head", "HEAD"), [(0, b"HTTP/1.1 200 OK\r\nContent-Length: 123\r\n\r\n"), (5, b"")])
        self.assertEqual(response_parts("/stall", "GET")[0][0], 30)


if __name__ == "__main__":
    unittest.main()
