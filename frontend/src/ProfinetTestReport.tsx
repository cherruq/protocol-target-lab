import type { ProtocolTestRun } from "./protocol-tests";
import { boundedWireSummary } from "./protocol-tests";
import { isProfinetConfig, type ProfinetConfig } from "./profinet-config";
import { profinetActualCount, profinetWriteMethod } from "./profinet-tests";
export default function ProfinetTestReport({
  run,
}: {
  run: ProtocolTestRun<ProfinetConfig>;
}) {
  if (!isProfinetConfig(run.applied_config))
    return (
      <p className="test-error">
        PROFINET启动快照类型不匹配，不能用当前表单解释。
      </p>
    );
  const write = profinetWriteMethod(run.method);
  return (
    <div className="test-config-notice">
      <strong>
        测试时三节点：N / {run.applied_config.ptcp_n.scenario.mode}；F /{" "}
        {run.applied_config.ptcp_f.scenario.mode}
      </strong>
      <p>
        此为启动快照，DCP真实当前/NV可能已被线上Set改变，不与initial_*盲比。Delay组播同时触发两个PTCP节点；合法其他节点回复与选中目标匹配分别计数，不能把两种Delay当同一MAC。故障场景通过表示预期故障已真实核验，不是全部正常互通。
      </p>
      <dl>
        {(
          [
            ["actual_requests", "实际发送帧"],
            ["actual_responses", "实际关联实收"],
            ["matched_responses", "选中目标匹配"],
            ["other_node_responses", "合法其他节点回复"],
            ["unexpected_responses", "关联异常实收"],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>
              {profinetActualCount(run.report?.summary, key) ??
                "未提供（不补计划数）"}
            </dd>
          </div>
        ))}
      </dl>
      <p>
        ALL计划24检查/26发帧，只有good/good且正常native基线的参考实收26=目标匹配20+合法其他节点6；故障与native当前语义按实际报告，不硬编码所有场景26。Sync/FollowUp/Announce凭两节点新鲜接纳事件核验，没有线上ACK；软件时间不证明硬件同步精度。
      </p>
      {write && (
        <>
          <strong>
            真实写入与恢复：
            {run.report?.restoration_complete === true
              ? "已核验语义恢复"
              : run.report?.restoration_complete === false
                ? "恢复未完成 / 失败"
                : "尚未提供恢复确认"}
          </strong>
          <p>
            临时Set会清对应NV值；测试须按baseline的current/NV关系选择恢复qualifier，并恢复所有触及的current/NV/OS语义。外部并发修改时不能覆盖，不能恢复initializer伪装成功。cleanup_complete只表示临时资源，不替代restoration_complete。
          </p>
          {run.report?.restoration !== undefined && (
            <pre className="protocol-wire">
              {boundedWireSummary(run.report.restoration).text}
            </pre>
          )}
        </>
      )}
      {run.method === "DCP_SIGNAL" && (
        <p>
          DCP
          ACK与软件LED实际三次1Hz闪烁/六转换分别核验；两轮保持真实时间，不等于物理LED。
        </p>
      )}
      {run.report?.summary && (
        <details>
          <summary>原始实际计数摘要</summary>
          <pre className="protocol-wire">
            {boundedWireSummary(run.report.summary).text}
          </pre>
        </details>
      )}
    </div>
  );
}
