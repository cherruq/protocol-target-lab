import { guideText, lazyGuidanceLabels } from "./protocol-description.ts";
import { validIpv4 } from "./dns-config.ts";
export const mplsScenarios = [
  "normal",
  "silent",
  "wrong-eth-src",
  "wrong-eth-dst",
  "wrong-ip-src",
  "wrong-ip-dst",
  "wrong-id",
  "wrong-seq",
  "wrong-payload",
  "bad-ip-checksum",
  "bad-icmp-checksum",
  "short-ethernet",
  "short-ipv4",
  "short-icmp",
] as const;
export type MplsScenario = (typeof mplsScenarios)[number];
export type MplsLink =
  | { mode: "docker-bridge" }
  | { mode: "host-interface"; interface: string };
export type MplsConfig = {
  wire_profile: "mpls-single-label-ipv4-icmp-echo";
  link: MplsLink;
  source_mac: string;
  source_ip: string;
  client_mac: string;
  client_ip: string;
  label: number;
  reply_ttl: number;
  scenario: { mode: MplsScenario };
};
export const mplsDefaults: MplsConfig = {
  wire_profile: "mpls-single-label-ipv4-icmp-echo",
  link: { mode: "docker-bridge" },
  source_mac: "02:00:00:00:58:20",
  source_ip: "198.18.58.20",
  client_mac: "02:00:00:00:58:10",
  client_ip: "198.18.58.10",
  label: 58,
  reply_ttl: 64,
  scenario: { mode: "normal" },
};
export const mplsScenarioLabels: Record<MplsScenario, string> = lazyGuidanceLabels(() => ({
  normal: guideText("mpls.configuration.mpls-config.001"),
  silent: guideText("mpls.configuration.mpls-config.002"),
  "wrong-eth-src": guideText("mpls.configuration.mpls-config.003"),
  "wrong-eth-dst": guideText("mpls.configuration.mpls-config.004"),
  "wrong-ip-src": guideText("mpls.configuration.mpls-config.005"),
  "wrong-ip-dst": guideText("mpls.configuration.mpls-config.006"),
  "wrong-id": guideText("mpls.configuration.mpls-config.007"),
  "wrong-seq": guideText("mpls.configuration.mpls-config.008"),
  "wrong-payload": guideText("mpls.configuration.mpls-config.009"),
  "bad-ip-checksum": guideText("mpls.configuration.mpls-config.010"),
  "bad-icmp-checksum": guideText("mpls.configuration.mpls-config.011"),
  "short-ethernet": guideText("mpls.configuration.mpls-config.012"),
  "short-ipv4": guideText("mpls.configuration.mpls-config.013"),
  "short-icmp": guideText("mpls.configuration.mpls-config.014"),
}));
export const mplsCaseLabels = lazyGuidanceLabels(() => ({
  TX_BOUNDARY: guideText("mpls.verification.tx-boundary.case"),
  ECHO: guideText("mpls.verification.mpls-config.015"),
  TC_TTL: guideText("mpls.verification.mpls-config.016"),
  PADDING: guideText("mpls.verification.mpls-config.017"),
  INVALID_REQUEST: guideText("mpls.verification.mpls-config.018"),
  ALL: guideText("mpls.verification.mpls-config.019"),
}));
function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function keys(v: Record<string, unknown>, expected: string[]) {
  return (
    Object.keys(v).length === expected.length &&
    Object.keys(v).every((k) => expected.includes(k))
  );
}
export function isMplsConfig(v: unknown): v is MplsConfig {
  return (
    object(v) &&
    keys(v, [
      "wire_profile",
      "link",
      "source_mac",
      "source_ip",
      "client_mac",
      "client_ip",
      "label",
      "reply_ttl",
      "scenario",
    ]) &&
    v.wire_profile === "mpls-single-label-ipv4-icmp-echo" &&
    object(v.link) &&
    (v.link.mode === "docker-bridge"
      ? keys(v.link, ["mode"])
      : v.link.mode === "host-interface" &&
        keys(v.link, ["mode", "interface"]) &&
        typeof v.link.interface === "string") &&
    ["source_mac", "source_ip", "client_mac", "client_ip"].every(
      (k) => typeof v[k] === "string",
    ) &&
    typeof v.label === "number" &&
    typeof v.reply_ttl === "number" &&
    object(v.scenario) &&
    keys(v.scenario, ["mode"]) &&
    typeof v.scenario.mode === "string" &&
    mplsScenarios.includes(v.scenario.mode as MplsScenario)
  );
}
function roleIp(v: string) {
  if (!validIpv4(v)) return false;
  const first = Number(v.split(".")[0]);
  return (
    first > 0 && !(first >= 224 && first <= 239) && v !== "255.255.255.255"
  );
}
function mac(v: string) {
  return (
    /^(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(v) &&
    v !== "00:00:00:00:00:00" &&
    (parseInt(v.slice(0, 2), 16) & 1) === 0
  );
}
export function validateMplsConfig(c: MplsConfig): void {
  if (!isMplsConfig(c))
    throw new Error(
      guideText("mpls.configuration.mpls-config.031"),
    );
  if (
    !mac(c.source_mac) ||
    !mac(c.client_mac) ||
    c.source_mac.toLowerCase() === c.client_mac.toLowerCase()
  )
    throw new Error(guideText("mpls.configuration.mpls-config.032"));
  if (
    !roleIp(c.source_ip) ||
    !roleIp(c.client_ip) ||
    c.source_ip === c.client_ip
  )
    throw new Error(guideText("mpls.configuration.mpls-config.033"));
  if (
    c.link.mode === "host-interface" &&
    !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,14}$/.test(c.link.interface)
  )
    throw new Error(
      guideText("mpls.configuration.mpls-config.034"),
    );
  if (!Number.isInteger(c.label) || c.label < 16 || c.label > 1048575)
    throw new Error(guideText("mpls.configuration.mpls-config.035"));
  if (!Number.isInteger(c.reply_ttl) || c.reply_ttl < 1 || c.reply_ttl > 255)
    throw new Error(guideText("mpls.configuration.mpls-config.036"));
}
export function normalizeMplsConfig(c: MplsConfig): MplsConfig {
  validateMplsConfig(c);
  return {
    ...c,
    source_mac: c.source_mac.toLowerCase(),
    client_mac: c.client_mac.toLowerCase(),
    link:
      c.link.mode === "docker-bridge"
        ? { mode: "docker-bridge" }
        : { mode: "host-interface", interface: c.link.interface },
    scenario: { mode: c.scenario.mode },
  };
}
export function sameMplsConfig(a: MplsConfig, b: MplsConfig) {
  return (
    a.wire_profile === b.wire_profile &&
    a.link.mode === b.link.mode &&
    (a.link.mode !== "host-interface" ||
      (b.link.mode === "host-interface" &&
        a.link.interface === b.link.interface)) &&
    a.source_mac.toLowerCase() === b.source_mac.toLowerCase() &&
    a.client_mac.toLowerCase() === b.client_mac.toLowerCase() &&
    a.source_ip === b.source_ip &&
    a.client_ip === b.client_ip &&
    Object.is(a.label, b.label) &&
    Object.is(a.reply_ttl, b.reply_ttl) &&
    a.scenario.mode === b.scenario.mode
  );
}
export function changeMplsLink(
  c: MplsConfig,
  mode: MplsLink["mode"],
  cachedInterface = "",
): MplsConfig {
  return {
    ...c,
    link:
      mode === "docker-bridge"
        ? { mode }
        : {
            mode,
            interface:
              c.link.mode === "host-interface"
                ? c.link.interface
                : cachedInterface,
          },
  };
}
export function mplsLinkDescription(c: MplsConfig) {
  return c.link.mode === "docker-bridge"
    ? guideText("mpls.configuration.mpls-config.020")
    : `${guideText("mpls.configuration.mpls-config.021")}${c.link.interface}${guideText("mpls.configuration.mpls-config.022")}`;
}
export function mplsDescription(c: unknown) {
  if (!isMplsConfig(c)) return guideText("mpls.configuration.mpls-config.023");
  return `${mplsLinkDescription(c)}${guideText("mpls.configuration.mpls-config.024")}${c.source_mac}${guideText("mpls.configuration.mpls-config.025")}${c.source_ip}${guideText("mpls.configuration.mpls-config.026")}${c.client_mac}${guideText("mpls.configuration.mpls-config.027")}${c.client_ip} · label ${c.label}${guideText("mpls.configuration.mpls-config.028")}${c.reply_ttl} · ${c.scenario.mode}`;
}
export function mplsReportLabel(method: string, c: unknown) {
  if (!isMplsConfig(c)) return method;
  return `${c.scenario.mode} · ${c.link.mode} · ${method === "ALL" ? guideText("mpls.configuration.mpls-config.029") : mplsCaseLabels[method as keyof typeof mplsCaseLabels] || method}${guideText("mpls.configuration.mpls-config.030")}`;
}
