"""Finite, public byte-exact DNS fixture catalog; no implicit success response."""
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path


@dataclass(frozen=True)
class Fixture:
    id: str
    fixture_set: str
    transport: str
    trigger: bytes
    frames: tuple[tuple[float, bytes], ...]
    close: bool

    @property
    def response(self):
        return b"".join(payload for _, payload in self.frames)


def load_catalog():
    root = Path(__file__).resolve().parent / "fixtures"
    catalog = json.loads((root / "catalog.json").read_text())
    files = {}
    for filename, expected in catalog["source_sha256"].items():
        raw = (root / filename).read_bytes()
        if hashlib.sha256(raw).hexdigest() != expected:
            raise ValueError("DNS fixture source checksum mismatch: " + filename)
        files[filename] = json.loads(raw)["scenarios"]
    result = []
    for entry in catalog["scenarios"]:
        raw = files[entry["file"]][entry["index"]]
        trigger = bytes.fromhex(raw["trigger_hex"])
        if entry["transport"] == "STREAM" and (len(trigger) < 2 or int.from_bytes(trigger[:2], "big") != len(trigger) - 2):
            raise ValueError("Invalid fixture request frame")
        frames = tuple((float(f.get("delay_ms", 0)) / 1000, bytes.fromhex(f["hex"])) for f in raw["frames"])
        if any(delay < 0 or delay > 3 or len(payload) > 65535 for delay, payload in frames):
            raise ValueError("Fixture exceeds bounded response limits")
        result.append(Fixture(entry["id"], entry["fixture_set"], entry["transport"], trigger, frames, raw.get("close", True)))
    if len({f.id for f in result}) != len(result):
        raise ValueError("Duplicate fixture ID")
    for fixture_set in ("final", "short", "wrong-id"):
        for transport in ("UDP", "STREAM"):
            group = [f.trigger for f in result if f.fixture_set == fixture_set and f.transport == transport]
            if len(set(group)) != len(group):
                raise ValueError("Ambiguous fixture trigger")
    return tuple(result)


CATALOG = load_catalog()


def selected_fixtures(config, transport, path="ALL"):
    group = "UDP" if transport == "UDP" else "STREAM"
    return [f for f in CATALOG if f.fixture_set == config["fixture_set"] and f.transport == group and (path == "ALL" or f.id == path)]
