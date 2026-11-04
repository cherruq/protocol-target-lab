import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

type Config = { bind_ip: string; port: number; response_body: string };
type Instance = {
  id: string;
  protocol_id: string;
  runtime: string;
  enabled: boolean;
  config: Config;
  applied_config: Config | null;
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
};

const defaults: Config = {
  bind_ip: "0.0.0.0",
  port: 18090,
  response_body: "hello",
};
const statusNames: Record<string, string> = {
  stopped: "已停止",
  starting: "启动中",
  running: "运行中",
  stopping: "停止中",
  error: "运行错误",
  "needs-config": "待配置",
  "environment-unavailable": "环境不可用",
};

async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
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
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
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
    trash: (
      <>
        <path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" />
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
      <label htmlFor={`${prefix}-body`}>
        固定响应正文
        <textarea
          id={`${prefix}-body`}
          value={config.response_body}
          onChange={(event) =>
            onChange({ ...config, response_body: event.target.value })
          }
          rows={3}
          maxLength={65536}
          disabled={disabled}
        />
        <span className="field-help">GET 返回此内容，POST 回显请求正文。</span>
      </label>
    </>
  );
}

export default function App() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [environment, setEnvironment] = useState<Environment | null>(null);
  const [assets, setAssets] = useState<Assets | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Config>({ ...defaults });
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const editingId = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [create, setCreate] = useState<{ id: string; config: Config } | null>(
    null,
  );
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logConnected, setLogConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [probe, setProbe] = useState<unknown>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const selected = instances.find((instance) => instance.id === selectedId);
  const effectiveConfigKey = JSON.stringify(
    selected?.applied_config || selected?.config || null,
  );
  const modalOpen = create !== null || deleteId !== null;
  const locked = Boolean(
    busy ||
      selected?.current_operation ||
      selected?.status === "starting" ||
      selected?.status === "stopping",
  );

  async function refresh() {
    const [nextInstances, nextEnvironment, nextAssets, nextProtocols] =
      await Promise.all([
        api<Instance[]>("/api/instances"),
        api<Environment>("/api/environment"),
        api<Assets>("/api/assets"),
        api<Protocol[]>("/api/protocols"),
      ]);
    setInstances(nextInstances);
    setEnvironment(nextEnvironment);
    setAssets(nextAssets);
    setProtocols(nextProtocols);
    setSelectedId((current) =>
      nextInstances.some((instance) => instance.id === current)
        ? current
        : nextInstances[0]?.id || null,
    );
    setLoading(false);
  }

  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        await refresh();
      } catch (cause) {
        if (active) {
          setError(String((cause as Error).message));
          setLoading(false);
        }
      }
    }
    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!selected) {
      editingId.current = null;
      return;
    }
    if (editingId.current !== selected.id || !dirtyRef.current) {
      setDraft({ ...selected.config });
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
    setProbe(null);
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

  useEffect(() => {
    if (!modalOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    function containFocus(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setCreate(null);
        setDeleteId(null);
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".modal button:not(:disabled), .modal input:not(:disabled), .modal textarea:not(:disabled)",
        ),
      );
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", containFocus);
    return () => {
      document.removeEventListener("keydown", containFocus);
      previousFocus?.focus();
    };
  }, [modalOpen]);

  async function perform(name: string, action: () => Promise<void>) {
    setBusy(name);
    setError("");
    setNotice("");
    try {
      await action();
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  function edit(config: Config) {
    setDraft(config);
    setDirty(true);
    dirtyRef.current = true;
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    await perform("save", async () => {
      await api(
        `/api/instances/${encodeURIComponent(selected.id)}/config`,
        "PUT",
        draft,
      );
      dirtyRef.current = false;
      setDirty(false);
      setNotice("配置已保存。运行中的实例会继续使用当前生效参数。");
    });
  }
  async function operate(kind: string) {
    if (!selected) return;
    await perform(kind, async () => {
      const result = await api(
        `/api/instances/${encodeURIComponent(selected.id)}/${kind}`,
        "POST",
        {},
      );
      if (kind === "probe") setProbe(result);
      else setNotice("操作已受理，正在核对实际运行状态。");
    });
  }
  async function createInstance(event: FormEvent) {
    event.preventDefault();
    if (!create) return;
    await perform("create", async () => {
      await api("/api/instances", "POST", {
        id: create.id,
        protocol_id: "http",
        config: create.config,
      });
      setSelectedId(create.id);
      setCreate(null);
      setNotice("实例已创建，可保存参数后启动。");
    });
  }
  async function remove() {
    if (!deleteId) return;
    await perform("delete", async () => {
      await api(`/api/instances/${encodeURIComponent(deleteId)}`, "DELETE");
      setDeleteId(null);
      setNotice("实例已删除。");
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
      JSON.stringify(selected.config) !==
        JSON.stringify(selected.applied_config),
  );
  const running = instances.filter(
    (instance) => instance.status === "running",
  ).length;
  const bodyBytes = new TextEncoder().encode(draft.response_body).length;

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
          <span>协议实例</span>
          <span className="nav-count">{instances.length}</span>
        </div>
        <div className="sidebar-section">
          <span>已接入协议</span>
          <span className="subtle-pill">{protocols.length}</span>
        </div>
        <div className="protocol-item">
          <span className="protocol-symbol">H</span>
          <div>
            HTTP<span>HTTP/1.1 · Docker</span>
          </div>
          <span className="sidebar-dot" />
        </div>
        <div className="sidebar-footer">
          <span
            className={`sidebar-dot ${environment?.docker_available ? "" : "offline"}`}
          />
          <div>
            {environment?.docker_available ? "Docker 已连接" : "Docker 未连接"}
            <span>本地实验环境 · v0.1.0</span>
          </div>
        </div>
      </aside>

      <main>
        <header className="page-header">
          <div>
            <div className="eyebrow">PROTOCOL TARGET LAB / 工作台</div>
            <h1>协议实例</h1>
            <p>配置测试目标，查看实际状态与协议日志。</p>
          </div>
          <button
            className="button primary"
            onClick={() => setCreate({ id: "", config: { ...defaults } })}
            disabled={Boolean(environment?.config_error)}
          >
            <Icon name="plus" />
            新建实例
          </button>
        </header>

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
            配置文件不可读：{environment.config_error}
            。请修复原文件，服务不会用空配置覆盖。
          </div>
        )}

        <section className="summary-grid" aria-label="环境概况">
          <div className="summary-card">
            <span className="summary-icon">
              <Icon name="box" />
            </span>
            <div>
              <span>运行实例</span>
              <strong>
                {running}
                <small> / {instances.length}</small>
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
                {environment
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
                {assets ? (assets.available ? "已就绪" : "缺少镜像") : "检查中"}
              </strong>
            </div>
            <span className="summary-caption mono" title={assets?.image}>
              {assets?.image || "检查本地资源"}
            </span>
          </div>
        </section>

        <div className="workspace">
          <section
            className="instance-list panel"
            aria-labelledby="instances-title"
          >
            <div className="panel-heading">
              <h2 id="instances-title">实例列表</h2>
              <span className="count-label">{instances.length}</span>
            </div>
            {loading ? (
              <div className="empty-small">正在读取实例…</div>
            ) : instances.length ? (
              <div className="instance-items">
                {instances.map((instance) => (
                  <button
                    className={`instance-item ${selectedId === instance.id ? "selected" : ""}`}
                    key={instance.id}
                    onClick={() => setSelectedId(instance.id)}
                  >
                    <span className="instance-icon">
                      <Icon name="globe" />
                    </span>
                    <span className="instance-label">
                      <strong>{instance.id}</strong>
                      <span>
                        {instance.applied_config?.bind_ip ||
                          instance.config.bind_ip}
                        :{instance.applied_config?.port || instance.config.port}
                      </span>
                      <Status value={instance.status} />
                    </span>
                    <span className="chevron">›</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-small">
                还没有 HTTP 实例。
                <br />
                点击“新建实例”开始。
              </div>
            )}
            <div className="list-footnote">
              每个实例拥有独立配置、运行状态和日志。
            </div>
          </section>

          {selected ? (
            <div className="instance-detail">
              <section className="panel detail-top">
                <div className="detail-heading">
                  <div className="instance-title">
                    <span className="protocol-badge">HTTP</span>
                    <h2>{selected.id}</h2>
                    <Status value={selected.status} />
                  </div>
                  <div className="detail-tools">
                    <button
                      className="icon-button"
                      title="复制为新实例"
                      aria-label="复制为新实例"
                      onClick={() =>
                        setCreate({
                          id: `${selected.id.slice(0, 43)}-copy`,
                          config: { ...selected.config },
                        })
                      }
                    >
                      <Icon name="copy" />
                    </button>
                    <button
                      className="icon-button danger"
                      title="删除实例"
                      aria-label="删除实例"
                      onClick={() => setDeleteId(selected.id)}
                      disabled={
                        locked ||
                        selected.enabled ||
                        selected.status !== "stopped"
                      }
                    >
                      <Icon name="trash" />
                    </button>
                  </div>
                </div>
                <p className="instance-description">
                  受控 HTTP 测试服务 <span>·</span> Docker <span>·</span>{" "}
                  HTTP/1.1
                </p>
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
                  <button
                    className="button text-button"
                    disabled={locked || selected.status !== "running"}
                    onClick={() => void operate("probe")}
                  >
                    业务探测 ↗
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
                {probe !== null && (
                  <div className="probe-result">
                    <div>
                      <strong>最近一次业务探测</strong>
                      <button
                        className="icon-button"
                        aria-label="收起探测结果"
                        onClick={() => setProbe(null)}
                      >
                        <Icon name="close" size={15} />
                      </button>
                    </div>
                    <pre>{JSON.stringify(probe, null, 2)}</pre>
                  </div>
                )}
              </section>

              <div className="detail-columns">
                <section className="panel config-panel">
                  <div className="panel-heading">
                    <h2>实例配置</h2>
                    <span className={`draft-label ${dirty ? "dirty" : ""}`}>
                      {dirty
                        ? "尚未保存"
                        : appliedDiffers
                          ? "有待应用的配置"
                          : "已保存"}
                    </span>
                  </div>
                  <form onSubmit={(event) => void save(event)}>
                    <ConfigFields
                      config={draft}
                      onChange={edit}
                      prefix="edit"
                      disabled={
                        Boolean(environment?.config_error) || busy === "save"
                      }
                    />
                    <div className="config-meta">
                      <span>UTF-8 正文</span>
                      <span>{bodyBytes.toLocaleString()} 字节</span>
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
                          <dt>响应正文</dt>
                          <dd className="applied-body">
                            {selected.applied_config.response_body ||
                              "（空正文）"}
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
                    aria-label="实例日志"
                  >
                    {logLines.length
                      ? logLines.join("\n")
                      : "等待实例日志…\n启动实例后，在此查看请求与响应事件。"}
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
                  <span className="muted">使用独立客户端发起请求</span>
                </div>
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
              </section>
            </div>
          ) : (
            <section className="panel empty-state">
              <div className="empty-symbol">
                <Icon name="globe" size={38} />
              </div>
              <h2>
                {loading ? "正在连接管理服务" : "创建第一个 HTTP 测试目标"}
              </h2>
              <p>设置监听地址、端口与响应正文，启动持续运行的测试服务。</p>
              <button
                className="button primary"
                onClick={() =>
                  setCreate({ id: "http-demo", config: { ...defaults } })
                }
                disabled={loading || Boolean(environment?.config_error)}
              >
                <Icon name="plus" />
                新建 HTTP 实例
              </button>
              <div className="supported-paths">
                <code>/ok</code>
                <code>/chunked</code>
                <code>/close</code>
                <span>GET · HEAD · POST</span>
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

      {create && (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget && !busy) setCreate(null);
          }}
        >
          <section
            className="modal panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-title"
          >
            <div className="panel-heading">
              <div>
                <div className="eyebrow">HTTP / DOCKER</div>
                <h2 id="create-title">新建实例</h2>
              </div>
              <button
                className="icon-button"
                aria-label="关闭新建实例"
                disabled={Boolean(busy)}
                onClick={() => setCreate(null)}
              >
                <Icon name="close" />
              </button>
            </div>
            <form onSubmit={(event) => void createInstance(event)}>
              {error && (
                <div className="banner error" role="alert">
                  {error}
                </div>
              )}
              <label htmlFor="create-id">
                实例 ID
                <input
                  id="create-id"
                  value={create.id}
                  onChange={(event) =>
                    setCreate({ ...create, id: event.target.value })
                  }
                  pattern="[a-z0-9][a-z0-9-]{0,47}"
                  maxLength={48}
                  placeholder="例如 http-demo"
                  required
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy === "create"}
                />
                <span className="field-help">
                  1～48 个小写字母、数字和连字符；以字母或数字开头。
                </span>
              </label>
              <ConfigFields
                config={create.config}
                onChange={(config) => setCreate({ ...create, config })}
                prefix="create"
                disabled={busy === "create"}
              />
              <div className="modal-note">
                新实例默认停止，点击“运行”后才会占用协议端口。
              </div>
              <div className="modal-actions">
                <button
                  className="button"
                  type="button"
                  onClick={() => setCreate(null)}
                  disabled={Boolean(busy)}
                >
                  取消
                </button>
                <button
                  className="button primary"
                  type="submit"
                  disabled={Boolean(busy)}
                >
                  {busy === "create" ? "创建中…" : "创建实例"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {deleteId && (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget && !busy)
              setDeleteId(null);
          }}
        >
          <section
            className="modal panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
          >
            <div className="panel-heading">
              <h2 id="delete-title">删除实例</h2>
              <button
                className="icon-button"
                aria-label="关闭删除实例"
                disabled={Boolean(busy)}
                onClick={() => setDeleteId(null)}
              >
                <Icon name="close" />
              </button>
            </div>
            <div className="delete-content">
              {error && (
                <div className="banner error" role="alert">
                  {error}
                </div>
              )}
              <p>
                确认删除实例 <strong>{deleteId}</strong> 及其配置？
              </p>
              <p>只有已停止、已禁用的实例可以删除。</p>
              <div className="modal-actions">
                <button
                  className="button"
                  disabled={Boolean(busy)}
                  autoFocus
                  onClick={() => setDeleteId(null)}
                >
                  取消
                </button>
                <button
                  className="button danger"
                  disabled={Boolean(busy)}
                  onClick={() => void remove()}
                >
                  {busy === "delete" ? "删除中…" : "确认删除"}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
