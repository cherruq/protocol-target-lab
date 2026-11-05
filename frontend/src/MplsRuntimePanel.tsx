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
        <h2>MPLS 只读运行态</h2>
        <span className="muted">约每2秒采样 · 不发测试包</span>
      </div>
      <p>
        本地软件就绪仅表示真实接口 / raw socket / 固定filter /
        主循环有效，不等于peer实收、正常Echo互通或连接Up。最近请求与输出是当前boot历史，TX提交不是协议ACK。
      </p>
      {error && (
        <div className="test-error" role="alert">
          {error}
        </div>
      )}
      {!r ? (
        <p role="status">
          {target.disconnected
            ? "管理服务失联，不能沿用旧就绪状态。"
            : target.status !== "running"
              ? "服务未运行，MPLS软件状态不可用。"
              : snapshotExpired && snapshot?.available
                ? "运行态样本过期，实际状态待确认。"
                : snapshot?.reason ||
                  (snapshot
                    ? "运行态格式或源身份不匹配，请核对版本。"
                    : "正在读取实际接口与源身份…")}
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
              <dt>主循环心跳距今（保守估计）</dt>
              <dd>
                {Number.isFinite(age) ? Math.ceil(age) + " ms" : "待确认"}
              </dd>
            </div>
            <div>
              <dt>真实接口 / MAC / MTU</dt>
              <dd>
                {r.interface.name} · ifindex {r.interface.ifindex} ·{" "}
                {r.interface.mac} · MTU {r.interface.mtu}
              </dd>
            </div>
            <div>
              <dt>当前应用链路 / 场景</dt>
              <dd>
                {r.link_mode} / {mplsRuntimeScenario(r.scenario)} · label{" "}
                {r.label} · 新IPv4回复TTL {r.reply_ttl}
              </dd>
            </div>
            <div>
              <dt>固定内核BPF / AUXDATA</dt>
              <dd>
                {r.filter.attached ? "已附加" : "未确认"} · {r.filter.name} ·{" "}
                {r.filter.instructions.length}条实际程序指令 ·
                AUXDATA已启用，剥离VLAN仍拒绝
              </dd>
            </div>
            <div>
              <dt>实际filter SHA / socket inode</dt>
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
            <div className="test-config-notice">
              当前选择13字节输出。kernel可拒绝该次TX并记录errno；本地服务仍可健康，正向客户端应明确能力不可用/tx_error，不能把无回复当silent成功或补长。当前boot实际TX错误计数{" "}
              {r.counters.tx_error}，历史计数不冒作新请求结果。
            </div>
          )}
          <h3>实际worker计数（当前boot历史）</h3>
          <dl>
            <div>
              <dt>接收 / accepted / rejected / expired</dt>
              <dd>
                {r.counters.rx_frames} / {r.counters.accepted} /{" "}
                {r.counters.rejected} / {r.counters.expired}
              </dd>
            </div>
            <div>
              <dt>TX提交 / suppressed / TX错误</dt>
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
          <p className="field-help">
            应用拒绝与过期来自实际事件；不推造kernel-drop。send成功仅为提交，peer实际incoming帧、长度、SHA与padding须由客户端报告另核。
          </p>
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
          <p className="field-help">
            tx_error记录内的frame仅是本次intended
            bytes与真实errno，不代表已发出；suppressed没有发包。tx_submitted也仅表示本地send提交，实际peer收到的字节另由测试记录证明。
          </p>
          <details>
            <summary>固定内核程序有限详情</summary>
            <pre className="protocol-wire">
              {boundedWireSummary({ instructions: r.filter.instructions }).text}
            </pre>
            <p className="field-help">
              管理器验证实际SO_GET_FILTER与socket身份；不是可编辑BPF。原始长度、有限预览与截断以实际字段为准，软件提交不冒称物理线缆完整抓包。
            </p>
          </details>
        </div>
      )}
    </section>
  );
}
