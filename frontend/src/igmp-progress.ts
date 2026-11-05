import { validIpv4 } from "./dns-config.ts";
export type IgmpProgress = {
  schema_version: 1;
  test_run_id: string;
  sequence: number;
  phase:
    | "warmup"
    | "general-query"
    | "group-query"
    | "cleanup"
    | "complete"
    | "failed";
  round: null | 1 | 2;
  groups_expected: string[];
  groups_covered: string[];
  queries_sent: number;
  reports_matched: number;
  prequery_reports: number;
  warmup_remaining_upper_ms: number;
  elapsed_ms: number;
  remaining_ms: number;
};
function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function integer(v: unknown) {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}
function time(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}
function groups(v: unknown): v is string[] {
  return (
    Array.isArray(v) &&
    v.length <= 16 &&
    new Set(v).size === v.length &&
    v.every(
      (x) => typeof x === "string" && validIpv4(x) && x.startsWith("239."),
    )
  );
}
/** Match the exact accepted run; the wire protocol itself has no transaction ID. */
export function ownIgmpProgress(
  value: unknown,
  testId: string,
  appliedGroups: readonly string[],
): IgmpProgress | null {
  if (
    !object(value) ||
    value.schema_version !== 1 ||
    value.test_run_id !== testId ||
    !integer(value.sequence) ||
    typeof value.phase !== "string" ||
    ![
      "warmup",
      "general-query",
      "group-query",
      "cleanup",
      "complete",
      "failed",
    ].includes(value.phase) ||
    !(value.round === null || value.round === 1 || value.round === 2) ||
    !groups(value.groups_expected) ||
    !groups(value.groups_covered) ||
    value.groups_expected.some((g) => !appliedGroups.includes(g)) ||
    value.groups_covered.some(
      (g) => !(value.groups_expected as string[]).includes(g),
    ) ||
    ![value.queries_sent, value.reports_matched, value.prequery_reports].every(
      integer,
    ) ||
    ![
      value.warmup_remaining_upper_ms,
      value.elapsed_ms,
      value.remaining_ms,
    ].every(time)
  )
    return null;
  return value as IgmpProgress;
}
export function sampledRemainingMs(
  sampleMs: number,
  elapsedMs: number,
): number | null {
  return [sampleMs, elapsedMs].every(time)
    ? Math.max(0, sampleMs - elapsedMs)
    : null;
}
export function igmpActualCount(
  summary: unknown,
  key: "actual_queries" | "actual_reports" | "total" | "prequery_reports",
): number | null {
  if (!object(summary) || !integer(summary[key])) return null;
  return summary[key] as number;
}
