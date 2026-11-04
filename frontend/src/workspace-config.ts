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
  | Iec101Config;
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
  | Iec101Config;
export type WorkspaceDrafts = Record<string, DraftConfig>;

export function sameWorkspaceConfig(
  a: WorkspaceConfig,
  b: WorkspaceConfig,
): boolean {
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
  const changed = isDnsConfig(edited)
    ? !isDnsConfig(saved) || !sameDnsConfig(edited, saved)
    : isMqttConfig(edited)
      ? !isMqttConfig(saved) || !sameMqttConfig(edited, saved)
      : isTelnetConfig(edited)
        ? !isTelnetConfig(saved) || !sameTelnetConfig(edited, saved)
        : isIec104Config(edited)
          ? !isIec104Config(saved) || !sameIec104Config(edited, saved)
          : isMqttSnConfig(edited)
            ? !isMqttSnConfig(saved) || !sameMqttSnConfig(edited, saved)
            : isRtpConfig(edited)
              ? !isRtpConfig(saved) || !sameRtpConfig(edited, saved)
              : isRtcpConfig(edited)
                ? !isRtcpConfig(saved) || !sameRtcpConfig(edited, saved)
                : isDlt645Config(edited)
                  ? !isDlt645Config(saved) || !sameDlt645Config(edited, saved)
                  : isIec101Config(edited)
                    ? !isIec101Config(saved) || !sameIec101Config(edited, saved)
                    : !isHttpConfig(saved) ||
                      !sameGeneratedConfig(edited, normalizeConfig(saved));
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
