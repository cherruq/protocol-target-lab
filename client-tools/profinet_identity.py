"""Read-only kernel identity probe, executed inside the exact owned source container."""
import fcntl
import hashlib
import json
import os
import socket
import stat
import sys

want = json.loads(sys.argv[1])
status = want["status"]
interfaces = {}
for role, expected in status["interfaces"].items():
    name = expected["name"]
    if not isinstance(name, str) or not name or len(name) > 15 or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-" for c in name):
        raise RuntimeError("invalid interface name")
    base = "/sys/class/net/" + name
    def read(field):
        with open(base + "/" + field, encoding="ascii") as f:
            return f.read().strip()
    actual = dict(name=name, ifindex=int(read("ifindex")), iflink=int(read("iflink")), mac=read("address").lower(), hardware_type=int(read("type")), mtu=int(read("mtu")), namespace=os.readlink("/proc/self/ns/net"))
    if any(actual[k] != expected[k] for k in actual):
        raise RuntimeError("actual interface differs from runtime observation: " + role)
    interfaces[role] = actual
if len({v["ifindex"] for v in interfaces.values()}) != 4:
    raise RuntimeError("PROFINET must have four distinct actual interfaces")
if interfaces["ptcp_n"]["iflink"] != interfaces["data"]["ifindex"] or interfaces["ptcp_f"]["iflink"] != interfaces["data"]["ifindex"]:
    raise RuntimeError("PTCP interfaces are not children of the actual data interface")


def process(pid):
    base = "/proc/" + str(pid)
    with open(base + "/stat", encoding="ascii") as f:
        fields = f.read().rsplit(")", 1)[1].split()
    ppid, ticks = int(fields[1]), int(fields[19])
    with open(base + "/status", encoding="ascii") as f:
        rows = dict(line.rstrip().split(":", 1) for line in f if ":" in line)
    if int(rows["NSpid"].split()[-1]) != pid:
        raise RuntimeError("native namespace PID mismatch")
    descriptors = {}
    entries = os.listdir(base + "/fd")
    if len(entries) > 256:
        raise RuntimeError("source descriptor budget exceeded")
    for entry in entries:
        try:
            descriptors[entry] = os.readlink(base + "/fd/" + entry)
        except FileNotFoundError:
            pass
    inodes = {v[8:-1] for v in descriptors.values() if v.startswith("socket:[")}
    packets = []
    with open(base + "/net/packet", encoding="ascii") as f:
        header = next(f).split()
        for index, line in enumerate(f):
            if index > 100000:
                raise RuntimeError("packet table budget exceeded")
            row = dict(zip(header, line.split()))
            if row.get("Inode") in inodes:
                packets.append(dict(inode=row["Inode"], ifindex=int(row["Iface"]), protocol=int(row["Proto"], 16), type=int(row["Type"])))
    return dict(pid=pid, ppid=ppid, start_ticks=ticks, namespace=os.readlink(base + "/ns/net"), descriptors=descriptors, packets=sorted(packets, key=lambda x:int(x["inode"])))

parent = process(1)
native_pid = status["components"]["dcp"]["pid"]
if not isinstance(native_pid, int) or isinstance(native_pid, bool) or native_pid < 2:
    raise RuntimeError("invalid actual native child PID")
native = process(native_pid)
if native["ppid"] != 1 or native["namespace"] != parent["namespace"] or native["start_ticks"] != status["components"]["dcp"]["start_ticks"]:
    raise RuntimeError("native child parent/start/namespace changed")
with open("/proc/" + str(native_pid) + "/exe", "rb") as f:
    native_hash = hashlib.file_digest(f, "sha256").hexdigest()
if native_hash != status["components"]["dcp"]["native_binary_sha256"] or native_hash != want["native_binary_sha256"]:
    raise RuntimeError("native process executable does not match image/source observation")
if not any(p["ifindex"] == interfaces["data"]["ifindex"] and p["type"] == 3 and p["protocol"] in (3, 0x8892) for p in native["packets"]):
    raise RuntimeError("native process does not own actual DCP packet socket")
