export type RuntimeEnvelope<R> = {
  available: boolean;
  reason?: string;
  source_container_id?: string;
  sample_age_ms?: number;
  runtime?: R;
};
export type RuntimeTarget = {
  id: string;
  containerId: string | null;
  status: string;
  disconnected: boolean;
};

/** Monotonic elapsed plus conservative server-side sample age; never renew a cached heartbeat. */
export function runtimeHeartbeatAge(
  workerAgeMs: number,
  receivedAt: number,
  now: number,
  serverSampleAgeMs = 0,
): number {
  if (
    ![workerAgeMs, receivedAt, now, serverSampleAgeMs].every(
      (v) => Number.isFinite(v) && v >= 0,
    ) ||
    now < receivedAt
  )
    return Infinity;
  return workerAgeMs + serverSampleAgeMs + now - receivedAt;
}
