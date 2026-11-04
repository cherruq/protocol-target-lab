"""Strict DNS configuration and bounded RFC 1035 wire helpers (standard library)."""
import hashlib
import ipaddress
import re
import secrets
import socket
import struct

TYPE_IDS = {"A": 1, "AAAA": 28, "TXT": 16}
TYPE_NAMES = {v: k for k, v in TYPE_IDS.items()}

def canonical_name(value):
    if not isinstance(value, str) or value.endswith(".."):
        raise ValueError("name: expected ASCII DNS hostname")
    name = value.removesuffix(".").lower()
    if len(name) > 253 or not name or any(not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", s, re.ASCII) for s in name.split(".")):
        raise ValueError("name: expected ASCII DNS labels 1..63 and total <=253")
    return name

def validate_config(config):
    if not isinstance(config, dict) or set(config) != {"bind_ip", "port", "udp_enabled", "tcp_enabled", "records"}:
        raise ValueError("config: expected bind_ip, port, udp_enabled, tcp_enabled, records only")
    if not isinstance(config["bind_ip"], str):
        raise ValueError("bind_ip: expected IPv4 string")
    ip = ipaddress.IPv4Address(config["bind_ip"])
    if ip.is_multicast or int(ip) == 0xffffffff or type(config["port"]) is not int or not 1 <= config["port"] <= 65535:
        raise ValueError("bind_ip/port: expected unicast/wildcard IPv4 and port 1..65535")
    if any(type(config[k]) is not bool for k in ("udp_enabled", "tcp_enabled")) or not (config["udp_enabled"] or config["tcp_enabled"]):
        raise ValueError("transports: enable UDP or TCP using booleans")
    if not isinstance(config["records"], list) or not 1 <= len(config["records"]) <= 32:
        raise ValueError("records: expected 1..32 records")
    records, seen, sets = [], set(), {}
    for r in config["records"]:
        if not isinstance(r, dict) or set(r) != {"name", "record_type", "value", "ttl"}:
            raise ValueError("record: expected name, record_type, value, ttl only")
        name, kind = canonical_name(r["name"]), r["record_type"]
        if kind not in ("A", "AAAA"):
            raise ValueError("record_type: expected A or AAAA")
        if not isinstance(r["value"], str):
            raise ValueError("value: expected IP address string")
        value = str((ipaddress.IPv4Address if kind == "A" else ipaddress.IPv6Address)(r["value"]))
        ttl = r["ttl"]
        if type(ttl) is not int or not 0 <= ttl <= 86400:
            raise ValueError("ttl: expected integer 0..86400")
        key = (name, kind, value)
        if key in seen:
            raise ValueError("records: duplicate name/type/address")
        seen.add(key)
        old_ttl, count = sets.get((name, kind), (ttl, 0))
        if old_ttl != ttl or count >= 16:
            raise ValueError("RRset: expected consistent TTL and at most 16 addresses")
        sets[name, kind] = ttl, count + 1
        records.append(dict(name=name, record_type=kind, value=value, ttl=ttl))
    return dict(config, bind_ip=str(ip), records=records)

def encode_name(name):
    return b"".join(bytes([len(s)]) + s.encode("ascii") for s in name.split(".")) + b"\0"

def query(name, qtype):
    ident = secrets.randbits(16)
    # EDNS payload 1232; do not depend on TCP fallback for UDP-only workspaces.
    data = struct.pack("!6H", ident, 0x0100, 1, 0, 0, 1) + encode_name(name) + struct.pack("!HH", qtype, 1)
    return ident, data + struct.pack("!BHHIH", 0, 41, 1232, 0, 0)

def read_name(data, offset):
    pos, end, labels, seen = offset, None, [], set()
    # A maximum-label name plus a compression pointer needs 129 positions.
    # Bound work independently of the DNS name length while retaining cycle checks.
    while True:
        if pos in seen or len(seen) >= 256 or pos >= len(data):
            raise ValueError("invalid/truncated DNS name pointer")
        seen.add(pos)
        n = data[pos]
        if n & 0xc0 == 0xc0:
            if pos + 2 > len(data):
                raise ValueError("truncated pointer")
            if end is None:
                end = pos + 2
            pos = struct.unpack_from("!H", data, pos)[0] & 0x3fff
        elif n == 0:
            name = ".".join(labels).lower()
            if len(name) > 253:
                raise ValueError("oversized DNS name")
            return name, end if end is not None else pos + 1
        else:
            if n > 63 or pos + 1 + n > len(data):
                raise ValueError("invalid/truncated DNS label")
            labels.append(data[pos + 1:pos + 1 + n].decode("ascii"))
            pos += n + 1

def decode(data):
    if not 12 <= len(data) <= 65535:
        raise ValueError("invalid DNS message length")
    ident, flags, qd, an, ns, ar = struct.unpack_from("!6H", data)
    if qd != 1 or an + ns + ar > 128:
        raise ValueError("unexpected DNS question/record count")
    name, pos = read_name(data, 12)
    qtype, qclass = struct.unpack_from("!HH", data, pos)
    pos += 4
    sections = []
    for count in (an, ns, ar):
        records = []
        for _ in range(count):
            owner, pos = read_name(data, pos)
            kind, klass, ttl, size = struct.unpack_from("!HHIH", data, pos)
            pos += 10
            value = data[pos:pos + size]
            if len(value) != size:
                raise ValueError("truncated RDATA")
            pos += size
            if kind in (1, 28):
                if len(value) != (4 if kind == 1 else 16):
                    raise ValueError("invalid address RDATA")
                value = str(ipaddress.ip_address(value))
            else:
                value = value[:128].hex()
            records.append(dict(name=owner, record_type=TYPE_NAMES.get(kind, str(kind)), type_id=kind, klass=klass, ttl=ttl, value=value))
        sections.append(records)
    if pos != len(data):
        raise ValueError("trailing DNS bytes")
    return dict(transaction_id=ident, flags=flags, rcode=flags & 15, question=dict(name=name, qtype=qtype, klass=qclass), answers=sections[0], authority=sections[1], additional=sections[2])

def preview(data, limit=128):
    return dict(length=len(data), hex=data[:limit].hex(), truncated=len(data) > limit, sha256=hashlib.sha256(data).hexdigest())

def recv_exact(sock, size):
    result = bytearray()
    while len(result) < size:
        part = sock.recv(size - len(result))
        if not part:
            raise ValueError("TCP closed before complete DNS frame")
        result.extend(part)
    return bytes(result)

def exchange(host, port, transport, data):
    # getaddrinfo accepts literal IPv4/IPv6 and hostnames; no config field can override this destination.
    family, socktype, proto, _, address = socket.getaddrinfo(host, port, type=socket.SOCK_DGRAM if transport == "UDP" else socket.SOCK_STREAM)[0]
    with socket.socket(family, socktype, proto) as sock:
        sock.settimeout(3)
        sock.connect(address)
        if transport == "UDP":
            sock.send(data)
            return sock.recv(65535)
        sock.sendall(struct.pack("!H", len(data)) + data)
        size = struct.unpack("!H", recv_exact(sock, 2))[0]
        if size < 12:
            raise ValueError("invalid TCP DNS frame length")
        return recv_exact(sock, size)
