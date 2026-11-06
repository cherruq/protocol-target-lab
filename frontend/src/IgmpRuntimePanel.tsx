import { guideText } from "./protocol-description.ts";
import { runtimeHeartbeatAge, type RuntimeTarget } from "./runtime-status";
import useRuntimeSnapshot from "./useRuntimeSnapshot";
import {
  currentIgmpRuntime,
  currentIgmpOwnedLink,
  igmpForceDescription,
  igmpNativeReportDescription,
} from "./igmp-runtime";
import { sampledRemainingMs } from "./igmp-progress";
import { boundedWireSummary } from "./protocol-tests";
export default function IgmpRuntimePanel(target: RuntimeTarget) {
  const {
    runtime: r,
    snapshot,
    snapshotExpired,
    receivedAt,
    now,
    error,
  } = useRuntimeSnapshot(target, currentIgmpRuntime);
  const elapsed = runtimeHeartbeatAge(
      0,
      receivedAt,
      now,
      snapshot?.sample_age_ms ?? 0,
    ),
    age = r
      ? runtimeHeartbeatAge(
          r.event_loop_age_ms,
          receivedAt,
          now,
          snapshot?.sample_age_ms ?? 0,
        )
      : Infinity;
  const owned = r ? currentIgmpOwnedLink(r) : null;
  const fresh =
    r &&
    r.worker_ready_after_bind &&
    (r.link_mode !== "owned-vxlan" || Boolean(owned)) &&
    r.membership.groups.every((g) => g.current_kernel_refs >= 1) &&
    age <= 2000;
  const warmup = r
    ? sampledRemainingMs(r.testability.remaining_warmup_upper_ms, elapsed)
    : null;
  return (
    <section className="panel" aria-label="IGMP 内核成员只读运行态">
      <div className="panel-heading">
        <h2>{guideText("igmp.runtime.igmpruntimepanel.014")}</h2>
        <span className="muted">{guideText("igmp.runtime.igmpruntimepanel.015")}</span>
      </div>
      <p>{guideText("igmp.runtime.igmpruntimepanel.001")}</p>
      {error && (
        <div className="test-error" role="alert">
          {error}
        </div>
      )}
      {!r ? (
        <p role="status">
          {target.disconnected
            ? guideText("igmp.runtime.igmpruntimepanel.002")
            : target.status !== "running"
              ? guideText("igmp.runtime.igmpruntimepanel.003")
              : snapshotExpired && snapshot?.available
                ? guideText("igmp.runtime.igmpruntimepanel.004")
                : snapshot?.reason ||
                  (snapshot
                    ? guideText("igmp.runtime.igmpruntimepanel.005")
                    : guideText("igmp.runtime.igmpruntimepanel.006"))}
        </p>
      ) : (
        <div className="applied-config">
          <dl>
            <div>
              <dt>本地成员服务</dt>
              <dd>
                {fresh
                  ? "内核成员引用已保持 · 真实接口 / socket / 主循环"
                  : "成员引用或主循环时效待确认"}{guideText("igmp.runtime.igmpruntimepanel.016")}</dd>
            </div>
            <div>
              <dt>{guideText("igmp.runtime.igmpruntimepanel.017")}</dt>
              <dd>
                {Number.isFinite(age) ? `${Math.ceil(age)} ms` : "待确认"}
              </dd>
            </div>
            <div>
              <dt>{guideText("igmp.runtime.igmpruntimepanel.018")}</dt>
              <dd>
                {r.kernel.origin}
                <br />
                {r.kernel.release}{guideText("igmp.runtime.igmpruntimepanel.019")}</dd>
            </div>
            <div>
              <dt>{guideText("igmp.runtime.igmpruntimepanel.020")}</dt>
              <dd>
                device {r.kernel.network_namespace.device} / inode{" "}
                {r.kernel.network_namespace.inode}
              </dd>
            </div>
            <div>
              <dt>{guideText("igmp.runtime.igmpruntimepanel.021")}</dt>
              <dd>
                {r.interface.name} · ifindex {r.interface.ifindex} ·{" "}
                {r.interface.primary_ipv4}/{r.interface.prefixlen}
                <br />
                {r.interface.mac} · MTU {r.interface.mtu}
              </dd>
            </div>
            <div>
              <dt>actual interface force / all force</dt>
              <dd>
                接口{" "}
                {igmpForceDescription(r.parameters.current.interface_force)}
                <br />
                all {igmpForceDescription(r.parameters.current.all_force)}
              </dd>
            </div>
            <div>
              <dt>{guideText("igmp.runtime.igmpruntimepanel.022")}</dt>
              <dd>
                {r.parameters.at_join.interface_force} /{" "}
                {r.parameters.at_join.all_force}{guideText("igmp.runtime.igmpruntimepanel.023")}</dd>
            </div>
            <div>
              <dt>{guideText("igmp.runtime.igmpruntimepanel.024")}</dt>
              <dd>
                {r.parameters.sysctl_qrv_at_join} /{" "}
                {r.parameters.current.sysctl_qrv}{guideText("igmp.runtime.igmpruntimepanel.025")}</dd>
            </div>
            <div>
              <dt>{guideText("igmp.runtime.igmpruntimepanel.026")}</dt>
              <dd>
                {r.parameters.qrv_upper_bound_at_join} ·{" "}
                {r.parameters.qrv_upper_bound_reason}
              </dd>
            </div>
            <div>
              <dt>{guideText("igmp.runtime.igmpruntimepanel.027")}</dt>
              <dd>
                {r.parameters.at_join.v2_unsolicited_interval_ms} /{" "}
                {r.parameters.at_join.v3_unsolicited_interval_ms} ms →{" "}
                {r.parameters.current.v2_unsolicited_interval_ms} /{" "}
                {r.parameters.current.v3_unsolicited_interval_ms} ms
              </dd>
            </div>
            <div>
              <dt>{guideText("igmp.runtime.igmpruntimepanel.028")}</dt>
              <dd>
                {(r.parameters.startup_upper_ms / 1000).toFixed(1)}秒 /{" "}
                {warmup === null ? "待确认" : `${(warmup / 1000).toFixed(1)}秒`}{guideText("igmp.runtime.igmpruntimepanel.029")}</dd>
            </div>
            <div>
              <dt>查询因果前置条件</dt>
              <dd>
                {r.testability.available
                  ? "当前引用/参数前置可用，实际测试仍需预算与链路预检"
                  : `不可用于查询验收：${r.testability.reason || "来源、引用或参数条件不满足"}`}
                ；成员服务可仍健康
              </dd>
            </div>
            <div>
              <dt>{guideText("igmp.runtime.igmpruntimepanel.030")}</dt>
              <dd>
                {r.parameters.detected_parameter_changes
                  ? "已检测参数改变"
                  : "未检测参数改变"}{" "}
                /{" "}
                {r.membership.other_refs_detected
                  ? "已检测其他或缺失引用"
                  : "未检测其他引用"}{guideText("igmp.runtime.igmpruntimepanel.031")}</dd>
            </div>
            <div>
              <dt>{guideText("igmp.runtime.igmpruntimepanel.032")}</dt>
              <dd>
                inode {r.membership.udp_socket_inode} / {r.packet_socket_inode}{guideText("igmp.runtime.igmpruntimepanel.033")}</dd>
            </div>
          </dl>
          {r.link_mode === "owned-vxlan" && (
            <section aria-label="IGMP专属VXLAN实际归属">
              <h3>{guideText("igmp.runtime.igmpruntimepanel.034")}</h3>
              {owned ? (
                <>
                  <dl>
                    <div>
                      <dt>{guideText("igmp.runtime.igmpruntimepanel.035")}</dt>
                      <dd>{guideText("igmp.runtime.igmpruntimepanel.036")}{owned.phase}{guideText("igmp.runtime.igmpruntimepanel.037")}</dd>
                    </div>
                    <div>
                      <dt>{guideText("igmp.runtime.igmpruntimepanel.038")}</dt>
                      <dd>
                        {owned.ownerId} / {owned.atomicGroup}
                      </dd>
                    </div>
                    <div>
                      <dt>{guideText("igmp.runtime.igmpruntimepanel.039")}</dt>
                      <dd>
                        {owned.name} / {owned.ifindex} / {owned.primaryIpv4}/
                        {owned.prefixlen} / {owned.mac} · MTU {owned.mtu}
                      </dd>
                    </div>
                    <div>
                      <dt>实际alias</dt>
                      <dd className="applied-body">{owned.alias}</dd>
                    </div>
                    <div>
                      <dt>{guideText("igmp.runtime.igmpruntimepanel.040")}</dt>
                      <dd className="applied-body">{owned.linkSha256}</dd>
                    </div>
                  </dl>
                  <p className="field-help">{guideText("igmp.runtime.igmpruntimepanel.007")}</p>
                </>
              ) : (
                <p className="test-error">{guideText("igmp.runtime.igmpruntimepanel.008")}</p>
              )}
            </section>
          )}
          <h3>{guideText("igmp.runtime.igmpruntimepanel.041")}</h3>
          <dl>
            {r.membership.groups.map((g) => (
              <div key={g.group}>
                <dt>{g.group}</dt>
                <dd>
                  join年龄样本 {(g.joined_age_ms / 1000).toFixed(1)}{guideText("igmp.runtime.igmpruntimepanel.042")}{g.current_kernel_refs}{guideText("igmp.runtime.igmpruntimepanel.043")}{" "}
                  {g.preexisting_other_refs}{guideText("igmp.runtime.igmpruntimepanel.044")}{g.other_refs}
                </dd>
              </div>
            ))}
          </dl>
          <p className="field-help">{guideText("igmp.runtime.igmpruntimepanel.009")}</p>
          {warmup !== null && (
            <p className="field-help">{guideText("igmp.runtime.igmpruntimepanel.010")}{((warmup + 34000) / 1000).toFixed(1)}{guideText("igmp.runtime.igmpruntimepanel.011")}{((warmup + 58000) / 1000).toFixed(1)}{guideText("igmp.runtime.igmpruntimepanel.012")}</p>
          )}
          <h3>{guideText("igmp.runtime.igmpruntimepanel.045")}</h3>
          <dl>
            <div>
              <dt>incoming Query / native Report outgoing</dt>
              <dd>
                {r.counters.queries_in} / {r.counters.reports_out}
              </dd>
            </div>
            <div>
              <dt>native v1 / v2 / v3 outgoing</dt>
              <dd>
                {r.counters.reports_v1_out} / {r.counters.reports_v2_out} /{" "}
                {r.counters.reports_v3_out}
              </dd>
            </div>
            <div>
              <dt>{guideText("igmp.runtime.igmpruntimepanel.046")}</dt>
              <dd>
                {r.counters.reports_in} / {r.counters.ignored} /{" "}
                {r.counters.rejected_capture} / {r.counters.log_dropped}
              </dd>
            </div>
          </dl>
          <h3>{guideText("igmp.runtime.igmpruntimepanel.047")}</h3>
          <pre className="protocol-wire">
            {r.last_query
              ? boundedWireSummary(r.last_query).text
              : "尚无实际Query记录，不从成员ready推造请求。"}
          </pre>
          <h3>{guideText("igmp.runtime.igmpruntimepanel.048")}</h3>
          <p>{igmpNativeReportDescription(r.last_report)}</p>
          <pre className="protocol-wire">
            {r.last_report
              ? boundedWireSummary(r.last_report).text
              : "尚无实际Report记录。"}
          </pre>
          <p className="field-help">{guideText("igmp.runtime.igmpruntimepanel.013")}</p>
        </div>
      )}
    </section>
  );
}
