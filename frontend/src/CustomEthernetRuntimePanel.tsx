import { guideText } from "./protocol-description.ts";
import { runtimeHeartbeatAge, type RuntimeTarget } from "./runtime-status";
import useRuntimeSnapshot from "./useRuntimeSnapshot";
import { currentCustomEthernetRuntime } from "./custom-ethernet-runtime";
import { boundedWireSummary } from "./protocol-tests";
export default function CustomEthernetRuntimePanel(target: RuntimeTarget) {
  const {
    runtime: r,
    snapshot,
    snapshotExpired,
    receivedAt,
    now,
    error,
  } = useRuntimeSnapshot(target, currentCustomEthernetRuntime);
  const age = r
    ? runtimeHeartbeatAge(
        r.event_loop_age_ms,
        receivedAt,
        now,
        snapshot?.sample_age_ms ?? 0,
      )
    : Infinity;
  const readbackMatches =
    !!r &&
    JSON.stringify(r.filter.instructions) ===
      JSON.stringify(r.filter.readback_instructions);
  const fresh =
    r &&
    r.worker_ready_after_bind &&
    r.filter.installed &&
    readbackMatches &&
    age <= 2000;
  return (
    <section className="panel" aria-label="Custom Ethernet 只读运行态">
      <div className="panel-heading">
        <h2>{guideText("custom-ethernet.runtime.customethernetruntimepanel.010")}</h2>
        <span className="muted">{guideText("custom-ethernet.runtime.customethernetruntimepanel.011")}</span>
      </div>
      <p>{guideText("custom-ethernet.runtime.customethernetruntimepanel.001")}</p>
      {error && (
        <div className="test-error" role="alert">
          {error}
        </div>
      )}
      {!r ? (
        <p role="status">
          {target.disconnected
            ? guideText("custom-ethernet.runtime.customethernetruntimepanel.002")
            : target.status !== "running"
              ? guideText("custom-ethernet.runtime.customethernetruntimepanel.003")
              : snapshotExpired && snapshot?.available
                ? guideText("custom-ethernet.runtime.customethernetruntimepanel.004")
                : snapshot?.reason ||
                  (snapshot
                    ? guideText("custom-ethernet.runtime.customethernetruntimepanel.005")
                    : guideText("custom-ethernet.runtime.customethernetruntimepanel.006"))}
        </p>
      ) : (
        <div className="applied-config">
          <dl>
            <div>
              <dt>本地服务</dt>
              <dd>
                {fresh
                  ? "就绪 · 实际接口 / 内核BPF / 主循环"
                  : "本地就绪、程序readback或心跳时效待确认"}
              </dd>
            </div>
            <div>
              <dt>{guideText("custom-ethernet.runtime.customethernetruntimepanel.012")}</dt>
              <dd>
                {Number.isFinite(age) ? `${Math.ceil(age)} ms` : "待确认"}
              </dd>
            </div>
            <div>
              <dt>{guideText("custom-ethernet.runtime.customethernetruntimepanel.013")}</dt>
              <dd>
                {r.interface.name} · ifindex {r.interface.ifindex} ·{" "}
                {r.interface.mac} · MTU {r.interface.mtu}
              </dd>
            </div>
            <div>
              <dt>{guideText("custom-ethernet.runtime.customethernetruntimepanel.014")}</dt>
              <dd>
                {r.link_mode} /{" "}
                {r.response_mode === "frame" ? "完整固定帧" : "构造固定载荷"}
              </dd>
            </div>
            <div>
              <dt>{guideText("custom-ethernet.runtime.customethernetruntimepanel.015")}</dt>
              <dd>
                {r.filter.installed ? "已安装" : "未确认安装"} ·{" "}
                {r.filter.instructions.length} 条 ·{" "}
                {readbackMatches ? "readback指令一致" : "指令不一致"} · socket
                inode {r.filter.packet_socket_inode}
              </dd>
            </div>
            <div>
              <dt>{guideText("custom-ethernet.runtime.customethernetruntimepanel.016")}</dt>
              <dd className="applied-body">{r.filter.sha256}</dd>
            </div>
            <div>
              <dt>{guideText("custom-ethernet.runtime.customethernetruntimepanel.017")}</dt>
              <dd>
                {r.library.version}
                <br />
                <span className="applied-body">{r.library.sha256}</span>
              </dd>
            </div>
            <div>
              <dt>{guideText("custom-ethernet.runtime.customethernetruntimepanel.018")}</dt>
              <dd className="applied-body">
                {r.boot_id} / {r.runtime_id}
              </dd>
            </div>
          </dl>
          <h3>实际计数（采样）</h3>
          <dl>
            <div>
              <dt>{guideText("custom-ethernet.runtime.customethernetruntimepanel.019")}</dt>
              <dd>
                {r.counters.received} / {r.counters.accepted} /{" "}
                {r.counters.tx_actual}
              </dd>
            </div>
            <div>
              <dt>{guideText("custom-ethernet.runtime.customethernetruntimepanel.020")}</dt>
              <dd>
                {r.counters.rejected} / {r.counters.outgoing_ignored} /{" "}
                {r.counters.log_dropped}
              </dd>
            </div>
          </dl>
          <p className="field-help">{guideText("custom-ethernet.runtime.customethernetruntimepanel.007")}</p>
          {(["last_received", "last_sent"] as const).map((key) => (
            <div key={key}>
              <h3>
                {key === "last_received"
                  ? "最近实际接收（当前boot历史）"
                  : "最近实际发送（当前boot历史）"}
              </h3>
              <pre className="protocol-wire">
                {r[key]
                  ? boundedWireSummary(r[key]).text
                  : "尚无真实记录；不会从就绪或旧容器推造收发。"}
              </pre>
              <p className="field-help">{guideText("custom-ethernet.runtime.customethernetruntimepanel.008")}</p>
            </div>
          ))}
          <details>
            <summary>内核程序有限详情</summary>
            <pre className="protocol-wire">
              {
                boundedWireSummary({
                  instructions: r.filter.instructions,
                  readback: r.filter.readback_instructions,
                }).text
              }
            </pre>
            <p className="field-help">{guideText("custom-ethernet.runtime.customethernetruntimepanel.009")}</p>
          </details>
        </div>
      )}
    </section>
  );
}
