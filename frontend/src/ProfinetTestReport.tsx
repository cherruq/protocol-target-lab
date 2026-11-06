import { guideText } from "./protocol-description.ts";
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
      <p className="test-error">{guideText("profinet.verification.profinettestreport.001")}</p>
    );
  const write = profinetWriteMethod(run.method);
  return (
    <div className="test-config-notice">
      <strong>{guideText("profinet.verification.profinettestreport.002")}{run.applied_config.ptcp_n.scenario.mode}{guideText("profinet.verification.profinettestreport.003")}{" "}
        {run.applied_config.ptcp_f.scenario.mode}
      </strong>
      <p>{guideText("profinet.verification.profinettestreport.004")}</p>
      <dl>
        {(
          [
            ["actual_requests", guideText("profinet.verification.profinettestreport.005")],
            ["actual_responses", guideText("profinet.verification.profinettestreport.006")],
            ["matched_responses", guideText("profinet.verification.profinettestreport.007")],
            ["other_node_responses", guideText("profinet.verification.profinettestreport.008")],
            ["unexpected_responses", guideText("profinet.verification.profinettestreport.009")],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>
              {profinetActualCount(run.report?.summary, key) ??
                guideText("profinet.verification.profinettestreport.010")}
            </dd>
          </div>
        ))}
      </dl>
      <p>{guideText("profinet.verification.profinettestreport.011")}</p>
      {write && (
        <>
          <strong>{guideText("profinet.verification.profinettestreport.012")}{run.report?.restoration_complete === true
              ? guideText("profinet.verification.profinettestreport.013")
              : run.report?.restoration_complete === false
                ? guideText("profinet.verification.profinettestreport.014")
                : guideText("profinet.verification.profinettestreport.015")}
          </strong>
          <p>{guideText("profinet.verification.profinettestreport.016")}</p>
          {run.report?.restoration !== undefined && (
            <pre className="protocol-wire">
              {boundedWireSummary(run.report.restoration).text}
            </pre>
          )}
        </>
      )}
      {run.method === "DCP_SIGNAL" && (
        <p>{guideText("profinet.verification.profinettestreport.017")}</p>
      )}
      {run.report?.summary && (
        <details>
          <summary>{guideText("profinet.verification.profinettestreport.018")}</summary>
          <pre className="protocol-wire">
            {boundedWireSummary(run.report.summary).text}
          </pre>
        </details>
      )}
    </div>
  );
}
