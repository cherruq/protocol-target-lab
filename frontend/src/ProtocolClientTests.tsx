import { guideText } from "./protocol-description.ts";
import type { ReactNode } from "react";
import type { ProtocolTestRun } from "./protocol-tests";
import {
  boundedWireSummary,
  actualProtocolExchanges,
  ownProtocolTest,
  protocolTestLabel,
} from "./protocol-tests";
import useProtocolTests from "./useProtocolTests";

type Target<C> = {
  id: string;
  status: string;
  enabled: boolean;
  current_operation: unknown;
  container_id: string | null;
  applied_config: C | null;
};
const statuses = {
  running: "测试运行中",
  passed: "测试通过",
  failed: "测试失败",
  error: "环境错误",
  interrupted: "测试已中断",
};

function Wire({
  title,
  message,
}: {
  title: string;
  message?: Record<string, unknown>;
}) {
  const preview = boundedWireSummary(message);
  return (
    <div className="wire-summary">
      <h4>{title}</h4>
      {message ? (
        <>
          <p className="field-help">{guideText("shared.verification.protocolclienttests.001")}</p>
          <pre className="protocol-wire">{preview.text}</pre>
          {preview.truncated && (
            <p>{guideText("shared.verification.protocolclienttests.002")}{" "}
              {preview.originalCharacters.toLocaleString()}{" "}{guideText("shared.verification.protocolclienttests.003")}</p>
          )}
        </>
      ) : (
        <p>{guideText("shared.verification.protocolclienttests.004")}</p>
      )}
    </div>
  );
}

