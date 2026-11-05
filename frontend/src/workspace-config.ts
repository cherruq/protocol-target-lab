import {
  isMplsConfig,
  sameMplsConfig,
  type MplsConfig,
} from "./mpls-config.ts";
import {
  isIgmpConfig,
  sameIgmpConfig,
  type IgmpConfig,
} from "./igmp-config.ts";
import {
  isCustomEthernetConfig,
  isCustomEthernetDraft,
  sameCustomEthernetConfig,
  sameCustomEthernetDraft,
  type CustomEthernetConfig,
  type CustomEthernetDraft,
} from "./custom-ethernet-config.ts";
import {
  isArpClientConfig,
  sameArpClientConfig,
  type ArpClientConfig,
} from "./arp-client-config.ts";
import {
  isVxlanConfig,
  sameVxlanConfig,
  type VxlanConfig,
} from "./vxlan-config.ts";
import { isBfdConfig, sameBfdConfig, type BfdConfig } from "./bfd-config.ts";
import {
  normalizeConfig,
  isHttpConfig,
  sameGeneratedConfig,
  sameStoredConfig,
  type Config,
  type StoredConfig,
} from "./config.ts";
import { isDnsConfig, sameDnsConfig, type DnsConfig } from "./dns-config.ts";
import {
  isMqttConfig,
  sameMqttConfig,
  type MqttConfig,
} from "./mqtt-config.ts";
import {
  isTelnetConfig,
  sameTelnetConfig,
  type TelnetConfig,
} from "./telnet-config.ts";
import {
  isIec104Config,
  sameIec104Config,
  type Iec104Config,
} from "./iec104-config.ts";
import {
  isMqttSnConfig,
  sameMqttSnConfig,
  type MqttSnConfig,
} from "./mqtt-sn-config.ts";
import { isRtpConfig, sameRtpConfig, type RtpConfig } from "./rtp-config.ts";
import {
  isRtcpConfig,
  sameRtcpConfig,
  type RtcpConfig,
} from "./rtcp-config.ts";
import {
  isDlt645Config,
  sameDlt645Config,
  type Dlt645Config,
} from "./dlt645-config.ts";
import {
  isIec101Config,
  sameIec101Config,
  type Iec101Config,
} from "./iec101-config.ts";
export type WorkspaceConfig =
  | StoredConfig
  | DnsConfig
  | MqttConfig
  | TelnetConfig
  | Iec104Config
  | MqttSnConfig
  | RtpConfig
  | RtcpConfig
  | Dlt645Config
  | Iec101Config
  | BfdConfig
  | VxlanConfig
  | ArpClientConfig
  | CustomEthernetConfig
  | IgmpConfig
  | MplsConfig;
export type DraftConfig =
  | Config
  | DnsConfig
  | MqttConfig
  | TelnetConfig
  | Iec104Config
  | MqttSnConfig
  | RtpConfig
  | RtcpConfig
  | Dlt645Config
  | Iec101Config
  | BfdConfig
  | VxlanConfig
  | ArpClientConfig
  | CustomEthernetDraft
  | IgmpConfig
  | MplsConfig;
export type WorkspaceDrafts = Record<string, DraftConfig>;

