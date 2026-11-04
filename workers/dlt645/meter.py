"""Finite DL/T645-2007 software meter core; no physical serial or ESAM claim.

Retains the authorized reference's thirteen finite experimental operations.
"""
from __future__ import annotations
from dataclasses import dataclass,field
from datetime import date,datetime,timedelta
import hashlib


@dataclass(frozen=True,slots=True)
class MeterConfig:
    address:str
    period:int
    energy:int
    programming_key:bool
    security:SecurityFixture|None=None
    baud:int=2400
    demand:int=123456
    clock:datetime=datetime(2026,1,1)
    credentials:tuple[bytes,...]=(bytes(3),)*10


POINT_ADDRESS = bytes([0xAA]) * 6

BROADCAST_ADDRESS = bytes([0x99]) * 6

ENERGY_DI = 0x00010000

PERIOD_DI = 0x04000103

ADDRESS_DI = 0x04000401

SPEED_DI = 0x04000703

TIME_DI = 0x04000102

DATETIME_DI = 0x0400010C

DEMAND_DI = 0x01010000

SECURITY_RESPONSE_DI = 0x070000FF

BAUDS = (600, 1200, 2400, 4800, 9600, 19200)

class DltError(ValueError):
    """使用稳定原因码区分帧错误、字段错误和本软件 profile 限界。"""

    def __init__(self, code: str, message: str, err: int = 1) -> None:
        super().__init__(message)
        self.code = code
        self.err = err

