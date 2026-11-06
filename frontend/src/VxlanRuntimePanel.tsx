import { guideText } from "./protocol-description.ts";
import { runtimeHeartbeatAge, type RuntimeTarget } from "./runtime-status";
import useRuntimeSnapshot from "./useRuntimeSnapshot";
import { currentVxlanRuntime } from "./vxlan-runtime";
import { vxlanModeLabels, type VxlanMode } from "./vxlan-config";
export default function VxlanRuntimePanel(target: RuntimeTarget) {
  const { runtime, snapshot, snapshotExpired, receivedAt, now, error } =
    useRuntimeSnapshot(target, currentVxlanRuntime);
  const age = runtime
    ? runtimeHeartbeatAge(
        runtime.event_loop_age_ms,
        receivedAt,
        now,
        snapshot?.sample_age_ms ?? 0,
      )
    : Infinity;
  const fresh = runtime && runtime.worker_ready_after_bind && age <= 2000;
  return (
    <section className="panel" aria-label="VXLAN 只读运行态">
      <div className="panel-heading">
        <h2>{guideText("vxlan.runtime.vxlanruntimepanel.008")}</h2>
        <span className="muted">{guideText("vxlan.runtime.vxlanruntimepanel.009")}</span>
      </div>
      <p>{guideText("vxlan.runtime.vxlanruntimepanel.001")}</p>
      {error && (
        <div className="test-error" role="alert">
          {error}
        </div>
      )}
      {!runtime ? (
        <p role="status">
          {target.disconnected
            ? guideText("vxlan.runtime.vxlanruntimepanel.002")
            : target.status !== "running"
              ? guideText("vxlan.runtime.vxlanruntimepanel.003")
              : snapshotExpired && snapshot?.available
                ? guideText("vxlan.runtime.vxlanruntimepanel.004")
                : snapshot?.reason ||
                  (snapshot ? guideText("vxlan.runtime.vxlanruntimepanel.005") : guideText("vxlan.runtime.vxlanruntimepanel.006"))}
        </p>
      ) : (
        <div className="applied-config">
          <dl>
            <div>
              <dt>本地服务</dt>
              <dd>
                {fresh
                  ? "就绪 · 主循环心跳正常"
                  : "心跳或状态时效待确认，不宣称就绪"}
              </dd>
            </div>
            <div>
              <dt>{guideText("vxlan.runtime.vxlanruntimepanel.010")}</dt>
              <dd>
                {Number.isFinite(age) ? `${Math.ceil(age)} ms` : "待确认"}
              </dd>
            </div>
            <div>
              <dt>{guideText("vxlan.runtime.vxlanruntimepanel.011")}</dt>
              <dd>
                {runtime.receiver.bind_ip}:{runtime.receiver.port} /{" "}
                {runtime.receiver.source_port}
              </dd>
            </div>
            <div>
              <dt>固定对端接收入口</dt>
              <dd>
                {runtime.receiver.peer_ip}:{runtime.receiver.peer_port}
              </dd>
            </div>
            <div>
              <dt>{guideText("vxlan.runtime.vxlanruntimepanel.012")}</dt>
              <dd>
                {vxlanModeLabels[runtime.scenario.mode as VxlanMode] ||
                  runtime.scenario.mode}{" "}
                / {runtime.vni} / {runtime.reply_inner_size} 字节（不含FCS）
              </dd>
            </div>
            <div>
              <dt>{guideText("vxlan.runtime.vxlanruntimepanel.013")}</dt>
              <dd>
                {runtime.last_valid_request_age_ms === null
                  ? "尚未收到合法 Request"
                  : `${runtime.last_valid_request_age_ms} ms（采样时）`}
              </dd>
            </div>
            <div>
              <dt>{guideText("vxlan.runtime.vxlanruntimepanel.014")}</dt>
              <dd>
                {runtime.counters.received} / {runtime.counters.accepted} /{" "}
                {runtime.counters.rejected}
              </dd>
            </div>
            <div>
              <dt>{guideText("vxlan.runtime.vxlanruntimepanel.015")}</dt>
              <dd>
                {runtime.counters.tx_actual} / {runtime.counters.normal_replies}{" "}
                / {runtime.counters.suppressed}
              </dd>
            </div>
            <div>
              <dt>{guideText("vxlan.runtime.vxlanruntimepanel.016")}</dt>
              <dd>
                {runtime.next_request_id} / {runtime.next_event_id}
              </dd>
            </div>
            <div>
              <dt>{guideText("vxlan.runtime.vxlanruntimepanel.017")}</dt>
              <dd>
                {runtime.cache_evictions} / {runtime.counters.log_dropped}
              </dd>
            </div>
          </dl>
          <p className="field-help">{guideText("vxlan.runtime.vxlanruntimepanel.007")}</p>
        </div>
      )}
    </section>
  );
}
