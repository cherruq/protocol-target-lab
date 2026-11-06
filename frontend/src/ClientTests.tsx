import { useEffect, useRef, useState } from "react";
import { isLegacyConfig, type StoredConfig } from "./config";
import {
  resultCounts,
  testMethods,
  httpMethodsForPath,
  httpResponseStatus,
  testPaths,
  testDurationLabel,
  visibleTestRun,
  acceptedTestWasReplaced,
  type TestMethod,
  type TestPath,
  type TestRun,
  type TestSnapshot,
  type WireMessage,
} from "./client-tests";

type Target = {
  id: string;
  status: string;
  enabled: boolean;
  current_operation: unknown;
  container_id: string | null;
  applied_config: StoredConfig | null;
};
const statuses: Record<TestRun["status"], string> = {
  running: "测试运行中",
  passed: "测试通过",
  failed: "测试失败",
  error: "环境错误",
  interrupted: "测试已中断",
};

async function testApi<T>(path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(
      path,
      body === undefined
        ? { signal: controller.signal }
        : {
            signal: controller.signal,
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
    );
    const text = await response.text();
    let value;
    try {
      value = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`测试接口返回异常（HTTP ${response.status}）`);
    }
    if (!response.ok)
      throw new Error(
        value?.error?.message || `测试请求失败（HTTP ${response.status}）`,
      );
    return value as T;
  } catch (cause) {
    if (controller.signal.aborted)
      throw new Error("客户端测试接口请求超时，请检查管理服务后重试。");
    throw cause;
  } finally {
    window.clearTimeout(timer);
  }
}

function configDescription(config: StoredConfig): string {
  const mode = isLegacyConfig(config)
    ? `旧版固定正文 ${new TextEncoder().encode(config.response_body).length} 字节`
    : `${config.response_length.toLocaleString()} 字节 · ${config.response_mode === "fixed" ? "固定内容" : "每次随机"}`;
  return `${config.tls_enabled ? "HTTPS" : "HTTP"} · ${config.bind_ip}:${config.port} · ${mode}`;
}

function WireSummary({
  title,
  message,
}: {
  title: string;
  message?: WireMessage;
}) {
  const bytes = message?.wire ?? message;
  return (
    <div className="wire-summary">
      <h4>{title}</h4>
      {message ? (
        <>
          <dl>
            {message.method && (
              <div>
                <dt>方法</dt>
                <dd>{message.method}</dd>
              </div>
            )}
            {message.path && (
              <div>
                <dt>路径</dt>
                <dd>{message.path}</dd>
              </div>
            )}
            {message.status !== undefined && (
              <div>
                <dt>HTTP 状态</dt>
                <dd>
                  {httpResponseStatus(message)}
                </dd>
              </div>
            )}
            {bytes?.body_length !== undefined && (
              <div>
                <dt>{message.wire ? "原始报文原长度" : "正文原长度"}</dt>
                <dd>{bytes?.body_length.toLocaleString()} 字节</dd>
              </div>
            )}
            {message.tls?.version && <div><dt>TLS</dt><dd>{message.tls.version} · {message.tls.cipher}</dd></div>}
            {message.tls?.verified_server_name && <div><dt>已校验证书名称</dt><dd>{message.tls.verified_server_name}</dd></div>}
          </dl>
          {message.headers && (
            <details className="wire-headers">
              <summary>
                HTTP 头
                {message.headers_truncated
                  ? ` · 摘要已截断（原长度 ${message.headers_original_length?.toLocaleString() ?? "未知"}）`
                  : message.headers_original_length !== undefined
                    ? ` · 原长度 ${message.headers_original_length.toLocaleString()}`
                    : ""}
              </summary>
              <pre>
                {Object.entries(message.headers)
                  .map(
                    ([key, value]) =>
                      `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`,
                  )
                  .join("\n") || "（无）"}
              </pre>
            </details>
          )}
          {bytes?.body_preview_hex !== undefined && (
            <div className="wire-body">
              <span>
                {message.wire ? "原始报文" : "正文"}十六进制预览
                {bytes?.body_truncated ? " · 已截断" : " · 完整"}
              </span>
              <pre>{bytes?.body_preview_hex || "（空字节预览）"}</pre>
              {bytes?.body_truncated && (
                <p>
                  仅显示部分字节；正文原长度为{" "}
                  {bytes?.body_length?.toLocaleString() ?? "未知"} 字节。
                </p>
              )}
            </div>
          )}
          {bytes?.body_sha256 && (
            <div className="wire-hash">
              <span>{message.wire ? "原始报文" : "正文"} SHA256</span>
              <code>{bytes?.body_sha256}</code>
            </div>
          )}
          {message.expected_wire_sha256 && (
            <div className="wire-hash"><span>预设原始报文 SHA256</span><code>{message.expected_wire_sha256}</code></div>
          )}
        </>
      ) : (
        <p>本项未提供此方向的收发摘要。</p>
      )}
    </div>
  );
}

