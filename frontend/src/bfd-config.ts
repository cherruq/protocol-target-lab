import { validIpv4 } from "./dns-config.ts";

export const bfdModes = [
  "normal",
  "poll",
  "quiet",
  "wrong-your",
  "ttl254",
  "short",
] as const;
export type BfdMode = (typeof bfdModes)[number];
export type BfdScenario =
  | { mode: "normal" }
  | { mode: "poll"; after_up_ms: number }
  | {
      mode: "quiet" | "wrong-your" | "ttl254" | "short";
      after_up_ms: number;
      duration_ms: number;
    };
export type BfdConfig = {
  wire_profile: "bfd-ipv4-single-hop";
  bind_ip: string;
  peer_ip: string;
  interface: string;
  source_port: number;
  local_discriminator: number;
  min_tx_us: number;
  min_rx_us: number;
  detect_mult: number;
  scenario: BfdScenario;
};
export const bfdDefaults: BfdConfig = {
  wire_profile: "bfd-ipv4-single-hop",
  bind_ip: "127.0.0.1",
  peer_ip: "127.0.0.2",
  interface: "lo",
  source_port: 55028,
  local_discriminator: 1111901224,
  min_tx_us: 1000000,
  min_rx_us: 1000000,
  detect_mult: 3,
  scenario: { mode: "normal" },
};
export const bfdModeLabels: Record<BfdMode, string> = {
  normal: "正常周期控制",
  poll: "目标发起 Poll / Final",
  quiet: "目标静默窗口",
  "wrong-your": "错误 Your discriminator",
  ttl254: "目标 TTL 254",
  short: "目标 7 字节短报文",
};
export const bfdCaseLabels: Record<string, string> = {
  NORMAL: "正常模式（两个新鲜会话轮次）",
  POLL: "目标 Poll（两个新鲜会话轮次）",
  QUIET: "目标静默及恢复（两个新鲜会话轮次）",
  WRONG_YOUR: "错误 Your 及恢复（两个新鲜会话轮次）",
  TTL254: "TTL 254 及恢复（两个新鲜会话轮次）",
  SHORT: "短报文及恢复（两个新鲜会话轮次）",
  ALL: "当前生效模式全部阶段（两个新鲜会话轮次）",
};
function object(v: unknown): v is Record<string, unknown> {
  return Boolean(v && typeof v === "object" && !Array.isArray(v));
}
function keys(v: Record<string, unknown>, expected: string[]): boolean {
  return (
    Object.keys(v).length === expected.length &&
    Object.keys(v).every((k) => expected.includes(k))
  );
}
function scenario(v: unknown): v is BfdScenario {
  if (!object(v)) return false;
  if (v.mode === "normal") return keys(v, ["mode"]);
  if (v.mode === "poll")
    return (
      keys(v, ["mode", "after_up_ms"]) && typeof v.after_up_ms === "number"
    );
  return (
    typeof v.mode === "string" &&
    ["quiet", "wrong-your", "ttl254", "short"].includes(v.mode) &&
    keys(v, ["mode", "after_up_ms", "duration_ms"]) &&
    typeof v.after_up_ms === "number" &&
    typeof v.duration_ms === "number"
  );
}
export function isBfdConfig(v: unknown): v is BfdConfig {
  return (
    object(v) &&
    keys(v, [
      "wire_profile",
      "bind_ip",
      "peer_ip",
      "interface",
      "source_port",
      "local_discriminator",
      "min_tx_us",
      "min_rx_us",
      "detect_mult",
      "scenario",
    ]) &&
    v.wire_profile === "bfd-ipv4-single-hop" &&
    ["bind_ip", "peer_ip", "interface"].every(
      (k) => typeof v[k] === "string",
    ) &&
    [
      "source_port",
      "local_discriminator",
      "min_tx_us",
      "min_rx_us",
      "detect_mult",
    ].every((k) => typeof v[k] === "number") &&
    scenario(v.scenario)
  );
}
/** A mode change replaces the tagged object; obsolete duration/delay fields never leak. */
export function changeBfdMode(config: BfdConfig, mode: BfdMode): BfdConfig {
  const previous = config.scenario;
  const after = previous.mode === "normal" ? 1000 : previous.after_up_ms;
  return {
    ...config,
    scenario:
      mode === "normal"
        ? { mode }
        : mode === "poll"
          ? { mode, after_up_ms: after }
          : {
              mode,
              after_up_ms: after,
              duration_ms:
                "duration_ms" in previous ? previous.duration_ms : 4000,
            },
  };
}
function unicast(ip: string): boolean {
  if (!validIpv4(ip)) return false;
  const first = Number(ip.split(".")[0]);
  return first > 0 && first < 224 && ip !== "255.255.255.255";
}
export function validateBfdConfig(config: BfdConfig): void {
  if (!isBfdConfig(config))
    throw new Error(
      "BFD 必须含固定 profile、完整10字段及与模式匹配的场景字段；不能含额外字段。",
    );
  if (
    !unicast(config.bind_ip) ||
    !unicast(config.peer_ip) ||
    config.bind_ip === config.peer_ip
  )
    throw new Error(
      "绑定地址与对端地址必须是两个不同的明确单播 IPv4 地址，不能使用通配、组播或广播地址。",
    );
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,14}$/.test(config.interface))
    throw new Error(
      "目标接口名须为1～15个 ASCII 字符，以字母、数字或下划线开头，其余仅可含字母、数字、下划线、点、连字符。",
    );
  for (const [key, low, high, label] of [
    ["source_port", 49152, 65535, "源 UDP 端口"],
    ["local_discriminator", 1, 4294967295, "本地 discriminator"],
    ["min_tx_us", 1000000, 4294967295, "最小发送间隔"],
    ["min_rx_us", 1000000, 4294967295, "最小接收间隔"],
    ["detect_mult", 1, 255, "检测倍数"],
  ] as const)
    if (
      !Number.isInteger(config[key]) ||
      config[key] < low ||
      config[key] > high
    )
      throw new Error(`${label}必须是 ${low}～${high} 之间的整数。`);
  if (
    config.scenario.mode !== "normal" &&
    (!Number.isInteger(config.scenario.after_up_ms) ||
      config.scenario.after_up_ms < 0 ||
      config.scenario.after_up_ms > 3600000)
  )
    throw new Error("Up 后延迟须为0～3600000之间的整毫秒数。");
  if (
    "duration_ms" in config.scenario &&
    (!Number.isInteger(config.scenario.duration_ms) ||
      config.scenario.duration_ms < 1 ||
      config.scenario.duration_ms > 3600000)
  )
    throw new Error("故障持续时间须为1～3600000之间的整毫秒数。");
}
export function sameBfdConfig(a: BfdConfig, b: BfdConfig): boolean {
  return (
    a.wire_profile === b.wire_profile &&
    a.bind_ip === b.bind_ip &&
    a.peer_ip === b.peer_ip &&
    a.interface === b.interface &&
    a.source_port === b.source_port &&
    a.local_discriminator === b.local_discriminator &&
    a.min_tx_us === b.min_tx_us &&
    a.min_rx_us === b.min_rx_us &&
    a.detect_mult === b.detect_mult &&
    a.scenario.mode === b.scenario.mode &&
    (a.scenario.mode === "normal" ||
      (b.scenario.mode !== "normal" &&
        a.scenario.after_up_ms === b.scenario.after_up_ms)) &&
    (!("duration_ms" in a.scenario) ||
      ("duration_ms" in b.scenario &&
        a.scenario.duration_ms === b.scenario.duration_ms))
  );
}
export function bfdDescription(c: BfdConfig): string {
  return `UDP ${c.bind_ip}:3784 → ${c.peer_ip}:3784 · 目标接口 ${c.interface} · 源端口 ${c.source_port} · discriminator ${c.local_discriminator} · Tx/Rx ${c.min_tx_us}/${c.min_rx_us} μs · 检测倍数 ${c.detect_mult} · ${bfdModeLabels[c.scenario.mode]}${c.scenario.mode === "normal" ? "" : ` / Up后 ${c.scenario.after_up_ms} ms`}${"duration_ms" in c.scenario ? ` / 持续 ${c.scenario.duration_ms} ms` : ""}`;
}

/** A retained report is named from its own applied snapshot, never today's case-label metadata. */
export function bfdReportLabel(method: string, config: BfdConfig): string {
  return method === "ALL"
    ? `${config.scenario.mode} 场景完整验证（2轮 · 测试时生效快照）`
    : bfdCaseLabels[method] || method;
}
