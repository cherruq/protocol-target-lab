import { guideText } from "./protocol-description.ts";
import { useEffect, useRef, useState } from "react";
import type { DnsConfig } from "./dns-config";
import { acceptedTestWasReplaced } from "./client-tests";

type DnsCheck = {
  name: string;
  passed: boolean;
  error?: string;
  seconds?: number;
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
};
type DnsRun = {
  id: string;
  instance_id: string;
  method: string;
  path: string;
  status: "running" | "passed" | "failed" | "error" | "interrupted";
  started_at: number;
  finished_at: number | null;
  source_container_id: string;
  container_name: string;
  applied_config: DnsConfig;
  report: {
    passed: boolean;
    checks: DnsCheck[];
    seconds?: number;
    error?: string;
    exit_code?: number | null;
  } | null;
  error: string | null;
  cleanup_complete: boolean;
};
type Snapshot = {
  session_id: string;
  cases: string[];
  paths: string[];
  current: DnsRun | null;
};
type Target = {
  id: string;
  enabled: boolean;
  status: string;
  container_id: string | null;
  current_operation: unknown;
  applied_config: DnsConfig | null;
};
const labels = {
  running: "测试运行中",
  passed: "测试通过",
  failed: "测试失败",
  error: "环境错误",
  interrupted: "测试已中断",
};

