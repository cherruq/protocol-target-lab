import { guideText, lazyGuidanceLabels } from "./protocol-description.ts";
export type CustomEthernetLink =
  | { mode: "docker-bridge" }
  | { mode: "host-interface"; interface: string };
export type CustomPayload = {
  destination_mac: string;
  source_mac: { mode: "interface" | "override"; value: string };
  ether_type: number;
  payload_hex: string;
  vlan: { enabled: boolean; vid: number; pcp: number; dei: boolean };
};
export type CustomEthernetConfig = {
  wire_profile: "ethernet-fixed-response";
  link: CustomEthernetLink;
  local_mac: string;
  peer_mac: string;
  packet_filter: string;
  request_marker_hex: string | null;
  response: {
    mode: "payload" | "frame";
    payload: CustomPayload;
    frame_hex: string;
  };
  promiscuous: boolean;
  multicast_macs: string[];
  test_request: { frame_hex: string };
};
export type CustomEthernetDraft = Omit<
  CustomEthernetConfig,
  "response" | "multicast_macs"
> & {
  response: Omit<CustomEthernetConfig["response"], "payload"> & {
    payload: Omit<CustomPayload, "ether_type"> & {
      ether_type: number | string;
    };
  };
  multicast_macs: string[] | string;
};
export const customEthernetDefaults: CustomEthernetConfig = {
  wire_profile: "ethernet-fixed-response",
  link: { mode: "docker-bridge" },
  local_mac: "02:00:00:00:02:20",
  peer_mac: "02:00:00:00:02:10",
  packet_filter: "ether proto 0x88b5 and ether src 02:00:00:00:02:10",
  request_marker_hex: "504c41422d52455155455354",
  response: {
    mode: "payload",
    payload: {
      destination_mac: "02:00:00:00:02:10",
      source_mac: { mode: "interface", value: "02:00:00:00:02:20" },
      ether_type: 0x88b5,
      payload_hex: "504c41422d524553504f4e5345".padEnd(128, "0"),
      vlan: { enabled: false, vid: 7, pcp: 0, dei: false },
    },
    frame_hex:
      "02000000021002000000022088b5" +
      "504c41422d524553504f4e5345".padEnd(128, "0"),
  },
  promiscuous: false,
  multicast_macs: [],
  test_request: {
    frame_hex:
      "02000000022002000000021088b5" +
      "504c41422d52455155455354".padEnd(128, "0"),
  },
};
function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function keys(v: Record<string, unknown>, ks: string[]) {
  return (
    Object.keys(v).length === ks.length && ks.every((k) => Object.hasOwn(v, k))
  );
}
function shape(v: unknown, draft: boolean): boolean {
  if (
    !object(v) ||
    !keys(v, [
      "wire_profile",
      "link",
      "local_mac",
      "peer_mac",
      "packet_filter",
      "request_marker_hex",
      "response",
      "promiscuous",
      "multicast_macs",
      "test_request",
    ]) ||
    v.wire_profile !== "ethernet-fixed-response"
  )
    return false;
  const l = v.link,
    r = v.response,
    t = v.test_request;
  if (
    !object(l) ||
    !(l.mode === "docker-bridge"
      ? keys(l, ["mode"])
      : l.mode === "host-interface" &&
        keys(l, ["mode", "interface"]) &&
        typeof l.interface === "string")
  )
    return false;
  if (
    !["local_mac", "peer_mac", "packet_filter"].every(
      (k) => typeof v[k] === "string",
    ) ||
    !(
      v.request_marker_hex === null || typeof v.request_marker_hex === "string"
    ) ||
    typeof v.promiscuous !== "boolean"
  )
    return false;
  if (
    !(
      Array.isArray(v.multicast_macs) &&
      v.multicast_macs.every((x) => typeof x === "string")
    ) &&
    !(draft && typeof v.multicast_macs === "string")
  )
    return false;
  if (
    !object(r) ||
    !keys(r, ["mode", "payload", "frame_hex"]) ||
    !["payload", "frame"].includes(String(r.mode)) ||
    typeof r.mode !== "string" ||
    typeof r.frame_hex !== "string" ||
    !object(r.payload)
  )
    return false;
  const p = r.payload,
    s = p.source_mac,
    vlan = p.vlan;
  return (
    keys(p, [
      "destination_mac",
      "source_mac",
      "ether_type",
      "payload_hex",
      "vlan",
    ]) &&
    typeof p.destination_mac === "string" &&
    typeof p.payload_hex === "string" &&
    (typeof p.ether_type === "number" ||
      (draft && typeof p.ether_type === "string")) &&
    object(s) &&
    keys(s, ["mode", "value"]) &&
    (s.mode === "interface" || s.mode === "override") &&
    typeof s.value === "string" &&
    object(vlan) &&
    keys(vlan, ["enabled", "vid", "pcp", "dei"]) &&
    typeof vlan.enabled === "boolean" &&
    typeof vlan.vid === "number" &&
    typeof vlan.pcp === "number" &&
    typeof vlan.dei === "boolean" &&
    object(t) &&
    keys(t, ["frame_hex"]) &&
    typeof t.frame_hex === "string"
  );
}
export function isCustomEthernetConfig(v: unknown): v is CustomEthernetConfig {
  return shape(v, false);
}
export function isCustomEthernetDraft(v: unknown): v is CustomEthernetDraft {
  return shape(v, true);
}
export function validCustomMac(v: string): boolean {
  return (
    /^(?:[a-fA-F0-9]{2}:){5}[a-fA-F0-9]{2}$/.test(v) &&
    v !== "00:00:00:00:00:00"
  );
}
function unicast(v: string) {
  return validCustomMac(v) && !(parseInt(v.slice(0, 2), 16) & 1);
}
export function customHexBytes(v: string, min = 0, max = 65535): number {
  if (
    !/^(?:[a-fA-F0-9]{2})*$/.test(v) ||
    v.length / 2 < min ||
    v.length / 2 > max
  )
    throw new Error(
      `${guideText("custom-ethernet.configuration.custom-ethernet-config.019")}${min}～${max}${guideText("custom-ethernet.configuration.custom-ethernet-config.020")}`,
    );
  return v.length / 2;
}
export function parseCustomEtherType(v: number | string): number {
  const n =
    typeof v === "number"
      ? v
      : /^(?:0x)?[a-fA-F0-9]{1,4}$/.test(v)
        ? parseInt(v.replace(/^0x/, ""), 16)
        : NaN;
  if (
    !Number.isInteger(n) ||
    n < 1536 ||
    n > 65535 ||
    [0x8100, 0x88a8, 0x9100].includes(n)
  )
    throw new Error(
      guideText("custom-ethernet.configuration.custom-ethernet-config.021"),
    );
  return n;
}
function integer(v: number, min: number, max: number) {
  return Number.isInteger(v) && v >= min && v <= max;
}
function validatePayload(p: CustomEthernetDraft["response"]["payload"]): void {
  if (!validCustomMac(p.destination_mac))
    throw new Error(guideText("custom-ethernet.configuration.custom-ethernet-config.022"));
  if (!unicast(p.source_mac.value))
    throw new Error(
      guideText("custom-ethernet.configuration.custom-ethernet-config.023"),
    );
  parseCustomEtherType(p.ether_type);
  if (!integer(p.vlan.vid, 0, 4094) || !integer(p.vlan.pcp, 0, 7))
    throw new Error(
      guideText("custom-ethernet.configuration.custom-ethernet-config.024"),
    );
  const bytes = customHexBytes(p.payload_hex, 0, 65521);
  if (bytes + (p.vlan.enabled ? 18 : 14) > 65535)
    throw new Error(
      guideText("custom-ethernet.configuration.custom-ethernet-config.025"),
    );
}
function normalized(d: CustomEthernetDraft): CustomEthernetConfig {
  return {
    ...d,
    local_mac: d.local_mac.toLowerCase(),
    peer_mac: d.peer_mac.toLowerCase(),
    request_marker_hex:
      d.request_marker_hex === ""
        ? null
        : (d.request_marker_hex?.toLowerCase() ?? null),
    multicast_macs: (typeof d.multicast_macs === "string"
      ? d.multicast_macs.split("\n").filter((x) => x.trim() !== "")
      : d.multicast_macs
    ).map((x) => x.toLowerCase()),
    response: {
      ...d.response,
      frame_hex: d.response.frame_hex.toLowerCase(),
      payload: {
        ...d.response.payload,
        destination_mac: d.response.payload.destination_mac.toLowerCase(),
        source_mac: {
          ...d.response.payload.source_mac,
          value: d.response.payload.source_mac.value.toLowerCase(),
        },
        ether_type: parseCustomEtherType(d.response.payload.ether_type),
        payload_hex: d.response.payload.payload_hex.toLowerCase(),
      },
    },
    test_request: { frame_hex: d.test_request.frame_hex.toLowerCase() },
  };
}
export function validateCustomEthernetConfig(c: CustomEthernetConfig): void {
  if (!isCustomEthernetConfig(c))
    throw new Error(
      guideText("custom-ethernet.configuration.custom-ethernet-config.026"),
    );
  if (
    !unicast(c.local_mac) ||
    !unicast(c.peer_mac) ||
    c.local_mac.toLowerCase() === c.peer_mac.toLowerCase()
  )
    throw new Error(guideText("custom-ethernet.configuration.custom-ethernet-config.027"));
  if (
    c.link.mode === "host-interface" &&
    !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,14}$/.test(c.link.interface)
  )
    throw new Error(
      guideText("custom-ethernet.configuration.custom-ethernet-config.028"),
    );
  if (
    !c.packet_filter.trim() ||
    c.packet_filter.includes("\0") ||
    new TextEncoder().encode(c.packet_filter).length > 2048
  )
    throw new Error(
      guideText("custom-ethernet.configuration.custom-ethernet-config.029"),
    );
  if (c.request_marker_hex !== null)
    customHexBytes(c.request_marker_hex, 1, 64);
  validatePayload(c.response.payload);
  customHexBytes(c.response.frame_hex, 14, 65535);
  customHexBytes(c.test_request.frame_hex, 14, 65535);
  if (
    c.multicast_macs.length > 16 ||
    new Set(c.multicast_macs.map((x) => x.toLowerCase())).size !==
      c.multicast_macs.length ||
    c.multicast_macs.some(
      (x) =>
        !validCustomMac(x) ||
        !(parseInt(x.slice(0, 2), 16) & 1) ||
        x.toLowerCase() === "ff:ff:ff:ff:ff:ff",
    )
  )
    throw new Error(
      guideText("custom-ethernet.configuration.custom-ethernet-config.030"),
    );
}
/** The API receives only strict valid banks; invalid inactive editor text remains in the UI draft. */
export function prepareCustomEthernetSave(
  draft: CustomEthernetDraft,
  saved: CustomEthernetConfig,
): { config: CustomEthernetConfig; retained: string[] } {
  if (!isCustomEthernetDraft(draft))
    throw new Error(guideText("custom-ethernet.configuration.custom-ethernet-config.031"));
  const d = structuredClone(draft),
    retained: string[] = [];
  const p = d.response.payload;
  if (d.response.mode === "frame") {
    try {
      validatePayload(p);
    } catch {
      d.response.payload = structuredClone(saved.response.payload);
      retained.push(guideText("custom-ethernet.configuration.custom-ethernet-config.032"));
    }
  } else {
    if (p.source_mac.mode === "interface" && !unicast(p.source_mac.value)) {
      p.source_mac.value = saved.response.payload.source_mac.value;
      retained.push(guideText("custom-ethernet.configuration.custom-ethernet-config.033"));
    }
    if (
      !p.vlan.enabled &&
      (!integer(p.vlan.vid, 0, 4094) || !integer(p.vlan.pcp, 0, 7))
    ) {
      p.vlan = { ...saved.response.payload.vlan, enabled: false };
      retained.push(guideText("custom-ethernet.configuration.custom-ethernet-config.034"));
    }
    validatePayload(p);
    try {
      customHexBytes(d.response.frame_hex, 14, 65535);
    } catch {
      d.response.frame_hex = saved.response.frame_hex;
      retained.push(guideText("custom-ethernet.configuration.custom-ethernet-config.035"));
    }
  }
  const config = normalized(d);
  validateCustomEthernetConfig(config);
  return { config, retained };
}
function stable(v: unknown): unknown {
  return Array.isArray(v)
    ? v.map(stable)
    : object(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, stable(v[k])]),
        )
      : v;
}
export function sameCustomEthernetConfig(
  a: CustomEthernetConfig,
  b: CustomEthernetConfig,
): boolean {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}
export function sameCustomEthernetDraft(
  d: CustomEthernetDraft,
  s: CustomEthernetConfig,
): boolean {
  if (
    typeof d.multicast_macs === "string" &&
    d.multicast_macs !== s.multicast_macs.join("\n")
  )
    return false;
  try {
    const p = prepareCustomEthernetSave(d, s);
    return !p.retained.length && sameCustomEthernetConfig(p.config, s);
  } catch {
    return false;
  }
}
export const customEthernetCaseLabels = lazyGuidanceLabels(() => ({
  ROUNDTRIP: guideText("custom-ethernet.verification.custom-ethernet-config.001"),
  REPEAT: guideText("custom-ethernet.verification.custom-ethernet-config.002"),
  ALL: guideText("custom-ethernet.verification.custom-ethernet-config.003"),
}));
export function customEthernetLinkDescription(c: CustomEthernetConfig): string {
  return c.link.mode === "docker-bridge"
    ? guideText("custom-ethernet.configuration.custom-ethernet-config.004")
    : `${guideText("custom-ethernet.configuration.custom-ethernet-config.005")}${c.link.interface}`;
}
export function customEthernetDescription(c: CustomEthernetConfig): string {
  const p = c.response.payload;
  return `${customEthernetLinkDescription(c)} · ${c.response.mode === "frame" ? `${guideText("custom-ethernet.configuration.custom-ethernet-config.006")}${c.response.frame_hex.length / 2}${guideText("custom-ethernet.configuration.custom-ethernet-config.007")}` : `${guideText("custom-ethernet.configuration.custom-ethernet-config.009")}${p.payload_hex.length / 2 + (p.vlan.enabled ? 18 : 14)}${guideText("custom-ethernet.configuration.custom-ethernet-config.010")}${p.ether_type.toString(16)} · ${p.vlan.enabled ? `VLAN ${p.vlan.vid}/PCP${p.vlan.pcp}/DEI${Number(p.vlan.dei)}` : guideText("custom-ethernet.configuration.custom-ethernet-config.008")}`}${guideText("custom-ethernet.configuration.custom-ethernet-config.011")}${c.test_request.frame_hex.length / 2}${guideText("custom-ethernet.configuration.custom-ethernet-config.012")}`;
}
export function customEthernetReportLabel(
  method: string,
  snapshot: unknown,
): string {
  return isCustomEthernetConfig(snapshot)
    ? `${snapshot.response.mode === "frame" ? guideText("custom-ethernet.configuration.custom-ethernet-config.013") : guideText("custom-ethernet.configuration.custom-ethernet-config.014")} · ${method === "ALL" ? guideText("custom-ethernet.configuration.custom-ethernet-config.015") : method === "REPEAT" ? guideText("custom-ethernet.configuration.custom-ethernet-config.016") : guideText("custom-ethernet.configuration.custom-ethernet-config.017")}${guideText("custom-ethernet.configuration.custom-ethernet-config.018")}`
    : method;
}
