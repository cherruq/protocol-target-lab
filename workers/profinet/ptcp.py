"""Finite software PTCP lab profile; no native-stack or hardware-clock claim."""
import struct
from dataclasses import dataclass,field

GROUPS = (
    "01:80:c2:00:00:0e",
    "01:0e:cf:00:04:00",
    "01:0e:cf:00:04:20",
    "01:0e:cf:00:04:40",
    "01:0e:cf:00:04:80",
)
FRAME_IDS = frozenset((0x0020, 0x0080, 0xFF00, 0xFF20, 0xFF40, 0xFF41, 0xFF42, 0xFF43))


@dataclass(frozen=True, slots=True)
class Block:
    """保存独立解析器核实过长度的 TLV。"""

    kind: int
    data: bytes


@dataclass(frozen=True, slots=True)
class Frame:
    """保存网络帧，不把以太网尾填充当成 PTCP 块。"""

    destination: bytes
    source: bytes
    frame_id: int
    sequence: int
    header: bytes
    blocks: tuple[Block, ...]


@dataclass(slots=True)
class PeerState:
    """按发起节点保留待配对的同步序列，不同步系统时钟。"""

    pending_sync: dict[bytes, Frame] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class Result:
    """返回需要实际发送的帧以及本次协议处理结果。"""

    frames: tuple[bytes, ...]
    status: str


def mac_bytes(value: str) -> bytes:
    """解析完整六字节 MAC。"""
    pieces = value.replace("-", ":").split(":")
    if len(pieces) != 6 or any(len(piece) != 2 for piece in pieces):
        raise ValueError("MAC 地址必须是六个完整字节")
    return bytes(int(piece, 16) for piece in pieces)


def decode_frame(raw: bytes) -> Frame:
    """独立核查二层头、固定头和 packed TLV，不接受截断报文。"""
    if len(raw) < 38:
        raise ValueError("PTCP 帧短于固定头及 End 块")
    destination, source, ether_type, frame_id = struct.unpack_from("!6s6sHH", raw)
    if ether_type != 0x8892 or frame_id not in FRAME_IDS:
        raise ValueError("非本陪测器支持的 PTCP 帧")
    sequence = struct.unpack_from("!H", raw, 28)[0]
    blocks: list[Block] = []
    cursor = 36
    while cursor <= len(raw) - 2:
        tag = struct.unpack_from("!H", raw, cursor)[0]
        cursor += 2
        block_type, size = divmod(tag, 512)
        if block_type == 0:
            if size:
                raise ValueError("End 块长度非零")
            return Frame(
                destination, source, frame_id, sequence, raw[16:36], tuple(blocks)
            )
        end = cursor + size
        if end > len(raw):
            raise ValueError("TLV 声明长度超出捕获帧")
        blocks.append(Block(block_type, raw[cursor:end]))
        cursor = end
    raise ValueError("缺少 End 块")


def one_block(message: Frame, kind: int, length: int) -> bytes:
    """要求交互中的关键块只出现一次且长度准确。"""
    values = [block.data for block in message.blocks if block.kind == kind]
    if len(values) != 1 or len(values[0]) != length:
        raise ValueError(f"类型 {kind} 块缺失、重复或长度不符")
    return values[0]


def encode_tlv(kind: int, data: bytes) -> bytes:
    """独立编码七位类型和九位长度，不使用产品编译器。"""
    if not 0 < kind < 128 or len(data) > 511:
        raise ValueError("TLV 类型或长度越界")
    return struct.pack("!H", (kind << 9) | len(data)) + data


def encode_delay_frame(
    source: bytes,
    frame_id: int,
    sequence: int,
    requestor: bytes,
    timestamp_ns: int,
    correction_ns: int,
) -> bytes:
    """构造符合 TI 公开 profile 的软件延迟响应。"""
    header = struct.pack(
        "!6s6sHH12xH2xI",
        mac_bytes(GROUPS[0]),
        source,
        0x8892,
        frame_id,
        sequence,
        correction_ns,
    )
    blocks = encode_tlv(6, requestor)
    if frame_id in (0xFF41, 0xFF43):
        blocks += encode_tlv(5, struct.pack("!2xII", 0, 0))
        blocks += encode_tlv(7, struct.pack("!2xI", timestamp_ns & 0xFFFFFFFF))
    return (header + blocks + bytes(2)).ljust(60, b"\x00")


