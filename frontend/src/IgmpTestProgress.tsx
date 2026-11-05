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
          <strong>真实客户端进度 · 最后样本：{phases[p.phase]}</strong>
          <p>
            轮次{p.round ?? "—"} / 2 · 样本序号{p.sequence}
            {run.status === "running"
              ? ` · 本页收到该序号后${(age / 1000).toFixed(1)}秒`
              : " · 测试已结束"}
            。进度不是通过判定，完成后仍核对最终报告与清理。
          </p>
          <p>
            本测试累计实际已发Query {p.queries_sent}
            ；已完成来源/窗口证据匹配的原生Report {p.reports_matched}
            ；首次测试Query前观察到的候选Report {p.prequery_reports}
            （不计查询成功，不声称都唯一来自启动unsolicited）。
          </p>
          <p>
            当前检查组覆盖 {p.groups_covered.length}/{p.groups_expected.length}
            ：{p.groups_covered.join(", ") || "尚无"}。期望：
            {p.groups_expected.join(", ") || "此阶段尚未选择检查组"}。
          </p>
          {run.status === "running" && (
            <>
              <p>
                客户端最后样本的全局剩余：
                {remaining && remaining > 0
                  ? `${(remaining / 1000).toFixed(1)}秒`
                  : "样本预算已到，等待客户端更新；界面不生成超时结果"}
                （采样值，不冒称当前准确倒计时，接收前延迟未知）。最后样本实际elapsed{" "}
                {(p.elapsed_ms / 1000).toFixed(1)}秒。
              </p>
              {p.phase === "warmup" && (
                <p>
                  客户端最后样本的暖机保守上界剩余：
                  {warmup && warmup > 0
                    ? `${(warmup / 1000).toFixed(1)}秒`
                    : "样本上界已到，仍等待实际阶段更新"}
                  。不是实际learned mr_qrv或内核定时器测量。
                </p>
              )}
              {age > 5000 && (
                <p>
                  此进度样本较旧，长随机等待中可能暂时没有新事件；当前计数以最后样本为准，不推断成功。
                </p>
              )}
            </>
          )}
        </>
      ) : run.status === "running" ? (
        <p>
          {run.progress
            ? "进度来源或格式不匹配，已隐藏；等待当前测试的新样本。"
            : "测试已运行，等待真实客户端进度；暖机及12秒随机响应窗口可能较长。"}
        </p>
      ) : null}
      {run.report && (
        <>
          <strong>最终执行与实际报文分开计数</strong>
          <p>
            已执行检查组：
            {igmpActualCount(run.report.summary, "total") ?? "未提供"}
            ；实际Query：
            {igmpActualCount(run.report.summary, "actual_queries") ?? "未提供"}
            ；证据匹配原生Report：
            {igmpActualCount(run.report.summary, "actual_reports") ?? "未提供"}
            。不从计划或check数量推造报告数。
          </p>
        </>
      )}
      {planned && (
        <p>
          按本次生效快照计划：{planned.checks}检查组 / {planned.queries} Query /{" "}
          {planned.reports} Report；仅是计划，不能冒充上方实际数。
        </p>
      )}
      <p className="field-help">
        General每轮覆盖全部测试时applied组，Group-specific只查ordered第一组；ALL计划4检查组。MRT100=10秒、每轮12秒/global90秒。测试端不IP加入目标组，没有报告ACK或wire事务ID。
      </p>
    </div>
  );
}
