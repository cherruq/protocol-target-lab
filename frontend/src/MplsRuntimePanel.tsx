import { guideText } from "./protocol-description.ts";
import { runtimeHeartbeatAge, type RuntimeTarget } from "./runtime-status";
import useRuntimeSnapshot from "./useRuntimeSnapshot";
import { currentMplsRuntime, mplsRuntimeScenario } from "./mpls-runtime";
import { boundedWireSummary } from "./protocol-tests";
export default function MplsRuntimePanel(target: RuntimeTarget) {
  const {
    runtime: r,
    snapshot,
    snapshotExpired,
    receivedAt,
    now,
    error,
  } = useRuntimeSnapshot(target, currentMplsRuntime);
  const age = r
    ? runtimeHeartbeatAge(
        r.event_loop_age_ms,
        receivedAt,
        now,
        snapshot?.sample_age_ms ?? 0,
      )
    : Infinity;
  const fresh =
    r &&
    r.worker_ready_after_bind &&
    r.filter.attached &&
    r.packet_auxdata &&
    age <= 2000;
  return (
    <section className="panel" aria-label="MPLS 只读运行态">
      <div className="panel-heading">
        <h2>{guideText("mpls.runtime.mplsruntimepanel.012")}</h2>
        <span className="muted">{guideText("mpls.runtime.mplsruntimepanel.013")}</span>
      </div>
      <p>{guideText("mpls.runtime.mplsruntimepanel.001")}</p>
      {error && (
        <div className="test-error" role="alert">
          {error}
        </div>
      )}
      {!r ? (
        <p role="status">
          {target.disconnected
            ? guideText("mpls.runtime.mplsruntimepanel.002")
            : target.status !== "running"
              ? guideText("mpls.runtime.mplsruntimepanel.003")
              : snapshotExpired && snapshot?.available
                ? guideText("mpls.runtime.mplsruntimepanel.004")
                : snapshot?.reason ||
                  (snapshot
                    ? guideText("mpls.runtime.mplsruntimepanel.005")
                    : guideText("mpls.runtime.mplsruntimepanel.006"))}
        </p>
      ) : (
        <div className="applied-config">
          <dl>
            <div>
              <dt>本地软件服务</dt>
              <dd>
                {fresh
                  ? "就绪 · 实际接口 / socket / filter / 主循环"
                  : "本地就绪或心跳时效待确认"}
                ；不等于对端收到
              </dd>
            </div>
            <div>
              <dt>{guideText("mpls.runtime.mplsruntimepanel.014")}</dt>
              <dd>
                {Number.isFinite(age) ? Math.ceil(age) + " ms" : "待确认"}
              </dd>
            </div>
            <div>
              <dt>{guideText("mpls.runtime.mplsruntimepanel.015")}</dt>
              <dd>
                {r.interface.name} · ifindex {r.interface.ifindex} ·{" "}
                {r.interface.mac} · MTU {r.interface.mtu}
              </dd>
            </div>
            <div>
              <dt>{guideText("mpls.runtime.mplsruntimepanel.016")}</dt>
              <dd>
                {r.link_mode} / {mplsRuntimeScenario(r.scenario)} · label{" "}
                {r.label}{guideText("mpls.runtime.mplsruntimepanel.017")}{r.reply_ttl}
              </dd>
            </div>
            <div>
              <dt>{guideText("mpls.runtime.mplsruntimepanel.018")}</dt>
              <dd>
                {r.filter.attached ? "已附加" : "未确认"} · {r.filter.name} ·{" "}
                {r.filter.instructions.length}{guideText("mpls.runtime.mplsruntimepanel.019")}</dd>
            </div>
            <div>
              <dt>{guideText("mpls.runtime.mplsruntimepanel.020")}</dt>
              <dd className="applied-body">
                {r.filter.sha256}
                <br />
                {r.filter.packet_socket_inode}
              </dd>
            </div>
            <div>
              <dt>boot / runtime / config SHA</dt>
              <dd className="applied-body">
                {r.boot_id} / {r.runtime_id}
                <br />
                {r.config_sha256}
              </dd>
            </div>
          </dl>
          {mplsRuntimeScenario(r.scenario) === "short-ethernet" && (
            <div className="test-config-notice">{guideText("mpls.runtime.mplsruntimepanel.007")}{" "}
              {r.counters.tx_error}{guideText("mpls.runtime.mplsruntimepanel.008")}</div>
          )}
          <h3>{guideText("mpls.runtime.mplsruntimepanel.021")}</h3>
          <dl>
            <div>
              <dt>{guideText("mpls.runtime.mplsruntimepanel.022")}</dt>
              <dd>
                {r.counters.rx_frames} / {r.counters.accepted} /{" "}
                {r.counters.rejected} / {r.counters.expired}
              </dd>
            </div>
            <div>
              <dt>{guideText("mpls.runtime.mplsruntimepanel.023")}</dt>
              <dd>
                {r.counters.tx_submitted} / {r.counters.suppressed} /{" "}
                {r.counters.tx_error}
              </dd>
            </div>
            <div>
              <dt>忽略 / 日志丢弃</dt>
              <dd>
                {r.counters.ignored} / {r.counters.log_dropped}
              </dd>
            </div>
          </dl>
          <p className="field-help">{guideText("mpls.runtime.mplsruntimepanel.009")}</p>
          {(["last_request", "last_output"] as const).map((key) => (
            <div key={key}>
              <h3>
                {key === "last_request"
                  ? "最近实际请求（当前boot历史）"
                  : "最近输出提交 / 抑制 / TX错误（当前boot历史）"}
              </h3>
              <pre className="protocol-wire">
                {r[key]
                  ? boundedWireSummary(r[key]).text
                  : "尚无实际记录；不从配置或就绪状态伪造帧。"}
              </pre>
            </div>
          ))}
          <p className="field-help">{guideText("mpls.runtime.mplsruntimepanel.010")}</p>
          <details>
            <summary>{guideText("mpls.runtime.mplsruntimepanel.024")}</summary>
            <pre className="protocol-wire">
              {boundedWireSummary({ instructions: r.filter.instructions }).text}
            </pre>
            <p className="field-help">{guideText("mpls.runtime.mplsruntimepanel.011")}</p>
          </details>
        </div>
      )}
    </section>
  );
}
