import { guideText } from "./protocol-description.ts";
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
        <h2>{guideText("profinet.runtime.profinetruntimepanel.043")}</h2>
        <span className="muted">{guideText("profinet.runtime.profinetruntimepanel.044")}</span>
      </div>
      <p>{guideText("profinet.runtime.profinetruntimepanel.001")}</p>
      {error && (
        <div className="test-error" role="alert">
          {error}
        </div>
      )}
      {!r ? (
        <p role="status">
          {target.disconnected
            ? guideText("profinet.runtime.profinetruntimepanel.002")
            : target.status !== "running"
              ? guideText("profinet.runtime.profinetruntimepanel.003")
              : snapshotExpired && snapshot?.available
                ? guideText("profinet.runtime.profinetruntimepanel.004")
                : snapshot?.reason ||
                  (snapshot
                    ? guideText("profinet.runtime.profinetruntimepanel.005")
                    : guideText("profinet.runtime.profinetruntimepanel.006"))}
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
              <dt>{guideText("profinet.runtime.profinetruntimepanel.045")}</dt>
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
            <h3>{guideText("profinet.runtime.profinetruntimepanel.046")}</h3>
            <dl>
              <div>
                <dt>{guideText("profinet.runtime.profinetruntimepanel.047")}</dt>
                <dd>
                  {r.components.dcp?.ready ? "ready" : "未确认ready"} · PID{" "}
                  {r.components.dcp?.pid ?? "未知"} / start_ticks{" "}
                  {r.components.dcp?.start_ticks ?? "未知"} ·{" "}
                  {r.components.dcp?.version ?? "未知"}
                </dd>
              </div>
              <div>
                <dt>{guideText("profinet.runtime.profinetruntimepanel.048")}</dt>
                <dd>{profinetNativeText(r.components.dcp?.current)}</dd>
              </div>
              <div>
                <dt>{guideText("profinet.runtime.profinetruntimepanel.049")}</dt>
                <dd>{profinetNativeText(r.components.dcp?.nonvolatile)}</dd>
              </div>
              <div>
                <dt>{guideText("profinet.runtime.profinetruntimepanel.050")}</dt>
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
              <p className="field-help">{guideText("profinet.runtime.profinetruntimepanel.007")}</p>
            )}
            <p className="field-help">{guideText("profinet.runtime.profinetruntimepanel.008")}</p>
            {r.network_apply && (
              <details open={!!r.network_apply.error}>
                <summary>{guideText("profinet.runtime.profinetruntimepanel.051")}</summary>
                <pre className="protocol-wire">
                  {boundedWireSummary(r.network_apply).text}
                </pre>
              </details>
            )}
            <details>
              <summary>{guideText("profinet.runtime.profinetruntimepanel.052")}</summary>
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
            <h3>{guideText("profinet.runtime.profinetruntimepanel.053")}</h3>
            {r.storage === null ? (
              <p>{guideText("profinet.runtime.profinetruntimepanel.009")}</p>
            ) : (
              <>
                <p>{guideText("profinet.runtime.profinetruntimepanel.010")}{r.storage.writer_locked ? guideText("profinet.runtime.profinetruntimepanel.011") : guideText("profinet.runtime.profinetruntimepanel.012")}{guideText("profinet.runtime.profinetruntimepanel.013")}{r.storage.initialized
                    ? guideText("profinet.runtime.profinetruntimepanel.014")
                    : guideText("profinet.runtime.profinetruntimepanel.015")}{guideText("profinet.runtime.profinetruntimepanel.016")}{r.storage.validation}{guideText("profinet.runtime.profinetruntimepanel.017")}</p>
                <p>{guideText("profinet.runtime.profinetruntimepanel.018")}{r.storage.native_nonvolatile_matches_saved === true
                    ? guideText("profinet.runtime.profinetruntimepanel.019")
                    : r.storage.native_nonvolatile_matches_saved === false
                      ? guideText("profinet.runtime.profinetruntimepanel.020")
                      : guideText("profinet.runtime.profinetruntimepanel.021")}{guideText("profinet.runtime.profinetruntimepanel.022")}</p>
                {r.storage.error && (
                  <div className="test-error">{r.storage.error}</div>
                )}
                <details>
                  <summary>{guideText("profinet.runtime.profinetruntimepanel.054")}</summary>
                  <pre className="protocol-wire">
                    {boundedWireSummary(r.storage).text}
                  </pre>
                  <p>{guideText("profinet.runtime.profinetruntimepanel.023")}</p>
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
                  {node?.ready ? guideText("profinet.runtime.profinetruntimepanel.024") : guideText("profinet.runtime.profinetruntimepanel.025")}{guideText("profinet.runtime.profinetruntimepanel.026")}{" "}
                  {node?.mode ?? guideText("profinet.runtime.profinetruntimepanel.027")}{guideText("profinet.runtime.profinetruntimepanel.028")}{node?.scenario ?? guideText("profinet.runtime.profinetruntimepanel.029")}{guideText("profinet.runtime.profinetruntimepanel.030")}{node?.pending ?? guideText("profinet.runtime.profinetruntimepanel.031")}{guideText("profinet.runtime.profinetruntimepanel.032")}{node?.packet_socket_inode ?? guideText("profinet.runtime.profinetruntimepanel.033")}
                </p>
                <p>{guideText("profinet.runtime.profinetruntimepanel.034")}</p>
                <pre className="protocol-wire">
                  {node?.counters
                    ? boundedWireSummary(node.counters).text
                    : "计数未提供，不补0"}
                </pre>
                <details>
                  <summary>{guideText("profinet.runtime.profinetruntimepanel.055")}</summary>
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
            <h3>{guideText("profinet.runtime.profinetruntimepanel.056")}</h3>
            <p>{guideText("profinet.runtime.profinetruntimepanel.035")}{r.signal?.state === true
                ? guideText("profinet.runtime.profinetruntimepanel.036")
                : r.signal?.state === false
                  ? guideText("profinet.runtime.profinetruntimepanel.037")
                  : guideText("profinet.runtime.profinetruntimepanel.038")}{" "}{guideText("profinet.runtime.profinetruntimepanel.039")}{r.signal?.transitions ?? guideText("profinet.runtime.profinetruntimepanel.040")}{" "}{guideText("profinet.runtime.profinetruntimepanel.041")}</p>
            <details>
              <summary>{guideText("profinet.runtime.profinetruntimepanel.057")}</summary>
              <pre className="protocol-wire">
                {
                  boundedWireSummary({ signal: r.signal, capture: r.capture })
                    .text
                }
              </pre>
              <p>{guideText("profinet.runtime.profinetruntimepanel.042")}</p>
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
