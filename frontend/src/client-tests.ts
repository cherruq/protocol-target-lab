import { guideText } from "./protocol-description.ts";
import type { StoredConfig } from "./config";

export type TestMethod =
  | "GET"
  | "HEAD"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "ALL";
export const testPaths = [
  "/ok", "/chunked", "/close", "/head", "/health", "/truncated",
  "/chunk-truncated", "/invalid-status", "/status-099", "/invalid-chunk",
  "/conflicting-length", "/negative-length", "/chunk-extension", "/no-content",
  "/not-modified", "/informational", "/informational-error", "/only-informational",
  "/split-length", "/not-found", "/server-error", "/stall", "/flood",
  "/auth/basic", "/auth/cookie", "/auth/header", "/auth/query",
] as const;
export type TestPath = (typeof testPaths)[number];
export function httpMethodsForPath(path: string): TestMethod[] {
  if (["/ok", "/chunked", "/close"].includes(path)) return [...testMethods];
  if (["/head", "/health"].includes(path)) return ["HEAD", "ALL"];
  return ["GET", "ALL"];
}
export const testMethods: TestMethod[] = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "ALL",
];

export type WireMessage = {
  method?: string;
  path?: string;
  status?: number | null;
  headers?: Record<string, unknown>;
  headers_truncated?: boolean;
  headers_original_length?: number;
  body_length?: number;
  body_preview_hex?: string;
  body_truncated?: boolean;
  body_sha256?: string;
  wire?: { body_length?: number; body_preview_hex?: string; body_sha256?: string; body_truncated?: boolean };
  expected_wire_sha256?: string;
  tls?: { version?: string; cipher?: string; verified_server_name?: string };
};
export function httpResponseStatus(message: WireMessage): string {
  if (message.status !== null) return String(message.status ?? guideText("http.verification.client-tests.001"));
  if (message.wire && (message.wire.body_length ?? message.body_length ?? 0) > 0) return guideText("http.verification.client-tests.002");
  return guideText("http.verification.client-tests.003");
}
export type TestCheck = {
  name: string;
  passed: boolean;
  request?: WireMessage;
  response?: WireMessage;
  error?: string;
  seconds?: number;
  duration_ms?: number;
  expected_behavior?: string;
  quiet_window_seconds?: number;
};
export type TestRun = {
  id: string;
  instance_id: string;
  method: TestMethod;
  path: TestPath;
  status: "running" | "passed" | "failed" | "error" | "interrupted";
  started_at: number;
  finished_at: number | null;
  container_name: string;
  source_container_id: string;
  applied_config: StoredConfig;
  report: {
    passed: boolean;
    checks: TestCheck[];
    summary?: { total: number; passed: number; failed: number };
    error?: string;
    exit_code?: number | null;
    seconds?: number;
  } | null;
  error: string | null;
  cleanup_complete: boolean;
};
export type TestSnapshot = {
  session_id: string;
  cases: TestMethod[];
  paths: TestPath[];
  current: TestRun | null;
};

export function visibleTestRun(
  run: TestRun | null,
  instanceId: string,
  waitingId: string | null,
): TestRun | null {
  if (
    !run ||
    run.instance_id !== instanceId ||
    (waitingId && run.id !== waitingId)
  )
    return null;
  return run;
}

export function acceptedTestWasReplaced(
  acceptedId: string | null,
  current: { id: string } | null,
): boolean {
  return Boolean(acceptedId && current?.id !== acceptedId);
}

export function elapsedSeconds(
  run: Pick<TestRun, "started_at" | "finished_at">,
  now = Date.now(),
): number {
  const milliseconds = (value: number) =>
    value > 100_000_000_000 ? value : value * 1000;
  return Math.max(
    0,
    ((run.finished_at === null ? now : milliseconds(run.finished_at)) -
      milliseconds(run.started_at)) /
      1000,
  );
}

export function resultCounts(checks: TestCheck[]): {
  total: number;
  passed: number;
  failed: number;
} {
  const passed = checks.filter((check) => check.passed).length;
  return { total: checks.length, passed, failed: checks.length - passed };
}

export function testDurationLabel(
  run: Pick<TestRun, "started_at" | "finished_at" | "report">,
  now = Date.now(),
): string {
  const clientSeconds = run.report?.seconds;
  if (
    typeof clientSeconds === "number" &&
    Number.isFinite(clientSeconds) &&
    clientSeconds >= 0
  )
    return `${guideText("http.verification.client-tests.004")}${clientSeconds.toFixed(3)}${guideText("http.verification.client-tests.005")}`;
  const total = elapsedSeconds(run, now);
  return run.finished_at !== null && total < 1
    ? guideText("http.verification.client-tests.006")
    : `${guideText("http.verification.client-tests.007")}${total.toFixed(1)}${guideText("http.verification.client-tests.008")}`;
}