native_inodes = {v[8:-1] for v in native["descriptors"].values() if v.startswith("socket:[")}
control_udp = []
with open("/proc/" + str(native_pid) + "/net/udp", encoding="ascii") as f:
    next(f)
    for index, line in enumerate(f):
        if index > 100000:
            raise RuntimeError("UDP table budget exceeded")
        row = line.split()
        if len(row) >= 10 and row[9] in native_inodes:
            ip, port = row[1].split(":")
            if int(port, 16) == 34964:
                control_udp.append(dict(ip=socket.inet_ntoa(bytes.fromhex(ip)[::-1]), port=34964, inode=row[9]))
if len(control_udp) != 1:
    raise RuntimeError("native child does not own the actual private UDP34964 socket")
native["udp34964"] = control_udp[0]
for role in ("ptcp_n", "ptcp_f"):
    inode = str(status["components"][role]["packet_socket_inode"])
    if not any(p["inode"] == inode and p["ifindex"] == interfaces[role]["ifindex"] and p["type"] == 3 and p["protocol"] == 0x8892 for p in parent["packets"]):
        raise RuntimeError("parent does not own actual PTCP socket: " + role)
if not any(p["inode"] == str(status["capture"]["packet_socket_inode"]) and p["ifindex"] == interfaces["data"]["ifindex"] and p["type"] == 3 and p["protocol"] in (3, 0x8892) for p in parent["packets"]):
    raise RuntimeError("parent does not own passive native DCP capture socket")
parent_inodes = {v[8:-1] for v in parent["descriptors"].values() if v.startswith("socket:[")}
listeners = []
with open("/proc/1/net/tcp", encoding="ascii") as f:
    next(f)
    for index, line in enumerate(f):
        if index > 100000:
            raise RuntimeError("TCP table budget exceeded")
        row = line.split()
        if len(row) >= 10 and row[9] in parent_inodes and row[3] == "0A":
            ip, port = row[1].split(":")
            if int(port, 16) == want["observer_port"]:
                listeners.append(dict(ip=socket.inet_ntoa(bytes.fromhex(ip)[::-1]), inode=row[9]))
if len(listeners) != 1 or listeners[0]["ip"] != want["observer_ip"]:
    raise RuntimeError("observer listener does not belong to parent at exact private management IPv4")
store = "/var/lib/protocol-target-lab/profinet-native"
fd = os.open(store + "/.plab-store.json", os.O_RDONLY | os.O_NOFOLLOW)
try:
    st = os.fstat(fd)
    if not stat.S_ISREG(st.st_mode) or st.st_uid != 0 or st.st_mode & 0o077 or st.st_size > 8192:
        raise RuntimeError("native store marker ownership/type/mode changed")
    marker = json.loads(os.read(fd, 8193))
finally:
    os.close(fd)
for key, value in want["store_marker"].items():
    if marker.get(key) != value:
        raise RuntimeError("native store marker identity mismatch: " + key)
fd = os.open(store + "/.writer.lock", os.O_RDWR | os.O_NOFOLLOW)
try:
    st = os.fstat(fd)
    if not stat.S_ISREG(st.st_mode) or st.st_uid != 0 or st.st_mode & 0o077:
        raise RuntimeError("native writer lock changed")
    if not any(os.stat("/proc/1/fd/" + key).st_ino == st.st_ino and os.stat("/proc/1/fd/" + key).st_dev == st.st_dev for key, value in parent["descriptors"].items() if value == store + "/.writer.lock"):
        raise RuntimeError("source parent does not own native writer lock descriptor")
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        pass
    else:
        fcntl.flock(fd, fcntl.LOCK_UN)
        raise RuntimeError("native store does not have exclusive active writer lock")
finally:
    os.close(fd)
# Native can own multiple legitimate protocol sockets; report rather than fabricate a one-FD rule.
print(json.dumps(dict(interfaces=interfaces, parent={k:v for k,v in parent.items() if k != "descriptors"}, native={k:v for k,v in native.items() if k != "descriptors"}, native_binary_sha256=native_hash, observer=listeners[0], store_marker=marker), separators=(",", ":")))
