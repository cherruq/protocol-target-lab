import { useEffect, useState } from "react";
import {
  bfdDiagnosticLabels,
  bfdHeartbeatAge,
  bfdStateLabels,
  currentBfdRuntime,
  type BfdRuntimeEnvelope,
} from "./bfd-runtime";

export default function BfdRuntimePanel({
  id,
  containerId,
  status,
  disconnected,
}: {
  id: string;
  containerId: string | null;
  status: string;
  disconnected: boolean;
}) {
  const [snapshot, setSnapshot] = useState<BfdRuntimeEnvelope | null>(null);
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
        const data = (await response.json()) as BfdRuntimeEnvelope;
        if (disposed) return;
        if (data.available && !currentBfdRuntime(data, containerId))
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
  }, [id, containerId, status, disconnected]);
  const snapshotExpired = now - receivedAt > 5000 || now < receivedAt;
  const runtime =
    !disconnected && status === "running" && !snapshotExpired
      ? currentBfdRuntime(snapshot, containerId)
      : null;
  const heartbeatAge = runtime
    ? bfdHeartbeatAge(
        runtime.event_loop_age_ms,
        receivedAt,
        now,
        snapshot?.sample_age_ms ?? 0,
      )
    : Infinity;
  const heartbeatFresh =
    runtime && runtime.worker_ready_after_bind && heartbeatAge <= 2000;
  return (
    <section className="panel bfd-runtime-panel" aria-label="BFD 只读运行态">
      <div className="panel-heading">
        <h2>BFD 只读运行态</h2>
        <span className="muted">约每2秒更新 · 不发送探测</span>
      </div>
      <p>
        本地服务运行与真实对端会话分别核对。没有真实对端时 Down
        不代表服务启动失败；私有观察器仅在受管容器身份核对后读取。
      </p>
      {error && (
        <div role="alert" className="test-error">
          {error}
        </div>
      )}
      {!runtime ? (
        <p role="status">
          {disconnected
            ? "管理服务失联，运行态待确认。"
            : status !== "running"
              ? "服务未运行，实时会话状态不可用。"
              : snapshotExpired && snapshot?.available
                ? "运行态样本已过期，当前会话待重新核对。"
                : snapshot?.reason ||
                  (snapshot ? "实时状态不可用。" : "正在读取真实会话状态…")}
        </p>
      ) : (
        <div className="applied-config">
          <dl>
            <div>
              <dt>本地服务</dt>
              <dd>
                {heartbeatFresh
                  ? "就绪 · 主循环心跳正常"
                  : "主循环就绪 / 心跳或状态时效待确认"}
              </dd>
            </div>
            <div>
              <dt>本地会话</dt>
              <dd>
                {heartbeatFresh
                  ? bfdStateLabels[runtime.local_state] || runtime.local_state
                  : "待确认（心跳异常，不宣称 Up）"}
              </dd>
            </div>
            <div>
              <dt>对端状态 / discriminator</dt>
              <dd>
                {heartbeatFresh
                  ? `${bfdStateLabels[runtime.remote_state] || runtime.remote_state} / ${runtime.remote_discriminator}`
                  : "待确认"}
              </dd>
            </div>
            <div>
              <dt>诊断</dt>
              <dd>
                {runtime.diagnostic} ·{" "}
                {bfdDiagnosticLabels[runtime.diagnostic] || "协议诊断"}
              </dd>
            </div>
            <div>
              <dt>最后有效接收距今</dt>
              <dd>
                {runtime.last_valid_age_ms === null
                  ? "尚未收到有效 Control"
                  : `${runtime.last_valid_age_ms} ms`}
              </dd>
            </div>
            <div>
              <dt>主循环心跳距今（保守估计）</dt>
              <dd>
                {Number.isFinite(heartbeatAge)
                  ? `${Math.ceil(heartbeatAge)} ms`
                  : "待确认"}
              </dd>
            </div>
            <div>
              <dt>协商发送 / 接收检测</dt>
              <dd>
                {runtime.negotiated_tx_us === null
                  ? "周期发送已抑制"
                  : `${runtime.negotiated_tx_us} μs`}{" "}
                / {runtime.receive_detection_us} μs
              </dd>
            </div>
            <div>
              <dt>场景 / 阶段</dt>
              <dd>
                {runtime.scenario.mode} / {runtime.scenario.phase}
              </dd>
            </div>
            <div>
              <dt>场景次数与 Poll</dt>
              <dd>
                窗口 {runtime.scenario.windows_started} · Poll 已发起{" "}
                {runtime.scenario.poll_started ? "是" : "否"} / 已完成{" "}
                {runtime.scenario.poll_completed ? "是" : "否"}
              </dd>
            </div>
            <div>
              <dt>会话 epoch / peer discriminator</dt>
              <dd>
                {runtime.epoch_id} / {runtime.epoch_peer_discriminator}
              </dd>
            </div>
            <div>
              <dt>接收总数 / 有效 / 拒绝</dt>
              <dd>
                {runtime.counters.rx_total} / {runtime.counters.accepted} /{" "}
                {runtime.counters.rejected}
              </dd>
            </div>
            <div>
              <dt>周期发送 / Final / 抑制</dt>
              <dd>
                {runtime.counters.tx_periodic} / {runtime.counters.tx_final} /{" "}
                {runtime.counters.suppressed}
              </dd>
            </div>
          </dl>
          <p className="field-help">
            发送计数只证明成功提交本地
            socket，不替代对端实际收到的证据。接收有效性与故障窗口以真实报文和当前
            epoch 为准。
          </p>
        </div>
      )}
    </section>
  );
}
