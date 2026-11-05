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
        <h2>Custom Ethernet 只读运行态</h2>
        <span className="muted">约每2秒采样 · 不主动发包</span>
      </div>
      <p>
        就绪表示实际接口、内核过滤器和主循环有效；不表示某次请求已匹配或客户端已收到响应。最近收发是当前boot的历史。
      </p>
      {error && (
        <div className="test-error" role="alert">
          {error}
        </div>
      )}
      {!r ? (
        <p role="status">
          {target.disconnected
            ? "管理服务失联，真实运行态待确认。"
            : target.status !== "running"
              ? "服务未运行，自定义以太网状态不可用。"
              : snapshotExpired && snapshot?.available
                ? "运行态样本过期，不能沿用旧就绪或收发状态。"
                : snapshot?.reason ||
                  (snapshot
                    ? "实时状态格式或身份不匹配，请核对管理服务版本。"
                    : "正在读取真实接口与内核过滤状态…")}
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
              <dt>主循环心跳距今（保守估计）</dt>
              <dd>
                {Number.isFinite(age) ? `${Math.ceil(age)} ms` : "待确认"}
              </dd>
            </div>
            <div>
              <dt>实际接口 / MTU</dt>
              <dd>
                {r.interface.name} · ifindex {r.interface.ifindex} ·{" "}
                {r.interface.mac} · MTU {r.interface.mtu}
              </dd>
            </div>
            <div>
              <dt>应用链路 / 响应模式</dt>
              <dd>
                {r.link_mode} /{" "}
                {r.response_mode === "frame" ? "完整固定帧" : "构造固定载荷"}
              </dd>
            </div>
            <div>
              <dt>内核过滤与实际readback</dt>
              <dd>
                {r.filter.installed ? "已安装" : "未确认安装"} ·{" "}
                {r.filter.instructions.length} 条 ·{" "}
                {readbackMatches ? "readback指令一致" : "指令不一致"} · socket
                inode {r.filter.packet_socket_inode}
              </dd>
            </div>
            <div>
              <dt>实际内核程序 SHA256</dt>
              <dd className="applied-body">{r.filter.sha256}</dd>
            </div>
            <div>
              <dt>libpcap运行库</dt>
              <dd>
                {r.library.version}
                <br />
                <span className="applied-body">{r.library.sha256}</span>
              </dd>
            </div>
            <div>
              <dt>boot / runtime身份</dt>
              <dd className="applied-body">
                {r.boot_id} / {r.runtime_id}
              </dd>
            </div>
          </dl>
          <h3>实际计数（采样）</h3>
          <dl>
            <div>
              <dt>socket接收 / 有效匹配 / 实际发送</dt>
              <dd>
                {r.counters.received} / {r.counters.accepted} /{" "}
                {r.counters.tx_actual}
              </dd>
            </div>
            <div>
              <dt>应用拒绝 / 忽略OUTGOING / 日志丢弃</dt>
              <dd>
                {r.counters.rejected} / {r.counters.outgoing_ignored} /{" "}
                {r.counters.log_dropped}
              </dd>
            </div>
          </dl>
          <p className="field-help">
            计数来自worker，不推造kernel-drop：被内核BPF丢弃的帧不进入普通接收计数。rejected为应用检查拒绝，未提供的细分marker计数不推造；send成功不等于peer收到。
          </p>
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
              <p className="field-help">
                有界摘要/预览；原始长度、捕获长度、AUXDATA重构、SHA及截断以实际字段为准，不等于物理线缆原始抓包。
              </p>
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
            <p className="field-help">
              源自身readback与FD身份依据，不冒称外部独立编译oracle。超过显示预算的完整证据由CLI/runtime取得。
            </p>
          </details>
        </div>
      )}
    </section>
  );
}
