import { guideText } from "./protocol-description.ts";
import useRuntimeSnapshot from "./useRuntimeSnapshot";
import {
  bfdDiagnosticLabels,
  bfdHeartbeatAge,
  bfdStateLabels,
  currentBfdRuntime,
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
  const { runtime, snapshot, snapshotExpired, receivedAt, now, error } =
    useRuntimeSnapshot(
      { id, containerId, status, disconnected },
      currentBfdRuntime,
    );
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
        <span className="muted">{guideText("bfd.runtime.bfdruntimepanel.008")}</span>
      </div>
      <p>{guideText("bfd.runtime.bfdruntimepanel.001")}</p>
      {error && (
        <div role="alert" className="test-error">
          {error}
        </div>
      )}
      {!runtime ? (
        <p role="status">
          {disconnected
            ? guideText("bfd.runtime.bfdruntimepanel.002")
            : status !== "running"
              ? guideText("bfd.runtime.bfdruntimepanel.003")
              : snapshotExpired && snapshot?.available
                ? guideText("bfd.runtime.bfdruntimepanel.004")
                : snapshot?.reason ||
                  (snapshot ? guideText("bfd.runtime.bfdruntimepanel.005") : guideText("bfd.runtime.bfdruntimepanel.006"))}
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
              <dt>{guideText("bfd.runtime.bfdruntimepanel.009")}</dt>
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
              <dt>{guideText("bfd.runtime.bfdruntimepanel.010")}</dt>
              <dd>
                {Number.isFinite(heartbeatAge)
                  ? `${Math.ceil(heartbeatAge)} ms`
                  : "待确认"}
              </dd>
            </div>
            <div>
              <dt>{guideText("bfd.runtime.bfdruntimepanel.011")}</dt>
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
              <dt>{guideText("bfd.runtime.bfdruntimepanel.012")}</dt>
              <dd>
                窗口 {runtime.scenario.windows_started}{guideText("bfd.runtime.bfdruntimepanel.013")}{" "}
                {runtime.scenario.poll_started ? "是" : "否"} / 已完成{" "}
                {runtime.scenario.poll_completed ? "是" : "否"}
              </dd>
            </div>
            <div>
              <dt>{guideText("bfd.runtime.bfdruntimepanel.014")}</dt>
              <dd>
                {runtime.epoch_id} / {runtime.epoch_peer_discriminator}
              </dd>
            </div>
            <div>
              <dt>{guideText("bfd.runtime.bfdruntimepanel.015")}</dt>
              <dd>
                {runtime.counters.rx_total} / {runtime.counters.accepted} /{" "}
                {runtime.counters.rejected}
              </dd>
            </div>
            <div>
              <dt>{guideText("bfd.runtime.bfdruntimepanel.016")}</dt>
              <dd>
                {runtime.counters.tx_periodic} / {runtime.counters.tx_final} /{" "}
                {runtime.counters.suppressed}
              </dd>
            </div>
          </dl>
          <p className="field-help">{guideText("bfd.runtime.bfdruntimepanel.007")}</p>
        </div>
      )}
    </section>
  );
}