export default function ClientTests({
  instance,
  hasUnappliedConfig,
  operationsLocked,
}: {
  instance: Target;
  hasUnappliedConfig: boolean;
  operationsLocked: boolean;
}) {
  const [path, setPath] = useState<TestPath>("/ok");
  const [snapshot, setSnapshot] = useState<TestSnapshot | null>(null);
  const [fetchError, setFetchError] = useState("");
  const [startError, setStartError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [waitingId, setWaitingId] = useState<string | null>(null);
  const [sessionNotice, setSessionNotice] = useState("");
  const mounted = useRef(false);
  const fetchSequence = useRef(0);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const session = useRef<string | null>(null);
  const acceptedTest = useRef<string | null>(null);
  const hadActiveTest = useRef(false);
  hadActiveTest.current =
    submitting || Boolean(waitingId) || snapshot?.current?.status === "running";
  const endpoint = `/api/instances/${encodeURIComponent(instance.id)}/tests`;

  async function refresh(force = false): Promise<void> {
    if (refreshInFlight.current && !force) return refreshInFlight.current;
    const request = ++fetchSequence.current;
    const task = (async () => {
      try {
        const next = await testApi<TestSnapshot>(endpoint);
        if (!mounted.current || request !== fetchSequence.current) return;
        const restarted = Boolean(
          session.current &&
            next.session_id &&
            session.current !== next.session_id,
        );
        if (restarted) {
          if (hadActiveTest.current)
            setSessionNotice(
              "管理服务已重启，原测试结果未保留，请重新执行；中断的临时容器会清理。",
            );
          setWaitingId(null);
          setSubmitting(false);
          setStartError("");
          acceptedTest.current = null;
        }
        session.current = next.session_id || null;
        if (next.current && next.current.instance_id !== instance.id) {
          setSnapshot({ ...next, current: null });
          setFetchError(
            "测试接口返回的结果与当前 HTTP 服务不一致，已隐藏该结果。",
          );
          return;
        }
        // Only POST acceptance arms this check. The immediate force refresh
        // invalidates every GET that began before the accepted ID was known.
        if (acceptedTestWasReplaced(acceptedTest.current, next.current)) {
          setSessionNotice(
            "请求的测试结果已被后续测试替换或不再保留；以下显示当前保留结果，请按需重新执行。",
          );
          acceptedTest.current = null;
          setWaitingId(null);
        } else if (
          next.current?.id === acceptedTest.current &&
          next.current.status !== "running"
        ) {
          acceptedTest.current = null;
        }
        setSnapshot(next);
        setFetchError("");
        setWaitingId((current) =>
          !next.current || next.current.id === current ? null : current,
        );
      } catch (cause) {
        if (mounted.current && request === fetchSequence.current)
          setFetchError((cause as Error).message);
      } finally {
        if (request === fetchSequence.current) refreshInFlight.current = null;
      }
    })();
    refreshInFlight.current = task;
    return task;
  }

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 2000);
    return () => {
      mounted.current = false;
      fetchSequence.current += 1;
      refreshInFlight.current = null;
      window.clearInterval(timer);
    };
  }, [instance.id]);

  async function start(method: TestMethod) {
    setSubmitting(true);
    setStartError("");
    setSessionNotice("");
    setWaitingId("submitting");
    acceptedTest.current = null;
    try {
      const result = await testApi<{ test_id: string }>(endpoint, {
        method,
        path,
      });
      if (!mounted.current) return;
      acceptedTest.current = result.test_id;
      setWaitingId(result.test_id);
      await refresh(true);
    } catch (cause) {
      if (mounted.current) {
        setStartError((cause as Error).message);
        setWaitingId(null);
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  const current = visibleTestRun(
    snapshot?.current || null,
    instance.id,
    waitingId,
  );
  const running = snapshot?.current?.status === "running";
  const disabled =
    operationsLocked ||
    !snapshot ||
    Boolean(fetchError) ||
    submitting ||
    Boolean(waitingId) ||
    running ||
    instance.status !== "running" ||
    !instance.enabled ||
    Boolean(instance.current_operation) ||
    !instance.applied_config;
  const checks = current?.report?.checks || [];
  const counts = resultCounts(checks);
  const paths = snapshot?.paths?.length ? snapshot.paths : testPaths;
  const sourceChanged = Boolean(
    current && current.source_container_id !== instance.container_id,
  );

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
    <section className="client-tests" aria-labelledby={`tests-${instance.id}`}>
      <div className="client-test-heading">
        <div>
          <h3 id={`tests-${instance.id}`}>内置客户端测试</h3>
          <p>
            使用当前生效参数，在目标宿主机运行一次性客户端容器。此测试不能替代跨节点验收。
          </p>
        </div>
      </div>
      {hasUnappliedConfig && (
        <div className="test-config-notice">
          存在未应用的配置；本次测试使用当前生效快照，不会自动保存或重启实例。
        </div>
      )}
      <div className="test-controls">
        <label htmlFor={`test-path-${instance.id}`}>
          测试路径
          <select
            id={`test-path-${instance.id}`}
            value={path}
            onChange={(event) => setPath(event.target.value as TestPath)}
            disabled={submitting || running || Boolean(waitingId)}
          >
            {paths.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <div className="test-method-buttons">
          {testMethods.map((method) => (
            <button
              type="button"
              className={`button ${method === "ALL" ? "primary" : ""}`}
              key={method}
              disabled={
                disabled ||
                !httpMethodsForPath(path).includes(method) ||
                Boolean(snapshot && !snapshot.cases.includes(method))
              }
              onClick={() => void start(method)}
            >
              {method === "ALL"
                ? "全部测试"
                : method === "GET"
                  ? "GET 测试"
                  : method}
            </button>
          ))}
        </div>
      </div>
      {!["/ok", "/chunked", "/close"].includes(path) && (
        <p className="test-config-notice">
          固定场景按预设字节和时序核对；测试通过表示目标正确输出该场景，不表示畸形报文是合法业务响应。
          {path === "/head" || path === "/health" ? " 此场景使用 HEAD。" : " 此场景使用 GET。"}
        </p>
      )}
      {!instance.enabled || instance.status !== "running" ? (
        <p className="test-availability">
          启动 HTTP 服务并确认运行就绪后，可发起客户端测试。
        </p>
      ) : instance.current_operation ? (
        <p className="test-availability">
          协议操作进行中，完成后可发起客户端测试。
        </p>
      ) : null}
      {fetchError && (
        <div className="test-error" role="alert">
          无法读取测试状态：{fetchError}
          {snapshot?.current && "。以下为最后获取的结果，当前状态待重新核对。"}
        </div>
      )}
      {startError && (
        <div className="test-error" role="alert">
          {startError}
        </div>
      )}
      {sessionNotice && (
        <div className="test-config-notice" role="status">
          {sessionNotice}
        </div>
      )}
      {(submitting || waitingId) && !current && (
        <div className="test-awaiting" role="status">
          {submitting ? "正在提交客户端测试…" : "测试已受理，等待当前测试结果…"}
        </div>
      )}
      {current ? (
        <div className="test-result" aria-live="polite">
          <div className="test-result-heading">
            <div>
              <span className={`test-status test-status-${current.status}`}>
                {statuses[current.status]}
              </span>
              <strong>
                {current.method === "ALL" ? (["/ok", "/chunked", "/close"].includes(current.path) ? "全部方法" : "场景验证") : current.method}{" "}
                {current.path}
              </strong>
              <span className="test-elapsed">{testDurationLabel(current)}</span>
            </div>
            <button
              className="button"
              type="button"
              disabled={current.status === "running"}
              onClick={download}
            >
              下载 JSON 报告
            </button>
          </div>
          <div className="test-snapshot">
            <span>测试快照：{configDescription(current.applied_config)}</span>
            <span>
              被测容器：<code>{current.source_container_id.slice(0, 12)}</code>
            </span>
            {current.report?.exit_code !== undefined && (
              <span>
                客户端退出码：
                {current.report.exit_code === null
                  ? "未取得"
                  : current.report.exit_code}
              </span>
            )}
          </div>
          {sourceChanged && (
            <p className="test-config-notice">
              此结果来自先前的被测容器，不代表当前 HTTP 服务的新状态。
            </p>
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
          {checks.length > 0 && (
            <>
              <div className="test-counts">
                共 {counts.total} 项 · 通过 {counts.passed} · 失败{" "}
                {counts.failed}
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
                      <span className="test-check-summary">
                        {check.request?.method} {check.request?.path}
                        {check.response?.status !== undefined
                          ? check.response.status === null
                            ? ` · ${httpResponseStatus(check.response)}`
                            : ` · HTTP ${check.response.status}`
                          : ""}
                      </span>
                      {check.seconds !== undefined ||
                      check.duration_ms !== undefined ? (
                        <span className="test-check-time">
                          {(
                            check.seconds ?? (check.duration_ms || 0) / 1000
                          ).toFixed(3)}{" "}
                          秒
                        </span>
                      ) : null}
                      <span className="test-check-outcome">
                        {check.passed ? "通过" : "失败"}
                      </span>
                    </summary>
                    {check.error && (
                      <p className="test-check-error">{check.error}</p>
                    )}
                    {check.expected_behavior && <p>预期行为：{check.expected_behavior}</p>}
                    {check.quiet_window_seconds !== undefined && <p>有限静默观察窗口：{check.quiet_window_seconds} 秒，不代表窗口以外无报文。</p>}
                    <div className="test-wire-grid">
                      <WireSummary title="请求" message={check.request} />
                      <WireSummary title="响应" message={check.response} />
                    </div>
                  </details>
                ))}
              </div>
            </>
          )}
          {!checks.length && current.status === "running" && (
            <p className="test-empty">
              正在发送请求并收集实际响应，结果将自动刷新。
            </p>
          )}
          {!checks.length && current.status !== "running" && (
            <p className="test-empty">
              没有可展示的逐项结果，请查看本次测试状态与错误原因。
            </p>
          )}
        </div>
      ) : !submitting && !waitingId && !fetchError ? (
        <p className="test-empty">
          尚无客户端测试结果。仅保留当前或最后一次测试，不保存历史记录。
        </p>
      ) : null}
    </section>
  );
}
