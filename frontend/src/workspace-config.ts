import {
  normalizeConfig,
  sameGeneratedConfig,
  sameStoredConfig,
  type Config,
  type StoredConfig,
} from "./config.ts";
import { isDnsConfig, sameDnsConfig, type DnsConfig } from "./dns-config.ts";
export type WorkspaceConfig = StoredConfig | DnsConfig;
export type DraftConfig = Config | DnsConfig;
export type WorkspaceDrafts = Record<string, DraftConfig>;

export function sameWorkspaceConfig(
  a: WorkspaceConfig,
  b: WorkspaceConfig,
): boolean {
  if (isDnsConfig(a) || isDnsConfig(b))
    return isDnsConfig(a) && isDnsConfig(b) && sameDnsConfig(a, b);
  return sameStoredConfig(a, b);
}
export function updateWorkspaceDrafts(
  drafts: WorkspaceDrafts,
  id: string,
  edited: DraftConfig,
  saved: WorkspaceConfig,
): WorkspaceDrafts {
  const changed = isDnsConfig(edited)
    ? !isDnsConfig(saved) || !sameDnsConfig(edited, saved)
    : isDnsConfig(saved) ||
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
