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
export type WorkspaceConfig =
  | StoredConfig
  | DnsConfig
  | MqttConfig
  | TelnetConfig;
export type DraftConfig = Config | DnsConfig | MqttConfig | TelnetConfig;
export type WorkspaceDrafts = Record<string, DraftConfig>;

export function sameWorkspaceConfig(
  a: WorkspaceConfig,
  b: WorkspaceConfig,
): boolean {
  if (isDnsConfig(a) || isDnsConfig(b))
    return isDnsConfig(a) && isDnsConfig(b) && sameDnsConfig(a, b);
  if (isMqttConfig(a) || isMqttConfig(b))
    return isMqttConfig(a) && isMqttConfig(b) && sameMqttConfig(a, b);
  if (isTelnetConfig(a) || isTelnetConfig(b))
    return isTelnetConfig(a) && isTelnetConfig(b) && sameTelnetConfig(a, b);
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
