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
        <h2>IGMP 内核成员只读运行态</h2>
        <span className="muted">约每2秒采样 · 不发Query/Report</span>
      </div>
      <p>
        成员引用保持与实际查询验收分别显示。Report由实际Linux内核发出；本页不创建假peer、不手写Report或ACK，不提供连接Up。
      </p>
      {error && (
        <div className="test-error" role="alert">
          {error}
        </div>
      )}
      {!r ? (
        <p role="status">
          {target.disconnected
            ? "管理服务失联，内核成员状态待确认。"
            : target.status !== "running"
              ? "服务未运行，本工作台成员状态不可用；不据此宣称整个共享宿主已离组。"
              : snapshotExpired && snapshot?.available
                ? "样本过期，不能沿用旧成员就绪或报告证据。"
                : snapshot?.reason ||
                  (snapshot
                    ? "运行态来源或格式不匹配。"
                    : "正在读取真实内核与成员引用…")}
        </p>
      ) : (
        <div className="applied-config">
          <dl>
            <div>
              <dt>本地成员服务</dt>
              <dd>
                {fresh
                  ? "内核成员引用已保持 · 真实接口 / socket / 主循环"
                  : "成员引用或主循环时效待确认"}
                ，不等于本轮Query已验证
              </dd>
            </div>
            <div>
              <dt>主循环心跳距今（保守估计）</dt>
              <dd>
                {Number.isFinite(age) ? `${Math.ceil(age)} ms` : "待确认"}
              </dd>
            </div>
            <div>
              <dt>真实kernel来源 / 版本</dt>
              <dd>
                {r.kernel.origin}
                <br />
                {r.kernel.release}（容器使用宿主内核，不是新guest kernel）
              </dd>
            </div>
            <div>
              <dt>实际network namespace</dt>
              <dd>
                device {r.kernel.network_namespace.device} / inode{" "}
                {r.kernel.network_namespace.inode}
              </dd>
            </div>
            <div>
              <dt>真实接口 / IPv4 / MAC</dt>
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
              <dt>join时 if force / all force</dt>
              <dd>
                {r.parameters.at_join.interface_force} /{" "}
                {r.parameters.at_join.all_force}（已有host接口只读）
              </dd>
            </div>
            <div>
              <dt>sysctl QRV（join / 当前）</dt>
              <dd>
                {r.parameters.sysctl_qrv_at_join} /{" "}
                {r.parameters.current.sysctl_qrv}；不是未导出的实际learned
                mr_qrv
              </dd>
            </div>
            <div>
              <dt>join时QRV保守上界</dt>
              <dd>
                {r.parameters.qrv_upper_bound_at_join} ·{" "}
                {r.parameters.qrv_upper_bound_reason}
              </dd>
            </div>
            <div>
              <dt>v2 / v3 unsolicited间隔（join / 当前）</dt>
              <dd>
                {r.parameters.at_join.v2_unsolicited_interval_ms} /{" "}
                {r.parameters.at_join.v3_unsolicited_interval_ms} ms →{" "}
                {r.parameters.current.v2_unsolicited_interval_ms} /{" "}
                {r.parameters.current.v3_unsolicited_interval_ms} ms
              </dd>
            </div>
            <div>
              <dt>保守startup窗口 / 剩余暖机上界估计</dt>
              <dd>
                {(r.parameters.startup_upper_ms / 1000).toFixed(1)}秒 /{" "}
                {warmup === null ? "待确认" : `${(warmup / 1000).toFixed(1)}秒`}
                ；含每period1000ms和首发2000ms裕度，不是实际定时器测量
              </dd>
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
              <dt>sticky参数变化 / 其他引用</dt>
              <dd>
                {r.parameters.detected_parameter_changes
                  ? "已检测参数改变"
                  : "未检测参数改变"}{" "}
                /{" "}
                {r.membership.other_refs_detected
                  ? "已检测其他或缺失引用"
                  : "未检测其他引用"}
                ；不自动重join清标记
              </dd>
            </div>
            <div>
              <dt>持有成员socket / AF_PACKET socket</dt>
              <dd>
                inode {r.membership.udp_socket_inode} / {r.packet_socket_inode}
                。成员UDP的私有临时端口只用于归属证明，不是应用服务入口。
              </dd>
            </div>
          </dl>
          {r.link_mode === "owned-vxlan" && (
            <section aria-label="IGMP专属VXLAN实际归属">
              <h3>专属kernel VXLAN归属</h3>
              {owned ? (
                <>
                  <dl>
                    <div>
                      <dt>root helper实际核验</dt>
                      <dd>
                        ready / matches_requested · receipt阶段 {owned.phase} ·
                        与成员进程实际接口一致
                      </dd>
                    </div>
                    <div>
                      <dt>
                        owner UUID / 设备原子标记ID（IFLA_GROUP，非组播组）
                      </dt>
                      <dd>
                        {owned.ownerId} / {owned.atomicGroup}
                      </dd>
                    </div>
                    <div>
                      <dt>实际接口 / ifindex / IPv4 / MAC</dt>
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
                      <dt>link-only SHA256（不含成员groups）</dt>
                      <dd className="applied-body">{owned.linkSha256}</dd>
                    </div>
                  </dl>
                  <p className="field-help">
                    创建时使用IFLA_GROUP归属标记及MAC/MTU/core，alias在可信marked
                    DOWN阶段补写并回读。接管/删除需receipt、实际属性与namespace一致，仅管理本工作台新设备。
                  </p>
                </>
              ) : (
                <p className="test-error">
                  专属helper归属尚未核对或与当前成员接口不一致；不会把任意receipt对象当作已验证资源。原生kernel成员观察独立展示。
                </p>
              )}
            </section>
          )}
          <h3>当前boot持有组引用（采样）</h3>
          <dl>
            {r.membership.groups.map((g) => (
              <div key={g.group}>
                <dt>{g.group}</dt>
                <dd>
                  join年龄样本 {(g.joined_age_ms / 1000).toFixed(1)}秒 · kernel
                  refs {g.current_kernel_refs} · join前其他refs{" "}
                  {g.preexisting_other_refs} · 当前其他refs {g.other_refs}
                </dd>
              </div>
            ))}
          </dl>
          <p className="field-help">
            停止仅释放本工作台IP_DROP_MEMBERSHIP/FD引用；host其他应用仍可能持有该组，不能宣称整个主机已离组。
          </p>
          {warmup !== null && (
            <p className="field-help">
              按当前暖机保守估计：单案例2轮预算上界
              {((warmup + 34000) / 1000).toFixed(1)}秒，ALL上界
              {((warmup + 58000) / 1000).toFixed(1)}
              秒；90秒client上限由服务端发起前再次核对，不缩短MRT或重新join。
            </p>
          )}
          <h3>实际捕获累计（含启动/外部查询，不是当前test通过数）</h3>
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
              <dt>其他incoming Report / 忽略 / 捕获拒绝 / 日志丢弃</dt>
              <dd>
                {r.counters.reports_in} / {r.counters.ignored} /{" "}
                {r.counters.rejected_capture} / {r.counters.log_dropped}
              </dd>
            </div>
          </dl>
          <h3>最近实际incoming Query（当前boot历史）</h3>
          <pre className="protocol-wire">
            {r.last_query
              ? boundedWireSummary(r.last_query).text
              : "尚无实际Query记录，不从成员ready推造请求。"}
          </pre>
          <h3>最近内核Report（当前boot历史）</h3>
          <p>{igmpNativeReportDescription(r.last_report)}</p>
          <pre className="protocol-wire">
            {r.last_report
              ? boundedWireSummary(r.last_report).text
              : "尚无实际Report记录。"}
          </pre>
          <p className="field-help">
            近期历史不自动归因于某次测试：启动报告、外部Query、报告抑制可能影响关联。最终测试需源Query/cursor/native
            Report与peer实际收包证据；没有wire事务ID或单播ACK。原长、SHA、截断和实际版本以记录为准。
          </p>
        </div>
      )}
    </section>
  );
}
