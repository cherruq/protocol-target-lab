import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  defaults,
  isLegacyConfig,
  normalizeConfig,
  sameGeneratedConfig,
  sameStoredConfig,
  supportedMethods,
  validateConfig,
  type Config,
  type StoredConfig,
} from "./config";
import ClientTests from "./ClientTests";
type Instance = {
  id: string;
  protocol_id: string;
  runtime: string;
  enabled: boolean;
  config: StoredConfig;
  applied_config: StoredConfig | null;
  status: string;
  container_id: string | null;
  error: string | null;
  current_operation: { id: string; kind: string } | null;
  last_result: unknown;
};
type Environment = {
  docker_available: boolean;
  docker_version?: string;
  error?: string;
  config_error?: string;
  kernel?: string;
  image?: string;
  image_available?: boolean;
};
type Assets = { image: string; available: boolean };
type Connection = { base_url: string; commands: string[] };
type Protocol = {
  id: string;
  name: string;
  implementation: string;
  version: string;
  available: boolean;
  supported_methods?: string[];
  workspace: Instance | null;
  status: string;
  error: string | null;
};
const statusNames: Record<string, string> = {
  stopped: "已停止",
  starting: "启动中",
  running: "运行中",
  stopping: "停止中",
  error: "运行错误",
  "needs-config": "待配置",
  "environment-unavailable": "环境不可用",
  checking: "核对中",
  unavailable: "不可用",
};

async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(path, {
      signal: controller.signal,
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`服务响应异常（HTTP ${response.status}）`);
    }
    if (!response.ok) {
      const detail = (data as { error?: { message?: string; field?: string } })
        ?.error;
      throw new Error(
        detail?.message
          ? `${detail.field ? `${detail.field}：` : ""}${detail.message}`
          : `请求失败（HTTP ${response.status}）`,
      );
    }
    return data as T;
  } catch (cause) {
    if (controller.signal.aborted)
      throw new Error("管理接口请求超时，请检查管理服务与运行环境。");
    throw cause;
  } finally {
    window.clearTimeout(timer);
  }
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    play: <path d="m8 5 11 7-11 7V5Z" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="12" height="12" rx="2" />
        <path d="M16 8V4H4v12h4" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
      </>
    ),
    pause: (
      <>
        <path d="M8 5v14M16 5v14" />
      </>
    ),
    terminal: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="m7 9 3 3-3 3m6 0h4" />
      </>
    ),
    box: (
      <>
        <path d="m12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8M12 13v9" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18Z" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.box}
    </svg>
  );
}

