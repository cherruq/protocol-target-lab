import { guideText, lazyGuidanceLabels } from "./protocol-description.ts";
import { validIpv4 } from "./dns-config.ts";

export const vxlanModes = [
  "normal",
  "silent",
  "wrong-vni",
  "clear-i",
  "wrong-eth-dst",
  "wrong-sha",
  "wrong-spa",
  "wrong-tha",
  "wrong-tpa",
  "short-header",
  "short-arp",
] as const;
export type VxlanMode = (typeof vxlanModes)[number];
export type VxlanConfig = {
  wire_profile: "vxlan-ipv4-arp";
  bind_ip: string;
  port: number;
  peer_ip: string;
  peer_port: number;
  source_port: number;
  vni: number;
  inner_ip: string;
  inner_mac: string;
  requester_ip: string;
  requester_mac: string;
  reply_padding: 0 | 18;
  scenario: { mode: VxlanMode };
};
export const vxlanDefaults: VxlanConfig = {
  wire_profile: "vxlan-ipv4-arp",
  bind_ip: "127.0.0.1",
  port: 4789,
  peer_ip: "127.0.0.2",
  peer_port: 4789,
  source_port: 55029,
  vni: 1000,
  inner_ip: "198.18.0.20",
  inner_mac: "02:00:00:00:00:20",
  requester_ip: "198.18.0.10",
  requester_mac: "02:00:00:00:00:10",
  reply_padding: 0,
  scenario: { mode: "normal" },
};
export const vxlanModeLabels: Record<VxlanMode, string> = lazyGuidanceLabels(() => ({
  normal: guideText("vxlan.configuration.vxlan-config.001"),
  silent: guideText("vxlan.configuration.vxlan-config.002"),
  "wrong-vni": guideText("vxlan.configuration.vxlan-config.003"),
  "clear-i": guideText("vxlan.configuration.vxlan-config.004"),
  "wrong-eth-dst": guideText("vxlan.configuration.vxlan-config.005"),
  "wrong-sha": guideText("vxlan.configuration.vxlan-config.006"),
  "wrong-spa": guideText("vxlan.configuration.vxlan-config.007"),
  "wrong-tha": guideText("vxlan.configuration.vxlan-config.008"),
  "wrong-tpa": guideText("vxlan.configuration.vxlan-config.009"),
  "short-header": guideText("vxlan.configuration.vxlan-config.010"),
  "short-arp": guideText("vxlan.configuration.vxlan-config.011"),
}));
export const vxlanCaseLabels: Record<string, string> = lazyGuidanceLabels(() => ({
  ARP: guideText("vxlan.verification.vxlan-config.012"),
  RESERVED_BITS: guideText("vxlan.verification.vxlan-config.013"),
  REQUEST_THA: guideText("vxlan.verification.vxlan-config.014"),
  INVALID_REQUEST: guideText("vxlan.verification.vxlan-config.015"),
  ALL: guideText("vxlan.verification.vxlan-config.016"),
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
export function isVxlanConfig(v: unknown): v is VxlanConfig {
  return (
    object(v) &&
    keys(v, [
      "wire_profile",
      "bind_ip",
      "port",
      "peer_ip",
      "peer_port",
      "source_port",
      "vni",
      "inner_ip",
      "inner_mac",
      "requester_ip",
      "requester_mac",
      "reply_padding",
      "scenario",
    ]) &&
    v.wire_profile === "vxlan-ipv4-arp" &&
    [
      "bind_ip",
      "peer_ip",
      "inner_ip",
      "inner_mac",
      "requester_ip",
      "requester_mac",
    ].every((k) => typeof v[k] === "string") &&
    ["port", "peer_port", "source_port", "vni"].every(
      (k) => typeof v[k] === "number",
    ) &&
    (v.reply_padding === 0 || v.reply_padding === 18) &&
    object(v.scenario) &&
    keys(v.scenario, ["mode"]) &&
    typeof v.scenario.mode === "string" &&
    vxlanModes.includes(v.scenario.mode as VxlanMode)
  );
}
function unicast(ip: string, allowZero = false): boolean {
  if (!validIpv4(ip)) return false;
  if (ip === "0.0.0.0") return allowZero;
  const first = Number(ip.split(".")[0]);
  return (
    first > 0 && !(first >= 224 && first <= 239) && ip !== "255.255.255.255"
  );
}
function mac(value: string): boolean {
  return (
    /^(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(value) &&
    value !== "00:00:00:00:00:00" &&
    (parseInt(value.slice(0, 2), 16) & 1) === 0
  );
}
export function validateVxlanConfig(c: VxlanConfig): void {
  if (!isVxlanConfig(c))
    throw new Error(
      guideText("vxlan.configuration.vxlan-config.021"),
    );
  if (!unicast(c.bind_ip) || !unicast(c.peer_ip))
    throw new Error(
      guideText("vxlan.configuration.vxlan-config.022"),
    );
  if (
    !unicast(c.inner_ip) ||
    !unicast(c.requester_ip, true) ||
    c.inner_ip === c.requester_ip
  )
    throw new Error(
      guideText("vxlan.configuration.vxlan-config.023"),
    );
  for (const [key, low, high, label] of [
    ["port", 1, 65535, guideText("vxlan.configuration.vxlan-config.024")],
    ["peer_port", 1, 65535, guideText("vxlan.configuration.vxlan-config.025")],
    ["source_port", 49152, 65535, guideText("vxlan.configuration.vxlan-config.026")],
    ["vni", 0, 16777215, "VNI"],
  ] as const) {
    if (!Number.isInteger(c[key]) || c[key] < low || c[key] > high)
      throw new Error(`${label}${guideText("vxlan.configuration.vxlan-config.027")}${low}～${high}${guideText("vxlan.configuration.vxlan-config.028")}`);
  }
  if (c.port === c.source_port)
    throw new Error(guideText("vxlan.configuration.vxlan-config.029"));
  if (
    c.bind_ip === c.peer_ip &&
    (c.peer_port === c.port || c.peer_port === c.source_port)
  )
    throw new Error(
      guideText("vxlan.configuration.vxlan-config.030"),
    );
  if (
    !mac(c.inner_mac) ||
    !mac(c.requester_mac) ||
    c.inner_mac.toLowerCase() === c.requester_mac.toLowerCase()
  )
    throw new Error(
      guideText("vxlan.configuration.vxlan-config.031"),
    );
}
/** Canonicalization matches manager save/hash semantics; no other address or field is rewritten. */
export function normalizeVxlanConfig(c: VxlanConfig): VxlanConfig {
  validateVxlanConfig(c);
  return {
    ...c,
    inner_mac: c.inner_mac.toLowerCase(),
    requester_mac: c.requester_mac.toLowerCase(),
    scenario: { mode: c.scenario.mode },
  };
}
export function sameVxlanConfig(a: VxlanConfig, b: VxlanConfig): boolean {
  return (
    a.wire_profile === b.wire_profile &&
    a.bind_ip === b.bind_ip &&
    a.port === b.port &&
    a.peer_ip === b.peer_ip &&
    a.peer_port === b.peer_port &&
    a.source_port === b.source_port &&
    a.vni === b.vni &&
    a.inner_ip === b.inner_ip &&
    a.inner_mac.toLowerCase() === b.inner_mac.toLowerCase() &&
    a.requester_ip === b.requester_ip &&
    a.requester_mac.toLowerCase() === b.requester_mac.toLowerCase() &&
    a.reply_padding === b.reply_padding &&
    a.scenario.mode === b.scenario.mode
  );
}
export function vxlanDescription(c: VxlanConfig): string {
  return `UDP ${c.bind_ip}:${c.port} → ${c.peer_ip}:${c.peer_port}${guideText("vxlan.configuration.vxlan-config.017")}${c.source_port} · VNI ${c.vni}${guideText("vxlan.configuration.vxlan-config.018")}${c.inner_ip}/${c.inner_mac.toLowerCase()}${guideText("vxlan.configuration.vxlan-config.019")}${c.requester_ip}/${c.requester_mac.toLowerCase()} · inner ${42 + c.reply_padding}B / UDP ${50 + c.reply_padding}B · ${vxlanModeLabels[c.scenario.mode]}`;
}
export function vxlanReportLabel(method: string, c: VxlanConfig): string {
  return method === "ALL"
    ? `${c.scenario.mode}${guideText("vxlan.configuration.vxlan-config.020")}`
    : vxlanCaseLabels[method] || method;
}