export function sameWorkspaceConfig(
  a: WorkspaceConfig,
  b: WorkspaceConfig,
): boolean {
  if (isMplsConfig(a) || isMplsConfig(b))
    return isMplsConfig(a) && isMplsConfig(b) && sameMplsConfig(a, b);
  if (isIgmpConfig(a) || isIgmpConfig(b))
    return isIgmpConfig(a) && isIgmpConfig(b) && sameIgmpConfig(a, b);
  if (isCustomEthernetConfig(a) || isCustomEthernetConfig(b))
    return (
      isCustomEthernetConfig(a) &&
      isCustomEthernetConfig(b) &&
      sameCustomEthernetConfig(a, b)
    );
  if (isArpClientConfig(a) || isArpClientConfig(b))
    return (
      isArpClientConfig(a) && isArpClientConfig(b) && sameArpClientConfig(a, b)
    );
  if (isVxlanConfig(a) || isVxlanConfig(b))
    return isVxlanConfig(a) && isVxlanConfig(b) && sameVxlanConfig(a, b);
  if (isBfdConfig(a) || isBfdConfig(b))
    return isBfdConfig(a) && isBfdConfig(b) && sameBfdConfig(a, b);
  if (isIec101Config(a) || isIec101Config(b))
    return isIec101Config(a) && isIec101Config(b) && sameIec101Config(a, b);
  if (isDlt645Config(a) || isDlt645Config(b))
    return isDlt645Config(a) && isDlt645Config(b) && sameDlt645Config(a, b);
  if (isRtcpConfig(a) || isRtcpConfig(b))
    return isRtcpConfig(a) && isRtcpConfig(b) && sameRtcpConfig(a, b);
  if (isRtpConfig(a) || isRtpConfig(b))
    return isRtpConfig(a) && isRtpConfig(b) && sameRtpConfig(a, b);
  if (isDnsConfig(a) || isDnsConfig(b))
    return isDnsConfig(a) && isDnsConfig(b) && sameDnsConfig(a, b);
  if (isMqttConfig(a) || isMqttConfig(b))
    return isMqttConfig(a) && isMqttConfig(b) && sameMqttConfig(a, b);
  if (isTelnetConfig(a) || isTelnetConfig(b))
    return isTelnetConfig(a) && isTelnetConfig(b) && sameTelnetConfig(a, b);
  if (isIec104Config(a) || isIec104Config(b))
    return isIec104Config(a) && isIec104Config(b) && sameIec104Config(a, b);
  if (isMqttSnConfig(a) || isMqttSnConfig(b))
    return isMqttSnConfig(a) && isMqttSnConfig(b) && sameMqttSnConfig(a, b);
  return isHttpConfig(a) && isHttpConfig(b) && sameStoredConfig(a, b);
}
export function updateWorkspaceDrafts(
  drafts: WorkspaceDrafts,
  id: string,
  edited: DraftConfig,
  saved: WorkspaceConfig,
): WorkspaceDrafts {
  const changed = isMplsConfig(edited)
    ? !isMplsConfig(saved) || !sameMplsConfig(edited, saved)
    : isIgmpConfig(edited)
      ? !isIgmpConfig(saved) || !sameIgmpConfig(edited, saved)
      : isCustomEthernetDraft(edited)
        ? !isCustomEthernetConfig(saved) ||
          !sameCustomEthernetDraft(edited, saved)
        : isArpClientConfig(edited)
          ? !isArpClientConfig(saved) || !sameArpClientConfig(edited, saved)
          : isVxlanConfig(edited)
            ? !isVxlanConfig(saved) || !sameVxlanConfig(edited, saved)
            : isBfdConfig(edited)
              ? !isBfdConfig(saved) || !sameBfdConfig(edited, saved)
              : isDnsConfig(edited)
                ? !isDnsConfig(saved) || !sameDnsConfig(edited, saved)
                : isMqttConfig(edited)
                  ? !isMqttConfig(saved) || !sameMqttConfig(edited, saved)
                  : isTelnetConfig(edited)
                    ? !isTelnetConfig(saved) || !sameTelnetConfig(edited, saved)
                    : isIec104Config(edited)
                      ? !isIec104Config(saved) ||
                        !sameIec104Config(edited, saved)
                      : isMqttSnConfig(edited)
                        ? !isMqttSnConfig(saved) ||
                          !sameMqttSnConfig(edited, saved)
                        : isRtpConfig(edited)
                          ? !isRtpConfig(saved) || !sameRtpConfig(edited, saved)
                          : isRtcpConfig(edited)
                            ? !isRtcpConfig(saved) ||
                              !sameRtcpConfig(edited, saved)
                            : isDlt645Config(edited)
                              ? !isDlt645Config(saved) ||
                                !sameDlt645Config(edited, saved)
                              : isIec101Config(edited)
                                ? !isIec101Config(saved) ||
                                  !sameIec101Config(edited, saved)
                                : !isHttpConfig(saved) ||
                                  !sameGeneratedConfig(
                                    edited,
                                    normalizeConfig(saved),
                                  );
  const next = { ...drafts };
  if (changed) next[id] = edited;
  else delete next[id];
  return next;
}
export function discardWorkspaceDraft(
  drafts: WorkspaceDrafts,
  id: string,
): WorkspaceDrafts {
  const next = { ...drafts };
  delete next[id];
  return next;
}

/** Pure display view only: never add transport endpoint fields to a stored L2 configuration. */
export function workspaceIpEndpoint(
  config: WorkspaceConfig | null | undefined,
): { bind_ip: string; port: number } | null {
  if (
    !config ||
    isArpClientConfig(config) ||
    isCustomEthernetConfig(config) ||
    isIgmpConfig(config) ||
    isMplsConfig(config)
  )
    return null;
  if (isIec101Config(config))
    return { bind_ip: config.bind_ip, port: config.single.port };
  if (isBfdConfig(config)) return { bind_ip: config.bind_ip, port: 3784 };
  return { bind_ip: config.bind_ip, port: config.port };
}