async function request<T>(endpoint: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(endpoint, {
      signal: controller.signal,
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const raw = await response.text();
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error(`DNS 测试接口返回异常（HTTP ${response.status}）`);
    }
    if (!response.ok)
      throw new Error(
        value?.error?.message || `DNS 测试请求失败（HTTP ${response.status}）`,
      );
    return value as T;
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error("DNS 测试接口请求超时，请检查管理服务后重试。");
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function Wire({
  title,
  value,
}: {
  title: string;
  value?: Record<string, unknown>;
}) {
  const question =
    value?.question && typeof value.question === "object"
      ? (value.question as Record<string, unknown>)
      : null;
  const wire =
    value?.wire && typeof value.wire === "object"
      ? (value.wire as Record<string, unknown>)
      : value;
  const qtype = value?.qtype ?? question?.qtype;
  const typeName = (type: unknown) =>
    ({ "1": "A", "28": "AAAA", "16": "TXT" })[String(type)] || String(type);
  const rcodeName = (code: unknown) =>
    ({
      "0": "NOERROR",
      "1": "FORMERR",
      "2": "SERVFAIL",
      "3": "NXDOMAIN",
      "4": "NOTIMP",
      "5": "REFUSED",
    })[String(code)] || "未知";
  const fields: Array<[string, unknown]> = [
    ["传输", value?.transport],
    ["查询名称", value?.name ?? question?.name],
    [
      "查询类型",
      qtype === undefined ? undefined : `${typeName(qtype)} (${qtype})`,
    ],
    ["事务 ID", value?.transaction_id],
    [
      "DNS RCODE",
      value?.rcode === undefined
        ? undefined
        : `${value.rcode} (${rcodeName(value.rcode)})`,
    ],
    [
      "报文原长度",
      typeof wire?.length === "number"
        ? `${wire.length.toLocaleString()} 字节`
        : undefined,
    ],
    [
      "TCP 帧长度",
      typeof value?.frame_length === "number"
        ? `${value.frame_length.toLocaleString()} 字节（2 字节长度前缀）`
        : undefined,
    ],
  ];
  const answers = Array.isArray(value?.answers)
    ? (value.answers as Array<Record<string, unknown>>)
    : null;
  return (
    <div className="wire-summary">
      <h4>{title}</h4>
      {value ? (
        <>
          <dl>
            {fields
              .filter(([, field]) => field !== undefined && field !== null)
              .map(([label, field]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{String(field)}</dd>
                </div>
              ))}
          </dl>
          {answers && (
            <div className="dns-answers">
              <h4>应答记录（{answers.length}）</h4>
              {answers.length ? (
                <ul>
                  {answers.map((answer, i) => (
                    <li key={i}>
                      <code>
                        {String(answer.name)}{" "}
                        {String(answer.record_type ?? typeName(answer.type_id))}{" "}
                        {String(answer.value)}
                      </code>
                      <span>TTL {String(answer.ttl)} 秒</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{guideText("dns.verification.dnsclienttests.001")}</p>
              )}
            </div>
          )}
          {typeof wire?.hex === "string" && (
            <div className="wire-body">
              <span>
                DNS 报文十六进制预览 · {wire.truncated ? "已截断" : "完整"}
              </span>
              <pre>{wire.hex || "（空字节预览）"}</pre>
              {Boolean(wire.truncated) && (
                <p>{guideText("dns.verification.dnsclienttests.002")}{String(wire.length ?? guideText("dns.verification.dnsclienttests.003"))}{" "}{guideText("dns.verification.dnsclienttests.004")}</p>
              )}
            </div>
          )}
          {typeof wire?.sha256 === "string" && (
            <div className="wire-hash">
              <span>报文 SHA256</span>
              <code>{wire.sha256}</code>
            </div>
          )}
          <details className="wire-headers">
            <summary>完整结构化摘要</summary>
            <pre className="dns-wire">{JSON.stringify(value, null, 2)}</pre>
          </details>
        </>
      ) : (
        <p>{guideText("dns.verification.dnsclienttests.005")}</p>
      )}
    </div>
  );
}

export default function DnsClientTests({
  instance,
  hasUnappliedConfig,
  operationsLocked,
}: {
  instance: Target;
  hasUnappliedConfig: boolean;
  operationsLocked: boolean;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [path, setPath] = useState("ALL");
  const [fetchError, setFetchError] = useState("");
  const [startError, setStartError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [waiting, setWaiting] = useState<string | null>(null);
  const mounted = useRef(false);
  const sequence = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const session = useRef<string | null>(null);
  const acceptedTest = useRef<string | null>(null);
  const active = useRef(false);
  active.current =
    submitting || Boolean(waiting) || snapshot?.current?.status === "running";
  const endpoint = `/api/instances/${encodeURIComponent(instance.id)}/tests`;
  async function refresh(force = false): Promise<void> {
    if (inFlight.current && !force) return inFlight.current;
    const generation = ++sequence.current;
    const task = (async () => {
      try {
        const next = await request<Snapshot>(endpoint);
        if (!mounted.current || generation !== sequence.current) return;
        if (session.current && session.current !== next.session_id) {
          if (active.current)
            setNotice(
              "管理服务已重启，原 DNS 测试结果未保留，请重新执行；中断的临时容器会清理。",
            );
          setWaiting(null);
          setSubmitting(false);
          setStartError("");
          acceptedTest.current = null;
        }
        session.current = next.session_id;
        if (next.current && next.current.instance_id !== instance.id) {
          setSnapshot({ ...next, current: null });
          setFetchError(
            "测试接口返回的结果与当前 DNS 服务不一致，已隐藏该结果。",
          );
          return;
        }
        if (acceptedTestWasReplaced(acceptedTest.current, next.current)) {
          setNotice(
            "请求的 DNS 测试结果已被后续测试替换或不再保留；以下显示当前保留结果，请按需重新执行。",
          );
          acceptedTest.current = null;
          setWaiting(null);
        } else if (
          next.current?.id === acceptedTest.current &&
          next.current.status !== "running"
        ) {
          acceptedTest.current = null;
        }
        setSnapshot(next);
        setFetchError("");
        setPath((current) => (next.paths.includes(current) ? current : "ALL"));
        setWaiting((current) =>
          !next.current || next.current.id === current ? null : current,
        );
      } catch (error) {
        if (mounted.current && generation === sequence.current)
          setFetchError((error as Error).message);
      } finally {
        if (generation === sequence.current) inFlight.current = null;
      }
    })();
    inFlight.current = task;
    return task;
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => {
      mounted.current = false;
      ++sequence.current;
      inFlight.current = null;
      window.clearInterval(timer);
    };
  }, [instance.id]);
  async function start(method: string) {
    setSubmitting(true);
    setWaiting("submitting");
    setStartError("");
    setNotice("");
    acceptedTest.current = null;
    try {
      const accepted = await request<{ test_id: string }>(endpoint, {
        method,
        path,
      });
      if (!mounted.current) return;
      acceptedTest.current = accepted.test_id;
      setWaiting(accepted.test_id);
      await refresh(true);
    } catch (error) {
      if (mounted.current) {
        setStartError((error as Error).message);
        setWaiting(null);
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }
  const current =
    snapshot?.current?.instance_id === instance.id &&
    (!waiting || snapshot.current.id === waiting)
      ? snapshot.current
      : null;
  const running = snapshot?.current?.status === "running";
  const disabled =
    operationsLocked ||
    !snapshot ||
    Boolean(fetchError) ||
    submitting ||
    Boolean(waiting) ||
    running ||
    !instance.enabled ||
    instance.status !== "running" ||
    Boolean(instance.current_operation) ||
    !instance.applied_config;
  const checks = current?.report?.checks || [];
  function download() {
    if (!current) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(current, null, 2) + "\n"], {
        type: "application/json;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${instance.id}-test-${current.id}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section
      className="client-tests"
      aria-labelledby={`dns-tests-${instance.id}`}
    >
      <div className="client-test-heading">
        <div>
          <h3 id={`dns-tests-${instance.id}`}>DNS 内置客户端测试</h3>
          <p>{guideText("dns.verification.dnsclienttests.006")}</p>
        </div>
      </div>
      {hasUnappliedConfig && (
        <div className="test-config-notice">{guideText("dns.verification.dnsclienttests.007")}</div>
      )}
      <div className="test-controls">
        <label htmlFor="dns-test-name">
          {instance.applied_config?.response_profile === "legacy-fixtures" ? "固定场景" : "查询名称"}
          <select
            id="dns-test-name"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            disabled={submitting || running || Boolean(waiting)}
          >
            {(snapshot?.paths || ["ALL"]).map((name) => (
              <option key={name} value={name}>
                {name === "ALL" ? (instance.applied_config?.response_profile === "legacy-fixtures" ? "全部场景" : "全部配置名称") : name}
              </option>
            ))}
          </select>
        </label>
        <div className="test-method-buttons">
          {["UDP", "TCP", "TLS", "ALL"].map((method) => (
            <button
              className={`button ${method === "ALL" ? "primary" : ""}`}
              key={method}
              type="button"
              disabled={disabled || !snapshot?.cases.includes(method)}
              onClick={() => void start(method)}
            >
              {method === "ALL" ? "全部测试" : `${method} 测试`}
            </button>
          ))}
        </div>
      </div>
      {(!instance.enabled || instance.status !== "running") && (
        <p className="test-availability">{guideText("dns.verification.dnsclienttests.008")}</p>
      )}
      {fetchError && (
        <div className="test-error" role="alert">
          无法读取 DNS 测试状态：{fetchError}
          {snapshot?.current && "。以下为最后获取的结果，当前状态待重新核对。"}
        </div>
      )}
      {startError && (
        <div className="test-error" role="alert">
          {startError}
        </div>
      )}
      {notice && (
        <div className="test-config-notice" role="status">
          {notice}
        </div>
      )}
      {(submitting || waiting) && !current && (
        <div className="test-awaiting" role="status">
          {submitting
            ? "正在提交 DNS 客户端测试…"
            : "测试已受理，等待当前结果…"}
        </div>
      )}
      {current ? (
        <div className="test-result" aria-live="polite">
          <div className="test-result-heading">
            <div>
              <span className={`test-status test-status-${current.status}`}>
                {labels[current.status]}
              </span>
              <strong>
                {current.method} ·{" "}
                {current.path === "ALL" ? (current.applied_config.response_profile === "legacy-fixtures" ? "全部场景" : "全部配置名称") : current.path}
              </strong>
              <span className="test-elapsed">
                {current.report?.seconds !== undefined
                  ? `客户端耗时 ${current.report.seconds.toFixed(3)} 秒`
                  : current.finished_at === null
                    ? "正在收集结果"
                    : "测试已结束"}
              </span>
            </div>
            <button
              className="button"
              disabled={current.status === "running"}
              onClick={download}
            >
              下载 JSON 报告
            </button>
          </div>
          <div className="test-snapshot">
            <span>
              测试快照：{current.applied_config.bind_ip}:
              {current.applied_config.port} ·{" "}
              {current.applied_config.records.length} 条记录 ·{" "}
              {[
                current.applied_config.udp_enabled && "UDP",
                current.applied_config.tcp_enabled && "TCP",
                current.applied_config.tls_enabled && `TLS:${current.applied_config.tls_port ?? 1853}`,
              ]
                .filter(Boolean)
                .join(" / ")}
            </span>
            <span>
              被测容器：<code>{current.source_container_id.slice(0, 12)}</code>
            </span>
            {current.report?.exit_code !== undefined && (
              <span>客户端退出码：{current.report.exit_code ?? "未取得"}</span>
            )}
          </div>
          {current.source_container_id !== instance.container_id && (
            <p className="test-config-notice">{guideText("dns.verification.dnsclienttests.009")}</p>
          )}
          <div
            className={`test-cleanup ${current.cleanup_complete ? "complete" : current.status === "running" ? "pending" : "residue"}`}
          >
            {current.cleanup_complete
              ? "客户端容器已清理"
              : current.status === "running"
                ? "客户端容器运行中，尚未清理"
                : `客户端容器未清理，存在残留：${current.container_name}`}
          </div>
          {current.error && (
            <div className="test-error" role="alert">
              客户端执行错误：{current.error}
            </div>
          )}
          {current.report?.error && current.report.error !== current.error && (
            <div className="test-error" role="alert">
              测试报告：{current.report.error}
            </div>
          )}
          {checks.length > 0 ? (
            <>
              <div className="test-counts">
                共 {checks.length} 项 · 通过{" "}
                {checks.filter((c) => c.passed).length} · 失败{" "}
                {checks.filter((c) => !c.passed).length}
              </div>
              <div className="test-check-list">
                {checks.map((check, index) => (
                  <details
                    className={`test-check ${check.passed ? "passed" : "failed"}`}
                    key={`${current.id}-${index}`}
                    open={!check.passed}
                  >
                    <summary>
                      <span className="check-mark">
                        {check.passed ? "✓" : "!"}
                      </span>
                      <span className="test-check-name">{check.name}</span>
                      {check.response?.rcode !== undefined && (
                        <span className="test-check-summary">
                          DNS RCODE {String(check.response.rcode)}
                        </span>
                      )}
                      <span className="test-check-outcome">
                        {check.passed ? "通过" : "失败"}
                      </span>
                    </summary>
                    {check.error && (
                      <p className="test-check-error">{check.error}</p>
                    )}
                    <div className="test-wire-grid">
                      <Wire title="DNS 请求" value={check.request} />
                      <Wire title="DNS 响应" value={check.response} />
                    </div>
                  </details>
                ))}
              </div>
            </>
          ) : (
            <p className="test-empty">
              {current.status === "running"
                ? guideText("dns.verification.dnsclienttests.010")
                : guideText("dns.verification.dnsclienttests.011")}
            </p>
          )}
        </div>
      ) : !submitting && !waiting && !fetchError ? (
        <p className="test-empty">{guideText("dns.verification.dnsclienttests.012")}</p>
      ) : null}
    </section>
  );
}
