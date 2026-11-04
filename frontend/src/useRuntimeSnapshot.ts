import { useEffect, useState } from "react";
import type { RuntimeEnvelope, RuntimeTarget } from "./runtime-status.ts";

/** Read-only current-source polling. No probe, peer generation or protocol-specific state mutation. */
export default function useRuntimeSnapshot<R>(
  { id, containerId, status, disconnected }: RuntimeTarget,
  selectRuntime: (
    snapshot: RuntimeEnvelope<R> | null,
    containerId: string | null,
  ) => R | null,
) {
  const [snapshot, setSnapshot] = useState<RuntimeEnvelope<R> | null>(null);
  const [error, setError] = useState("");
  const [receivedAt, setReceivedAt] = useState(0);
  const [now, setNow] = useState(performance.now());
  useEffect(() => {
    let disposed = false,
      inFlight = false;
    let controller: AbortController | null = null;
    setSnapshot(null);
    setError("");
    if (disconnected || status !== "running" || !containerId) return;
    async function refresh() {
      if (inFlight || disposed) return;
      inFlight = true;
      controller = new AbortController();
      const timer = window.setTimeout(() => controller?.abort(), 10000);
      try {
        const response = await fetch(
          `/api/instances/${encodeURIComponent(id)}/runtime`,
          { signal: controller.signal },
        );
        if (!response.ok)
          throw new Error(`读取失败（HTTP ${response.status}）`);
        const data = (await response.json()) as RuntimeEnvelope<R>;
        if (disposed) return;
        if (data.available && !selectRuntime(data, containerId))
          throw new Error("运行态来源或格式不匹配，待重新核对。");
        setSnapshot(data);
        setReceivedAt(performance.now());
        setNow(performance.now());
        setError("");
      } catch (cause) {
        if (!disposed) {
          setSnapshot(null);
          setError(
            (cause as Error).name === "AbortError"
              ? "运行态读取超时，当前会话待确认。"
              : (cause as Error).message,
          );
        }
      } finally {
        window.clearTimeout(timer);
        inFlight = false;
      }
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 2000);
    const clock = window.setInterval(() => setNow(performance.now()), 1000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.clearInterval(clock);
      controller?.abort();
    };
  }, [id, containerId, status, disconnected, selectRuntime]);
  const snapshotExpired = now - receivedAt > 5000 || now < receivedAt;
  const runtime =
    !disconnected && status === "running" && !snapshotExpired
      ? selectRuntime(snapshot, containerId)
      : null;
  return { runtime, snapshot, snapshotExpired, receivedAt, now, error };
}
