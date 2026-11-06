#!/usr/bin/env python3
"""Persistent real dnsmasq plus TLS proxy, or explicit byte-exact lab fixtures."""
import argparse
import json
import ipaddress
from pathlib import Path
import signal
import socket
import socketserver
import ssl
import subprocess
import sys
import threading
import time

from dns_wire import validate_config
from legacy_fixtures import selected_fixtures

PRINT_LOCK = threading.Lock()
STOPPING = threading.Event()


def emit(event, **fields):
    with PRINT_LOCK:
        print(json.dumps(dict(event=event, time_ns=time.time_ns(), **fields), separators=(",", ":")), flush=True)


def server_context():
    root = Path(__file__).resolve().parent
    cert = root / "tls"
    if not cert.exists():
        cert = root.parent / "tls"
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(cert / "lab.crt", cert / "lab.key")
    return context


def read_frame(stream):
    data = bytearray()
    expected = 2
    deadline = time.monotonic() + 5
    while len(data) < expected:
        if STOPPING.is_set() or time.monotonic() >= deadline:
            raise TimeoutError("DNS request frame deadline")
        stream.settimeout(min(0.2, max(0.001, deadline - time.monotonic())))
        try:
            part = stream.recv(expected - len(data))
        except TimeoutError:
            continue
        if not part:
            if not data:
                return None
            raise ValueError("incomplete DNS request frame")
        data.extend(part)
        if len(data) == 2:
            expected = 2 + int.from_bytes(data, "big")
    return bytes(data)


