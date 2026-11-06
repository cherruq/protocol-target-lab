import { guideText, lazyGuidanceLabels } from "./protocol-description.ts";
import { runtimeHeartbeatAge, type RuntimeTarget } from "./runtime-status";
import useRuntimeSnapshot from "./useRuntimeSnapshot";
import {
  currentArpClientRuntime,
  arpPendingRemainingMs,
} from "./arp-client-runtime";
const mappingKinds: Record<string, string> = lazyGuidanceLabels(() => ({
  server_mac_for_target_ip: "ARP 查询IP对应MAC",
  assigned_ip_for_target_mac: "RARP 目标MAC对应实验分配IP",
  server_ip_for_known_mac: "InARP 已知MAC对应协议IP",
}));
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
        <h2>{guideText("arp-client.runtime.arpclientruntimepanel.011")}</h2>
        <span className="muted">{guideText("arp-client.runtime.arpclientruntimepanel.012")}</span>
      </div>
      <p>{guideText("arp-client.runtime.arpclientruntimepanel.001")}</p>
      {error && (
        <div className="test-error" role="alert">
          {error}
        </div>
      )}
      {!runtime ? (
        <p role="status">
          {target.disconnected
            ? guideText("arp-client.runtime.arpclientruntimepanel.002")
            : target.status !== "running"
              ? guideText("arp-client.runtime.arpclientruntimepanel.003")
              : snapshotExpired && snapshot?.available
                ? guideText("arp-client.runtime.arpclientruntimepanel.004")
                : snapshot?.reason ||
                  (snapshot ? guideText("arp-client.runtime.arpclientruntimepanel.005") : guideText("arp-client.runtime.arpclientruntimepanel.006"))}
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
                <dt>{guideText("arp-client.runtime.arpclientruntimepanel.013")}</dt>
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
                <dt>{guideText("arp-client.runtime.arpclientruntimepanel.014")}</dt>
                <dd>
                  {runtime.link_mode} / {runtime.mode} /{" "}
                  {runtime.request_scenario}
                </dd>
              </div>
              <div>
                <dt>{guideText("arp-client.runtime.arpclientruntimepanel.015")}</dt>
                <dd>
                  {runtime.counters.queries_sent} / {runtime.counters.resolved}{" "}
                  / {runtime.counters.timeouts}
                </dd>
              </div>
              <div>
                <dt>{guideText("arp-client.runtime.arpclientruntimepanel.016")}</dt>
                <dd>
                  {runtime.counters.negative_silent} /{" "}
                  {runtime.counters.unexpected_responses}
                </dd>
              </div>
              <div>
                <dt>{guideText("arp-client.runtime.arpclientruntimepanel.017")}</dt>
                <dd>
                  {runtime.counters.observed_frames} /{" "}
                  {runtime.counters.incoming_frames} /{" "}
                  {runtime.counters.rejected_frames}
                </dd>
              </div>
              <div>
                <dt>{guideText("arp-client.runtime.arpclientruntimepanel.018")}</dt>
                <dd>
                  {runtime.counters.ignored_control} /{" "}
                  {runtime.counters.ignored_outgoing} /{" "}
                  {runtime.counters.log_dropped}
                </dd>
              </div>
            </dl>
            <p className="field-help">{guideText("arp-client.runtime.arpclientruntimepanel.007")}</p>
            <h3>{guideText("arp-client.runtime.arpclientruntimepanel.019")}</h3>
            {runtime.pending ? (
              <dl>
                <div>
                  <dt>{guideText("arp-client.runtime.arpclientruntimepanel.020")}</dt>
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
                  <dt>{guideText("arp-client.runtime.arpclientruntimepanel.021")}</dt>
                  <dd>
                    {!fresh
                      ? "状态待确认"
                      : remaining && remaining > 0
                        ? `${Math.ceil(remaining)} ms`
                        : "已到估计期限，等待新样本确认；界面不生成timeout"}
                  </dd>
                </div>
                <div>
                  <dt>{guideText("arp-client.runtime.arpclientruntimepanel.022")}</dt>
                  <dd>{runtime.pending.unexpected_responses}</dd>
                </div>
              </dl>
            ) : (
              <p>{guideText("arp-client.runtime.arpclientruntimepanel.008")}</p>
            )}
            <h3>{guideText("arp-client.runtime.arpclientruntimepanel.023")}</h3>
            {runtime.last_mapping ? (
              <dl>
                <div>
                  <dt>{guideText("arp-client.runtime.arpclientruntimepanel.024")}</dt>
                  <dd>
                    {mappingKinds[runtime.last_mapping.mapping_kind] ||
                      runtime.last_mapping.mapping_kind}{" "}
                    / {runtime.last_mapping.query_id}
                  </dd>
                </div>
                <div>
                  <dt>{guideText("arp-client.runtime.arpclientruntimepanel.025")}</dt>
                  <dd>
                    {runtime.last_mapping.mapping_mac} →{" "}
                    {runtime.last_mapping.mapping_ip}
                  </dd>
                </div>
                <div>
                  <dt>{guideText("arp-client.runtime.arpclientruntimepanel.026")}</dt>
                  <dd>
                    {Number.isFinite(elapsed)
                      ? `${Math.ceil(Math.max(0, runtime.uptime_ms - runtime.last_mapping.received_ms + elapsed))} ms`
                      : "待确认"}{guideText("arp-client.runtime.arpclientruntimepanel.027")}</dd>
                </div>
                <div>
                  <dt>{guideText("arp-client.runtime.arpclientruntimepanel.028")}</dt>
                  <dd className="applied-body">
                    {runtime.last_mapping.response_sha256}
                  </dd>
                </div>
              </dl>
            ) : (
              <p>{guideText("arp-client.runtime.arpclientruntimepanel.009")}</p>
            )}
            <p className="field-help">{guideText("arp-client.runtime.arpclientruntimepanel.010")}</p>
          </div>
        </>
      )}
    </section>
  );
}
