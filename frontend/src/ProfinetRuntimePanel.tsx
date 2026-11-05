import useRuntimeSnapshot from "./useRuntimeSnapshot";
import { runtimeHeartbeatAge, type RuntimeTarget } from "./runtime-status";
import {
  currentProfinetRuntime,
  profinetNativeText,
  profinetAllLocalReady,
  type ProfinetInterface,
} from "./profinet-runtime";
import { boundedWireSummary } from "./protocol-tests";
function interfaceText(i: ProfinetInterface | null) {
  return i
    ? `${i.name} · ifindex ${i.ifindex} / iflink ${i.iflink} · ${i.mac} · MTU ${i.mtu} · ${i.ipv4.length ? i.ipv4.map((a) => a.address + "/" + a.prefixlen).join(", ") : "当前无IPv4"} · ${i.namespace}`
    : "真实接口尚未提供";
}
export default function ProfinetRuntimePanel(target: RuntimeTarget) {
  const {
    runtime: r,
    snapshot,
    receivedAt,
    now,
    snapshotExpired,
    error,
  } = useRuntimeSnapshot(target, currentProfinetRuntime);
  const age = r
    ? runtimeHeartbeatAge(
        r.event_loop_age_ms,
        receivedAt,
        now,
        snapshot?.sample_age_ms ?? 0,
      )
    : Infinity;
  const nativeAge =
    r && typeof r.components.dcp?.tick_age_ms === "number"
      ? runtimeHeartbeatAge(
          r.components.dcp.tick_age_ms,
          receivedAt,
          now,
          snapshot?.sample_age_ms ?? 0,
        )
      : Infinity;
  const ready = r && profinetAllLocalReady(r, age, nativeAge);
  return (
    <section className="panel" aria-label="PROFINET 三节点只读运行态">
      <div className="panel-heading">
        <h2>PROFINET 三节点只读运行态</h2>
        <span className="muted">约每2秒采样 · 不主动发业务包</span>
      </div>
      <p>
        本地三节点就绪不等于PLC连接、硬件同步或DCP系统应用成功。native当前、NV内存、存储文件与实际OS分别观察，源改变或失联时不沿用旧状态。
      </p>
      {error && (
        <div className="test-error" role="alert">
          {error}
        </div>
      )}
      {!r ? (
        <p role="status">
          {target.disconnected
            ? "管理服务失联，真实状态待确认。"
            : target.status !== "running"
              ? "服务未运行，三节点运行态不可用；保留native-store不等于节点仍运行。"
              : snapshotExpired && snapshot?.available
                ? "运行态样本过期，不沿用旧就绪/站名/IP。"
                : snapshot?.reason ||
                  (snapshot
                    ? "运行态来源或schema不匹配，请核对版本。"
                    : "正在读取三个真实节点及native状态…")}
        </p>
      ) : (
        <div className="applied-config">
          <dl>
            <div>
              <dt>本地整组</dt>
              <dd>
                {ready
                  ? "三个节点与主循环实际就绪"
                  : "部分节点、native tick或主循环时效待确认"}
              </dd>
            </div>
            <div>
              <dt>主循环 / native tick年龄（保守估计）</dt>
              <dd>
                {Number.isFinite(age) ? Math.ceil(age) + "ms" : "未知"} /{" "}
                {Number.isFinite(nativeAge)
                  ? Math.ceil(nativeAge) + "ms"
                  : "未知"}
              </dd>
            </div>
            {(["management", "data", "ptcp_n", "ptcp_f"] as const).map((k) => (
              <div key={k}>
                <dt>实际 {k} 接口</dt>
                <dd>{interfaceText(r.interfaces[k])}</dd>
              </div>
            ))}
          </dl>
          <section aria-label="DCP native当前与实际应用">
            <h3>DCP · 原生 p-net 当前与实际应用</h3>
            <dl>
              <div>
                <dt>native子进程 / 版本</dt>
                <dd>
                  {r.components.dcp?.ready ? "ready" : "未确认ready"} · PID{" "}
                  {r.components.dcp?.pid ?? "未知"} / start_ticks{" "}
                  {r.components.dcp?.start_ticks ?? "未知"} ·{" "}
                  {r.components.dcp?.version ?? "未知"}
                </dd>
              </div>
              <div>
                <dt>native当前重复采样值</dt>
                <dd>{profinetNativeText(r.components.dcp?.current)}</dd>
              </div>
              <div>
                <dt>native NV内存</dt>
                <dd>{profinetNativeText(r.components.dcp?.nonvolatile)}</dd>
              </div>
              <div>
                <dt>native样本稳定性</dt>
                <dd>
                  {r.components.dcp?.snapshot_stable === true
                    ? "重复稳定采样（不是与第三方RX线程的事务锁）"
                    : r.components.dcp?.snapshot_stable === false
                      ? "样本尚不稳定"
                      : "未知"}
                </dd>
              </div>
              <div>
                <dt>实际OS应用</dt>
                <dd>
                  {r.network_apply === null
                    ? "尚未观察，不能从ACK或Get值推断"
                    : r.network_apply.confirmed &&
                        r.network_apply.management_unchanged === true
                      ? "实际数据接口已核验，management保持"
                      : `未确认 / 分歧：${r.network_apply.phase}；${r.network_apply.error || "请核对actual IP/routes和callback"}`}
                </dd>
              </div>
            </dl>
            {r.network_apply?.sequence === null && (
              <p className="field-help">
                尚未观察到 native
                应用回调（sequence=null）；当前IP/路由是否匹配以实际OS读回为准，不伪造回调序号。
              </p>
            )}
            <p className="field-help">
              初始化参数仅新store使用。native ACK已返回、native
              Get新值与OS成功是不同证据；临时Set会清对应NV，不能当作Web保存语义。这里不修改hostname或宿主接口。
            </p>
            {r.network_apply && (
              <details open={!!r.network_apply.error}>
                <summary>callback意图与实际IP/routes（只读）</summary>
                <pre className="protocol-wire">
                  {boundedWireSummary(r.network_apply).text}
                </pre>
              </details>
            )}
            <details>
              <summary>native固定身份 / 二进制来源</summary>
              <pre className="protocol-wire">
                {
                  boundedWireSummary({
                    version: r.components.dcp?.version,
                    commit: r.components.dcp?.commit,
                    binary_sha256: r.components.dcp?.native_binary_sha256,
                    factory: r.components.dcp?.factory,
                  }).text
                }
              </pre>
            </details>
          </section>
          <section aria-label="PROFINET native持久存储">
            <h3>native持久存储（与当前/NV内存分开）</h3>
            {r.storage === null ? (
              <p>尚未观察存储状态，不能当作新空store或已保存。</p>
            ) : (
              <>
                <p>
                  writer lock：{r.storage.writer_locked ? "已持有" : "未确认"}；
                  {r.storage.initialized
                    ? "已有初始化存储，启动参数不覆盖它"
                    : "尚未标记初始化"}
                  ；校验：{r.storage.validation}。
                </p>
                <p>
                  NV内存与文件语义：
                  {r.storage.native_nonvolatile_matches_saved === true
                    ? "当前观察一致"
                    : r.storage.native_nonvolatile_matches_saved === false
                      ? "不一致 / 可能保存待完成，不能称永久保存成功"
                      : "未知"}
                  。停止、管理程序重启和普通升级保留store。
                </p>
                {r.storage.error && (
                  <div className="test-error">{r.storage.error}</div>
                )}
                <details>
                  <summary>存储归属、文件校验与保存层次</summary>
                  <pre className="protocol-wire">
                    {boundedWireSummary(r.storage).text}
                  </pre>
                  <p>
                    native-save观察不证明掉电/fsync耐久性；文件存在不等于native当前值，临时文件状态也不能自动清空或重启掩盖。
                  </p>
                </details>
              </>
            )}
          </section>
          {(["ptcp_n", "ptcp_f"] as const).map((k) => {
            const node = r.components[k];
            return (
              <section
                key={k}
                aria-label={
                  k === "ptcp_n" ? "PTCP-N 实际处理" : "PTCP-F 实际处理"
                }
              >
                <h3>
                  {k === "ptcp_n"
                    ? "PTCP-N（Delay FF43）"
                    : "PTCP-F（Delay FF41+FF42）"}
                </h3>
                <p>
                  {node?.ready ? "节点ready" : "节点未确认ready"} ·{" "}
                  {node?.mode ?? "模式未知"} / {node?.scenario ?? "场景未知"} ·
                  pending Sync {node?.pending ?? "未知"}（不是已同步）；packet
                  socket {node?.packet_socket_inode ?? "未知"}
                </p>
                <p>
                  两节点都接纳单步Sync、Sync+FU和Announce，只有真实处理事件，无线上ACK；软件时戳不调整系统时钟，也不证明硬件同步精度。
                </p>
                <pre className="protocol-wire">
                  {node?.counters
                    ? boundedWireSummary(node.counters).text
                    : "计数未提供，不补0"}
                </pre>
                <details>
                  <summary>最近实际请求 / 处理输出（当前boot历史）</summary>
                  <pre className="protocol-wire">
                    {
                      boundedWireSummary({
                        packet_filter: node?.packet_filter,
                        last_request: node?.last_request,
                        last_output: node?.last_output,
                      }).text
                    }
                  </pre>
                </details>
              </section>
            );
          })}
          <section aria-label="PROFINET 软件LED与被动捕获">
            <h3>软件Signal LED与被动捕获</h3>
            <p>
              软件LED：
              {r.signal?.state === true
                ? "亮"
                : r.signal?.state === false
                  ? "灭"
                  : "未知"}{" "}
              · 实际转换 {r.signal?.transitions ?? "未知"}{" "}
              次；不是物理GPIO/LED。DCP
              Signal测试必须真实三次1Hz闪烁，不压缩时钟。
            </p>
            <details>
              <summary>实际软件LED历史 / 被动capture</summary>
              <pre className="protocol-wire">
                {
                  boundedWireSummary({ signal: r.signal, capture: r.capture })
                    .text
                }
              </pre>
              <p>
                被动namespace捕获没有native发包PID归属；进程/FD/不可变二进制证明与实际线上bytes分层。received不自动等于accepted，TX提交不等于peer实收。
              </p>
            </details>
          </section>
          <details>
            <summary>源身份（只读）</summary>
            <pre className="protocol-wire">
              {
                boundedWireSummary({
                  boot_id: r.boot_id,
                  runtime_id: r.runtime_id,
                  config_sha256: r.config_sha256,
                  next_event_id: r.next_event_id,
                  cache_evictions: r.cache_evictions,
                }).text
              }
            </pre>
          </details>
        </div>
      )}
    </section>
  );
}