class BoundedThreads(socketserver.ThreadingMixIn):
    daemon_threads = True
    block_on_close = False

    def process_request(self, request, address):
        if not self.slots.acquire(False):
            self.shutdown_request(request)
            emit("connection_rejected", reason="64 active requests", peer=address)
            return
        try:
            super().process_request(request, address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()


class StreamServer(BoundedThreads, socketserver.TCPServer):
    allow_reuse_address = True
    request_queue_size = 16

    def __init__(self, address, config, context=None, proxy_port=None):
        self.slots = threading.BoundedSemaphore(64)
        self.context = context
        self.proxy_port = proxy_port
        self.fixtures = {f.trigger: f for f in selected_fixtures(config, "TCP")}
        self.clients = set()
        self.clients_lock = threading.Lock()
        super().__init__(address, StreamHandler)

    def add_client(self, sock):
        with self.clients_lock:
            self.clients.add(sock)

    def remove_client(self, sock):
        with self.clients_lock:
            self.clients.discard(sock)

    def close_clients(self):
        with self.clients_lock:
            clients = list(self.clients)
        for sock in clients:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            sock.close()

    def handle_error(self, request, address):
        emit("connection_error", peer=address, error="connection closed or invalid request")


class DatagramServer(BoundedThreads, socketserver.UDPServer):
    allow_reuse_address = True
    max_packet_size = 65535

    def __init__(self, address, config):
        self.slots = threading.BoundedSemaphore(64)
        self.fixtures = {f.trigger: f for f in selected_fixtures(config, "UDP")}
        super().__init__(address, DatagramHandler)

    def handle_error(self, request, address):
        emit("datagram_error", peer=address)


class DatagramHandler(socketserver.BaseRequestHandler):
    def handle(self):
        request, sock = self.request
        fixture = self.server.fixtures.get(request)
        emit("fixture_request", transport="UDP", peer=self.client_address,
             fixture=fixture.id if fixture else None, request_hex=request[:128].hex(), request_length=len(request))
        if fixture is None:
            return
        for delay, payload in fixture.frames:
            if STOPPING.wait(delay):
                return
            sock.sendto(payload, self.client_address)
            emit("fixture_send", transport="UDP", fixture=fixture.id, bytes=len(payload), hex=payload[:128].hex())


class StreamHandler(socketserver.BaseRequestHandler):
    def handle(self):
        server = self.server
        stream = self.request
        server.add_client(stream)
        stream.settimeout(3)
        try:
            if server.context is not None:
                wrapped = server.context.wrap_socket(stream, server_side=True)
                server.remove_client(stream)
                stream = wrapped
                server.add_client(stream)
            if server.proxy_port is not None:
                return self.proxy(stream, server.proxy_port)
            while not STOPPING.is_set():
                request = read_frame(stream)
                if request is None:
                    return
                fixture = server.fixtures.get(request)
                emit("fixture_request", transport="TLS" if server.context else "TCP", peer=self.client_address,
                     fixture=fixture.id if fixture else None, request_hex=request[:128].hex(), request_length=len(request))
                if fixture is None:
                    return
                stream.settimeout(3)
                for delay, payload in fixture.frames:
                    if STOPPING.wait(delay):
                        return
                    if payload:
                        stream.sendall(payload)
                        emit("fixture_send", transport="TLS" if server.context else "TCP", fixture=fixture.id, bytes=len(payload), hex=payload[:128].hex())
                if fixture.close:
                    return
        except (OSError, ValueError) as exc:
            emit("connection_error", peer=self.client_address, error=str(exc)[:512])
        finally:
            server.remove_client(stream)
            stream.close()

    def proxy(self, stream, port):
        with socket.create_connection(("127.0.0.1", port), timeout=3) as upstream:
            self.server.add_client(upstream)
            try:
                while not STOPPING.is_set():
                    request = read_frame(stream)
                    if request is None:
                        return
                    upstream.settimeout(3)
                    upstream.sendall(request)
                    response = read_frame(upstream)
                    if response is None:
                        raise ValueError("dnsmasq closed before a response")
                    stream.settimeout(3)
                    stream.sendall(response)
                    emit("tls_proxy_response", request_length=len(request), response_length=len(response))
            finally:
                self.server.remove_client(upstream)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config-json", required=True)
    parser.add_argument("--internal-port", type=int, default=15353)
    parser.add_argument("--internal-tls-port", type=int, default=1853)
    parser.add_argument("--internal-bind", default="0.0.0.0")
    parser.add_argument("--dnsmasq", default="/usr/local/sbin/dnsmasq")
    args = parser.parse_args()
    servers = []
    started_servers = []
    child = None
    exit_code = 0
    STOPPING.clear()
    def stop(*_):
        STOPPING.set()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        config = validate_config(json.loads(args.config_json))
        ipaddress.IPv4Address(args.internal_bind)
        if not 1 <= args.internal_port <= 65535 or not 1 <= args.internal_tls_port <= 65535 or (config["tls_enabled"] and args.internal_port == args.internal_tls_port):
            raise ValueError("internal DNS ports must be distinct valid ports")
        context = server_context() if config["tls_enabled"] else None
        if config["response_profile"] == "standard":
            command = [args.dnsmasq, "--conf-file=/dev/null", "--keep-in-foreground", f"--port={args.internal_port}", "--no-resolv", "--no-hosts", "--local=/#/", "--cache-size=0", "--log-queries=extra", "--log-facility=-", "--pid-file=", "--edns-packet-max=1232"]
            if args.internal_bind != "0.0.0.0":
                command += ["--listen-address=" + args.internal_bind, "--bind-interfaces"]
            command += ["--host-record={name},{value},{ttl}".format(**r) for r in config["records"]]
            child = subprocess.Popen(command)
        else:
            if config["udp_enabled"]:
                servers.append(DatagramServer((args.internal_bind, args.internal_port), config))
            if config["tcp_enabled"]:
                servers.append(StreamServer((args.internal_bind, args.internal_port), config))
        if context:
            servers.append(StreamServer((args.internal_bind, args.internal_tls_port), config, context,
                                        args.internal_port if config["response_profile"] == "standard" else None))
        for server in servers:
            threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.1}, daemon=True).start()
            started_servers.append(server)
        emit("ready", response_profile=config["response_profile"], fixture_set=config["fixture_set"],
             udp_enabled=config["udp_enabled"], tcp_enabled=config["tcp_enabled"], tls_enabled=config["tls_enabled"],
             internal_port=args.internal_port, internal_tls_port=args.internal_tls_port)
        while not STOPPING.wait(0.1):
            if child is not None and child.poll() is not None:
                emit("dnsmasq_exit", returncode=child.returncode)
                exit_code = 1
                break
    except (ValueError, TypeError, OSError) as exc:
        emit("configuration_error", error=str(exc)[:1024])
        exit_code = 2
    finally:
        STOPPING.set()
        for server in servers:
            if isinstance(server, StreamServer):
                server.close_clients()
            if server in started_servers:
                server.shutdown()
            server.server_close()
        if child is not None and child.poll() is None:
            child.terminate()
            try:
                child.wait(3)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
        emit("stopped")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
