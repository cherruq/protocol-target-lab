import { mplsUnexpectedCount, mplsUnexpectedPeer } from "./mpls-tests";
import type { ProtocolTestRun } from "./protocol-tests";
import { boundedWireSummary } from "./protocol-tests";
import { isMplsConfig, type MplsConfig } from "./mpls-config";
export default function MplsTestReport({
  run,
}: {
  run: ProtocolTestRun<MplsConfig>;
}) {
  if (!isMplsConfig(run.applied_config))
    return (
      <p className="test-error">
        测试快照类型不匹配，不能按当前配置解释旧结果。
      </p>
    );
  const unexpected = mplsUnexpectedCount(run.report?.summary);
  return (
    <div className="test-config-notice">
      <strong>
        当前测试自己的生效场景：{run.applied_config.scenario.mode}
      </strong>
      <p>
        {run.applied_config.scenario.mode === "normal"
          ? "仅normal的完整匹配普通IPv4 Echo Reply可表示本次正常响应。"
          : "故障场景检查通过表示实际执行了目标故障，不等于正常Echo互通；silent也必须有新鲜suppressed因果证据。"}{" "}
        ALL计划8检查/8请求；INVALID_REQUEST两轮不应有回复，因此不把8请求当8响应。实际请求、TX提交、peer实收与抑制分别以报告字段为准，未知数不从计划补齐。
      </p>
      {run.applied_config.scenario.mode === "short-ethernet" && (
        <p>
          13字节TX不支持时，正向检查必须明确tx_error/environment_unavailable；不能将空响应判为silent通过。INVALID_REQUEST可独立通过。
        </p>
      )}
      <p>
        实际关联异常入站：{unexpected ?? "未提供（旧版报告不推作0）"}
        。异常帧不是正常回复；失败时可能多包，不用计划请求数截掉真实计数。
      </p>
      {run.report?.checks.map((check, i) => {
        const peer = mplsUnexpectedPeer(check.response);
        return peer && (peer.frames.length > 0 || (peer.total ?? 0) > 0) ? (
          <details key={i}>
            <summary>
              异常incoming实际证据 · {check.name} · 总计{" "}
              {peer.total ?? "未提供"} 条
            </summary>
            <p>
              服务端摘要
              {peer.serverTruncated === null
                ? "截断状态未提供"
                : peer.serverTruncated
                  ? "已截断"
                  : "未截断"}
              ；本页最多展示8项{peer.displayTruncated ? "（额外项已截断）" : ""}
              。原始总数不从预览长度推导；保留实际frame、metadata与association_reason，不把异常入站称协议ACK。
            </p>
            <pre className="protocol-wire">
              {boundedWireSummary(peer.frames).text}
            </pre>
          </details>
        ) : null;
      })}
      {run.report?.summary && (
        <>
          <h4>实际报告计数（未提供字段不推造）</h4>
          <pre className="protocol-wire">
            {boundedWireSummary(run.report.summary).text}
          </pre>
        </>
      )}
      <p>
        ICMP
        identifier/sequence是真实wire字段；request_id/event_id仅源本地关联，不是MPLS
        ACK。send成功不等于peer收到，完整request
        SHA→事件→输出SHA与实际incoming证据见逐项摘要。
      </p>
    </div>
  );
}
