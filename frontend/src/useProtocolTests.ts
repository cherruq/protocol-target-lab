import { useEffect, useRef, useState } from "react";
import { acceptedTestWasReplaced } from "./client-tests";
import type { ProtocolTestSnapshot } from "./protocol-tests";

async function testRequest<T>(endpoint: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(endpoint, {
      signal: controller.signal,
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error(`测试接口返回异常（HTTP ${response.status}）`);
    }
    if (!response.ok)
      throw new Error(
        value?.error?.message || `测试请求失败（HTTP ${response.status}）`,
      );
    return value as T;
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error("客户端测试接口请求超时，请检查管理服务后重试。");
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

/** Shared lifecycle for protocol metadata, exact accepted IDs and bounded polling. */
export default function useProtocolTests<C>(instanceId: string) {
  const [snapshot, setSnapshot] = useState<ProtocolTestSnapshot<C> | null>(
    null,
  );
  const [path, setPath] = useState("");
  const [fetchError, setFetchError] = useState("");
  const [startError, setStartError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [waitingId, setWaitingId] = useState<string | null>(null);
  const mounted = useRef(false);
  const sequence = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const session = useRef<string | null>(null);
  const accepted = useRef<{ id: string; session?: string } | null>(null);
  const active = useRef(false);
  active.current =
    submitting || Boolean(waitingId) || snapshot?.current?.status === "running";
  const endpoint = `/api/instances/${encodeURIComponent(instanceId)}/tests`;
  async function refresh(force = false): Promise<void> {
    if (inFlight.current && !force) return inFlight.current;
    const generation = ++sequence.current;
    const task = (async () => {
      try {
        const next = await testRequest<ProtocolTestSnapshot<C>>(endpoint);
        if (!mounted.current || generation !== sequence.current) return;
        if (
          !Array.isArray(next.cases) ||
          !Array.isArray(next.paths) ||
          typeof next.session_id !== "string"
        )
          throw new Error("测试接口缺少用例、参数或管理服务会话信息。");
        const restarted = Boolean(
          session.current && session.current !== next.session_id,
        );
        if (restarted && accepted.current?.session !== next.session_id) {
          if (active.current)
            setNotice(
              "管理服务已重启，原测试结果未保留，请重新执行；中断的临时容器会清理。",
            );
          accepted.current = null;
          setWaitingId(null);
          setSubmitting(false);
          setStartError("");
        }
        session.current = next.session_id;
        if (next.current && next.current.instance_id !== instanceId) {
          setSnapshot({ ...next, current: null });
          setFetchError("测试结果与当前协议服务不一致，已隐藏该结果。");
          return;
        }
        if (
          accepted.current?.session &&
          accepted.current.session !== next.session_id
        ) {
          accepted.current = null;
          setWaitingId(null);
          setNotice("管理服务会话已改变，原测试结果未保留，请重新执行。");
        } else if (
          acceptedTestWasReplaced(accepted.current?.id || null, next.current)
        ) {
          accepted.current = null;
          setWaitingId(null);
          setNotice(
            "请求的测试结果已被后续测试替换或不再保留；以下显示当前保留结果，请按需重新执行。",
          );
        } else if (
          accepted.current?.id === next.current?.id &&
          next.current?.status !== "running"
        )
          accepted.current = null;
        setSnapshot(next);
        setFetchError("");
        setPath((current) =>
          next.paths.includes(current) ? current : next.paths[0] || "",
        );
        setWaitingId((current) =>
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
  }, [instanceId]);
  async function start(method: string) {
    setSubmitting(true);
    setWaitingId("submitting");
    accepted.current = null;
    setStartError("");
    setNotice("");
    try {
      const result = await testRequest<{
        test_id: string;
        session_id?: string;
      }>(endpoint, { method, path });
      if (!mounted.current) return;
      if (!result.test_id)
        throw new Error("测试接口没有返回受理 ID，请检查当前测试状态后重试。");
      accepted.current = { id: result.test_id, session: result.session_id };
      setWaitingId(result.test_id);
      await refresh(true);
    } catch (error) {
      if (mounted.current) {
        setStartError((error as Error).message);
        setWaitingId(null);
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }
  return {
    snapshot,
    path,
    setPath,
    fetchError,
    startError,
    notice,
    submitting,
    waitingId,
    start,
  };
}