function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${value}`}>
      <span className="status-dot" />
      {statusNames[value] || value}
    </span>
  );
}

async function copyText(value: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("复制失败，请手动选中文本复制");
}

function ConfigFields({
  config,
  onChange,
  prefix,
  disabled = false,
}: {
  config: Config;
  onChange: (value: Config) => void;
  prefix: string;
  disabled?: boolean;
}) {
  return (
    <>
      <div className="field-row">
        <label htmlFor={`${prefix}-bind`}>
          绑定地址
          <input
            id={`${prefix}-bind`}
            value={config.bind_ip}
            onChange={(event) =>
              onChange({ ...config, bind_ip: event.target.value })
            }
            required
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
          />
          <span className="field-help">0.0.0.0 表示全部 IPv4 接口</span>
        </label>
        <label htmlFor={`${prefix}-port`}>
          TCP 端口
          <input
            id={`${prefix}-port`}
            type="number"
            min="1"
            max="65535"
            value={config.port || ""}
            onChange={(event) =>
              onChange({ ...config, port: Number(event.target.value) })
            }
            required
            disabled={disabled}
          />
        </label>
      </div>
      <div className="field-row response-fields">
        <label htmlFor={`${prefix}-length`}>
          响应长度（字节）
          <input
            id={`${prefix}-length`}
            type="number"
            min="0"
            max="1048576"
            step="1"
            value={
              Number.isFinite(config.response_length)
                ? config.response_length
                : ""
            }
            onChange={(event) =>
              onChange({
                ...config,
                response_length: event.currentTarget.valueAsNumber,
              })
            }
            required
            disabled={disabled}
          />
          <span className="field-help">0～1048576 字节；0 表示空正文。</span>
        </label>
        <label htmlFor={`${prefix}-mode`}>
          响应模式
          <select
            id={`${prefix}-mode`}
            value={config.response_mode}
            onChange={(event) =>
              onChange({
                ...config,
                response_mode: event.target.value as Config["response_mode"],
              })
            }
            disabled={disabled}
          >
            <option value="fixed">固定内容</option>
            <option value="random">每次随机</option>
          </select>
        </label>
      </div>
      <div className="response-description">
        {config.response_mode === "fixed" ? (
          <p>
            重复 ASCII <code>0123456789abcdef</code>，按指定字节数截断。
          </p>
        ) : (
          <p>每次请求生成新的随机字节，正文长度始终等于指定字节数。</p>
        )}
        <p>
          HEAD 只返回响应头；其他支持的方法均按此配置生成正文，POST
          不回显请求正文。
        </p>
      </div>
    </>
  );
}

export default function App() {
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [environment, setEnvironment] = useState<Environment | null>(null);
  const [assets, setAssets] = useState<Assets | null>(null);
  const [selectedProtocolId, setSelectedProtocolId] = useState("http");
  const [draft, setDraft] = useState<Config>({ ...defaults });
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const editingId = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const refreshGeneration = useRef(0);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logConnected, setLogConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const logRef = useRef<HTMLPreElement>(null);
  const selectedProtocol = protocols.find(
    (protocol) => protocol.id === selectedProtocolId,
  );
  const selected = selectedProtocol?.workspace || null;
  const selectedId = selected?.id || null;
  const displayedStatus = connectionError
    ? "checking"
    : selectedProtocol?.status || "unavailable";
  const effectiveConfigKey = JSON.stringify(
    selected?.applied_config || selected?.config || null,
  );
  const locked = Boolean(
    busy ||
      connectionError ||
      selected?.current_operation ||
      selected?.status === "starting" ||
      selected?.status === "stopping",
  );

  async function refresh(force = false): Promise<void> {
    if (refreshInFlight.current && !force) return refreshInFlight.current;
    const generation = ++refreshGeneration.current;
    const task = (async () => {
      try {
        const [nextEnvironment, nextAssets, nextProtocols] = await Promise.all([
          api<Environment>("/api/environment"),
          api<Assets>("/api/assets"),
          api<Protocol[]>("/api/protocols"),
        ]);
        if (generation !== refreshGeneration.current) return;
        setEnvironment(nextEnvironment);
        setAssets(nextAssets);
        setProtocols(nextProtocols);
        setSelectedProtocolId((current) =>
          nextProtocols.some((protocol) => protocol.id === current)
            ? current
            : nextProtocols[0]?.id || "http",
        );
        setConnectionError("");
        setLoading(false);
      } catch (cause) {
        if (generation === refreshGeneration.current) {
          setConnectionError((cause as Error).message);
          setLoading(false);
        }
      } finally {
        if (generation === refreshGeneration.current)
          refreshInFlight.current = null;
      }
    })();
    refreshInFlight.current = task;
    return task;
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 2000);
    return () => {
      refreshGeneration.current += 1;
      refreshInFlight.current = null;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!selected) {
      editingId.current = null;
      return;
    }
    if (editingId.current !== selected.id || !dirtyRef.current) {
      setDraft(normalizeConfig(selected.config));
      setDirty(false);
      dirtyRef.current = false;
      editingId.current = selected.id;
    }
  }, [selected]);

  useEffect(() => {
    setConnection(null);
    if (!selectedId) return;
    let active = true;
    api<Connection>(
      `/api/instances/${encodeURIComponent(selectedId)}/connection-info`,
    )
      .then((value) => {
        if (active) setConnection(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [selectedId, effectiveConfigKey]);

  useEffect(() => {
    setLogLines([]);
    setLogConnected(false);
    setPaused(false);
    pausedRef.current = false;
    if (!selectedId) return;
    let active = true;
    const source = new EventSource(
      `/api/instances/${encodeURIComponent(selectedId)}/logs`,
    );
    source.onopen = () => {
      if (active) setLogConnected(true);
    };
    source.onerror = () => {
      if (active) setLogConnected(false);
    };
    source.addEventListener("logs", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent<string>).data) as {
          lines: string[];
        };
        if (active && !pausedRef.current && Array.isArray(data.lines))
          setLogLines(data.lines.slice(-200));
      } catch {
        /* Wait for the next complete snapshot. */
      }
    });
    return () => {
      active = false;
      source.close();
    };
  }, [selectedId]);

  useEffect(() => {
    if (!paused && logRef.current)
      logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logLines, paused]);
  useEffect(() => {
    if (notice) {
      const timer = window.setTimeout(() => setNotice(""), 4500);
      return () => window.clearTimeout(timer);
    }
  }, [notice]);

  async function perform(name: string, action: () => Promise<void>) {
    setBusy(name);
    setError("");
    setNotice("");
    try {
      await action();
      await refresh(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  function edit(config: Config) {
    setDraft(config);
    const changed =
      !selected ||
      !sameGeneratedConfig(config, normalizeConfig(selected.config));
    setDirty(changed);
    dirtyRef.current = changed;
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    await perform("save", async () => {
      validateConfig(draft);
      await api(
        `/api/instances/${encodeURIComponent(selected.id)}/config`,
        "PUT",
        draft,
      );
      dirtyRef.current = false;
      setDirty(false);
      setNotice("配置已保存。运行中的 HTTP 服务会继续使用当前生效参数。");
    });
  }
  async function operate(kind: "start" | "stop" | "restart") {
    if (!selected) return;
    await perform(kind, async () => {
      await api(
        `/api/instances/${encodeURIComponent(selected.id)}/${kind}`,
        "POST",
        {},
      );
      setNotice("操作已受理，正在核对实际运行状态。");
    });
  }
  async function copy(value: string) {
    try {
      await copyText(value);
      setNotice("已复制。");
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  const appliedDiffers = Boolean(
    selected?.applied_config &&
      !sameStoredConfig(selected.config, selected.applied_config),
  );
  const methods = selectedProtocol?.supported_methods || supportedMethods;
  const legacyApplied = isLegacyConfig(selected?.applied_config);
  const legacySaved = isLegacyConfig(selected?.config);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="Protocol Target Lab 首页">
          <span className="brand-mark">
            <Icon name="box" size={24} />
          </span>
          <span>
            PROTOCOL<span className="brand-sub">TARGET LAB</span>
          </span>
        </a>
        <div className="workspace-label">测试环境</div>
        <div className="nav-current">
          <Icon name="globe" />
          <span>协议工作台</span>
        </div>
        <div className="sidebar-section">
          <span>已接入协议</span>
          <span className="subtle-pill">{protocols.length}</span>
        </div>
        <nav className="protocol-navigation" aria-label="协议工作台">
          {protocols.map((protocol) => (
            <button
              key={protocol.id}
              type="button"
              className={`protocol-workspace-button ${protocol.id === selectedProtocolId ? "selected" : ""}`}
              aria-current={
                protocol.id === selectedProtocolId ? "page" : undefined
              }
              onClick={() => setSelectedProtocolId(protocol.id)}
            >
              <span className="protocol-symbol">
                {protocol.name.slice(0, 1)}
              </span>
              <span className="protocol-nav-content">
                <strong>{protocol.name}</strong>
                <Status
                  value={connectionError ? "checking" : protocol.status}
                />
                {protocol.workspace?.current_operation && (
                  <span className="protocol-nav-operation">
                    正在执行：{protocol.workspace.current_operation.kind}
                  </span>
                )}
                {(connectionError ||
                  protocol.error ||
                  protocol.workspace?.error) && (
                  <span
                    className="protocol-nav-error"
                    title={
                      connectionError ||
                      protocol.error ||
                      protocol.workspace?.error ||
                      ""
                    }
                  >
                    {connectionError
                      ? "管理连接中断，状态待核对"
                      : protocol.error || protocol.workspace?.error}
                  </span>
                )}
              </span>
            </button>
          ))}
          {!protocols.length && (
            <p className="sidebar-loading">
              {loading ? "正在读取协议…" : "无法读取协议目录"}
            </p>
          )}
        </nav>
        <div className="sidebar-footer">
          <span
            className={`sidebar-dot ${environment?.docker_available && !connectionError ? "" : "offline"}`}
          />
          <div>
            {connectionError
              ? "环境状态待核对"
              : environment?.docker_available
                ? "Docker 已连接"
                : environment
                  ? "Docker 未连接"
                  : "正在检查环境"}
            <span>本地实验环境</span>
          </div>
        </div>
      </aside>

      <main>
        <header className="page-header">
          <div>
            <div className="eyebrow">PROTOCOL TARGET LAB / 协议工作台</div>
            <h1>
              {selectedProtocol
                ? `${selectedProtocol.name} 协议`
                : "协议工作台"}
            </h1>
            <p>配置协议目标，查看实际运行状态与收发日志。</p>
          </div>
        </header>

        {connectionError && (
          <div className="banner error" role="alert">
            无法同步运行状态：{connectionError}
            。当前状态待重新核对；编辑中的草稿会保留。
          </div>
        )}

        {error && (
          <div className="banner error" role="alert">
            <span>{error}</span>
            <button aria-label="关闭错误提示" onClick={() => setError("")}>
              <Icon name="close" />
            </button>
          </div>
        )}
        {notice && (
          <div className="banner success" role="status">
            <span>
              <Icon name="check" />
              {notice}
            </span>
            <button aria-label="关闭提示" onClick={() => setNotice("")}>
              <Icon name="close" />
            </button>
          </div>
        )}
        {environment?.config_error && (
          <div className="banner error" role="alert">
            配置不可用：{environment.config_error}
            。请修复原文件，服务不会用空配置覆盖。
          </div>
        )}

        <section className="summary-grid" aria-label="环境概况">
          <div className="summary-card">
            <span className="summary-icon">
              <Icon name="box" />
            </span>
            <div>
              <span>{selectedProtocol?.name || "协议"} 运行状态</span>
              <strong className="summary-text">
                <Status value={displayedStatus} />
              </strong>
            </div>
            <span className="summary-caption">按实际容器状态核对</span>
          </div>
          <div className="summary-card">
            <span className="summary-icon">
              <Icon name="check" />
            </span>
            <div>
              <span>Docker Engine</span>
              <strong className="summary-text">
                {connectionError
                  ? "待核对"
                  : environment
                    ? environment.docker_available
                      ? "已连接"
                      : "不可用"
                    : "连接中"}
              </strong>
            </div>
            <span className="summary-caption">
              {environment?.docker_version ||
                environment?.error ||
                "等待环境信息"}
            </span>
          </div>
          <div className="summary-card">
            <span className="summary-icon">
              <Icon name="terminal" />
            </span>
            <div>
              <span>HTTP 运行镜像</span>
              <strong className="summary-text">
                {connectionError
                  ? "待核对"
                  : assets
                    ? assets.available
                      ? "已就绪"
                      : "缺少镜像"
                    : "检查中"}
              </strong>
            </div>
            <span className="summary-caption mono" title={assets?.image}>
              {assets?.image || "检查本地资源"}
            </span>
          </div>
        </section>

        <div className="workspace">
          {selected ? (
            <div className="instance-detail">
              <section className="panel detail-top">
                <div className="detail-heading">
                  <div className="instance-title">
                    <span className="protocol-badge">HTTP</span>
                    <h2>{selectedProtocol?.name || "HTTP"} 工作台</h2>
                    <Status value={displayedStatus} />
                  </div>
                </div>
                <p className="instance-description">
                  受控 HTTP 测试服务 <span>·</span> Docker <span>·</span>{" "}
                  HTTP/1.1
                </p>
                <div className="method-support">
                  <span>
                    {legacyApplied ? "新生成模式支持的方法" : "支持的方法"}
                  </span>
                  <div>
                    {methods.map((method) => (
                      <code key={method}>{method}</code>
                    ))}
                  </div>
                  <p>
                    {legacyApplied
                      ? "旧生效配置保留旧版能力；保存新配置并重启后，切换到上述方法和响应生成规则。"
                      : "HEAD 无正文；GET、POST、PUT、PATCH、DELETE、OPTIONS 均按配置生成响应正文。"}
                  </p>
                </div>
                <div className="instance-actions">
                  <button
                    className="button primary"
                    disabled={locked || Boolean(environment?.config_error)}
                    onClick={() => void operate("start")}
                  >
                    <Icon name="play" />
                    {busy === "start" ? "提交中…" : "运行"}
                  </button>
                  <button
                    className="button"
                    disabled={locked || Boolean(environment?.config_error)}
                    onClick={() => void operate("stop")}
                  >
                    <Icon name="stop" />
                    停止
                  </button>
                  <button
                    className="button"
                    disabled={locked || Boolean(environment?.config_error)}
                    onClick={() => void operate("restart")}
                  >
                    <Icon name="refresh" />
                    重启并应用配置
                  </button>
                </div>
                <div className="intent-line">
                  <span
                    className={`mini-dot ${selected.enabled ? "on" : ""}`}
                  />
                  <span>
                    {selected.enabled
                      ? selected.applied_config
                        ? "已启用 · 管理服务或设备恢复后，使用生效配置恢复运行"
                        : "已启用 · 首次启动尚未成功，需要显式重试"
                      : "已禁用 · 不会自动恢复运行"}
                  </span>
                </div>
                {selected.current_operation && (
                  <div className="inline-note">
                    正在执行：{selected.current_operation.kind}
                    。操作受理与业务成功分别核对。
                  </div>
                )}
                {selected.error && (
                  <div className="inline-error" role="alert">
                    {selected.error}
                  </div>
                )}
              </section>

              <div className="detail-columns">
                <section className="panel config-panel">
                  <div className="panel-heading">
                    <h2>HTTP 配置</h2>
                    <span className={`draft-label ${dirty ? "dirty" : ""}`}>
                      {dirty
                        ? "尚未保存"
                        : appliedDiffers
                          ? "有待应用的配置"
                          : "已保存"}
                    </span>
                  </div>
                  <form onSubmit={(event) => void save(event)}>
                    {(legacySaved || legacyApplied) && (
                      <div className="migration-note" role="note">
                        {legacySaved
                          ? "此工作台含旧版固定正文配置。旧运行配置仍保留；编辑草稿初始长度取旧正文的 UTF-8 字节数。保存并重启后使用新的内容生成模式，正文不再保留原文本，POST 不再回显请求正文。"
                          : "新配置已保存，旧生效配置仍保留固定正文和 POST 回显行为。显式重启后才切换到新的内容生成模式和方法支持。"}
                      </div>
                    )}
                    <ConfigFields
                      config={draft}
                      onChange={edit}
                      prefix="edit"
                      disabled={
                        Boolean(environment?.config_error) || busy === "save"
                      }
                    />
                    <div className="config-meta">
                      <span>精确按字节计数</span>
                      <span>
                        {Number.isFinite(draft.response_length)
                          ? draft.response_length.toLocaleString()
                          : "—"}{" "}
                        字节 ·{" "}
                        {draft.response_mode === "fixed"
                          ? "固定内容"
                          : "每次随机"}
                      </span>
                    </div>
                    <div className="form-footer">
                      <p>
                        保存配置不会自动重启。点击“运行”或“重启并应用配置”后生效。
                      </p>
                      <button
                        className="button primary"
                        disabled={locked || Boolean(environment?.config_error)}
                        type="submit"
                      >
                        {busy === "save" ? "保存中…" : "保存配置"}
                      </button>
                    </div>
                  </form>
                  <div className="applied-config">
                    <h3>当前生效参数</h3>
                    {selected.applied_config ? (
                      <dl>
                        <div>
                          <dt>绑定地址</dt>
                          <dd>{selected.applied_config.bind_ip}</dd>
                        </div>
                        <div>
                          <dt>TCP 端口</dt>
                          <dd>{selected.applied_config.port}</dd>
                        </div>
                        <div>
                          <dt>响应配置</dt>
                          <dd className="applied-body">
                            {isLegacyConfig(selected.applied_config)
                              ? `旧版固定正文 ${new TextEncoder().encode(selected.applied_config.response_body).length.toLocaleString()} 字节（POST 回显）`
                              : `${selected.applied_config.response_length.toLocaleString()} 字节 · ${selected.applied_config.response_mode === "fixed" ? "固定内容" : "每次随机"}`}
                          </dd>
                        </div>
                        <div>
                          <dt>容器</dt>
                          <dd title={selected.container_id || ""}>
                            {selected.container_id?.slice(0, 12) || "未运行"}
                          </dd>
                        </div>
                      </dl>
                    ) : (
                      <p>首次成功启动后显示。</p>
                    )}
                  </div>
                </section>

                <section className="panel log-panel">
                  <div className="panel-heading">
                    <div className="log-title">
                      <h2>实时日志</h2>
                      <span
                        className={`stream-dot ${logConnected && !paused ? "connected" : ""}`}
                      />
                      <span className="stream-status">
                        {paused
                          ? "已暂停跟随"
                          : logConnected
                            ? "正在跟随"
                            : "等待连接"}
                      </span>
                    </div>
                    <div className="log-tools">
                      <button
                        className={`icon-button ${paused ? "active" : ""}`}
                        title={paused ? "恢复跟随" : "暂停跟随"}
                        aria-label={paused ? "恢复跟随" : "暂停跟随"}
                        onClick={() => {
                          pausedRef.current = !paused;
                          setPaused(!paused);
                        }}
                      >
                        <Icon name={paused ? "play" : "pause"} size={16} />
                      </button>
                      <button
                        className="icon-button"
                        title="复制日志"
                        aria-label="复制日志"
                        onClick={() => void copy(logLines.join("\n"))}
                      >
                        <Icon name="copy" size={16} />
                      </button>
                      <button
                        className="icon-button"
                        title="下载日志"
                        aria-label="下载日志"
                        onClick={() => {
                          const url = URL.createObjectURL(
                            new Blob([logLines.join("\n") + "\n"], {
                              type: "text/plain;charset=utf-8",
                            }),
                          );
                          const link = document.createElement("a");
                          link.href = url;
                          link.download = `${selected.id}.log`;
                          link.click();
                          URL.revokeObjectURL(url);
                        }}
                      >
                        <Icon name="download" size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="log-meta">
                    <span>来源：Docker stdout / stderr</span>
                    <span>最近 200 行</span>
                  </div>
                  <pre
                    className="log-content"
                    ref={logRef}
                    tabIndex={0}
                    aria-label="HTTP 服务日志"
                  >
                    {logLines.length
                      ? logLines.join("\n")
                      : "等待 HTTP 服务日志…\n启动 HTTP 服务后，在此查看请求与响应事件。"}
                  </pre>
                  <div className="log-footer">
                    <span>
                      日志为有界快照，收发预览可能截断；原始长度见日志字段。
                    </span>
                  </div>
                </section>
              </div>

              <section className="panel connection-panel">
                <div className="panel-heading">
                  <h2>连接与验证</h2>
                  <span className="muted">内置测试与手动接入</span>
                </div>
                <ClientTests
                  key={selected.id}
                  instance={selected}
                  hasUnappliedConfig={dirty || appliedDiffers}
                  operationsLocked={locked}
                />
                <details className="connection-help">
                  <summary>手动接入与 curl 命令</summary>
                  <div className="connection-content">
                    <div className="endpoint">
                      <span>HTTP 入口</span>
                      <code>
                        {connection?.base_url ||
                          `http://${(selected.applied_config || selected.config).bind_ip}:${(selected.applied_config || selected.config).port}`}
                      </code>
                      <p>绑定 0.0.0.0 时，请使用目标设备实际可达的 IP。</p>
                    </div>
                    <div className="command-list">
                      {(
                        connection?.commands || [
                          `curl -i http://<目标IP>:${(selected.applied_config || selected.config).port}/ok`,
                          `curl -i http://<目标IP>:${(selected.applied_config || selected.config).port}/chunked`,
                          `curl -i http://<目标IP>:${(selected.applied_config || selected.config).port}/close`,
                        ]
                      ).map((command, index) => (
                        <div className="command" key={index}>
                          <code>{command}</code>
                          <button
                            className="icon-button"
                            aria-label={`复制命令 ${index + 1}`}
                            title="复制命令"
                            onClick={() => void copy(command)}
                          >
                            <Icon name="copy" size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </details>
              </section>
            </div>
          ) : (
            <section className="panel empty-state">
              <div className="empty-symbol">
                <Icon name="globe" size={38} />
              </div>
              <h2>
                {loading
                  ? "正在读取协议工作台"
                  : `${selectedProtocol?.name || "HTTP"} 工作台不可用`}
              </h2>
              <p>
                {selectedProtocol?.error ||
                  environment?.config_error ||
                  (loading
                    ? "正在核对配置与运行资源。"
                    : "无法取得协议工作台配置，请查看管理服务诊断。")}
              </p>
              <div className="supported-paths">
                <code>/ok</code>
                <code>/chunked</code>
                <code>/close</code>
                <span>{methods.join(" · ")}</span>
              </div>
            </section>
          )}
        </div>
        <footer className="page-footer">
          <span>Protocol Target Lab</span>
          <span>
            管理服务停止后，被测容器可以继续运行。整体停止请使用 plabctl
            stop-all。
          </span>
        </footer>
      </main>
    </div>
  );
}
