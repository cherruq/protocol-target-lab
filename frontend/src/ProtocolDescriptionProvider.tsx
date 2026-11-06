import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { guidanceRevision, guidanceState, loadGuidance, subscribeGuidance } from "./protocol-description.ts";

export default function ProtocolDescriptionProvider({ children }: { children: ReactNode }) {
  useSyncExternalStore(subscribeGuidance, guidanceRevision);
  const [hasLoaded, setHasLoaded] = useState(false);
  const state = guidanceState();
  useEffect(() => { void loadGuidance().catch(() => {}); }, []);
  useEffect(() => { if (state.ready) setHasLoaded(true); }, [state.ready]);
  if (!hasLoaded && !state.ready)
    return <main className="panel" role="status"><h1>协议工作台</h1><p>{state.error || "正在读取统一协议说明…"}</p>{state.error && <button className="button" onClick={() => void loadGuidance().catch(() => {})}>重试</button>}</main>;
  return <>{hasLoaded && !state.ready && !state.error && <div className="inline-note" role="status">管理服务已更新，正在读取匹配版本的协议说明…</div>}{state.error && <div className="inline-note" role="alert">{state.error} 当前协议说明暂不可用。<button className="button" onClick={() => void loadGuidance().catch(() => {})}>重试</button></div>}{children}</>;
}