/** Metadata-driven testing UI; protocol-specific wire fields remain structured. */
export default function ProtocolClientTests<C>({
  instance,
  protocolName,
  hasUnappliedConfig,
  operationsLocked,
  describeConfig,
  caseLabels,
  pathLabel = "测试参数",
  receiveEvidence = false,
  reportLabel,
  showActualExchanges = false,
  renderExtra,
  showRetainedResultNotice = false,
  validateResult,
}: {
  instance: Target<C>;
  protocolName: string;
  hasUnappliedConfig: boolean;
  operationsLocked: boolean;
  describeConfig: (config: C) => string;
  caseLabels?: Record<string, string>;
  pathLabel?: string;
  receiveEvidence?: boolean;
  reportLabel?: (method: string, appliedConfig: C) => string;
  showActualExchanges?: boolean;
  renderExtra?: (run: ProtocolTestRun<C>) => ReactNode;
  showRetainedResultNotice?: boolean;
  validateResult?: (run: ProtocolTestRun<C>) => string | null;
}) {
  const state = useProtocolTests<C>(instance.id);
  const {
    snapshot,
    path,
    setPath,
    fetchError,
    startError,
    notice,
    submitting,
    waitingId,
    start,
  } = state;
  const current = ownProtocolTest(
    snapshot?.current || null,
    instance.id,
    waitingId,
  );
  const running = snapshot?.current?.status === "running";
  const disabled =
    operationsLocked ||
    !snapshot ||
    !snapshot.cases.length ||
    !snapshot.paths.includes(path) ||
    Boolean(fetchError) ||
    submitting ||
    Boolean(waitingId) ||
    running ||
    instance.status !== "running" ||
    !instance.enabled ||
    Boolean(instance.current_operation) ||
    !instance.applied_config;
  const checks = current?.report?.checks || [];
  const resultProblem = current ? validateResult?.(current) : null;
  const label = (method: string) =>
    protocolTestLabel(method, snapshot?.case_labels, caseLabels);
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
      aria-labelledby={`protocol-tests-${instance.id}`}
    >
      <div className="client-test-heading">
        <div>
          <h3 id={`protocol-tests-${instance.id}`}>
            {protocolName} 内置客户端测试
          </h3>
          <p>
            {receiveEvidence
              ? `${guideText("shared.verification.protocolclienttests.005")}${protocolName}${guideText("shared.verification.protocolclienttests.006")}`
              : guideText("shared.verification.protocolclienttests.007")}
          </p>
        </div>
      </div>
      {hasUnappliedConfig && (
        <div className="test-config-notice">{guideText("shared.verification.protocolclienttests.008")}</div>
      )}
      <div className="test-controls">
        <label htmlFor={`protocol-test-path-${instance.id}`}>
          {snapshot?.path_label || pathLabel}
          <select
            id={`protocol-test-path-${instance.id}`}
            value={path}
            onChange={(e) => setPath(e.target.value)}
            disabled={submitting || running || Boolean(waitingId)}
          >
            {snapshot?.paths.map((value) => (
              <option value={value} key={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <div className="test-method-buttons">
          {snapshot?.cases.map((method) => (
            <button
              type="button"
              className={`button ${method === "ALL" ? "primary" : ""}`}
              key={method}
              disabled={disabled}
              onClick={() => void start(method)}
            >
              {label(method)}
            </button>
          ))}
        </div>
      </div>
      {(!instance.enabled || instance.status !== "running") && (
        <p className="test-availability">{guideText("shared.verification.protocolclienttests.009")}{protocolName}{guideText("shared.verification.protocolclienttests.010")}</p>
      )}
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
      {startError && current && showRetainedResultNotice && (
        <p className="test-config-notice" role="status">{guideText("shared.verification.protocolclienttests.011")}<code>{current.id}</code>{guideText("shared.verification.protocolclienttests.012")}</p>
      )}
      {notice && (
        <div className="test-config-notice" role="status">
          {notice}
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
              <span
                className={`test-status test-status-${resultProblem ? "error" : current.status}`}
              >
                {resultProblem ? "结果待核对" : statuses[current.status]}
              </span>
              <strong>
                {reportLabel
                  ? reportLabel(current.method, current.applied_config)
                  : label(current.method)}{" "}
                · {current.path}
              </strong>
              <span className="test-elapsed">
                {typeof current.report?.seconds === "number" &&
                Number.isFinite(current.report.seconds)
                  ? `客户端耗时 ${current.report.seconds.toFixed(3)} 秒`
                  : current.status === "running"
                    ? "正在收集结果"
                    : "测试已结束"}
              </span>
            </div>
            <button
              type="button"
              className="button"
              disabled={current.status === "running"}
              onClick={download}
            >
              下载 JSON 报告
            </button>
          </div>
          <div className="test-snapshot">
            <span>测试快照：{describeConfig(current.applied_config)}</span>
            <span>
              测试 ID：<code>{current.id}</code>
            </span>
            <span>
              被测容器：<code>{current.source_container_id.slice(0, 12)}</code>
            </span>
            {current.report?.exit_code !== undefined && (
              <span>客户端退出码：{current.report.exit_code ?? "未取得"}</span>
            )}
          </div>
          {current.source_container_id !== instance.container_id && (
            <p className="test-config-notice">{guideText("shared.verification.protocolclienttests.013")}</p>
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
          {resultProblem && (
            <div className="test-error" role="alert">
              {resultProblem}
            </div>
          )}
          {renderExtra?.(current)}
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
          {current.report?.trace !== undefined && (
            <div className="protocol-extra-trace">
              <Wire
                title={`${protocolName} 交互记录`}
                message={{ trace: current.report.trace }}
              />
            </div>
          )}
          {showActualExchanges && current.report && (
            <p className="test-counts">{guideText("shared.verification.protocolclienttests.014")}{actualProtocolExchanges(current.report.summary) ?? guideText("shared.verification.protocolclienttests.015")}{" "}{guideText("shared.verification.protocolclienttests.016")}</p>
          )}
          {checks.length ? (
            <>
              <div className="test-counts">
                共 {checks.length} 项 · 通过{" "}
                {checks.filter((c) => c.passed).length} · 失败{" "}
                {checks.filter((c) => !c.passed).length}
              </div>
              <div className="test-check-list">
                {checks.map((check, i) => (
                  <details
                    className={`test-check ${check.passed ? "passed" : "failed"}`}
                    open={!check.passed}
                    key={`${current.id}-${i}`}
                  >
                    <summary>
                      <span className="check-mark">
                        {check.passed ? "✓" : "!"}
                      </span>
                      <span className="test-check-name">{check.name}</span>
                      {typeof check.seconds === "number" && (
                        <span className="test-check-time">
                          {check.seconds.toFixed(3)} 秒
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
                      <Wire
                        title={`${protocolName} ${receiveEvidence ? "发送的数据报" : "请求 / 发送"}`}
                        message={check.request}
                      />
                      <Wire
                        title={`${protocolName} ${receiveEvidence ? "目标实际接收证据（私有观察器）" : "响应 / 交付"}`}
                        message={check.response}
                      />
                    </div>
                    {check.trace !== undefined && (
                      <div className="protocol-extra-trace">
                        <Wire
                          title={`${protocolName} 交互记录`}
                          message={{ trace: check.trace }}
                        />
                      </div>
                    )}
                  </details>
                ))}
              </div>
            </>
          ) : (
            <p className="test-empty">
              {current.status === "running"
                ? receiveEvidence
                  ? guideText("shared.verification.protocolclienttests.017")
                  : guideText("shared.verification.protocolclienttests.018")
                : guideText("shared.verification.protocolclienttests.019")}
            </p>
          )}
        </div>
      ) : !submitting && !waitingId && !fetchError ? (
        <p className="test-empty">{guideText("shared.verification.protocolclienttests.020")}</p>
      ) : null}
    </section>
  );
}
