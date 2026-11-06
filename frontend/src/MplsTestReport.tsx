import { guideText } from "./protocol-description.ts";
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
      <p className="test-error">{guideText("mpls.verification.mplstestreport.001")}</p>
    );
  const unexpected = mplsUnexpectedCount(run.report?.summary);
  return (
    <div className="test-config-notice">
      <strong>{guideText("mpls.verification.mplstestreport.002")}{run.applied_config.scenario.mode}
      </strong>
      <p>
        {run.applied_config.scenario.mode === "normal"
          ? guideText("mpls.verification.mplstestreport.003")
          : guideText("mpls.verification.mplstestreport.004")}{" "}{guideText("mpls.verification.mplstestreport.005")}</p>
      {run.applied_config.scenario.mode === "short-ethernet" && (
        <p>{guideText("mpls.verification.mplstestreport.006")}</p>
      )}
      <p>{guideText("mpls.verification.mplstestreport.007")}{unexpected ?? guideText("mpls.verification.mplstestreport.008")}{guideText("mpls.verification.mplstestreport.009")}</p>
      {run.report?.checks.map((check, i) => {
        const peer = mplsUnexpectedPeer(check.response);
        return peer && (peer.frames.length > 0 || (peer.total ?? 0) > 0) ? (
          <details key={i}>
            <summary>{guideText("mpls.verification.mplstestreport.010")}{check.name}{guideText("mpls.verification.mplstestreport.011")}{" "}
              {peer.total ?? guideText("mpls.verification.mplstestreport.012")}{guideText("mpls.verification.mplstestreport.013")}</summary>
            <p>{guideText("mpls.verification.mplstestreport.014")}{peer.serverTruncated === null
                ? guideText("mpls.verification.mplstestreport.015")
                : peer.serverTruncated
                  ? guideText("mpls.verification.mplstestreport.016")
                  : guideText("mpls.verification.mplstestreport.017")}{guideText("mpls.verification.mplstestreport.018")}{peer.displayTruncated ? guideText("mpls.verification.mplstestreport.019") : ""}{guideText("mpls.verification.mplstestreport.020")}</p>
            <pre className="protocol-wire">
              {boundedWireSummary(peer.frames).text}
            </pre>
          </details>
        ) : null;
      })}
      {run.report?.summary && (
        <>
          <h4>{guideText("mpls.verification.mplstestreport.021")}</h4>
          <pre className="protocol-wire">
            {boundedWireSummary(run.report.summary).text}
          </pre>
        </>
      )}
      <p>{guideText("mpls.verification.mplstestreport.022")}</p>
    </div>
  );
}
