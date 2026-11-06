"""Real byte-exact checks for deliberately malformed DNS lab fixtures."""
import socket
import time
from dns_wire import connect_stream, preview, recv_exact
from legacy_fixtures import selected_fixtures

QUIET_SECONDS = 0.15


def verify_quiet(sock):
    sock.settimeout(QUIET_SECONDS)
    try:
        unexpected = sock.recv(65535)
    except TimeoutError:
        return
    raise ValueError("Expected held-open silence; received EOF or unexpected bytes: " + unexpected[:64].hex())


def stream_result(sock, fixture):
    started = time.monotonic()
    sock.settimeout(3)
    data = recv_exact(sock, len(fixture.response))
    if data != fixture.response:
        raise ValueError("Fixture response bytes differ")
    elapsed = time.monotonic() - started
    minimum = sum(delay for delay, _ in fixture.frames)
    # A generous 30ms tolerance avoids interpreting socket fragments as TCP segments.
    if minimum and elapsed + 0.03 < minimum:
        raise ValueError("Fixture response arrived before its configured delay")
    if fixture.close:
        if sock.recv(1) != b"":
            raise ValueError("Fixture response has extra bytes instead of EOF")
    else:
        verify_quiet(sock)
    return data


def udp_control(sock, control):
    sock.settimeout(3)
    sock.send(control.trigger)
    expected = [payload for _, payload in control.frames]
    actual = [sock.recv(65535) for _ in expected]
    if actual != expected:
        raise ValueError("Same-socket positive UDP control failed")
    return dict(fixture=control.id, response=[preview(w) for w in actual])


def run_fixture(host, port, transport, fixture, config, round_number):
    check = dict(name=f"{transport}/{fixture.id}/round-{round_number}", passed=False,
                 request=dict(transport=transport, fixture=fixture.id, **preview(fixture.trigger)))
    started = time.monotonic()
    try:
        controls = {}
        if transport == "UDP":
            family, socktype, proto, _, address = socket.getaddrinfo(host, port, type=socket.SOCK_DGRAM)[0]
            with socket.socket(family, socktype, proto) as sock:
                sock.settimeout(3)
                sock.connect(address)
                if not fixture.frames:
                    control = next(f for f in selected_fixtures(config, "UDP") if f.frames)
                    controls["before"] = udp_control(sock, control)
                sock.send(fixture.trigger)
                actual = []
                for delay, expected in fixture.frames:
                    t = time.monotonic()
                    wire = sock.recv(65535)
                    if wire != expected:
                        raise ValueError("Fixture datagram bytes differ")
                    if delay and time.monotonic() - t + 0.03 < delay:
                        raise ValueError("Fixture datagram arrived before configured delay")
                    actual.append(wire)
                verify_quiet(sock)
                if not fixture.frames:
                    controls["after"] = udp_control(sock, control)
                check["response"] = dict(datagrams=[preview(w) for w in actual],
                                         expected_silence=not fixture.frames,
                                         quiet_seconds=QUIET_SECONDS)
        else:
            with connect_stream(host, port, transport) as sock:
                if not fixture.response:
                    # stream/two-frames keeps this same connection alive, proving it reaches
                    # the target before and after the deliberately silent next request.
                    control = next(f for f in selected_fixtures(config, transport) if f.id == "stream/two-frames")
                    sock.sendall(control.trigger)
                    controls["before"] = dict(fixture=control.id, response=preview(stream_result(sock, control)))
                sock.settimeout(3)
                sock.sendall(fixture.trigger)
                wire = stream_result(sock, fixture)
                check["response"] = dict(**preview(wire), close=fixture.close,
                                         expected_silence=not wire,
                                         quiet_seconds=QUIET_SECONDS if not fixture.close else 0)
                if not fixture.close:
                    control = next(f for f in selected_fixtures(config, transport) if f.id == "stream/normal-10")
                    sock.settimeout(3)
                    sock.sendall(control.trigger)
                    controls["after"] = dict(fixture=control.id, response=preview(stream_result(sock, control)))
        if controls:
            check["same_connection_positive_controls"] = controls
        check["passed"] = True
    except (OSError, ValueError, StopIteration) as exc:
        check["error"] = str(exc)[:1024]
    check["seconds"] = round(time.monotonic() - started, 6)
    return check
