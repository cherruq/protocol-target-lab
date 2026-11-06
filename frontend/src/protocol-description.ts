/** Protocol guidance is supplied only by the manager; the Web bundle has no text fallback. */
export type GuidanceSection = "overview" | "configuration" | "connection" | "verification" | "runtime";
export type GuidanceEntry = {
  id: string;
  protocols: string[];
  section: GuidanceSection;
  topic: string;
  text: string;
  choice?: { group: string; value: string };
};
export type GuidanceCatalog = {
  schema_version: number;
  manager_version: string;
  language: string;
  protocols: string[];
  entries: GuidanceEntry[];
};
let catalog: GuidanceCatalog | null = null;
let messages = new Map<string, string>();
let generation = 0;
let change = 0;
let problem = "";
let inFlight: Promise<void> | null = null;
let requiredVersion: string | undefined;
const listeners = new Set<() => void>();
const sections = new Set(["overview", "configuration", "connection", "verification", "runtime"]);
export function installGuidanceCatalog(value: GuidanceCatalog): void {
  if (value?.schema_version !== 1 || typeof value.manager_version !== "string" || !value.manager_version || value.language !== "zh-CN" ||
      !Array.isArray(value.protocols) || value.protocols.some((id) => typeof id !== "string" || !id) || !value.protocols.length || new Set(value.protocols).size !== value.protocols.length ||
      !Array.isArray(value.entries) || !value.entries.length)
    throw new Error("协议说明格式或版本不兼容。");
  const next = new Map<string, string>();
  for (const item of value.entries) {
    if (typeof item.id !== "string" || !item.id || typeof item.text !== "string" || !item.text.trim() || next.has(item.id) ||
        !sections.has(item.section) || !Array.isArray(item.protocols) || !item.protocols.length || item.protocols.some((id) => !value.protocols.includes(id)))
      throw new Error("协议说明存在缺失、重复或无效条目。");
    next.set(item.id, item.text);
  }
  for (const id of value.protocols)
    if (!value.entries.some((item) => item.protocols.includes(id))) throw new Error("协议说明不完整。");
  catalog = value;
  messages = next;
  problem = "";
  notify();
}
function notify() { change++; for (const listener of listeners) listener(); }
export function subscribeGuidance(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function guidanceRevision() { return change; }
export function guidanceState() { return { ready: Boolean(catalog), version: catalog?.manager_version, error: problem }; }
export function guideText(id: string): string { return messages.get(id) ?? "说明暂不可用"; }
/** Labels must resolve after the manager's catalog loads, including module-level maps. */
export function lazyGuidanceLabels<T extends object>(factory: () => T): T {
  return new Proxy({} as T, {
    get: (_target, property) => Reflect.get(factory(), property),
    ownKeys: () => Reflect.ownKeys(factory()),
    getOwnPropertyDescriptor: (_target, property) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(factory(), property);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
  });
}
export function loadGuidance(expectedVersion?: string): Promise<void> {
  if (expectedVersion) {
    requiredVersion = expectedVersion;
    if (catalog && catalog.manager_version !== expectedVersion) {
      catalog = null;
      messages = new Map();
      problem = "";
      notify();
    }
  }
  if (catalog && (!requiredVersion || catalog.manager_version === requiredVersion)) return Promise.resolve();
  if (inFlight) return inFlight;
  const requestGeneration = ++generation;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  inFlight = (async () => {
    try {
      const response = await fetch("/api/descriptions", { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error(`读取协议说明失败（HTTP ${response.status}）`);
      const next = await response.json() as GuidanceCatalog;
      if (requiredVersion && next.manager_version !== requiredVersion) throw new Error("管理服务已变化，正在等待匹配版本的协议说明。");
      if (generation === requestGeneration) installGuidanceCatalog(next);
    } catch (error) {
      if (generation === requestGeneration) {
        problem = controller.signal.aborted ? "协议说明读取超时。" : (error as Error).message;
        // Do not retain old normative text across a manager upgrade.
        if (requiredVersion && catalog?.manager_version !== requiredVersion) { catalog = null; messages = new Map(); }
        notify();
      }
      throw error;
    } finally { clearTimeout(timer); inFlight = null; }
  })();
  return inFlight;
}
