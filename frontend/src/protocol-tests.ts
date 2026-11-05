export type ProtocolCheck = {
  name: string;
  passed: boolean;
  error?: string;
  seconds?: number;
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
  trace?: unknown;
};
export type ProtocolTestRun<C> = {
  id: string;
  instance_id: string;
  method: string;
  path: string;
  status: "running" | "passed" | "failed" | "error" | "interrupted";
  started_at: number;
  finished_at: number | null;
  source_container_id: string;
  container_name: string;
  applied_config: C;
  report: {
    passed: boolean;
    checks: ProtocolCheck[];
    seconds?: number;
    error?: string;
    exit_code?: number | null;
    trace?: unknown;
    summary?: { actual_exchanges?: number; [key: string]: unknown };
  } | null;
  error: string | null;
  cleanup_complete: boolean;
};
export type ProtocolTestSnapshot<C> = {
  session_id: string;
  cases: string[];
  paths: string[];
  case_labels?: Record<string, string>;
  path_label?: string;
  current: ProtocolTestRun<C> | null;
};
export function protocolTestLabel(
  id: string,
  labels?: Record<string, string>,
  fallback?: Record<string, string>,
): string {
  return labels?.[id] || fallback?.[id] || id;
}
export function boundedWireSummary(
  value: unknown,
  limit = 16384,
): { text: string; truncated: boolean; originalCharacters: number } {
  const text = JSON.stringify(value, null, 2) || "";
  return {
    text: text.slice(0, limit),
    truncated: text.length > limit,
    originalCharacters: text.length,
  };
}
export function ownProtocolTest<C>(
  run: ProtocolTestRun<C> | null,
  instanceId: string,
  waitingId: string | null,
): ProtocolTestRun<C> | null {
  return run &&
    run.instance_id === instanceId &&
    (!waitingId || run.id === waitingId)
    ? run
    : null;
}

/** Completed exchanges are explicit proof counts, never inferred from planned methods or check groups. */
export function actualProtocolExchanges(summary: unknown): number | null {
  if (!summary || typeof summary !== "object" || Array.isArray(summary))
    return null;
  const n = (summary as Record<string, unknown>).actual_exchanges;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
}
