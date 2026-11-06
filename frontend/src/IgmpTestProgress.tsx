import { guideText } from "./protocol-description.ts";
import { useEffect, useState } from "react";
import type { ProtocolTestRun } from "./protocol-tests";
import { isIgmpConfig, igmpPlannedCounts } from "./igmp-config";
import { ownIgmpProgress, igmpActualCount } from "./igmp-progress";
const phases = {
  warmup: "暖机保守上界等待",
  "general-query": "General Query / 全部组",
  "group-query": "Group-specific / 仅首组",
  cleanup: "核对身份与清理",
  complete: "客户端完成阶段（仍须最终结果核对）",
  failed: "客户端失败阶段",
};
export default function IgmpTestProgress({
  run,
}: {
  run: ProtocolTestRun<unknown>;
}) {
  const config = isIgmpConfig(run.applied_config) ? run.applied_config : null;
  const planned = config
    ? igmpPlannedCounts(run.method, config.groups.length)
    : null;
  const p = config
    ? ownIgmpProgress(run.progress, run.id, config.groups)
    : null;
  const key = p ? `${run.id}:${p.sequence}` : "";
  const [sample, setSample] = useState<{ key: string; at: number } | null>(
      null,
    ),
    [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    setSample(key ? { key, at: performance.now() } : null);
    setNow(performance.now());
  }, [key]);
  useEffect(() => {
    if (run.status !== "running") return;
    const timer = window.setInterval(() => setNow(performance.now()), 1000);
    return () => window.clearInterval(timer);
  }, [run.id, run.status]);
  const age = sample?.key === key ? Math.max(0, now - sample.at) : 0;
  const remaining = p?.remaining_ms ?? null,
    warmup = p?.warmup_remaining_upper_ms ?? null;
  return (
    <div className="test-config-notice" aria-label="IGMP 查询进度与实际计数">
      {p ? (
        <>
          <strong>{guideText("igmp.verification.igmptestprogress.001")}{phases[p.phase]}</strong>
          <p>{guideText("igmp.verification.igmptestprogress.002")}{p.round ?? "—"}{guideText("igmp.verification.igmptestprogress.003")}{p.sequence}
            {run.status === "running"
              ? `${guideText("igmp.verification.igmptestprogress.004")}${(age / 1000).toFixed(1)}${guideText("igmp.verification.igmptestprogress.005")}`
              : guideText("igmp.verification.igmptestprogress.006")}{guideText("igmp.verification.igmptestprogress.007")}</p>
          <p>{guideText("igmp.verification.igmptestprogress.008")}{p.queries_sent}{guideText("igmp.verification.igmptestprogress.009")}{p.reports_matched}{guideText("igmp.verification.igmptestprogress.010")}{p.prequery_reports}{guideText("igmp.verification.igmptestprogress.011")}</p>
          <p>{guideText("igmp.verification.igmptestprogress.012")}{p.groups_covered.length}{guideText("igmp.verification.igmptestprogress.013")}{p.groups_expected.length}{guideText("igmp.verification.igmptestprogress.014")}{p.groups_covered.join(", ") || guideText("igmp.verification.igmptestprogress.015")}{guideText("igmp.verification.igmptestprogress.016")}{p.groups_expected.join(", ") || guideText("igmp.verification.igmptestprogress.017")}{guideText("igmp.verification.igmptestprogress.018")}</p>
          {run.status === "running" && (
            <>
              <p>{guideText("igmp.verification.igmptestprogress.019")}{remaining && remaining > 0
                  ? `${(remaining / 1000).toFixed(1)}${guideText("igmp.verification.igmptestprogress.020")}`
                  : guideText("igmp.verification.igmptestprogress.021")}{guideText("igmp.verification.igmptestprogress.022")}{" "}
                {(p.elapsed_ms / 1000).toFixed(1)}{guideText("igmp.verification.igmptestprogress.023")}</p>
              {p.phase === "warmup" && (
                <p>{guideText("igmp.verification.igmptestprogress.024")}{warmup && warmup > 0
                    ? `${(warmup / 1000).toFixed(1)}${guideText("igmp.verification.igmptestprogress.025")}`
                    : guideText("igmp.verification.igmptestprogress.026")}{guideText("igmp.verification.igmptestprogress.027")}</p>
              )}
              {age > 5000 && (
                <p>{guideText("igmp.verification.igmptestprogress.028")}</p>
              )}
            </>
          )}
        </>
      ) : run.status === "running" ? (
        <p>
          {run.progress
            ? guideText("igmp.verification.igmptestprogress.029")
            : guideText("igmp.verification.igmptestprogress.030")}
        </p>
      ) : null}
      {run.report && (
        <>
          <strong>{guideText("igmp.verification.igmptestprogress.031")}</strong>
          <p>{guideText("igmp.verification.igmptestprogress.032")}{igmpActualCount(run.report.summary, "total") ?? guideText("igmp.verification.igmptestprogress.033")}{guideText("igmp.verification.igmptestprogress.034")}{igmpActualCount(run.report.summary, "actual_queries") ?? guideText("igmp.verification.igmptestprogress.035")}{guideText("igmp.verification.igmptestprogress.036")}{igmpActualCount(run.report.summary, "actual_reports") ?? guideText("igmp.verification.igmptestprogress.037")}{guideText("igmp.verification.igmptestprogress.038")}</p>
        </>
      )}
      {planned && (
        <p>{guideText("igmp.verification.igmptestprogress.039")}{planned.checks}{guideText("igmp.verification.igmptestprogress.040")}{planned.queries}{guideText("igmp.verification.igmptestprogress.041")}{" "}
          {planned.reports}{guideText("igmp.verification.igmptestprogress.042")}</p>
      )}
      <p className="field-help">{guideText("igmp.verification.igmptestprogress.043")}</p>
    </div>
  );
}
