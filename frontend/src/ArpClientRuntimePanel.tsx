import { runtimeHeartbeatAge, type RuntimeTarget } from "./runtime-status";
import useRuntimeSnapshot from "./useRuntimeSnapshot";
import {
  currentArpClientRuntime,
  arpPendingRemainingMs,
} from "./arp-client-runtime";
const mappingKinds: Record<string, string> = {
  server_mac_for_target_ip: "ARP 查询IP对应MAC",
  assigned_ip_for_target_mac: "RARP 目标MAC对应实验分配IP",
  server_ip_for_known_mac: "InARP 已知MAC对应协议IP",
};
export default function ArpClientRuntimePanel(target: RuntimeTarget) {
  const { runtime, snapshot, snapshotExpired, receivedAt, now, error } =
    useRuntimeSnapshot(target, currentArpClientRuntime);
  const elapsed = runtimeHeartbeatAge(
      0,
      receivedAt,
      now,
      snapshot?.sample_age_ms ?? 0,
    ),
    age = runtime
      ? runtimeHeartbeatAge(
          runtime.event_loop_age_ms,
          receivedAt,
          now,
          snapshot?.sample_age_ms ?? 0,
        )
      : Infinity;
  const fresh =
      runtime &&
      runtime.worker_ready_after_bind &&
      runtime.filter.attached &&
      age <= 2000,
    remaining = runtime ? arpPendingRemainingMs(runtime, elapsed) : null;
  return (
    <section className="panel" aria-label="ARP-client 只读运行态">
      <div className="panel-heading">
        <h2>ARP-client 只读运行态</h2>
        <span className="muted">约每2秒采样 · 不生成回应</span>
      </div>
      <p>
        目标持续主动请求，无反向对端时重试和超时是正常运行行为。运行不等于已解析；pending与最近历史映射分别记录，不提供连接Up或响应ACK。
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
              ? "服务未运行，主动请求状态不可用。"
              : snapshotExpired && snapshot?.available
                ? "运行态样本已过期，当前请求与历史映射待重新核对。"
                : snapshot?.reason ||
                  (snapshot ? "实时状态不可用。" : "正在读取真实请求端状态…")}
        </p>
      ) : (
        <>
          <div className="applied-config">
            <dl>
              <div>
                <dt>本地服务</dt>
                <dd>
                  {fresh
                    ? "就绪 · 真实接口 / 过滤器 / 主循环"
                    : "本地就绪或心跳时效待确认"}
                </dd>
              </div>
              <div>
                <dt>主循环心跳距今（保守估计）</dt>
                <dd>
                  {Number.isFinite(age) ? `${Math.ceil(age)} ms` : "待确认"}
                </dd>
              </div>
              <div>
                <dt>真实接口</dt>
                <dd>
                  {runtime.interface.name} · ifindex {runtime.interface.ifindex}{" "}
                  · ARPHRD_ETHER · {runtime.interface.mac}
                </dd>
              </div>
              <div>
                <dt>应用链路 / 请求模式 / 场景</dt>
                <dd>
                  {runtime.link_mode} / {runtime.mode} /{" "}
                  {runtime.request_scenario}
                </dd>
              </div>
              <div>
                <dt>实际请求发送 / 映射累计 / 超时</dt>
                <dd>
                  {runtime.counters.queries_sent} / {runtime.counters.resolved}{" "}
                  / {runtime.counters.timeouts}
                </dd>
              </div>
              <div>
                <dt>负向静默 / 负向非预期回应</dt>
                <dd>
                  {runtime.counters.negative_silent} /{" "}
                  {runtime.counters.unexpected_responses}
                </dd>
              </div>
              <div>
                <dt>观察帧 / incoming / 拒绝帧</dt>
                <dd>
                  {runtime.counters.observed_frames} /{" "}
                  {runtime.counters.incoming_frames} /{" "}
                  {runtime.counters.rejected_frames}
                </dd>
              </div>
              <div>
                <dt>忽略控制流量 / OUTGOING / 日志丢弃</dt>
                <dd>
                  {runtime.counters.ignored_control} /{" "}
                  {runtime.counters.ignored_outgoing} /{" "}
                  {runtime.counters.log_dropped}
                </dd>
              </div>
            </dl>
            <p className="field-help">
              negative_silent只在该负向query到期且没有可归属回应时增加，不代表链路一帧都没有；resolved为本boot历史计数，不是当前请求已完成。
            </p>
            <h3>当前 pending 请求（采样）</h3>
            {runtime.pending ? (
              <dl>
                <div>
                  <dt>本地 query_id / 重试索引</dt>
                  <dd>
                    {runtime.pending.query_id} / {runtime.pending.retry_index}
                    （0为首次）
                  </dd>
                </div>
                <div>
                  <dt>预期策略</dt>
                  <dd>
                    {!runtime.pending.expected_response
                      ? "负向：禁止形成映射，包括完整规范回应"
                      : "正向：仅完整匹配当前请求的 incoming 回应可映射"}
                  </dd>
                </div>
                <div>
                  <dt>剩余响应期限（估计）</dt>
                  <dd>
                    {!fresh
                      ? "状态待确认"
                      : remaining && remaining > 0
                        ? `${Math.ceil(remaining)} ms`
                        : "已到估计期限，等待新样本确认；界面不生成timeout"}
                  </dd>
                </div>
                <div>
                  <dt>本query可归属非预期回应</dt>
                  <dd>{runtime.pending.unexpected_responses}</dd>
                </div>
              </dl>
            ) : (
              <p>
                当前样本没有pending，可能处于下一组间隔；不据此宣称映射成功。
              </p>
            )}
            <h3>最近历史映射（当前 boot）</h3>
            {runtime.last_mapping ? (
              <dl>
                <div>
                  <dt>映射种类 / 本地 query_id</dt>
                  <dd>
                    {mappingKinds[runtime.last_mapping.mapping_kind] ||
                      runtime.last_mapping.mapping_kind}{" "}
                    / {runtime.last_mapping.query_id}
                  </dd>
                </div>
                <div>
                  <dt>实际历史 MAC → IP</dt>
                  <dd>
                    {runtime.last_mapping.mapping_mac} →{" "}
                    {runtime.last_mapping.mapping_ip}
                  </dd>
                </div>
                <div>
                  <dt>收到距今（保守估计）</dt>
                  <dd>
                    {Number.isFinite(elapsed)
                      ? `${Math.ceil(Math.max(0, runtime.uptime_ms - runtime.last_mapping.received_ms + elapsed))} ms`
                      : "待确认"}
                    ，不代表当前pending已解析
                  </dd>
                </div>
                <div>
                  <dt>实际响应 SHA256</dt>
                  <dd className="applied-body">
                    {runtime.last_mapping.response_sha256}
                  </dd>
                </div>
              </dl>
            ) : (
              <p>
                当前boot尚无真实历史映射；不会从发送成功、旧容器或超时推造映射。
              </p>
            )}
            <p className="field-help">
              协议没有wire transaction
              ID；query_id仅本地关联。相同元组的迟到相同回应仍可能有歧义。响应后不发ACK，不把padding测试nonce作为协议字段或认证。
            </p>
          </div>
        </>
      )}
    </section>
  );
}