def bcd_octet(value: int) -> int:
    """把一个两位十进制数编码成 BCD。"""
    if not 0 <= value <= 99:
        raise DltError("bcd_range", "BCD 数值超出两位范围")
    return (value // 10) * 16 + value % 10

def unbcd(value: int) -> int:
    """严格拒绝十六进制 A～F，而不是把它们当十进制数字。"""
    if value >> 4 > 9 or value & 15 > 9:
        raise DltError("invalid_bcd", "BCD 包含非十进制半字节")
    return (value >> 4) * 10 + (value & 15)

def bcd_number(value: int, size: int) -> bytes:
    """把无符号定点整数按低字节在前编码，单位由数据项定义。"""
    if not 0 <= value < 100**size:
        raise DltError("bcd_range", "数据项超出指定 BCD 宽度")
    result = bytearray()
    for _index in range(size):
        result.append(bcd_octet(value % 100))
        value //= 100
    return bytes(result)

def address_bytes(value: str) -> bytes:
    """十二位表地址按低两位先传输，不执行数据域的加 33H。"""
    if len(value) != 12 or not value.isascii() or not value.isdecimal():
        raise ValueError("表地址必须是十二位 ASCII 十进制数字")
    return bytes(int(value[pos : pos + 2], 16) for pos in range(10, -1, -2))

def address_text(value: bytes) -> str:
    """把已核验的六字节 BCD 地址转换成显示形式。"""
    if len(value) != 6:
        raise DltError("address_length", "表地址应为六字节")
    for item in value:
        unbcd(item)
    return value[::-1].hex()

def di_bytes(value: int) -> bytes:
    """数据标识按 DI0 到 DI3 顺序排列。"""
    return value.to_bytes(4, "little")

def decode_clock(data: bytes) -> datetime:
    """解码 ss mm hh DD MM YY 六字节，验证实际公历日期。"""
    if len(data) != 6:
        raise DltError("clock_length", "时间应为六字节")
    values = [unbcd(item) for item in data]
    try:
        return datetime(
            2000 + values[5], values[4], values[3], values[2], values[1], values[0]
        )
    except ValueError as error:
        raise DltError("invalid_clock", "BCD 时间不是有效公历日期") from error

def clock_bytes(value: datetime, *, weekday: bool = False) -> bytes:
    """返回低位先传的时间或日期星期时间数据。"""
    values = [value.second, value.minute, value.hour]
    if weekday:
        values.append((value.weekday() + 1) % 7)
    values.extend([value.day, value.month, value.year - 2000])
    return bytes(bcd_octet(item) for item in values)

@dataclass(frozen=True, slots=True)
class Frame:
    """保留已按长度、CS 和结束符核验的帧原件及解码数据域。"""

    address: bytes
    control: int
    data: bytes
    raw: bytes

    @property
    def function(self) -> int:
        """取出低五位功能码。"""
        return self.control & 31

    def log_fields(self) -> dict[str, object]:
        """仅在证据边界展开帧字段。"""
        return {
            "raw_hex": self.raw.hex(),
            "address_hex": self.address.hex(),
            "control": self.control,
            "function": self.function,
            "response": bool(self.control & 128),
            "error": bool(self.control & 64),
            "followup": bool(self.control & 32),
            "data_hex": self.data.hex(),
            "data_length": len(self.data),
        }

def encode_frame(address: bytes, control: int, data: bytes = b"") -> bytes:
    """在本模块独立计算长度、数据域偏移和八位校验和。"""
    if len(address) != 6 or not 0 <= control <= 255 or len(data) > 255:
        raise DltError("encode_range", "帧地址、控制码或长度超出范围")
    wire = bytes((item + 0x33) & 255 for item in data)
    body = b"\x68" + address + bytes([0x68, control, len(data)]) + wire
    return body + bytes([sum(body) & 255, 0x16])

def decode_frame(raw: bytes) -> Frame:
    """核验完整帧，不按数据中的 16H 截断，也不自动修补畸形帧。"""
    if len(raw) < 12:
        raise DltError("short_frame", "帧不足十二字节")
    if raw[0] != 0x68 or raw[7] != 0x68:
        raise DltError("start", "起始标识不正确")
    if len(raw) != 12 + raw[9]:
        raise DltError("length", "长度域与完整原件不符")
    if raw[-1] != 0x16:
        raise DltError("end", "结束符不是 16H")
    if sum(raw[:-2]) & 255 != raw[-2]:
        raise DltError("checksum", "八位累加校验和不符")
    address = raw[1:7]
    if address != POINT_ADDRESS:
        address_text(address)
    return Frame(
        address, raw[8], bytes((item - 0x33) & 255 for item in raw[10:-2]), raw
    )

@dataclass(frozen=True, slots=True)
class StreamBatch:
    """一次增量输入产生的完整帧及有限诊断。"""

    frames: tuple[Frame, ...]
    events: tuple[dict[str, object], ...]

@dataclass(slots=True)
class DltStream:
    """按 L 域定界，保留跨块半帧，错误后逐字节重新寻找起始标识。"""

    max_buffer: int = 8192
    interbyte_timeout: float = 0.5
    buffer: bytearray = field(default_factory=bytearray)
    last_input: float | None = None

    def expire(self, now: float) -> tuple[dict[str, object], ...]:
        """半帧超过字节间期限后清除，不跨连接复用旧残片。"""
        if (
            not self.buffer
            or self.last_input is None
            or now - self.last_input <= self.interbyte_timeout
        ):
            return ()
        raw = bytes(self.buffer)
        self.buffer.clear()
        self.last_input = None
        return (
            {
                "event": "stream_rejected",
                "reason": "interbyte_timeout",
                "raw_hex": raw.hex(),
            },
        )

    def feed(self, data: bytes, now: float) -> StreamBatch:
        """先过期再接收新块，噪声与无效完整候选均不触发回应。"""
        events = list(self.expire(now))
        if len(self.buffer) + len(data) > self.max_buffer:
            raise DltError("buffer_budget", "流缓冲预算耗尽")
        self.buffer.extend(data)
        self.last_input = now
        frames: list[Frame] = []
        while self.buffer:
            position = self.buffer.find(0x68)
            if position != 0:
                size = position if position > 0 else len(self.buffer)
                noise = bytes(self.buffer[:size])
                del self.buffer[:size]
                events.append(
                    {
                        "event": "stream_noise",
                        "raw_hex": noise.hex(),
                        "wakeup_only": all(item == 0xFE for item in noise),
                    }
                )
            if len(self.buffer) < 10:
                break
            if self.buffer[7] != 0x68:
                events.append(
                    {
                        "event": "stream_rejected",
                        "reason": "second_start",
                        "raw_hex": bytes(self.buffer[:10]).hex(),
                    }
                )
                del self.buffer[0]
                continue
            size = 12 + self.buffer[9]
            if len(self.buffer) < size:
                break
            raw = bytes(self.buffer[:size])
            try:
                frame = decode_frame(raw)
            except DltError as error:
                events.append(
                    {
                        "event": "stream_rejected",
                        "reason": error.code,
                        "raw_hex": raw.hex(),
                    }
                )
                del self.buffer[0]
                continue
            frames.append(frame)
            del self.buffer[:size]
        if not self.buffer:
            self.last_input = None
        return StreamBatch(tuple(frames), tuple(events))

    def finish(self) -> bytes:
        """结束连接时归还残片证据并清理内部缓冲。"""
        raw = bytes(self.buffer)
        self.buffer.clear()
        self.last_input = None
        return raw

@dataclass(frozen=True, slots=True)
class SecurityFixture:
    """固定字节传输 fixture 绝不表示 ESAM 或密钥认证通过。"""

    request_di: int
    response_di: int
    operator: bytes
    request: bytes
    response: bytes

    def __post_init__(self) -> None:
        if self.request_di not in (0x07000001, 0x07000002, 0x07000003):
            raise ValueError("安全 fixture 只支持身份认证表中三个八字节请求项")
        if self.response_di != SECURITY_RESPONSE_DI:
            raise ValueError("身份 fixture 响应 DI 应为 070000FF")
        if (
            len(self.operator) != 4
            or len(self.request) != 8
            or len(self.response) != 12
        ):
            raise ValueError(
                "身份 fixture operator/request/response 必须为 4/8/12 字节"
            )

@dataclass(slots=True)
class MeterState:
    """进程级持久状态；每条新连接只替换分帧器，绝不重置业务。"""

    address: bytes
    baud: int
    period: int
    energy: int
    demand: int
    credentials: list[bytes]
    wall_base: datetime
    mono_base: float
    generation: int = 0
    freeze_count: int = 0
    last_freeze: bytes = b""
    frozen_energy: int | None = None
    frozen_demand: int | None = None
    frozen_clock: str | None = None
    meter_clear_count: int = 0
    demand_clear_count: int = 0
    last_sync_day: date | None = None
    output: int = 0
    relay: str = "closed"
    alarm: bool = False
    power_hold: bool = False
    restore_at: float | None = None
    restore_relay: str | None = None

    @classmethod
    def create(cls, config: MeterConfig, now: float) -> "MeterState":
        """仅在明确初始化服务时载入 fixture。"""
        return cls(
            address_bytes(config.address),
            config.baud,
            config.period,
            config.energy,
            config.demand,
            list(config.credentials),
            config.clock,
            now,
        )

    def wall(self, now: float) -> datetime:
        """软件时钟用单调时间推进，不读取或调整宿主日期时钟。"""
        return self.wall_base + timedelta(seconds=max(0, now - self.mono_base))

    def snapshot(self, now: float) -> dict[str, object]:
        """状态证据不把模拟密码散列当认证证明。"""
        return {
            "generation": self.generation,
            "address": address_text(self.address),
            "baud": self.baud,
            "physical_baud_verified": False,
            "period": self.period,
            "energy_hundredths": self.energy,
            "demand_ten_thousandths": self.demand,
            "credential_sha256": [
                hashlib.sha256(item).hexdigest() for item in self.credentials
            ],
            "clock": self.wall(now).isoformat(timespec="seconds"),
            "last_sync_day": str(self.last_sync_day) if self.last_sync_day else None,
            "freeze_count": self.freeze_count,
            "last_freeze_hex": self.last_freeze.hex(),
            "frozen_energy_hundredths": self.frozen_energy,
            "frozen_demand_ten_thousandths": self.frozen_demand,
            "frozen_clock": self.frozen_clock,
            "meter_clear_count": self.meter_clear_count,
            "demand_clear_count": self.demand_clear_count,
            "output": self.output,
            "relay": self.relay,
            "alarm": self.alarm,
            "power_hold": self.power_hold,
            "restore_at_monotonic": self.restore_at,
            "software_only": True,
        }

    def tick(self, now: float) -> tuple[dict[str, object], ...]:
        """按协议五分钟单位执行软件自动恢复，不缩短标准时间来冒充实测。"""
        if self.restore_at is None or now < self.restore_at:
            return ()
        before = self.snapshot(now)
        self.relay = self.restore_relay or "allowed"
        self.restore_at, self.restore_relay = None, None
        self.generation += 1
        return (
            {
                "event": "state_committed",
                "operation": "automatic_relay_restore",
                "before": before,
                "after": self.snapshot(now),
            },
        )

@dataclass(frozen=True, slots=True)
class Reply:
    """待发正常意图与待完整应答后提交的软件速率。"""

    address: bytes
    control: int
    data: bytes = b""
    pending_baud: int | None = None

    @property
    def raw(self) -> bytes:
        """序列化正常回复，不包含故障变换。"""
        return encode_frame(self.address, self.control, self.data)

    def log_fields(self) -> dict[str, object]:
        """明确这组字段仅表示控制意图。"""
        return {
            "address_hex": self.address.hex(),
            "control": self.control,
            "data_hex": self.data.hex(),
            "raw_hex": self.raw.hex(),
            "pending_baud": self.pending_baud,
        }

@dataclass(frozen=True, slots=True)
class Decision:
    """严格分开请求业务处理和网络实际发送。"""

    reply: Reply | None
    events: tuple[dict[str, object], ...]

def authenticated(data: bytes, state: MeterState, levels: tuple[int, ...]) -> bool:
    """权限只接受本命令明确的明文等级，密码按三个原始字节比较。"""
    return (
        len(data) >= 4 and data[0] in levels and data[1:4] == state.credentials[data[0]]
    )

def require_size(data: bytes, size: int) -> None:
    """正常 profile 使用精确字段宽度，不忽略尾字节。"""
    if len(data) != size:
        raise DltError("data_length", "命令数据域宽度不符")

def require_programmed_auth(
    data: bytes, state: MeterState, config: MeterConfig, levels: tuple[int, ...]
) -> None:
    """把模拟编程键条件与实际口令校验分开记录。"""
    if not config.programming_key:
        raise DltError("programming_key_disabled", "需要显式模拟编程键", 4)
    if not authenticated(data, state, levels):
        raise DltError("authentication", "权限或软件测试密码不符", 4)

def read_data(di: int, state: MeterState, now: float) -> bytes:
    """只返回本软件声明支持的真实状态，未知及只写密码项不造数据。"""
    if di == ENERGY_DI:
        return bcd_number(state.energy, 4)
    if di == PERIOD_DI:
        return bytes([bcd_octet(state.period)])
    if di == ADDRESS_DI:
        return state.address
    if di == SPEED_DI:
        return bytes([1 << (BAUDS.index(state.baud) + 1)])
    if di == TIME_DI:
        return clock_bytes(state.wall(now))[:3]
    if di == DATETIME_DI:
        return clock_bytes(state.wall(now), weekday=True)
    if di == DEMAND_DI:
        timestamp = bytes(5) if state.demand == 0 else clock_bytes(state.wall(now))[1:]
        return bcd_number(state.demand, 3) + timestamp
    raise DltError("unsupported_di", "未实现或只写的数据标识", 2)

def apply_request(
    frame: Frame, state: MeterState, config: MeterConfig, now: float
) -> Reply | None:
    """完整校验命令后才更改软件状态，异常由外层生成规范错误应答。"""
    data, function = frame.data, frame.function
    if function == 0x11:
        require_size(data, 4)
        return Reply(
            state.address,
            0x91,
            data + read_data(int.from_bytes(data, "little"), state, now),
        )
    if function == 0x13:
        require_size(data, 0)
        return Reply(state.address, 0x93, state.address)
    if function == 0x14:
        require_size(data, 13)
        require_programmed_auth(data[4:8], state, config, (2, 4))
        if int.from_bytes(data[:4], "little") != PERIOD_DI:
            raise DltError("unsupported_write_di", "仅支持可写最大需量周期", 2)
        value = unbcd(data[12])
        if value == 0:
            raise DltError("period_zero", "需量周期不能为零")
        state.period = value
        return Reply(state.address, 0x94)
    if function == 0x15:
        require_size(data, 6)
        if not config.programming_key:
            raise DltError("programming_key_disabled", "写地址需要模拟编程键", 4)
        address_text(data)
        if data == BROADCAST_ADDRESS:
            raise DltError("broadcast_meter_address", "不能写广播为本表地址")
        state.address = data
        return Reply(state.address, 0x95)
    if function == 0x16:
        require_size(data, 4)
        for value, low, high in zip(data, (0, 0, 1, 1), (59, 23, 31, 12), strict=True):
            if value != 0x99 and not low <= unbcd(value) <= high:
                raise DltError("freeze_time", "冻结时间字段超出范围")
        state.freeze_count += 1
        state.last_freeze = data
        if data == bytes([0x99]) * 4:
            state.frozen_energy, state.frozen_demand = state.energy, state.demand
            state.frozen_clock = state.wall(now).isoformat(timespec="seconds")
        return (
            None if frame.address == BROADCAST_ADDRESS else Reply(state.address, 0x96)
        )
    if function == 0x08:
        value = decode_clock(data)
        current = state.wall(now)
        if abs((value - current).total_seconds()) > 300:
            raise DltError("clock_window", "广播校时超出五分钟窗口")
        if state.last_sync_day == current.date():
            raise DltError("clock_daily_limit", "同一表内日期已广播校时")
        state.wall_base, state.mono_base = value, now
        state.last_sync_day = value.date()
        return None
    if function == 0x17:
        require_size(data, 1)
        if data[0] not in (2, 4, 8, 16, 32, 64):
            raise DltError("baud_characteristic", "速率必须为非保留位的 one-hot", 8)
        return Reply(state.address, 0x97, data, BAUDS[data[0].bit_length() - 2])
    if function == 0x18:
        require_size(data, 12)
        if not config.programming_key:
            raise DltError("programming_key_disabled", "修改密码需要模拟编程键", 4)
        old_level, new_level = data[4], data[8]
        if not 0 <= old_level <= new_level <= 9 or not authenticated(
            data[4:8], state, tuple(range(10))
        ):
            raise DltError("authentication", "原密码权限不够或不正确", 4)
        if int.from_bytes(data[:4], "little") != 0x04000C01 + new_level:
            raise DltError("password_di", "密码 DI 与新权限不对应", 2)
        state.credentials[new_level] = data[9:12]
        return Reply(state.address, 0x98, data[8:12])
    if function in (0x19, 0x1A):
        require_size(data, 8)
        require_programmed_auth(
            data[:4], state, config, (2, 4) if function == 0x19 else (2,)
        )
        state.demand = 0
        if function == 0x19:
            state.demand_clear_count += 1
        else:
            state.energy = 0
            state.freeze_count, state.last_freeze = 0, b""
            state.frozen_energy, state.frozen_demand, state.frozen_clock = (
                None,
                None,
                None,
            )
            state.meter_clear_count += 1
        return Reply(state.address, function | 0x80)
    if function == 0x1C:
        require_size(data, 16)
        if not authenticated(data[:4], state, (2, 4)):
            raise DltError("authentication", "控制命令密码或明文权限不符", 4)
        if data[3] == 1:
            raise DltError(
                "status_profile_unsupported", "P2=01 的状态字应答不在本 profile"
            )
        command, delay = data[8:10]
        if command not in (0x1A, 0x1B, 0x1C, 0x1D, 0x1E, 0x2A, 0x2B, 0x3A, 0x3B):
            raise DltError("control_command", "未知明文控制命令")
        if (command in (0x1D, 0x1E) and delay == 0) or (
            command not in (0x1D, 0x1E) and delay != 0
        ):
            raise DltError("control_delay", "自动恢复时间或保留字段不符")
        if decode_clock(data[10:]) <= state.wall(now):
            raise DltError("expired_control", "控制命令已超过有效截止时间")
        if command in (0x1A, 0x1B, 0x1C, 0x1D, 0x1E, 0x3A, 0x3B):
            state.restore_at, state.restore_relay = None, None
        if command in (0x1A, 0x1D, 0x1E):
            state.relay = "open"
        elif command == 0x1B:
            state.relay = "allowed"
        elif command == 0x1C:
            state.relay = "closed"
        elif command in (0x2A, 0x2B):
            state.alarm = command == 0x2A
        elif command in (0x3A, 0x3B):
            state.power_hold = command == 0x3A
        if command in (0x1D, 0x1E):
            state.restore_at = now + delay * 300
            state.restore_relay = "closed" if command == 0x1D else "allowed"
        return Reply(state.address, 0x9C)
    if function == 0x1D:
        require_size(data, 1)
        if data[0] not in (0, 1, 2):
            raise DltError("output_mode", "输出控制只允许 00/01/02")
        state.output = data[0]
        return Reply(state.address, 0x9D, data)
    if function == 0x03:
        fixture = config.security
        if (
            fixture is None
            or data != di_bytes(fixture.request_di) + fixture.operator + fixture.request
        ):
            raise DltError(
                "security_not_verified", "无 ESAM，仅严格拒绝或精确传输 fixture", 8
            )
        return Reply(
            state.address, 0x83, di_bytes(fixture.response_di) + fixture.response
        )
    raise DltError("unsupported_function", "功能码不在十三项软件 profile")

def handle_request(
    frame: Frame, state: MeterState, config: MeterConfig, now: float
) -> Decision:
    """限制寻址例外，语法错误不改状态，广播永不自创 ACK。"""
    function = frame.function
    if frame.control & 0xE0:
        return Decision(
            None, ({"event": "request_rejected", "reason": "request_control_bits"},)
        )
    expected = (
        POINT_ADDRESS
        if function in (0x13, 0x15)
        else BROADCAST_ADDRESS
        if function == 0x08
        else state.address
    )
    broadcast_freeze = function == 0x16 and frame.address == BROADCAST_ADDRESS
    if frame.address != expected and not broadcast_freeze:
        return Decision(
            None, ({"event": "request_rejected", "reason": "not_addressed"},)
        )
    before = state.snapshot(now)
    try:
        reply = apply_request(frame, state, config, now)
    except DltError as error:
        return rejected_decision(frame, state, error)
    events: list[dict[str, object]] = [
        {
            "event": "request_accepted",
            "function": function,
            "programming_key_simulated": config.programming_key,
            "software_only": True,
        }
    ]
    if before != state.snapshot(now):
        state.generation += 1
        events.append(
            {
                "event": "state_committed",
                "operation": f"function_{function:02x}",
                "before": before,
                "after": state.snapshot(now),
            }
        )
    if function == 0x03:
        events.append(
            {
                "event": "security_fixture_matched",
                "crypto_verified": False,
                "request_di": f"{int.from_bytes(frame.data[:4], 'little'):08X}",
                "response_di": "070000FF",
            }
        )
    if reply is None:
        events.append(
            {
                "event": "reply_not_required",
                "function": function,
                "broadcast": frame.address == BROADCAST_ADDRESS,
            }
        )
    return Decision(reply, tuple(events))

def rejected_decision(frame: Frame, state: MeterState, error: DltError) -> Decision:
    """规范规定静默的请求及超出 profile 的请求不生成通用错误 ACK。"""
    silent = (
        frame.function in (0x08, 0x13, 0x15)
        or frame.address == BROADCAST_ADDRESS
        or error.code in ("unsupported_function", "status_profile_unsupported")
    )
    data = bytes([error.err, 0]) if frame.function == 0x03 else bytes([error.err])
    response = None if silent else Reply(state.address, frame.function | 0xC0, data)
    return Decision(
        response,
        (
            {
                "event": "request_rejected",
                "reason": error.code,
                "message": str(error),
                "normal_success": False,
            },
        ),
    )