def process_frame(
    raw: bytes,
    source_mac: bytes,
    state: PeerState,
    *,
    delay_mode: str = "without-follow-up",
    scenario: str = "good",
    truncated_follow_up_size: int = 37,
    timestamp_ns: int = 0,
) -> Result:
    """只响应可识别的真实请求，并对同步组合进行独立语义核对。"""
    if delay_mode not in ("without-follow-up", "with-follow-up"):
        raise ValueError("未知延迟响应模式")
    if scenario not in (
        "good",
        "wrong-seq",
        "missing-follow-up",
        "bad-tlv",
        "wrong-port",
        "old-seq-first",
        "truncated-follow-up",
        "follow-up-reserved",
        "follow-up-padding",
        "follow-up-duplicate-port",
        "follow-up-bad-end",
    ):
        raise ValueError("未知故障注入场景")
    if (
        scenario in ("missing-follow-up", "truncated-follow-up")
        or scenario.startswith("follow-up-")
    ) and delay_mode != "with-follow-up":
        raise ValueError("FollowUp 故障场景必须使用 with-follow-up 模式")
    if not 16 <= truncated_follow_up_size <= 45:
        raise ValueError("截断 FollowUp 长度必须在 16～45 字节之间")
    message = decode_frame(raw)
    if message.source == source_mac:
        return Result((), "ignored-own-source")
    if message.frame_id == 0xFF40:
        if message.destination != mac_bytes(GROUPS[0]):
            raise ValueError("DelayReq 未使用链路本地延迟组播地址")
        if message.header[:12] != bytes(12) or message.header[14:] != bytes(6):
            raise ValueError("DelayReq 保留字节和请求延迟必须为零")
        requestor = one_block(message, 6, 6)
        if requestor == bytes(6) or requestor[0] & 1:
            raise ValueError("DelayReq 请求端口不是有效单播 MAC")
        sequence = (
            message.sequence
            if scenario != "wrong-seq"
            else (message.sequence + 1) & 0xFFFF
        )
        if scenario == "wrong-port":
            requestor = requestor[:-1] + bytes((requestor[-1] ^ 1,))
        response_id = 0xFF41 if delay_mode == "with-follow-up" else 0xFF43
        response = encode_delay_frame(
            source_mac, response_id, sequence, requestor, timestamp_ns, 0
        )
        if scenario == "bad-tlv":
            response = response[:36] + b"\x0d\xff" + response[38:]
        frames = [response]
        if delay_mode == "with-follow-up" and scenario != "missing-follow-up":
            follow_up = encode_delay_frame(
                source_mac, 0xFF42, sequence, requestor, timestamp_ns, 1000
            )
            if scenario == "truncated-follow-up":
                follow_up = follow_up[:truncated_follow_up_size]
            elif scenario == "follow-up-reserved":
                follow_up = follow_up[:16] + b"\x01" + follow_up[17:]
            elif scenario == "follow-up-padding":
                follow_up = follow_up[:30] + b"\x01" + follow_up[31:]
            elif scenario == "follow-up-duplicate-port":
                follow_up = (follow_up[:44] + follow_up[36:44] + bytes(2)).ljust(
                    60, b"\x00"
                )
            elif scenario == "follow-up-bad-end":
                follow_up = follow_up[:44] + b"\x00\x01" + follow_up[46:]
            frames.append(follow_up)
        if scenario == "old-seq-first":
            interleaved: list[bytes] = []
            for current in frames:
                previous = (
                    current[:28]
                    + ((sequence - 1) & 0xFFFF).to_bytes(2, "big")
                    + current[30:]
                )
                interleaved.extend((previous, current))
            frames = interleaved
        return Result(tuple(frames), f"delay-request-accepted:{delay_mode}:{scenario}")
    if message.frame_id in (0x0020, 0x0080, 0xFF20, 0xFF00):
        domain = one_block(message, 1, 22)
        if domain[:6] == bytes(6) or domain[0] & 1:
            raise ValueError("同步主时钟源 MAC 无效")
        if message.frame_id == 0xFF00:
            if message.destination != mac_bytes(GROUPS[1]):
                raise ValueError("Announce 组播目的地址不符")
            one_block(message, 4, 6)
            return Result((), "announce-accepted")
        timestamp = one_block(message, 2, 10)
        if struct.unpack_from("!I", timestamp, 6)[0] >= 1_000_000_000:
            raise ValueError("同步纳秒字段越界")
        expected_group = {0x0020: GROUPS[2], 0xFF20: GROUPS[3], 0x0080: GROUPS[4]}[
            message.frame_id
        ]
        if message.destination != mac_bytes(expected_group):
            raise ValueError("同步组播目的地址与 FrameID 不符")
        if message.frame_id == 0x0020:
            if (
                len(state.pending_sync) >= 128
                and message.source not in state.pending_sync
            ):
                raise ValueError("待配对同步节点超过上限")
            state.pending_sync[message.source] = message
            return Result((), "sync-awaiting-follow-up")
        if message.frame_id == 0xFF20:
            previous = state.pending_sync.get(message.source)
            if previous is None or previous.sequence != message.sequence:
                raise ValueError("FollowUp 缺少同一源地址与序号的 Sync")
            if (
                one_block(previous, 1, 22) != domain
                or one_block(previous, 2, 10) != timestamp
            ):
                raise ValueError("FollowUp 的同步域或软件时间与 Sync 不符")
            state.pending_sync.pop(message.source)
            return Result((), "sync-follow-up-complete")
        return Result((), "sync-without-follow-up-accepted")
    return Result((), "ignored-nonrequest")


