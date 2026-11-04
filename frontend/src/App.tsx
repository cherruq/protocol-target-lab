import BfdConfigForm from "./BfdConfigForm";
import BfdRuntimePanel from "./BfdRuntimePanel";
import {
  bfdDefaults,
  bfdCaseLabels,
  isBfdConfig,
  validateBfdConfig,
  bfdDescription,
  bfdReportLabel,
  type BfdConfig,
} from "./bfd-config";
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
  isHttpConfig,
  normalizeConfig,
  supportedMethods,
  validateConfig,
  type Config,
  type StoredConfig,
} from "./config";
import ClientTests from "./ClientTests";
import DnsConfigForm from "./DnsConfigForm";
import DnsClientTests from "./DnsClientTests";
import MqttConfigForm from "./MqttConfigForm";
import TelnetConfigForm from "./TelnetConfigForm";
import Iec104ConfigForm from "./Iec104ConfigForm";
import MqttSnConfigForm from "./MqttSnConfigForm";
import RtpConfigForm from "./RtpConfigForm";
import RtcpConfigForm from "./RtcpConfigForm";
import Dlt645ConfigForm from "./Dlt645ConfigForm";
import Iec101ConfigForm from "./Iec101ConfigForm";
import {
  iec101Defaults,
  iec101CaseLabels,
  isIec101Config,
  validateIec101Config,
  iec101Description,
  type Iec101Config,
} from "./iec101-config";
import {
  dlt645Defaults,
  dlt645CaseLabels,
  isDlt645Config,
  validateDlt645Config,
  dlt645Description,
  type Dlt645Config,
} from "./dlt645-config";
import {
  rtcpDefaults,
  rtcpCaseLabels,
  isRtcpConfig,
  validateRtcpConfig,
  rtcpDescription,
  type RtcpConfig,
} from "./rtcp-config";
import {
  rtpDefaults,
  rtpCaseLabels,
  isRtpConfig,
  validateRtpConfig,
  rtpDescription,
  type RtpConfig,
} from "./rtp-config";
import {
  mqttSnDefaults,
  mqttSnCaseLabels,
  isMqttSnConfig,
  validateMqttSnConfig,
  mqttSnDescription,
  type MqttSnConfig,
} from "./mqtt-sn-config";
import {
  iec104Defaults,
  iec104CaseLabels,
  isIec104Config,
  validateIec104Config,
  iec104StartupDescription,
  type Iec104Config,
} from "./iec104-config";
import {
  telnetDefaults,
  telnetCaseLabels,
  isTelnetConfig,
  validateTelnetConfig,
  type TelnetConfig,
} from "./telnet-config";
import ProtocolClientTests from "./ProtocolClientTests";
import {
  mqttDefaults,
  mqttCaseLabels,
  isMqttConfig,
  validateMqttConfig,
  type MqttConfig,
} from "./mqtt-config";
import {
  dnsDefaults,
  isDnsConfig,
  normalizeDnsConfig,
  type DnsConfig,
} from "./dns-config";
import {
  sameWorkspaceConfig,
  updateWorkspaceDrafts,
  discardWorkspaceDraft,
  type WorkspaceConfig,
  type DraftConfig,
} from "./workspace-config";
type Instance = {
  id: string;
  protocol_id: string;
  runtime: string;
  enabled: boolean;
  config: WorkspaceConfig;
  applied_config: WorkspaceConfig | null;
  status: string;
  container_id: string | null;
  error: string | null;
  current_operation: { id: string; kind: string } | null;
  last_result: unknown;
};
type HttpInstance = Omit<Instance, "config" | "applied_config"> & {
  config: StoredConfig;
  applied_config: StoredConfig | null;
};
type DnsInstance = Omit<Instance, "config" | "applied_config"> & {
  config: DnsConfig;
  applied_config: DnsConfig | null;
};
type MqttInstance = Omit<Instance, "config" | "applied_config"> & {
  config: MqttConfig;
  applied_config: MqttConfig | null;
};
type TelnetInstance = Omit<Instance, "config" | "applied_config"> & {
  config: TelnetConfig;
  applied_config: TelnetConfig | null;
};
type Iec104Instance = Omit<Instance, "config" | "applied_config"> & {
  config: Iec104Config;
  applied_config: Iec104Config | null;
};
type MqttSnInstance = Omit<Instance, "config" | "applied_config"> & {
  config: MqttSnConfig;
  applied_config: MqttSnConfig | null;
};
type RtpInstance = Omit<Instance, "config" | "applied_config"> & {
  config: RtpConfig;
  applied_config: RtpConfig | null;
};
type RtcpInstance = Omit<Instance, "config" | "applied_config"> & {
  config: RtcpConfig;
  applied_config: RtcpConfig | null;
};
type Dlt645Instance = Omit<Instance, "config" | "applied_config"> & {
  config: Dlt645Config;
  applied_config: Dlt645Config | null;
};
type Iec101Instance = Omit<Instance, "config" | "applied_config"> & {
  config: Iec101Config;
  applied_config: Iec101Config | null;
};
type BfdInstance = Omit<Instance, "config" | "applied_config"> & {
  config: BfdConfig;
  applied_config: BfdConfig | null;
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
type ImageAsset = { image: string; available: boolean; image_id?: string };
type Assets = ImageAsset & { protocols?: Record<string, ImageAsset> };
type Connection = {
  base_url?: string;
  endpoint?: string;
  endpoints?: { single: string; double: string };
  commands: string[];
};
type Protocol = {
  id: string;
  name: string;
  implementation: string;
  version: string;
  available: boolean;
  supported_methods?: string[];
  supported_transports?: string[];
  supported_versions?: string[];
  supported_qos?: number[];
  supported_features?: string[];
  image?: string;
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
  const [drafts, setDrafts] = useState<Record<string, DraftConfig>>({});
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
  const isDns = selectedProtocol?.id === "dns";
  const isMqtt = selectedProtocol?.id === "mqtt";
  const isTelnet = selectedProtocol?.id === "telnet";
  const isIec104 = selectedProtocol?.id === "iec104";
  const isMqttSn = selectedProtocol?.id === "mqtt-sn";
  const isRtp = selectedProtocol?.id === "rtp";
  const isRtcp = selectedProtocol?.id === "rtcp";
  const isDlt645 = selectedProtocol?.id === "dlt645";
  const isBfd = selectedProtocol?.id === "bfd";
  const isIec101 = selectedProtocol?.id === "iec101";
  const protocolName = selectedProtocol?.name || "协议";
  const httpSelected =
    selectedProtocol?.id === "http" &&
    selected?.protocol_id === "http" &&
    isHttpConfig(selected.config) &&
    (!selected.applied_config || isHttpConfig(selected.applied_config))
      ? (selected as HttpInstance)
      : null;
  const dnsSelected =
    isDns &&
    selected?.protocol_id === "dns" &&
    isDnsConfig(selected.config) &&
    (!selected.applied_config || isDnsConfig(selected.applied_config))
      ? (selected as DnsInstance)
      : null;
  const mqttSelected =
    isMqtt &&
    selected?.protocol_id === "mqtt" &&
    isMqttConfig(selected.config) &&
    (!selected.applied_config || isMqttConfig(selected.applied_config))
      ? (selected as MqttInstance)
      : null;
  const telnetSelected =
    isTelnet &&
    selected?.protocol_id === "telnet" &&
    isTelnetConfig(selected.config) &&
    (!selected.applied_config || isTelnetConfig(selected.applied_config))
      ? (selected as TelnetInstance)
      : null;
  const iec104Selected =
    isIec104 &&
    selected?.protocol_id === "iec104" &&
    isIec104Config(selected.config) &&
    (!selected.applied_config || isIec104Config(selected.applied_config))
      ? (selected as Iec104Instance)
      : null;
  const mqttSnSelected =
    isMqttSn &&
    selected?.protocol_id === "mqtt-sn" &&
    isMqttSnConfig(selected.config) &&
    (!selected.applied_config || isMqttSnConfig(selected.applied_config))
      ? (selected as MqttSnInstance)
      : null;
  const rtpSelected =
    isRtp &&
    selected?.protocol_id === "rtp" &&
    isRtpConfig(selected.config) &&
    (!selected.applied_config || isRtpConfig(selected.applied_config))
      ? (selected as RtpInstance)
      : null;
  const rtcpSelected =
    isRtcp &&
    selected?.protocol_id === "rtcp" &&
    isRtcpConfig(selected.config) &&
    (!selected.applied_config || isRtcpConfig(selected.applied_config))
      ? (selected as RtcpInstance)
      : null;
  const dlt645Selected =
    isDlt645 &&
    selected?.protocol_id === "dlt645" &&
    isDlt645Config(selected.config) &&
    (!selected.applied_config || isDlt645Config(selected.applied_config))
      ? (selected as Dlt645Instance)
      : null;
  const iec101Selected =
    isIec101 &&
    selected?.protocol_id === "iec101" &&
    isIec101Config(selected.config) &&
    (!selected.applied_config || isIec101Config(selected.applied_config))
      ? (selected as Iec101Instance)
      : null;
  const bfdSelected =
    isBfd &&
    selected?.protocol_id === "bfd" &&
    isBfdConfig(selected.config) &&
    (!selected.applied_config || isBfdConfig(selected.applied_config))
      ? (selected as BfdInstance)
      : null;
  const knownWorkspace = Boolean(
    httpSelected ||
      dnsSelected ||
      mqttSelected ||
      telnetSelected ||
      iec104Selected ||
      mqttSnSelected ||
      rtpSelected ||
      rtcpSelected ||
      dlt645Selected ||
      iec101Selected ||
      bfdSelected,
  );
  const cachedDraft = selectedId ? drafts[selectedId] : undefined;
  const draft: Config =
    cachedDraft &&
    !isDnsConfig(cachedDraft) &&
    !isMqttConfig(cachedDraft) &&
    !isTelnetConfig(cachedDraft) &&
    !isIec104Config(cachedDraft) &&
    !isMqttSnConfig(cachedDraft) &&
    !isRtpConfig(cachedDraft) &&
    !isRtcpConfig(cachedDraft) &&
    !isDlt645Config(cachedDraft) &&
    !isIec101Config(cachedDraft) &&
    !isBfdConfig(cachedDraft)
      ? cachedDraft
      : httpSelected
        ? normalizeConfig(httpSelected.config)
        : defaults;
  const dnsDraft: DnsConfig = isDnsConfig(cachedDraft)
    ? cachedDraft
    : dnsSelected?.config || dnsDefaults;
  const mqttDraft: MqttConfig = isMqttConfig(cachedDraft)
    ? cachedDraft
    : mqttSelected?.config || mqttDefaults;
  const telnetDraft: TelnetConfig = isTelnetConfig(cachedDraft)
    ? cachedDraft
    : telnetSelected?.config || telnetDefaults;
  const iec104Draft: Iec104Config = isIec104Config(cachedDraft)
    ? cachedDraft
    : iec104Selected?.config || iec104Defaults;
  const mqttSnDraft: MqttSnConfig = isMqttSnConfig(cachedDraft)
    ? cachedDraft
    : mqttSnSelected?.config || mqttSnDefaults;
  const rtpDraft: RtpConfig = isRtpConfig(cachedDraft)
    ? cachedDraft
    : rtpSelected?.config || rtpDefaults;
  const rtcpDraft: RtcpConfig = isRtcpConfig(cachedDraft)
    ? cachedDraft
    : rtcpSelected?.config || rtcpDefaults;
  const dlt645Draft: Dlt645Config = isDlt645Config(cachedDraft)
    ? cachedDraft
    : dlt645Selected?.config || dlt645Defaults;
  const iec101Draft: Iec101Config = isIec101Config(cachedDraft)
    ? cachedDraft
    : iec101Selected?.config || iec101Defaults;
  const bfdDraft: BfdConfig = isBfdConfig(cachedDraft)
    ? cachedDraft
    : bfdSelected?.config || bfdDefaults;
  const effectiveConfig = selected?.applied_config || selected?.config;
  const effectivePort =
    effectiveConfig && isIec101Config(effectiveConfig)
      ? effectiveConfig.single.port
      : effectiveConfig && isBfdConfig(effectiveConfig)
        ? 3784
        : effectiveConfig?.port;
  const effectiveSecondPort =
    effectiveConfig && isIec101Config(effectiveConfig)
      ? effectiveConfig.double.port
      : undefined;
  const dirty = Boolean(cachedDraft);
  const selectedAsset =
    assets?.protocols?.[selectedProtocolId] ||
    (selectedProtocolId === "http" ? assets : null);
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

  function edit(config: DraftConfig) {
    if (!selected || !knownWorkspace) return;
    setDrafts((current) =>
      updateWorkspaceDrafts(current, selected.id, config, selected.config),
    );
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!selected || !knownWorkspace) return;
    await perform("save", async () => {
      const payload = isBfd
        ? bfdDraft
        : isDns
          ? normalizeDnsConfig(dnsDraft)
          : isMqtt
            ? mqttDraft
            : isTelnet
              ? telnetDraft
              : isIec104
                ? iec104Draft
                : isMqttSn
                  ? mqttSnDraft
                  : isRtp
                    ? rtpDraft
                    : isRtcp
                      ? rtcpDraft
                      : isDlt645
                        ? dlt645Draft
                        : isIec101
                          ? iec101Draft
                          : draft;
      if (isBfd) validateBfdConfig(bfdDraft);
      else if (isIec101) validateIec101Config(iec101Draft);
      else if (isDlt645) validateDlt645Config(dlt645Draft);
      else if (isRtcp) validateRtcpConfig(rtcpDraft);
      else if (isRtp) validateRtpConfig(rtpDraft);
      else if (isMqttSn) validateMqttSnConfig(mqttSnDraft);
      else if (isIec104) validateIec104Config(iec104Draft);
      else if (isTelnet) validateTelnetConfig(telnetDraft);
      else if (isMqtt) validateMqttConfig(mqttDraft);
      else if (!isDns) validateConfig(draft);
      await api(
        `/api/instances/${encodeURIComponent(selected.id)}/config`,
        "PUT",
        payload,
      );
      setDrafts((current) => discardWorkspaceDraft(current, selected.id));
      setNotice(
        `${protocolName} 配置已保存。运行中的服务会继续使用当前生效参数。`,
      );
    });
  }
  async function operate(kind: "start" | "stop" | "restart") {
    if (!selected || !knownWorkspace) return;
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
      !sameWorkspaceConfig(selected.config, selected.applied_config),
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
              onClick={() => {
                setSelectedProtocolId(protocol.id);
                setError("");
                setNotice("");
              }}
            >
              <span className="protocol-symbol">
                {protocol.name.slice(0, 1)}
              </span>
              <span className="protocol-nav-content">
                <strong>{protocol.name}</strong>
                <Status
                  value={connectionError ? "checking" : protocol.status}
                />
                {protocol.workspace && drafts[protocol.workspace.id] && (
                  <span className="protocol-nav-operation">草稿未保存</span>
                )}
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
              <span>{protocolName} 运行镜像</span>
              <strong className="summary-text">
                {connectionError
                  ? "待核对"
                  : selectedAsset
                    ? selectedAsset.available
                      ? "已就绪"
                      : "缺少镜像"
                    : "检查中"}
              </strong>
            </div>
            <span className="summary-caption mono" title={selectedAsset?.image}>
              {selectedAsset?.image ||
                selectedProtocol?.image ||
                "检查本地资源"}
            </span>
          </div>
        </section>

        <div className="workspace">
          {selected && knownWorkspace ? (
            <div className="instance-detail">
              <section className="panel detail-top">
                <div className="detail-heading">
                  <div className="instance-title">
                    <span className="protocol-badge">{protocolName}</span>
                    <h2>{selectedProtocol?.name || "HTTP"} 工作台</h2>
                    <Status value={displayedStatus} />
                  </div>
                </div>
                <p className="instance-description">
                  受控 {protocolName} 测试服务 <span>·</span> Docker{" "}
                  <span>·</span>{" "}
                  {isBfd
                    ? `${selectedProtocol?.implementation || "Python stdlib BFD"} · IPv4 单跳异步`
                    : isIec101
                      ? `${selectedProtocol?.implementation || "lib60870-C 2.4.1"} · 原生双通道 PTY / TCP`
                      : isDlt645
                        ? `${selectedProtocol?.implementation || "DL/T645-2007 software meter"} · TCP 软件电表`
                        : isRtcp
                          ? `${selectedProtocol?.implementation || "RTCPv2 SR+SDES receiver"} · UDP 接收`
                          : isRtp
                            ? `${selectedProtocol?.implementation || "RTPv2 receiver"} · UDP 接收`
                            : isMqttSn
                              ? `${selectedProtocol?.implementation || "Paho 1.5.1"}（含注册容量保护修正） · UDP 网关`
                              : isIec104
                                ? `${selectedProtocol?.implementation || "c104 2.2.1"}（含 TCP 分帧修正） · TCP`
                                : isTelnet
                                  ? `${selectedProtocol?.implementation || "TELNET"} · TCP`
                                  : isDns
                                    ? "UDP / TCP"
                                    : isMqtt
                                      ? `${selectedProtocol?.implementation || "MQTT"} · 匿名 TCP`
                                      : "HTTP/1.1"}
                </p>
                <div className="method-support">
                  <span>
                    {isBfd
                      ? "固定对端与场景"
                      : isIec101
                        ? "固定双通道与原生协议"
                        : isDlt645
                          ? "有限软件电表与实验边界"
                          : isRtcp
                            ? "固定 profile 与接收范围"
                            : isRtp
                              ? "接收与观察范围"
                              : isMqttSn
                                ? "本轮验收与原生部署"
                                : isIec104
                                  ? "固定类型与命令模式"
                                  : isTelnet
                                    ? "协议协商能力"
                                    : isMqtt
                                      ? "支持的版本与 QoS"
                                      : isDns
                                        ? "支持的传输"
                                        : legacyApplied
                                          ? "新生成模式支持的方法"
                                          : "支持的方法"}
                  </span>
                  <div>
                    {(isBfd
                      ? ["BFD Control", "UDP 3784", "Active", "24字节 · 无认证"]
                      : isIec101
                        ? [
                            "IEC101 非平衡",
                            "single 1/1/1/1",
                            "double 2/2/2/3",
                            "9600/8N1（PTY请求）",
                          ]
                        : isDlt645
                          ? [
                              "DL/T645-2007",
                              "TCP 字节流",
                              "默认 ALL 只读",
                              "软件状态",
                            ]
                          : isRtcp
                            ? ["RTCPv2", "UDP", "SR + SDES", "独立接收证据"]
                            : isRtp
                              ? [
                                  "RTPv2",
                                  "UDP",
                                  "CSRC / 扩展 / 填充",
                                  "有界接收证据",
                                ]
                              : isMqttSn
                                ? [
                                    "UDP",
                                    "QoS 1（本轮验收）",
                                    "组播 GWINFO",
                                    "同容器私有 Broker",
                                  ]
                                : isIec104
                                  ? [
                                      "M_SP_NA_1",
                                      "M_ME_NC_1",
                                      "C_SC_NA_1",
                                      "DIRECT",
                                    ]
                                  : isTelnet
                                    ? selectedProtocol?.supported_features || []
                                    : isMqtt
                                      ? [
                                          ...(
                                            selectedProtocol?.supported_versions ||
                                            []
                                          ).map((v) => `MQTT ${v}`),
                                          ...(
                                            selectedProtocol?.supported_qos ||
                                            []
                                          ).map((q) => `QoS ${q}`),
                                        ]
                                      : isDns
                                        ? selectedProtocol?.supported_transports || [
                                            "UDP",
                                            "TCP",
                                          ]
                                        : methods
                    ).map((method) => (
                      <code key={method}>{method}</code>
                    ))}
                  </div>
                  <p>
                    {isBfd
                      ? "服务自主运行并维持一个固定对端会话。Down 是合法监测状态，不等于本地服务故障；ALL 只验证当前生效场景两个新鲜轮次，不自动切换六种模式。"
                      : isIec101
                        ? "两个独立通道同时启用，各一个活动 TCP 主站连接。原生 FT1.2 / ASDU 经软件 PTY 透明传输；不是 IEC104，也不代表物理 RS-232/485 线速、电压或现场设备验收。"
                        : isDlt645
                          ? "TCP 软件电表保留有限软件读写、冻结与控制行为。默认 ALL 仅核心只读 8 项；可选写周期会恢复原当前值，扩展 03 仅拒绝或固定传输 fixture（crypto_verified=false）。不代表物理 RS-485、继电器、ESAM 或密码学认证。"
                          : isRtcp
                            ? "固定 SR+SDES compound 接收 profile，全包验证与匹配 CNAME；不发送 RR / ACK，不依赖 RTP 工作台。私有观察器只提供实际接收证据，不是 RTCP 协议回复。"
                            : isRtp
                              ? "单向接收并记录实际 RTP 字段与原始载荷，不发送 RTP ACK、不解码或播放媒体。内置测试通过私有只读观察器核对目标真实接收，发送成功本身不代表已接收。"
                              : isMqttSn
                                ? "本轮验证 QoS 1 端到端收发及真实组播发现，其他原生 QoS 能力未在本轮验收。网关及私有 Broker 使用同一容器，不依赖 MQTT 工作台是否运行。"
                                : isIec104
                                  ? "三个固定角色用于实验模拟。单点和测量显示启动初值；实时点值以 GI / READ 的实际返回为准。DIRECT 命令仅修改模拟内存，不连接或驱动物理设备。"
                                  : isTelnet
                                    ? "使用真实 Telnet 协议栈进行 IAC 协商；实验应用提供 ECHO、INFO、CLOSE，不提供系统登录或 shell。"
                                    : isMqtt
                                      ? "支持发布 / 订阅与 QoS 0、1、2。当前使用匿名 TCP，不提供 TLS、密码认证、WebSocket 或 SCRAM。"
                                      : isDns
                                        ? "按配置记录回答 A / AAAA 查询。UDP 和 TCP 可分别启用，使用同一组记录与端口。"
                                        : legacyApplied
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
                    <h2>{protocolName} 配置</h2>
                    <span className={`draft-label ${dirty ? "dirty" : ""}`}>
                      {dirty
                        ? "尚未保存"
                        : appliedDiffers
                          ? "有待应用的配置"
                          : "已保存"}
                    </span>
                  </div>
                  <form onSubmit={(event) => void save(event)}>
                    {httpSelected && (legacySaved || legacyApplied) && (
                      <div className="migration-note" role="note">
                        {legacySaved
                          ? "此工作台含旧版固定正文配置。旧运行配置仍保留；编辑草稿初始长度取旧正文的 UTF-8 字节数。保存并重启后使用新的内容生成模式，正文不再保留原文本，POST 不再回显请求正文。"
                          : "新配置已保存，旧生效配置仍保留固定正文和 POST 回显行为。显式重启后才切换到新的内容生成模式和方法支持。"}
                      </div>
                    )}
                    {isBfd ? (
                      <BfdConfigForm
                        config={bfdDraft}
                        onChange={edit}
                        disabled={
                          Boolean(environment?.config_error) || busy === "save"
                        }
                      />
                    ) : isIec101 ? (
                      <Iec101ConfigForm
                        config={iec101Draft}
                        onChange={edit}
                        disabled={
                          Boolean(environment?.config_error) || busy === "save"
                        }
                      />
                    ) : isDlt645 ? (
                      <Dlt645ConfigForm
                        config={dlt645Draft}
                        onChange={edit}
                        disabled={
                          Boolean(environment?.config_error) || busy === "save"
                        }
                      />
                    ) : isRtcp ? (
                      <RtcpConfigForm
                        config={rtcpDraft}
                        onChange={edit}
                        disabled={
                          Boolean(environment?.config_error) || busy === "save"
                        }
                      />
                    ) : isRtp ? (
                      <RtpConfigForm
                        config={rtpDraft}
                        onChange={edit}
                        disabled={
                          Boolean(environment?.config_error) || busy === "save"
                        }
                      />
                    ) : isMqttSn ? (
                      <MqttSnConfigForm
                        config={mqttSnDraft}
                        onChange={edit}
                        disabled={
                          Boolean(environment?.config_error) || busy === "save"
                        }
                      />
                    ) : isIec104 ? (
                      <Iec104ConfigForm
                        config={iec104Draft}
                        onChange={edit}
                        disabled={
                          Boolean(environment?.config_error) || busy === "save"
                        }
                      />
                    ) : isTelnet ? (
                      <TelnetConfigForm
                        config={telnetDraft}
                        onChange={edit}
                        disabled={
                          Boolean(environment?.config_error) || busy === "save"
                        }
                      />
                    ) : isDns ? (
                      <DnsConfigForm
                        config={dnsDraft}
                        onChange={edit}
                        disabled={
                          Boolean(environment?.config_error) || busy === "save"
                        }
                      />
                    ) : isMqtt ? (
                      <MqttConfigForm
                        config={mqttDraft}
                        onChange={edit}
                        disabled={
                          Boolean(environment?.config_error) || busy === "save"
                        }
                      />
                    ) : (
                      <>
                        <ConfigFields
                          config={draft}
                          onChange={edit}
                          prefix="edit"
                          disabled={
                            Boolean(environment?.config_error) ||
                            busy === "save"
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
                      </>
                    )}
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
                  {dirty && (
                    <p className="draft-memory-note">
                      此草稿会在协议切换时保留；刷新或关闭页面会丢失未保存的修改。
                    </p>
                  )}
                  <div className="applied-config">
                    <h3>
                      {isIec101
                        ? "当前生效双通道参数（软件模拟）"
                        : isDlt645
                          ? "当前生效启动参数（非实时表状态）"
                          : isIec104
                            ? "当前生效启动参数（非实时点值）"
                            : "当前生效参数"}
                    </h3>
                    {selected.applied_config ? (
                      <dl>
                        <div>
                          <dt>绑定地址</dt>
                          <dd>{selected.applied_config.bind_ip}</dd>
                        </div>
                        <div>
                          <dt>
                            {isIec101
                              ? "双通道 TCP 端口"
                              : isBfd || isRtp || isRtcp
                                ? "UDP 端口"
                                : isMqttSn
                                  ? "主 UDP 端口"
                                  : isDns
                                    ? "DNS 端口"
                                    : "TCP 端口"}
                          </dt>
                          <dd>
                            {isIec101Config(selected.applied_config)
                              ? `single ${selected.applied_config.single.port} / double ${selected.applied_config.double.port}`
                              : isBfdConfig(selected.applied_config)
                                ? 3784
                                : selected.applied_config.port}
                          </dd>
                        </div>
                        <div>
                          <dt>
                            {isBfd
                              ? "固定对端、时序与场景"
                              : isIec101
                                ? "固定格式与遥信配置"
                                : isDlt645
                                  ? "软件电表启动配置与限制"
                                  : isRtp || isRtcp
                                    ? "数据报容量与接收范围"
                                    : isMqttSn
                                      ? "网关发现与私有 Broker"
                                      : isIec104
                                        ? "启动点配置与映射"
                                        : isTelnet
                                          ? "实验应用与限制"
                                          : isDns
                                            ? "启用传输"
                                            : isMqtt
                                              ? "连接与报文限制"
                                              : "响应配置"}
                          </dt>
                          <dd className="applied-body">
                            {isBfdConfig(selected.applied_config)
                              ? bfdDescription(selected.applied_config)
                              : isIec101Config(selected.applied_config)
                                ? iec101Description(selected.applied_config)
                                : isDlt645Config(selected.applied_config)
                                  ? dlt645Description(selected.applied_config)
                                  : isRtcpConfig(selected.applied_config)
                                    ? rtcpDescription(selected.applied_config)
                                    : isRtpConfig(selected.applied_config)
                                      ? rtpDescription(selected.applied_config)
                                      : isMqttSnConfig(selected.applied_config)
                                        ? mqttSnDescription(
                                            selected.applied_config,
                                          )
                                        : isIec104Config(
                                              selected.applied_config,
                                            )
                                          ? iec104StartupDescription(
                                              selected.applied_config,
                                            )
                                          : isTelnetConfig(
                                                selected.applied_config,
                                              )
                                            ? `最多 ${selected.applied_config.max_connections} 个连接 · 输入行最大 ${selected.applied_config.max_line_bytes.toLocaleString()} 字节（去掉 CRLF） · 欢迎语 ${JSON.stringify(selected.applied_config.banner)}`
                                            : isMqttConfig(
                                                  selected.applied_config,
                                                )
                                              ? `最多 ${selected.applied_config.max_connections} 个连接 · 完整报文最大 ${selected.applied_config.max_packet_size.toLocaleString()} 字节`
                                              : isDnsConfig(
                                                    selected.applied_config,
                                                  )
                                                ? [
                                                    selected.applied_config
                                                      .udp_enabled && "UDP",
                                                    selected.applied_config
                                                      .tcp_enabled && "TCP",
                                                  ]
                                                    .filter(Boolean)
                                                    .join(" / ")
                                                : isLegacyConfig(
                                                      selected.applied_config,
                                                    )
                                                  ? `旧版固定正文 ${new TextEncoder().encode(selected.applied_config.response_body).length.toLocaleString()} 字节（POST 回显）`
                                                  : `${selected.applied_config.response_length.toLocaleString()} 字节 · ${selected.applied_config.response_mode === "fixed" ? "固定内容" : "每次随机"}`}
                          </dd>
                        </div>
                        {isMqttSnConfig(selected.applied_config) && (
                          <div>
                            <dt>预定义主题</dt>
                            <dd>
                              <ul className="dns-applied-records">
                                {selected.applied_config.predefined_topics.map(
                                  (t) => (
                                    <li key={t.topic_id}>
                                      <code>
                                        {t.topic_id} ↔ {t.topic}
                                      </code>
                                    </li>
                                  ),
                                )}
                              </ul>
                            </dd>
                          </div>
                        )}
                        {isDnsConfig(selected.applied_config) && (
                          <div>
                            <dt>生效记录</dt>
                            <dd>
                              <ul className="dns-applied-records">
                                {selected.applied_config.records.map((r, i) => (
                                  <li key={i}>
                                    <code>
                                      {r.name} {r.record_type} {r.value}
                                    </code>
                                    <span>TTL {r.ttl} 秒</span>
                                  </li>
                                ))}
                              </ul>
                            </dd>
                          </div>
                        )}
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
                    aria-label={`${protocolName} 服务日志`}
                  >
                    {logLines.length
                      ? logLines.join("\n")
                      : `等待 ${protocolName} 服务日志…\n启动 ${protocolName} 服务后，在此查看请求与响应事件。`}
                  </pre>
                  <div className="log-footer">
                    <span>
                      日志为有界快照，收发预览可能截断；原始长度见日志字段。
                    </span>
                  </div>
                </section>
              </div>

              {bfdSelected && (
                <BfdRuntimePanel
                  key={bfdSelected.id}
                  id={bfdSelected.id}
                  containerId={bfdSelected.container_id}
                  status={bfdSelected.status}
                  disconnected={Boolean(connectionError)}
                />
              )}
              <section className="panel connection-panel">
                <div className="panel-heading">
                  <h2>连接与验证</h2>
                  <span className="muted">内置测试与手动接入</span>
                </div>
                {bfdSelected ? (
                  <>
                    <p className="test-config-notice">
                      仅测试当前生效模式，每次两个新鲜会话轮次；不会切换或代测其他模式。测试要求对端
                      IP 已属于执行主机，且该地址 UDP 3784 无其他主站占用；LAN
                      对端在远机时，本机测试会明确拒绝，不自动配置 IP 或
                      SSH。故障验证同时核对实际接收报文与私有只读场景证据。
                    </p>
                    <ProtocolClientTests
                      key={bfdSelected.id}
                      instance={bfdSelected}
                      protocolName="BFD"
                      hasUnappliedConfig={dirty || appliedDiffers}
                      operationsLocked={locked}
                      caseLabels={bfdCaseLabels}
                      pathLabel="会话范围"
                      describeConfig={bfdDescription}
                      reportLabel={bfdReportLabel}
                    />
                  </>
                ) : iec101Selected ? (
                  <ProtocolClientTests
                    key={iec101Selected.id}
                    instance={iec101Selected}
                    protocolName="IEC101"
                    hasUnappliedConfig={dirty || appliedDiffers}
                    operationsLocked={locked}
                    caseLabels={iec101CaseLabels}
                    pathLabel="通道范围（dual 默认16项）"
                    describeConfig={iec101Description}
                  />
                ) : dlt645Selected ? (
                  <ProtocolClientTests
                    key={dlt645Selected.id}
                    instance={dlt645Selected}
                    protocolName="DL/T645"
                    hasUnappliedConfig={dirty || appliedDiffers}
                    operationsLocked={locked}
                    caseLabels={dlt645CaseLabels}
                    pathLabel="软件表会话"
                    describeConfig={dlt645Description}
                  />
                ) : rtcpSelected ? (
                  <ProtocolClientTests
                    key={rtcpSelected.id}
                    instance={rtcpSelected}
                    protocolName="RTCP"
                    hasUnappliedConfig={dirty || appliedDiffers}
                    operationsLocked={locked}
                    caseLabels={rtcpCaseLabels}
                    pathLabel="测试会话"
                    describeConfig={rtcpDescription}
                    receiveEvidence
                  />
                ) : rtpSelected ? (
                  <ProtocolClientTests
                    key={rtpSelected.id}
                    instance={rtpSelected}
                    protocolName="RTP"
                    hasUnappliedConfig={dirty || appliedDiffers}
                    operationsLocked={locked}
                    caseLabels={rtpCaseLabels}
                    pathLabel="测试流"
                    describeConfig={rtpDescription}
                    receiveEvidence
                  />
                ) : mqttSnSelected ? (
                  <ProtocolClientTests
                    key={mqttSnSelected.id}
                    instance={mqttSnSelected}
                    protocolName="MQTT-SN"
                    hasUnappliedConfig={dirty || appliedDiffers}
                    operationsLocked={locked}
                    caseLabels={mqttSnCaseLabels}
                    pathLabel="测试主题前缀"
                    describeConfig={mqttSnDescription}
                  />
                ) : iec104Selected ? (
                  <ProtocolClientTests
                    key={iec104Selected.id}
                    instance={iec104Selected}
                    protocolName="IEC104"
                    hasUnappliedConfig={dirty || appliedDiffers}
                    operationsLocked={locked}
                    caseLabels={iec104CaseLabels}
                    pathLabel="固定站点"
                    describeConfig={(config) =>
                      `${config.bind_ip}:${config.port} · 最多 ${config.max_connections} 个连接 · ${iec104StartupDescription(config)}`
                    }
                  />
                ) : telnetSelected ? (
                  <ProtocolClientTests
                    key={telnetSelected.id}
                    instance={telnetSelected}
                    protocolName="TELNET"
                    hasUnappliedConfig={dirty || appliedDiffers}
                    operationsLocked={locked}
                    caseLabels={telnetCaseLabels}
                    pathLabel="实验会话"
                    describeConfig={(config) =>
                      `${config.bind_ip}:${config.port} · 最多 ${config.max_connections} 个连接 · 输入行最大 ${config.max_line_bytes.toLocaleString()} 字节（去掉 CRLF） · 欢迎语 ${JSON.stringify(config.banner)}`
                    }
                  />
                ) : mqttSelected ? (
                  <ProtocolClientTests
                    key={mqttSelected.id}
                    instance={mqttSelected}
                    protocolName="MQTT"
                    hasUnappliedConfig={dirty || appliedDiffers}
                    operationsLocked={locked}
                    caseLabels={mqttCaseLabels}
                    pathLabel="主题前缀"
                    describeConfig={(config) =>
                      `${config.bind_ip}:${config.port} · 最多 ${config.max_connections} 个连接 · 完整报文最大 ${config.max_packet_size.toLocaleString()} 字节`
                    }
                  />
                ) : dnsSelected ? (
                  <DnsClientTests
                    key={dnsSelected.id}
                    instance={dnsSelected}
                    hasUnappliedConfig={dirty || appliedDiffers}
                    operationsLocked={locked}
                  />
                ) : httpSelected ? (
                  <ClientTests
                    key={selected.id}
                    instance={httpSelected}
                    hasUnappliedConfig={dirty || appliedDiffers}
                    operationsLocked={locked}
                  />
                ) : null}
                <details className="connection-help">
                  <summary>
                    手动接入与{" "}
                    {isBfd
                      ? "BFD 当前模式客户端"
                      : isIec101
                        ? "IEC101 双通道与本地串口桥"
                        : isDlt645
                          ? "DL/T645 软件表客户端"
                          : isRtcp
                            ? "RTCP 发送与接收观察"
                            : isRtp
                              ? "RTP 发送与接收观察"
                              : isMqttSn
                                ? "MQTT-SN 客户端"
                                : isIec104
                                  ? "IEC104 客户端"
                                  : isTelnet
                                    ? "Telnet 客户端"
                                    : isDns
                                      ? "dig"
                                      : isMqtt
                                        ? "MQTT 客户端"
                                        : "curl"}{" "}
                    命令
                  </summary>
                  <div className="connection-content">
                    <div className="endpoint">
                      <span>
                        {isIec101
                          ? "single 入口 · 1/1/1/1"
                          : `${protocolName} 入口`}
                      </span>
                      <code>
                        {(isIec101 ? connection?.endpoints?.single : null) ||
                          connection?.base_url ||
                          connection?.endpoint ||
                          `${isIec101 || isDlt645 ? "tcp://" : isBfd || isRtp || isRtcp || isMqttSn ? "udp://" : isIec104 ? "iec104://" : isTelnet ? "telnet://" : isDns ? "" : isMqtt ? "mqtt://" : "http://"}${(selected.applied_config || selected.config).bind_ip}:${effectivePort}`}
                      </code>
                      <p>
                        {isBfd
                          ? "固定控制端口3784；目标接口与异机客户端接口须各自在对应主机核对。"
                          : "绑定 0.0.0.0 时，请使用目标设备实际可达的 IP。"}
                      </p>
                    </div>
                    {isIec101 && (
                      <div className="endpoint">
                        <span>double 入口 · 2/2/2/3</span>
                        <code>
                          {connection?.endpoints?.double ||
                            `tcp://${effectiveConfig?.bind_ip}:${effectiveSecondPort}`}
                        </code>
                        <p>
                          在实际测试主机本地执行串口桥命令；Web 不会自动 SSH
                          或启动其他主机上的 helper。稳定路径为
                          /run/protocol-target-lab/serial/iec101-a 与
                          iec101-b。桥接占用通道期间请先停止桥接，再运行内置客户端测试。
                        </p>
                      </div>
                    )}
                    <div className="command-list">
                      {(
                        connection?.commands ||
                        (isBfd
                          ? ["等待管理服务提供 BFD 接入命令。"]
                          : isIec101
                            ? ["等待管理服务提供 IEC101 双通道接入命令。"]
                            : isDlt645
                              ? ["等待管理服务提供 DL/T645 接入命令。"]
                              : isRtcp
                                ? ["等待管理服务提供 RTCP 接入命令。"]
                                : isRtp
                                  ? ["等待管理服务提供 RTP 接入命令。"]
                                  : isMqttSn
                                    ? ["等待管理服务提供 MQTT-SN 接入命令。"]
                                    : isIec104
                                      ? ["等待管理服务提供 IEC104 接入命令。"]
                                      : isTelnet
                                        ? ["等待管理服务提供 TELNET 接入命令。"]
                                        : isMqtt
                                          ? ["等待管理服务提供 MQTT 接入命令。"]
                                          : isDns
                                            ? [
                                                `dig @<目标IP> -p ${effectivePort} ${dnsSelected?.applied_config?.records[0]?.name || dnsSelected?.config.records[0]?.name || "device.test"} A`,
                                                `dig +tcp @<目标IP> -p ${effectivePort} ${dnsSelected?.applied_config?.records[0]?.name || dnsSelected?.config.records[0]?.name || "device.test"} A`,
                                              ]
                                            : [
                                                `curl -i http://<目标IP>:${effectivePort}/ok`,
                                                `curl -i http://<目标IP>:${effectivePort}/chunked`,
                                                `curl -i http://<目标IP>:${effectivePort}/close`,
                                              ])
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
                    : selected && !knownWorkspace
                      ? "当前配置类型与协议不匹配，或此界面尚未支持该协议的配置；请检查管理服务与前端版本。"
                      : "无法取得协议工作台配置，请查看管理服务诊断。")}
              </p>
              <div className="supported-paths">
                {isBfd ? (
                  <>
                    <code>BFD · IPv4 单跳异步</code>
                    <span>固定对端 · 自主会话 · UDP3784</span>
                  </>
                ) : isIec101 ? (
                  <>
                    <code>IEC101 · 原生双通道</code>
                    <span>single 1/1/1/1 · double 2/2/2/3</span>
                  </>
                ) : isDlt645 ? (
                  <>
                    <code>DL/T645-2007 · TCP 软件表</code>
                    <span>固定 profile · 核心 ALL 只读</span>
                  </>
                ) : isRtcp ? (
                  <>
                    <code>RTCPv2 · SR+SDES</code>
                    <span>独立接收证据 · 不发送 RR / ACK</span>
                  </>
                ) : isRtp ? (
                  <>
                    <code>RTPv2 · UDP 接收</code>
                    <span>私有接收证据 · 不发送 RTP ACK</span>
                  </>
                ) : isMqttSn ? (
                  <>
                    <code>UDP</code>
                    <code>QoS 1（本轮验收）</code>
                    <code>组播 GWINFO</code>
                  </>
                ) : isIec104 ? (
                  <>
                    <code>M_SP_NA_1</code>
                    <code>M_ME_NC_1</code>
                    <code>C_SC_NA_1 · DIRECT</code>
                  </>
                ) : isTelnet ? (
                  <>
                    {(selectedProtocol?.supported_features || []).map(
                      (feature) => (
                        <code key={feature}>{feature}</code>
                      ),
                    )}
                    <span>ECHO · INFO · CLOSE</span>
                  </>
                ) : isMqtt ? (
                  <>
                    <code>MQTT 3.1.1</code>
                    <code>MQTT 5.0</code>
                    <span>QoS 0 · 1 · 2</span>
                  </>
                ) : isDns ? (
                  <>
                    <code>A</code>
                    <code>AAAA</code>
                    <span>UDP · TCP</span>
                  </>
                ) : selectedProtocol?.id === "http" ? (
                  <>
                    <code>/ok</code>
                    <code>/chunked</code>
                    <code>/close</code>
                    <span>{methods.join(" · ")}</span>
                  </>
                ) : null}
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
