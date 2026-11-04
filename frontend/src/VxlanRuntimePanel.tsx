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
        <h2>VXLAN 只读运行态</h2>
        <span className="muted">约每2秒更新 · 不发送 ARP 探测</span>
      </div>
      <p>
        只读核对受管源容器的绑定、主循环与因果计数。VXLAN / UDP
        无会话连接状态，此处不生成隧道 Up 或伪造对端。
      </p>
      {error && (
        <div className="test-error" role="alert">
          {error}
        </div>
      )}
      {!runtime ? (
        <p role="status">
          {target.disconnected
            ? "管理服务失联，运行态待确认。"
            : target.status !== "running"
              ? "服务未运行，实时接收状态不可用。"
              : snapshotExpired && snapshot?.available
                ? "运行态样本已过期，当前状态待重新核对。"
                : snapshot?.reason ||
                  (snapshot ? "实时状态不可用。" : "正在读取真实接收状态…")}
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
              <dt>主循环心跳距今（保守估计）</dt>
              <dd>
                {Number.isFinite(age) ? `${Math.ceil(age)} ms` : "待确认"}
              </dd>
            </div>
            <div>
              <dt>接收 / 固定源端口</dt>
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
              <dt>配置场景 / VNI / inner 大小</dt>
              <dd>
                {vxlanModeLabels[runtime.scenario.mode as VxlanMode] ||
                  runtime.scenario.mode}{" "}
                / {runtime.vni} / {runtime.reply_inner_size} 字节（不含FCS）
              </dd>
            </div>
            <div>
              <dt>最近合法 Request 距今</dt>
              <dd>
                {runtime.last_valid_request_age_ms === null
                  ? "尚未收到合法 Request"
                  : `${runtime.last_valid_request_age_ms} ms（采样时）`}
              </dd>
            </div>
            <div>
              <dt>接收 / 合法 / 拒绝</dt>
              <dd>
                {runtime.counters.received} / {runtime.counters.accepted} /{" "}
                {runtime.counters.rejected}
              </dd>
            </div>
            <div>
              <dt>实际发送 / 正常 Reply / 抑制</dt>
              <dd>
                {runtime.counters.tx_actual} / {runtime.counters.normal_replies}{" "}
                / {runtime.counters.suppressed}
              </dd>
            </div>
            <div>
              <dt>下个请求 / 事件 ID</dt>
              <dd>
                {runtime.next_request_id} / {runtime.next_event_id}
              </dd>
            </div>
            <div>
              <dt>事件淘汰 / 日志丢弃</dt>
              <dd>
                {runtime.cache_evictions} / {runtime.counters.log_dropped}
              </dd>
            </div>
          </dl>
          <p className="field-help">
            实际发送仅代表成功提交本地
            socket；静默须有同一请求的合法接收与抑制记录。完整因果证据、真实接收字节与哈希在客户端报告中核对。
          </p>
        </div>
      )}
    </section>
  );
}
