import { guideText, lazyGuidanceLabels } from "./protocol-description.ts";
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
export const bfdModeLabels: Record<BfdMode, string> = lazyGuidanceLabels(() => ({
  normal: guideText("bfd.configuration.bfd-config.001"),
  poll: guideText("bfd.configuration.bfd-config.002"),
  quiet: guideText("bfd.configuration.bfd-config.003"),
  "wrong-your": guideText("bfd.configuration.bfd-config.004"),
  ttl254: guideText("bfd.configuration.bfd-config.005"),
  short: guideText("bfd.configuration.bfd-config.006"),
}));
export const bfdCaseLabels: Record<string, string> = lazyGuidanceLabels(() => ({
  NORMAL: guideText("bfd.verification.bfd-config.007"),
  POLL: guideText("bfd.verification.bfd-config.008"),
  QUIET: guideText("bfd.verification.bfd-config.009"),
  WRONG_YOUR: guideText("bfd.verification.bfd-config.010"),
  TTL254: guideText("bfd.verification.bfd-config.011"),
  SHORT: guideText("bfd.verification.bfd-config.012"),
  ALL: guideText("bfd.verification.bfd-config.013"),
}));
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
      guideText("bfd.configuration.bfd-config.020"),
    );
  if (
    !unicast(config.bind_ip) ||
    !unicast(config.peer_ip) ||
    config.bind_ip === config.peer_ip
  )
    throw new Error(
      guideText("bfd.configuration.bfd-config.021"),
    );
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,14}$/.test(config.interface))
    throw new Error(
      guideText("bfd.configuration.bfd-config.022"),
    );
  for (const [key, low, high, label] of [
    ["source_port", 49152, 65535, guideText("bfd.configuration.bfd-config.023")],
    ["local_discriminator", 1, 4294967295, guideText("bfd.configuration.bfd-config.024")],
    ["min_tx_us", 1000000, 4294967295, guideText("bfd.configuration.bfd-config.025")],
    ["min_rx_us", 1000000, 4294967295, guideText("bfd.configuration.bfd-config.026")],
    ["detect_mult", 1, 255, guideText("bfd.configuration.bfd-config.027")],
  ] as const)
    if (
      !Number.isInteger(config[key]) ||
      config[key] < low ||
      config[key] > high
    )
      throw new Error(`${label}${guideText("bfd.configuration.bfd-config.028")}${low}～${high}${guideText("bfd.configuration.bfd-config.029")}`);
  if (
    config.scenario.mode !== "normal" &&
    (!Number.isInteger(config.scenario.after_up_ms) ||
      config.scenario.after_up_ms < 0 ||
      config.scenario.after_up_ms > 3600000)
  )
    throw new Error(guideText("bfd.configuration.bfd-config.030"));
  if (
    "duration_ms" in config.scenario &&
    (!Number.isInteger(config.scenario.duration_ms) ||
      config.scenario.duration_ms < 1 ||
      config.scenario.duration_ms > 3600000)
  )
    throw new Error(guideText("bfd.configuration.bfd-config.031"));
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
  return `UDP ${c.bind_ip}:3784 → ${c.peer_ip}${guideText("bfd.configuration.bfd-config.016")}${c.interface}${guideText("bfd.configuration.bfd-config.017")}${c.source_port} · discriminator ${c.local_discriminator} · Tx/Rx ${c.min_tx_us}/${c.min_rx_us}${guideText("bfd.configuration.bfd-config.018")}${c.detect_mult} · ${bfdModeLabels[c.scenario.mode]}${c.scenario.mode === "normal" ? "" : `${guideText("bfd.configuration.bfd-config.014")}${c.scenario.after_up_ms} ms`}${"duration_ms" in c.scenario ? `${guideText("bfd.configuration.bfd-config.015")}${c.scenario.duration_ms} ms` : ""}`;
}

/** A retained report is named from its own applied snapshot, never today's case-label metadata. */
export function bfdReportLabel(method: string, config: BfdConfig): string {
  return method === "ALL"
    ? `${config.scenario.mode}${guideText("bfd.configuration.bfd-config.019")}`
    : bfdCaseLabels[method] || method;
}
