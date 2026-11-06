import { loadGuidance, subscribeGuidance, guidanceRevision } from "./protocol-description.ts";
import { guideText, lazyGuidanceLabels } from "./protocol-description.ts";
import { protocolNavigationItems } from "./protocol-navigation";
import ProfinetConfigForm from "./ProfinetConfigForm";
import ProfinetRuntimePanel from "./ProfinetRuntimePanel";
import ProfinetConnectionHelp from "./ProfinetConnectionHelp";
import ProfinetTestReport from "./ProfinetTestReport";
import { profinetResultProblem } from "./profinet-tests";
import {
  profinetDefaults,
  isProfinetConfig,
  normalizeProfinetConfig,
  profinetDescription,
  profinetLinkDescription,
  profinetCaseLabels,
  profinetReportLabel,
  type ProfinetConfig,
} from "./profinet-config";
import MplsConfigForm from "./MplsConfigForm";
import MplsRuntimePanel from "./MplsRuntimePanel";
import MplsConnectionHelp from "./MplsConnectionHelp";
import MplsTestReport from "./MplsTestReport";
import { mplsResultProblem, mplsResultOutcome } from "./mpls-tests";
import {
  mplsDefaults,
  isMplsConfig,
  normalizeMplsConfig,
  mplsDescription,
  mplsLinkDescription,
  mplsCaseLabels,
  mplsReportLabel,
  type MplsConfig,
} from "./mpls-config";
import IgmpConfigForm from "./IgmpConfigForm";
import IgmpRuntimePanel from "./IgmpRuntimePanel";
import IgmpTestProgress from "./IgmpTestProgress";
import IgmpConnectionHelp, {
  type IgmpConnectionInfo,
} from "./IgmpConnectionHelp";
import {
  igmpDefaults,
  isIgmpConfig,
  normalizeIgmpConfig,
  igmpDescription,
  igmpLinkDescription,
  igmpCaseLabels,
  igmpReportLabel,
  igmpBuiltinConfigured,
  type IgmpConfig,
  type IgmpLinkDrafts,
} from "./igmp-config";
import CustomEthernetConfigForm from "./CustomEthernetConfigForm";
import CustomEthernetRuntimePanel from "./CustomEthernetRuntimePanel";
import CustomEthernetConnectionHelp from "./CustomEthernetConnectionHelp";
import {
  customEthernetDefaults,
  isCustomEthernetConfig,
  isCustomEthernetDraft,
  prepareCustomEthernetSave,
  customEthernetDescription,
  customEthernetLinkDescription,
  customEthernetCaseLabels,
  customEthernetReportLabel,
  type CustomEthernetConfig,
  type CustomEthernetDraft,
} from "./custom-ethernet-config";
import ArpClientConnectionHelp from "./ArpClientConnectionHelp";
import ArpClientConfigForm, {
  ArpClientBudgetNotice,
} from "./ArpClientConfigForm";
import ArpClientRuntimePanel from "./ArpClientRuntimePanel";
import {
  arpClientDefaults,
  arpClientCaseLabels,
  isArpClientConfig,
  normalizeArpClientConfig,
  arpClientDescription,
  arpClientReportLabel,
  arpClientLinkDescription,
  type ArpClientConfig,
} from "./arp-client-config";
import VxlanConfigForm from "./VxlanConfigForm";
import VxlanRuntimePanel from "./VxlanRuntimePanel";
import {
  vxlanDefaults,
  vxlanCaseLabels,
  isVxlanConfig,
  normalizeVxlanConfig,
  vxlanDescription,
  vxlanReportLabel,
  type VxlanConfig,
} from "./vxlan-config";
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
  useSyncExternalStore,
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
  dnsConnectionCommands,
  type DnsConfig,
} from "./dns-config";
import {
  workspaceIpEndpoint,
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
type VxlanInstance = Omit<Instance, "config" | "applied_config"> & {
  config: VxlanConfig;
  applied_config: VxlanConfig | null;
};
type ProfinetInstance = Omit<Instance, "config" | "applied_config"> & {
  config: ProfinetConfig;
  applied_config: ProfinetConfig | null;
};
type MplsInstance = Omit<Instance, "config" | "applied_config"> & {
  config: MplsConfig;
  applied_config: MplsConfig | null;
};
type IgmpInstance = Omit<Instance, "config" | "applied_config"> & {
  config: IgmpConfig;
  applied_config: IgmpConfig | null;
};
type CustomEthernetInstance = Omit<Instance, "config" | "applied_config"> & {
  config: CustomEthernetConfig;
  applied_config: CustomEthernetConfig | null;
};
type ArpClientInstance = Omit<Instance, "config" | "applied_config"> & {
  config: ArpClientConfig;
  applied_config: ArpClientConfig | null;
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
type Connection = IgmpConnectionInfo & {
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
const statusNames: Record<string, string> = lazyGuidanceLabels(() => ({
  stopped: "已停止",
  starting: "启动中",
  running: "运行中",
  stopping: "停止中",
  error: "运行错误",
  "needs-config": "待配置",
  "environment-unavailable": "环境不可用",
  checking: "核对中",
  unavailable: "不可用",
}));

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
          <span className="field-help">{guideText("http.configuration.app.001")}</span>
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
      <fieldset className="dns-transports" disabled={disabled}>
        <legend>HTTP 传输</legend>
        <label>
          <input
            id={`${prefix}-tls`}
            type="checkbox"
            checked={Boolean(config.tls_enabled)}
            onChange={(event) => {
              const next = { ...config };
              if (event.target.checked) next.tls_enabled = true;
              else delete next.tls_enabled;
              onChange(next);
            }}
          /> HTTPS（TLS）
        </label>
        <p className="field-help">{guideText("http.configuration.app.002")}{" "}<a href="/api/tls/lab.crt" download="lab.crt">{guideText("http.configuration.app.003")}</a>
        </p>
      </fieldset>
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
          <span className="field-help">{guideText("http.configuration.app.004")}</span>
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
          <p>{guideText("http.configuration.app.005")}<code>{guideText("http.configuration.app.006")}</code>{guideText("http.configuration.app.007")}</p>
        ) : (
          <p>{guideText("http.configuration.app.008")}</p>
        )}
        <p>{guideText("http.configuration.app.009")}</p>
      </div>
    </>
  );
}

export default function App() {
  useSyncExternalStore(subscribeGuidance, guidanceRevision);
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [environment, setEnvironment] = useState<Environment | null>(null);
  const [assets, setAssets] = useState<Assets | null>(null);
  const [selectedProtocolId, setSelectedProtocolId] = useState("http");
  const [protocolSearch, setProtocolSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, DraftConfig>>({});
  const [customInterfaceDrafts, setCustomInterfaceDrafts] = useState<
    Record<string, string>
  >({});
  const [mplsInterfaceDrafts, setMplsInterfaceDrafts] = useState<
    Record<string, string>
  >({});
  const [igmpLinkDrafts, setIgmpLinkDrafts] = useState<
    Record<string, IgmpLinkDrafts>
  >({});
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
  const isArpClient = selectedProtocol?.id === "arp-client";
  const isCustomEthernet = selectedProtocol?.id === "custom-ethernet";
  const isIgmp = selectedProtocol?.id === "igmp";
  const isMpls = selectedProtocol?.id === "mpls";
  const isProfinet = selectedProtocol?.id === "profinet";
  const isVxlan = selectedProtocol?.id === "vxlan";
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
  const vxlanSelected =
    isVxlan &&
    selected?.protocol_id === "vxlan" &&
    isVxlanConfig(selected.config) &&
    (!selected.applied_config || isVxlanConfig(selected.applied_config))
      ? (selected as VxlanInstance)
      : null;
  const arpClientSelected =
    isArpClient &&
    selected?.protocol_id === "arp-client" &&
    isArpClientConfig(selected.config) &&
    (!selected.applied_config || isArpClientConfig(selected.applied_config))
      ? (selected as ArpClientInstance)
      : null;
  const customEthernetSelected =
    isCustomEthernet &&
    selected?.protocol_id === "custom-ethernet" &&
    isCustomEthernetConfig(selected.config) &&
    (!selected.applied_config ||
      isCustomEthernetConfig(selected.applied_config))
      ? (selected as CustomEthernetInstance)
      : null;
  const igmpSelected =
    isIgmp &&
    selected?.protocol_id === "igmp" &&
    isIgmpConfig(selected.config) &&
    (!selected.applied_config || isIgmpConfig(selected.applied_config))
      ? (selected as IgmpInstance)
      : null;
  const mplsSelected =
    isMpls &&
    selected?.protocol_id === "mpls" &&
    isMplsConfig(selected.config) &&
    (!selected.applied_config || isMplsConfig(selected.applied_config))
      ? (selected as MplsInstance)
      : null;
  const profinetSelected =
    isProfinet &&
    selected?.protocol_id === "profinet" &&
    isProfinetConfig(selected.config) &&
    (!selected.applied_config || isProfinetConfig(selected.applied_config))
      ? (selected as ProfinetInstance)
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
    bfdSelected ||
    vxlanSelected ||
    arpClientSelected ||
    customEthernetSelected ||
    igmpSelected ||
    mplsSelected ||
    profinetSelected,
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
    !isBfdConfig(cachedDraft) &&
    !isVxlanConfig(cachedDraft) &&
    !isArpClientConfig(cachedDraft) &&
    !isCustomEthernetDraft(cachedDraft) &&
    !isIgmpConfig(cachedDraft) &&
    !isMplsConfig(cachedDraft) &&
    !isProfinetConfig(cachedDraft)
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
  const vxlanDraft: VxlanConfig = isVxlanConfig(cachedDraft)
    ? cachedDraft
    : vxlanSelected?.config || vxlanDefaults;
  const arpClientDraft: ArpClientConfig = isArpClientConfig(cachedDraft)
    ? cachedDraft
    : arpClientSelected?.config || arpClientDefaults;
  const customEthernetDraft: CustomEthernetDraft = isCustomEthernetDraft(
    cachedDraft,
  )
    ? cachedDraft
    : customEthernetSelected?.config || customEthernetDefaults;
  const igmpDraft: IgmpConfig = isIgmpConfig(cachedDraft)
    ? cachedDraft
    : igmpSelected?.config || igmpDefaults;
  const mplsDraft: MplsConfig = isMplsConfig(cachedDraft)
    ? cachedDraft
    : mplsSelected?.config || mplsDefaults;
  const profinetDraft: ProfinetConfig = isProfinetConfig(cachedDraft)
    ? cachedDraft
    : profinetSelected?.config || profinetDefaults;
  const effectiveConfig = selected?.applied_config || selected?.config;
  const effectiveIp = workspaceIpEndpoint(effectiveConfig);
  const effectivePort = effectiveIp?.port;
  const httpTls = Boolean(effectiveConfig && isHttpConfig(effectiveConfig) && effectiveConfig.tls_enabled);
  const httpCurlPrefix = httpTls
    ? `curl --cacert lab.crt --connect-to protocol-target-lab.test:${effectivePort}:<目标IP>:${effectivePort} -i https://protocol-target-lab.test:${effectivePort}`
    : `curl -i http://<目标IP>:${effectivePort}`;
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
        if (nextProtocols[0]?.version) void loadGuidance(nextProtocols[0].version).catch(() => {});
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
      const customPrepared = customEthernetSelected
        ? prepareCustomEthernetSave(
            customEthernetDraft,
            customEthernetSelected.config,
          )
        : null;
      const payload = isProfinet
        ? normalizeProfinetConfig(profinetDraft)
        : isMpls
          ? normalizeMplsConfig(mplsDraft)
          : isIgmp
            ? normalizeIgmpConfig(igmpDraft)
            : isCustomEthernet
              ? customPrepared!.config
              : isArpClient
                ? normalizeArpClientConfig(arpClientDraft)
                : isVxlan
                  ? normalizeVxlanConfig(vxlanDraft)
                  : isBfd
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
      else if (
        !isDns &&
        !isVxlan &&
        !isArpClient &&
        !isCustomEthernet &&
        !isIgmp &&
        !isMpls &&
        !isProfinet
      )
        validateConfig(draft);
      await api(
        `/api/instances/${encodeURIComponent(selected.id)}/config`,
        "PUT",
        payload,
      );
      setDrafts((current) =>
        customPrepared?.retained.length
          ? updateWorkspaceDrafts(
              current,
              selected.id,
              customEthernetDraft,
              customPrepared.config,
            )
          : discardWorkspaceDraft(current, selected.id),
      );
      setNotice(
        customPrepared?.retained.length
          ? `当前有效配置已保存；${customPrepared.retained.join("、")}仍有本地未保存编辑，已保留。运行中的服务继续使用生效快照。`
          : `${protocolName} 配置已保存。运行中的服务会继续使用当前生效参数。`,
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
  const visibleProtocols = protocolNavigationItems(protocols, protocolSearch);
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
        <div className="protocol-search">
          <input
            type="search"
            aria-label="搜索协议"
            placeholder="搜索协议…"
            value={protocolSearch}
            onChange={(event) => setProtocolSearch(event.target.value)}
          />
          {protocolSearch && (
            <button type="button" aria-label="清空协议搜索" onClick={() => setProtocolSearch("")}>×</button>
          )}
        </div>
        <nav className="protocol-navigation" aria-label="协议工作台">
          {visibleProtocols.map((protocol) => {
            const status = connectionError ? "checking" : protocol.status;
            const draft = Boolean(protocol.workspace && drafts[protocol.workspace.id]);
            const operation = protocol.workspace?.current_operation;
            const protocolError = connectionError || protocol.error || protocol.workspace?.error;
            const detail = [protocol.name, statusNames[status] || status, draft && "草稿未保存", operation && `正在执行：${operation.kind}`, protocolError].filter(Boolean).join(" · ");
            return (
              <button
                key={protocol.id}
                type="button"
                className={`protocol-workspace-button ${protocol.id === selectedProtocolId ? "selected" : ""}`}
                aria-current={protocol.id === selectedProtocolId ? "page" : undefined}
                aria-label={detail}
                title={detail}
                onClick={() => {
                  setSelectedProtocolId(protocol.id);
                  setError("");
                  setNotice("");
                }}
              >
                <strong className="protocol-nav-name">{protocol.name}</strong>
                {draft && <span className="protocol-nav-marker" aria-label="草稿未保存">•</span>}
                {operation && <span className="protocol-nav-marker" aria-label={`正在执行：${operation.kind}`}>↻</span>}
                {protocolError && <span className="protocol-nav-marker protocol-nav-warning" aria-label={protocolError}>!</span>}
                <Status value={status} />
              </button>
            );
          })}
          {!visibleProtocols.length && (
            <p className="sidebar-loading" role="status">
              {protocols.length ? guideText("shared.overview.app.010") : loading ? guideText("shared.overview.app.011") : guideText("shared.overview.app.012")}
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
            <p>{guideText("shared.overview.app.013")}</p>
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
                <p className="instance-description">{guideText("shared.overview.app.014")}{protocolName}{guideText("shared.overview.app.015")}<span>{guideText("shared.overview.app.016")}</span>{guideText("shared.overview.app.017")}{" "}
                  <span>{guideText("shared.overview.app.018")}</span>{" "}
                  {isProfinet
                    ? `${selectedProtocol?.implementation || "p-net0.2.0 / software PTCP"}${guideText("profinet.overview.app.019")}`
                    : isMpls
                      ? `${selectedProtocol?.implementation || guideText("mpls.overview.app.020")}${guideText("mpls.overview.app.021")}`
                      : isIgmp
                        ? `${selectedProtocol?.implementation || "Linux kernel IP_ADD_MEMBERSHIP"}${guideText("igmp.overview.app.022")}`
                        : isCustomEthernet
                          ? `${selectedProtocol?.implementation || "libpcap 1.10.5 / AF_PACKET"}${guideText("custom-ethernet.overview.app.023")}`
                          : isArpClient
                            ? `${selectedProtocol?.implementation || guideText("arp-client.overview.app.024")}${guideText("arp-client.overview.app.025")}`
                            : isVxlan
                              ? `${selectedProtocol?.implementation || "VXLAN IPv4 ARP responder"}${guideText("vxlan.overview.app.026")}`
                              : isBfd
                                ? `${selectedProtocol?.implementation || "Python stdlib BFD"}${guideText("bfd.overview.app.027")}`
                                : isIec101
                                  ? `${selectedProtocol?.implementation || "lib60870-C 2.4.1"}${guideText("iec101.overview.app.028")}`
                                  : isDlt645
                                    ? `${selectedProtocol?.implementation || "DL/T645-2007 software meter"}${guideText("dlt645.overview.app.029")}`
                                    : isRtcp
                                      ? `${selectedProtocol?.implementation || "RTCPv2 SR+SDES receiver"}${guideText("rtcp.overview.app.030")}`
                                      : isRtp
                                        ? `${selectedProtocol?.implementation || "RTPv2 receiver"}${guideText("rtp.overview.app.031")}`
                                        : isMqttSn
                                          ? `${selectedProtocol?.implementation || "Paho 1.5.1"}${guideText("mqtt-sn.overview.app.032")}`
                                          : isIec104
                                            ? `${selectedProtocol?.implementation || "c104 2.2.1"}${guideText("iec104.overview.app.033")}`
                                            : isTelnet
                                              ? `${selectedProtocol?.implementation || "TELNET"} · TCP`
                                              : isDns
                                                ? "UDP / TCP / TLS"
                                                : isMqtt
                                                  ? `${selectedProtocol?.implementation || "MQTT"}${guideText("mqtt.overview.app.034")}`
                                                  : httpTls ? "HTTPS · HTTP/1.1 / TLS" : "HTTP/1.1"}
                </p>
                <div className="method-support">
                  <span>
                    {isProfinet
                      ? guideText("profinet.overview.app.079")
                      : isMpls
                        ? guideText("mpls.overview.app.080")
                        : isIgmp
                          ? guideText("igmp.overview.app.081")
                          : isCustomEthernet
                            ? guideText("custom-ethernet.overview.app.082")
                            : isArpClient
                              ? guideText("arp-client.overview.app.083")
                              : isVxlan
                                ? guideText("vxlan.overview.app.084")
                                : isBfd
                                  ? guideText("bfd.overview.app.085")
                                  : isIec101
                                    ? guideText("iec101.overview.app.086")
                                    : isDlt645
                                      ? guideText("dlt645.overview.app.087")
                                      : isRtcp
                                        ? guideText("rtcp.overview.app.088")
                                        : isRtp
                                          ? guideText("rtp.overview.app.089")
                                          : isMqttSn
                                            ? guideText("mqtt-sn.overview.app.090")
                                            : isIec104
                                              ? guideText("iec104.overview.app.091")
                                              : isTelnet
                                                ? guideText("telnet.overview.app.092")
                                                : isMqtt
                                                  ? guideText("mqtt.overview.app.093")
                                                  : isDns
                                                    ? guideText("dns.overview.app.094")
                                                    : legacyApplied
                                                      ? guideText("http.overview.app.095")
                                                      : guideText("http.overview.app.096")}
                  </span>
                  <div>
                    {(isProfinet
                      ? [
                          guideText("profinet.overview.app.097"),
                          guideText("profinet.overview.app.098"),
                          guideText("profinet.overview.app.099"),
                          guideText("profinet.overview.app.100"),
                        ]
                      : isMpls
                        ? [
                            guideText("mpls.overview.app.101"),
                            guideText("mpls.overview.app.102"),
                            guideText("mpls.overview.app.103"),
                            guideText("mpls.overview.app.104"),
                          ]
                        : isIgmp
                          ? [
                              guideText("igmp.overview.app.105"),
                              guideText("igmp.overview.app.106"),
                              guideText("igmp.overview.app.107"),
                              guideText("igmp.overview.app.108"),
                            ]
                          : isCustomEthernet
                            ? [
                                guideText("custom-ethernet.overview.app.109"),
                                guideText("custom-ethernet.overview.app.110"),
                                guideText("custom-ethernet.overview.app.111"),
                                guideText("custom-ethernet.overview.app.112"),
                              ]
                            : isArpClient
                              ? [
                                  "ARP / RARP / InARP",
                                  guideText("arp-client.overview.app.113"),
                                  guideText("arp-client.overview.app.114"),
                                  guideText("arp-client.overview.app.115"),
                                ]
                              : isVxlan
                                ? [
                                    guideText("vxlan.overview.app.116"),
                                    "Ethernet / IPv4 ARP",
                                    guideText("vxlan.overview.app.117"),
                                    guideText("vxlan.overview.app.118"),
                                  ]
                                : isBfd
                                  ? [
                                      "BFD Control",
                                      "UDP 3784",
                                      "Active",
                                      guideText("bfd.overview.app.119"),
                                    ]
                                  : isIec101
                                    ? [
                                        guideText("iec101.overview.app.120"),
                                        "single 1/1/1/1",
                                        "double 2/2/2/3",
                                        guideText("iec101.overview.app.121"),
                                      ]
                                    : isDlt645
                                      ? [
                                          "DL/T645-2007",
                                          guideText("dlt645.overview.app.122"),
                                          guideText("dlt645.overview.app.123"),
                                          guideText("dlt645.overview.app.124"),
                                        ]
                                      : isRtcp
                                        ? [
                                            "RTCPv2",
                                            "UDP",
                                            "SR + SDES",
                                            guideText("rtcp.overview.app.125"),
                                          ]
                                        : isRtp
                                          ? [
                                              "RTPv2",
                                              "UDP",
                                              guideText("rtp.overview.app.126"),
                                              guideText("rtp.overview.app.127"),
                                            ]
                                          : isMqttSn
                                            ? [
                                                "UDP",
                                                guideText("mqtt-sn.overview.app.128"),
                                                guideText("mqtt-sn.overview.app.129"),
                                                guideText("mqtt-sn.overview.app.130"),
                                              ]
                                            : isIec104
                                              ? [
                                                  "M_SP_NA_1",
                                                  "M_ME_NC_1",
                                                  "C_SC_NA_1",
                                                  "DIRECT",
                                                ]
                                              : isTelnet
                                                ? selectedProtocol?.supported_features ||
                                                  []
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
                                                        "TLS",
                                                      ]
                                                    : methods
                    ).map((method) => (
                      <code key={method}>{method}</code>
                    ))}
                  </div>
                  <p>
                    {isProfinet
                      ? guideText("profinet.overview.app.035")
                      : isMpls
                        ? guideText("mpls.overview.app.036")
                        : isIgmp
                          ? guideText("igmp.overview.app.037")
                          : isCustomEthernet
                            ? guideText("custom-ethernet.overview.app.038")
                            : isArpClient
                              ? guideText("arp-client.overview.app.039")
                              : isVxlan
                                ? guideText("vxlan.overview.app.040")
                                : isBfd
                                  ? guideText("bfd.overview.app.041")
                                  : isIec101
                                    ? guideText("iec101.overview.app.042")
                                    : isDlt645
                                      ? guideText("dlt645.overview.app.043")
                                      : isRtcp
                                        ? guideText("rtcp.overview.app.044")
                                        : isRtp
                                          ? guideText("rtp.overview.app.045")
                                          : isMqttSn
                                            ? guideText("mqtt-sn.overview.app.046")
                                            : isIec104
                                              ? guideText("iec104.overview.app.047")
                                              : isTelnet
                                                ? guideText("telnet.overview.app.048")
                                                : isMqtt
                                                  ? guideText("mqtt.overview.app.049")
                                                  : isDns
                                                    ? guideText("dns.overview.app.050")
                                                    : legacyApplied
                                                      ? guideText("http.overview.app.051")
                                                      : guideText("http.overview.app.052")}
                  </p>
                </div>
                <div className="instance-actions">
                  <button
                    className="button primary"
                    disabled={locked || Boolean(environment?.config_error) || displayedStatus === "running"}
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
                        ? guideText("shared.overview.app.131")
                        : guideText("shared.overview.app.132")
                      : guideText("shared.overview.app.133")}
                  </span>
                </div>
                {selected.current_operation && (
                  <div className="inline-note">{guideText("shared.overview.app.134")}{selected.current_operation.kind}{guideText("shared.overview.app.135")}</div>
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
                    <h2>{protocolName}{guideText("shared.configuration.app.136")}</h2>
                    <span className={`draft-label ${dirty ? "dirty" : ""}`}>
                      {dirty
                        ? guideText("shared.configuration.app.137")
                        : appliedDiffers
                          ? guideText("shared.configuration.app.138")
                          : guideText("shared.configuration.app.139")}
                    </span>
                  </div>
                  <form onSubmit={(event) => void save(event)}>
                    {httpSelected && (legacySaved || legacyApplied) && (
                      <div className="migration-note" role="note">
                        {legacySaved
                          ? guideText("http.configuration.app.140")
                          : guideText("http.configuration.app.141")}
                      </div>
                    )}
                    {isProfinet ? (
                      <ProfinetConfigForm
                        config={profinetDraft}
                        onChange={edit}
                        disabled={locked}
                      />
                    ) : isMpls ? (
                      <MplsConfigForm
                        config={mplsDraft}
                        disabled={locked}
                        onChange={edit}
                        interfaceDraft={mplsInterfaceDrafts[selected.id] || ""}
                        onInterfaceDraftChange={(v) =>
                          setMplsInterfaceDrafts((cur) => ({
                            ...cur,
                            [selected.id]: v,
                          }))
                        }
                      />
                    ) : isIgmp ? (
                      <IgmpConfigForm
                        config={igmpDraft}
                        onChange={edit}
                        disabled={
                          Boolean(environment?.config_error) || busy === "save"
                        }
                        linkDrafts={igmpLinkDrafts[selected.id] || {}}
                        onLinkDrafts={(value) =>
                          setIgmpLinkDrafts((current) => ({
                            ...current,
                            [selected.id]: value,
                          }))
                        }
                      />
                    ) : isCustomEthernet && customEthernetSelected ? (
                      <CustomEthernetConfigForm
                        config={customEthernetDraft}
                        saved={customEthernetSelected.config}
                        onChange={edit}
                        disabled={
                          Boolean(environment?.config_error) || busy === "save"
                        }
                        onCopy={copy}
                        interfaceDraft={
                          customInterfaceDrafts[selected.id] ??
                          (customEthernetDraft.link.mode === "host-interface"
                            ? customEthernetDraft.link.interface
                            : "")
                        }
                        onInterfaceDraft={(value) =>
                          setCustomInterfaceDrafts((current) => ({
                            ...current,
                            [selected.id]: value,
                          }))
                        }
                      />
                    ) : isArpClient ? (
                      <ArpClientConfigForm
                        config={arpClientDraft}
                        onChange={edit}
                        disabled={
                          Boolean(environment?.config_error) || busy === "save"
                        }
                      />
                    ) : isVxlan ? (
                      <VxlanConfigForm
                        config={vxlanDraft}
                        onChange={edit}
                        disabled={
                          Boolean(environment?.config_error) || busy === "save"
                        }
                      />
                    ) : isBfd ? (
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
                          <span>{guideText("http.configuration.app.142")}</span>
                          <span>
                            {Number.isFinite(draft.response_length)
                              ? draft.response_length.toLocaleString()
                              : "—"}{" "}{guideText("http.configuration.app.143")}{" "}
                            {draft.response_mode === "fixed"
                              ? guideText("http.configuration.app.144")
                              : guideText("http.configuration.app.145")}
                          </span>
                        </div>
                      </>
                    )}
                    <div className="form-footer">
                      <p>{guideText("shared.configuration.app.053")}</p>
                      <button
                        className="button primary"
                        disabled={locked || Boolean(environment?.config_error)}
                        type="submit"
                      >
                        {busy === "save" ? guideText("shared.configuration.app.146") : guideText("shared.configuration.app.147")}
                      </button>
                    </div>
                  </form>
                  {dirty && (
                    <p className="draft-memory-note">{guideText("shared.configuration.app.054")}</p>
                  )}
                  <div className="applied-config">
                    <h3>
                      {isProfinet
                        ? guideText("profinet.configuration.app.148")
                        : isIec101
                          ? guideText("iec101.configuration.app.149")
                          : isDlt645
                            ? guideText("dlt645.configuration.app.150")
                            : isIec104
                              ? guideText("iec104.configuration.app.151")
                              : guideText("shared.configuration.app.152")}
                    </h3>
                    {selected.applied_config ? (
                      <dl>
                        <div>
                          <dt>
                            {isArpClient ||
                            isCustomEthernet ||
                            isIgmp ||
                            isMpls ||
                            isProfinet
                              ? guideText("shared.configuration.app.153")
                              : guideText("shared.configuration.app.154")}
                          </dt>
                          <dd>
                            {isProfinetConfig(selected.applied_config)
                              ? profinetLinkDescription()
                              : isMplsConfig(selected.applied_config)
                                ? mplsLinkDescription(selected.applied_config)
                                : isIgmpConfig(selected.applied_config)
                                  ? igmpLinkDescription(selected.applied_config)
                                  : isCustomEthernetConfig(
                                        selected.applied_config,
                                      )
                                    ? customEthernetLinkDescription(
                                        selected.applied_config,
                                      )
                                    : isArpClientConfig(selected.applied_config)
                                      ? arpClientLinkDescription(
                                          selected.applied_config,
                                        )
                                      : selected.applied_config.bind_ip}
                          </dd>
                        </div>
                        {!isArpClientConfig(selected.applied_config) &&
                          !isCustomEthernetConfig(selected.applied_config) &&
                          !isIgmpConfig(selected.applied_config) &&
                          !isMplsConfig(selected.applied_config) &&
                          !isProfinetConfig(selected.applied_config) && (
                            <div>
                              <dt>
                                {isIec101
                                  ? guideText("iec101.configuration.app.155")
                                  : isVxlan || isBfd || isRtp || isRtcp
                                    ? guideText("shared.configuration.app.156")
                                    : isMqttSn
                                      ? guideText("mqtt-sn.configuration.app.157")
                                      : isDns
                                        ? guideText("dns.configuration.app.158")
                                        : guideText("shared.configuration.app.159")}
                              </dt>
                              <dd>
                                {isIec101Config(selected.applied_config)
                                  ? `single ${selected.applied_config.single.port} / double ${selected.applied_config.double.port}`
                                  : isBfdConfig(selected.applied_config)
                                    ? 3784
                                    : selected.applied_config.port}
                              </dd>
                            </div>
                          )}
                        <div>
                          <dt>
                            {isProfinet
                              ? guideText("profinet.configuration.app.160")
                              : isMpls
                                ? guideText("mpls.configuration.app.161")
                                : isIgmp
                                  ? guideText("igmp.configuration.app.162")
                                  : isCustomEthernet
                                    ? guideText("custom-ethernet.configuration.app.163")
                                    : isArpClient
                                      ? guideText("arp-client.configuration.app.164")
                                      : isVxlan
                                        ? guideText("vxlan.configuration.app.165")
                                        : isBfd
                                          ? guideText("bfd.configuration.app.166")
                                          : isIec101
                                            ? guideText("iec101.configuration.app.167")
                                            : isDlt645
                                              ? guideText("dlt645.configuration.app.168")
                                              : isRtp || isRtcp
                                                ? guideText("shared.configuration.app.169")
                                                : isMqttSn
                                                  ? guideText("mqtt-sn.configuration.app.170")
                                                  : isIec104
                                                    ? guideText("iec104.configuration.app.171")
                                                    : isTelnet
                                                      ? guideText("telnet.configuration.app.172")
                                                      : isDns
                                                        ? guideText("dns.configuration.app.173")
                                                        : isMqtt
                                                          ? guideText("mqtt.configuration.app.174")
                                                          : guideText("shared.configuration.app.175")}
                          </dt>
                          <dd className="applied-body">
                            {isProfinetConfig(selected.applied_config)
                              ? profinetDescription(selected.applied_config)
                              : isMplsConfig(selected.applied_config)
                                ? mplsDescription(selected.applied_config)
                                : isIgmpConfig(selected.applied_config)
                                  ? igmpDescription(selected.applied_config)
                                  : isCustomEthernetConfig(
                                        selected.applied_config,
                                      )
                                    ? customEthernetDescription(
                                        selected.applied_config,
                                      )
                                    : isArpClientConfig(selected.applied_config)
                                      ? arpClientDescription(
                                          selected.applied_config,
                                        )
                                      : isVxlanConfig(selected.applied_config)
                                        ? vxlanDescription(
                                            selected.applied_config,
                                          )
                                        : isBfdConfig(selected.applied_config)
                                          ? bfdDescription(
                                              selected.applied_config,
                                            )
                                          : isIec101Config(
                                                selected.applied_config,
                                              )
                                            ? iec101Description(
                                                selected.applied_config,
                                              )
                                            : isDlt645Config(
                                                  selected.applied_config,
                                                )
                                              ? dlt645Description(
                                                  selected.applied_config,
                                                )
                                              : isRtcpConfig(
                                                    selected.applied_config,
                                                  )
                                                ? rtcpDescription(
                                                    selected.applied_config,
                                                  )
                                                : isRtpConfig(
                                                      selected.applied_config,
                                                    )
                                                  ? rtpDescription(
                                                      selected.applied_config,
                                                    )
                                                  : isMqttSnConfig(
                                                        selected.applied_config,
                                                      )
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
                                                        ? `${guideText("shared.configuration.app.176")}${selected.applied_config.max_connections}${guideText("shared.configuration.app.177")}${selected.applied_config.max_line_bytes.toLocaleString()}${guideText("shared.configuration.app.178")}${JSON.stringify(selected.applied_config.banner)}`
                                                        : isMqttConfig(
                                                              selected.applied_config,
                                                            )
                                                          ? `${guideText("shared.configuration.app.179")}${selected.applied_config.max_connections}${guideText("shared.configuration.app.180")}${selected.applied_config.max_packet_size.toLocaleString()}${guideText("shared.configuration.app.181")}`
                                                          : isDnsConfig(
                                                                selected.applied_config,
                                                              )
                                                            ? [
                                                                selected
                                                                  .applied_config
                                                                  .udp_enabled &&
                                                                  "UDP",
                                                                selected
                                                                  .applied_config
                                                                  .tcp_enabled &&
                                                                  "TCP",
                                                                selected.applied_config.tls_enabled && `TLS:${selected.applied_config.tls_port ?? 1853}`,
                                                              ]
                                                                .filter(Boolean)
                                                                .join(" / ")
                                                            : isLegacyConfig(
                                                                  selected.applied_config,
                                                                )
                                                              ? `${guideText("shared.configuration.app.182")}${new TextEncoder().encode(selected.applied_config.response_body).length.toLocaleString()}${guideText("shared.configuration.app.183")}`
                                                              : `${selected.applied_config.response_length.toLocaleString()}${guideText("shared.configuration.app.186")}${selected.applied_config.response_mode === "fixed" ? guideText("shared.configuration.app.184") : guideText("shared.configuration.app.185")}`}
                          </dd>
                        </div>
                        {isMqttSnConfig(selected.applied_config) && (
                          <div>
                            <dt>{guideText("shared.configuration.app.187")}</dt>
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
                            <dt>{guideText("shared.configuration.app.188")}</dt>
                            <dd>
                              <ul className="dns-applied-records">
                                {selected.applied_config.records.map((r, i) => (
                                  <li key={i}>
                                    <code>
                                      {r.name} {r.record_type} {r.value}
                                    </code>
                                    <span>TTL {r.ttl}{guideText("shared.configuration.app.189")}</span>
                                  </li>
                                ))}
                              </ul>
                            </dd>
                          </div>
                        )}
                        <div>
                          <dt>{guideText("shared.configuration.app.190")}</dt>
                          <dd title={selected.container_id || ""}>
                            {selected.container_id?.slice(0, 12) || guideText("shared.configuration.app.191")}
                          </dd>
                        </div>
                      </dl>
                    ) : (
                      <p>{guideText("shared.configuration.app.055")}</p>
                    )}
                  </div>
                </section>

                <section className="panel log-panel">
                  <div className="panel-heading">
                    <div className="log-title">
                      <h2>{guideText("shared.runtime.app.192")}</h2>
                      <span
                        className={`stream-dot ${logConnected && !paused ? "connected" : ""}`}
                      />
                      <span className="stream-status">
                        {paused
                          ? guideText("shared.runtime.app.193")
                          : logConnected
                            ? guideText("shared.runtime.app.194")
                            : guideText("shared.runtime.app.195")}
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
                    <span>{guideText("shared.runtime.app.196")}</span>
                    <span>{guideText("shared.runtime.app.197")}</span>
                  </div>
                  <pre
                    className="log-content"
                    ref={logRef}
                    tabIndex={0}
                    aria-label={`${protocolName}${guideText("shared.runtime.app.198")}`}
                  >
                    {logLines.length
                      ? logLines.join("\n")
                      : `${guideText("shared.runtime.app.199")}${protocolName}${guideText("shared.runtime.app.200")}${protocolName}${guideText("shared.runtime.app.201")}`}
                  </pre>
                  <div className="log-footer">
                    <span>{guideText("shared.runtime.app.202")}</span>
                  </div>
                </section>
              </div>

              {profinetSelected && (
                <ProfinetRuntimePanel
                  key={profinetSelected.id}
                  id={profinetSelected.id}
                  containerId={profinetSelected.container_id}
                  status={profinetSelected.status}
                  disconnected={Boolean(connectionError)}
                />
              )}
              {mplsSelected && (
                <MplsRuntimePanel
                  key={mplsSelected.id}
                  id={mplsSelected.id}
                  containerId={mplsSelected.container_id}
                  status={mplsSelected.status}
                  disconnected={Boolean(connectionError)}
                />
              )}
              {igmpSelected && (
                <IgmpRuntimePanel
                  key={igmpSelected.id}
                  id={igmpSelected.id}
                  containerId={igmpSelected.container_id}
                  status={igmpSelected.status}
                  disconnected={Boolean(connectionError)}
                />
              )}
              {customEthernetSelected && (
                <CustomEthernetRuntimePanel
                  key={customEthernetSelected.id}
                  id={customEthernetSelected.id}
                  containerId={customEthernetSelected.container_id}
                  status={customEthernetSelected.status}
                  disconnected={Boolean(connectionError)}
                />
              )}
              {arpClientSelected && (
                <ArpClientRuntimePanel
                  key={arpClientSelected.id}
                  id={arpClientSelected.id}
                  containerId={arpClientSelected.container_id}
                  status={arpClientSelected.status}
                  disconnected={Boolean(connectionError)}
                />
              )}
              {vxlanSelected && (
                <VxlanRuntimePanel
                  key={vxlanSelected.id}
                  id={vxlanSelected.id}
                  containerId={vxlanSelected.container_id}
                  status={vxlanSelected.status}
                  disconnected={Boolean(connectionError)}
                />
              )}
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
                  <h2>{guideText("shared.connection.app.203")}</h2>
                  <span className="muted">{guideText("shared.connection.app.204")}</span>
                </div>
                {profinetSelected ? (
                  <>
                    <p className="test-config-notice">{guideText("profinet.connection.app.056")}</p>
                    <ProtocolClientTests
                      key={profinetSelected.id}
                      instance={profinetSelected}
                      protocolName="PROFINET"
                      hasUnappliedConfig={dirty || appliedDiffers}
                      operationsLocked={locked}
                      describeConfig={profinetDescription}
                      caseLabels={profinetCaseLabels}
                      pathLabel="固定三节点suite"
                      reportLabel={profinetReportLabel}
                      validateResult={profinetResultProblem}
                      showRetainedResultNotice
                      renderExtra={(run) => (
                        <ProfinetTestReport key={run.id} run={run} />
                      )}
                    />
                  </>
                ) : mplsSelected ? (
                  <>
                    <p className="test-config-notice">{guideText("mpls.connection.app.057")}</p>
                    <ProtocolClientTests
                      key={mplsSelected.id}
                      instance={mplsSelected}
                      protocolName="MPLS"
                      hasUnappliedConfig={dirty || appliedDiffers}
                      operationsLocked={locked}
                      describeConfig={mplsDescription}
                      caseLabels={mplsCaseLabels}
                      pathLabel="单标签 Echo profile"
                      reportLabel={mplsReportLabel}
                      showRetainedResultNotice
                      validateResult={mplsResultProblem}
                      resultOutcome={mplsResultOutcome}
                      renderExtra={(run) => (
                        <MplsTestReport key={run.id} run={run} />
                      )}
                    />
                  </>
                ) : igmpSelected ? (
                  <>
                    <p className="test-config-notice">{guideText("igmp.connection.app.058")}</p>
                    {igmpSelected.applied_config &&
                      !igmpBuiltinConfigured(igmpSelected.applied_config) && (
                        <p className="test-error">{guideText("igmp.connection.app.059")}</p>
                      )}
                    <ProtocolClientTests
                      key={igmpSelected.id}
                      instance={igmpSelected}
                      protocolName="IGMP"
                      showRetainedResultNotice
                      hasUnappliedConfig={dirty || appliedDiffers}
                      operationsLocked={
                        locked ||
                        Boolean(
                          igmpSelected.applied_config &&
                          !igmpBuiltinConfigured(igmpSelected.applied_config),
                        )
                      }
                      describeConfig={igmpDescription}
                      caseLabels={igmpCaseLabels}
                      pathLabel="内核成员profile"
                      reportLabel={igmpReportLabel}
                      renderExtra={(run) => (
                        <IgmpTestProgress key={run.id} run={run} />
                      )}
                    />
                  </>
                ) : customEthernetSelected ? (
                  <>
                    <p className="test-config-notice">{guideText("custom-ethernet.connection.app.060")}</p>
                    <ProtocolClientTests
                      key={customEthernetSelected.id}
                      instance={customEthernetSelected}
                      protocolName="Custom Ethernet"
                      hasUnappliedConfig={dirty || appliedDiffers}
                      operationsLocked={locked}
                      describeConfig={customEthernetDescription}
                      caseLabels={customEthernetCaseLabels}
                      pathLabel="显式请求fixture"
                      reportLabel={customEthernetReportLabel}
                      showActualExchanges
                    />
                  </>
                ) : arpClientSelected ? (
                  <>
                    {arpClientSelected.applied_config && (
                      <ArpClientBudgetNotice
                        config={arpClientSelected.applied_config}
                      />
                    )}
                    <p className="test-config-notice">{guideText("arp-client.connection.app.061")}</p>
                    <p className="field-help">
                      {arpClientSelected.applied_config?.link.mode ===
                      "host-interface"
                        ? guideText("arp-client.connection.app.062")
                        : guideText("arp-client.connection.app.063")}
                    </p>
                    <ProtocolClientTests
                      key={arpClientSelected.id}
                      instance={arpClientSelected}
                      protocolName="ARP-client"
                      hasUnappliedConfig={dirty || appliedDiffers}
                      operationsLocked={locked}
                      caseLabels={arpClientCaseLabels}
                      pathLabel="反向对端"
                      describeConfig={arpClientDescription}
                      reportLabel={arpClientReportLabel}
                    />
                  </>
                ) : vxlanSelected ? (
                  <>
                    <p className="test-config-notice">{guideText("vxlan.connection.app.064")}</p>
                    <ProtocolClientTests
                      key={vxlanSelected.id}
                      instance={vxlanSelected}
                      protocolName="VXLAN"
                      hasUnappliedConfig={dirty || appliedDiffers}
                      operationsLocked={locked}
                      caseLabels={vxlanCaseLabels}
                      pathLabel="ARP 角色"
                      describeConfig={vxlanDescription}
                      reportLabel={vxlanReportLabel}
                    />
                  </>
                ) : bfdSelected ? (
                  <>
                    <p className="test-config-notice">{guideText("bfd.connection.app.065")}</p>
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
                      `${config.bind_ip}:${config.port}${guideText("iec104.verification.app.205")}${config.max_connections}${guideText("iec104.verification.app.206")}${iec104StartupDescription(config)}`
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
                      `${config.bind_ip}:${config.port}${guideText("telnet.verification.app.207")}${config.max_connections}${guideText("telnet.verification.app.208")}${config.max_line_bytes.toLocaleString()}${guideText("telnet.verification.app.209")}${JSON.stringify(config.banner)}`
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
                      `${config.bind_ip}:${config.port}${guideText("mqtt.verification.app.210")}${config.max_connections}${guideText("mqtt.verification.app.211")}${config.max_packet_size.toLocaleString()}${guideText("mqtt.verification.app.212")}`
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
                  <summary>{guideText("shared.connection.app.213")}{" "}
                    {isProfinet
                      ? guideText("profinet.connection.app.214")
                      : isMpls
                        ? guideText("mpls.connection.app.215")
                        : isIgmp
                          ? guideText("igmp.connection.app.216")
                          : isCustomEthernet
                            ? guideText("custom-ethernet.connection.app.217")
                            : isArpClient
                              ? guideText("arp-client.connection.app.218")
                              : isVxlan
                                ? guideText("vxlan.connection.app.219")
                                : isBfd
                                  ? guideText("bfd.connection.app.220")
                                  : isIec101
                                    ? guideText("iec101.connection.app.221")
                                    : isDlt645
                                      ? guideText("dlt645.connection.app.222")
                                      : isRtcp
                                        ? guideText("rtcp.connection.app.223")
                                        : isRtp
                                          ? guideText("rtp.connection.app.224")
                                          : isMqttSn
                                            ? guideText("mqtt-sn.connection.app.225")
                                            : isIec104
                                              ? guideText("iec104.connection.app.226")
                                              : isTelnet
                                                ? guideText("telnet.connection.app.227")
                                                : isDns
                                                  ? "dig"
                                                  : isMqtt
                                                    ? guideText("mqtt.connection.app.228")
                                                    : "curl"}{" "}{guideText("shared.connection.app.229")}</summary>
                  <div className="connection-content">
                    <div className="endpoint">
                      <span>
                        {isIec101
                          ? guideText("iec101.connection.app.230")
                          : `${protocolName}${guideText("shared.connection.app.231")}`}
                      </span>
                      <code>
                        {profinetSelected
                          ? profinetLinkDescription()
                          : mplsSelected
                            ? mplsLinkDescription(
                                mplsSelected.applied_config ||
                                  mplsSelected.config,
                              )
                            : igmpSelected
                              ? connection?.endpoint ||
                                igmpLinkDescription(
                                  igmpSelected.applied_config ||
                                    igmpSelected.config,
                                )
                              : customEthernetSelected
                                ? connection?.endpoint ||
                                  customEthernetLinkDescription(
                                    customEthernetSelected.applied_config ||
                                      customEthernetSelected.config,
                                  )
                                : arpClientSelected
                                  ? connection?.endpoint ||
                                    arpClientLinkDescription(
                                      arpClientSelected.applied_config ||
                                        arpClientSelected.config,
                                    )
                                  : (isIec101
                                      ? connection?.endpoints?.single
                                      : null) ||
                                    connection?.base_url ||
                                    connection?.endpoint ||
                                    `${isIec101 || isDlt645 ? "tcp://" : isVxlan || isBfd || isRtp || isRtcp || isMqttSn ? "udp://" : isIec104 ? "iec104://" : isTelnet ? "telnet://" : isDns ? "" : isMqtt ? "mqtt://" : httpTls ? "https://" : "http://"}${effectiveIp?.bind_ip}:${effectivePort}`}
                      </code>
                      <p>
                        {isProfinet
                          ? guideText("profinet.connection.app.066")
                          : isMpls
                            ? guideText("mpls.connection.app.067")
                            : isIgmp
                              ? guideText("igmp.connection.app.068")
                              : isCustomEthernet
                                ? guideText("custom-ethernet.connection.app.069")
                                : isArpClient
                                  ? guideText("arp-client.connection.app.070")
                                  : isVxlan
                                    ? guideText("vxlan.connection.app.071")
                                    : isBfd
                                      ? guideText("bfd.connection.app.072")
                                      : guideText("shared.connection.app.073")}
                      </p>
                    </div>
                    {isDns && effectiveConfig && isDnsConfig(effectiveConfig) && effectiveConfig.tls_enabled && (
                      <div className="endpoint">
                        <span>{guideText("dns.connection.app.232")}</span>
                        <code>{effectiveConfig.bind_ip}:{effectiveConfig.tls_port ?? 1853}</code>
                        <p>{guideText("dns.connection.app.074")}</p>
                      </div>
                    )}
                    {isIec101 && (
                      <div className="endpoint">
                        <span>{guideText("iec101.connection.app.233")}</span>
                        <code>
                          {connection?.endpoints?.double ||
                            `tcp://${effectiveIp?.bind_ip}:${effectiveSecondPort}`}
                        </code>
                        <p>{guideText("iec101.connection.app.075")}</p>
                      </div>
                    )}
                    <div className="command-list">
                      {(
                        connection?.commands ||
                        (isProfinet
                          ? [
                              guideText("profinet.connection.app.234"),
                            ]
                          : isMpls
                            ? [
                                guideText("mpls.connection.app.235"),
                              ]
                            : isIgmp
                              ? [
                                  guideText("igmp.connection.app.236"),
                                ]
                              : isCustomEthernet
                                ? [
                                    guideText("custom-ethernet.connection.app.237"),
                                  ]
                                : isArpClient
                                  ? [
                                      guideText("arp-client.connection.app.238"),
                                    ]
                                  : isVxlan
                                    ? [guideText("vxlan.connection.app.239")]
                                    : isBfd
                                      ? [guideText("bfd.connection.app.240")]
                                      : isIec101
                                        ? [
                                            guideText("iec101.connection.app.241"),
                                          ]
                                        : isDlt645
                                          ? [
                                              guideText("dlt645.connection.app.242"),
                                            ]
                                          : isRtcp
                                            ? [
                                                guideText("rtcp.connection.app.243"),
                                              ]
                                            : isRtp
                                              ? [
                                                  guideText("rtp.connection.app.244"),
                                                ]
                                              : isMqttSn
                                                ? [
                                                    guideText("mqtt-sn.connection.app.245"),
                                                  ]
                                                : isIec104
                                                  ? [
                                                      guideText("iec104.connection.app.246"),
                                                    ]
                                                  : isTelnet
                                                    ? [
                                                        guideText("telnet.connection.app.247"),
                                                      ]
                                                    : isMqtt
                                                      ? [
                                                          guideText("mqtt.connection.app.248"),
                                                        ]
                                                      : isDns
                                                        ? dnsConnectionCommands(dnsSelected?.applied_config || dnsSelected?.config || dnsDefaults)
                                                        : [
                                                            `${httpCurlPrefix}/ok`,
                                                            `${httpCurlPrefix}/chunked`,
                                                            `${httpCurlPrefix}/close`,
                                                          ])
                      ).map((command, index) => (
                        <div className="command" key={index}>
                          <code>{command}</code>
                          <button
                            className="icon-button"
                            aria-label={`${guideText("shared.connection.app.249")}${index + 1}`}
                            title="复制命令"
                            onClick={() => void copy(command)}
                          >
                            <Icon name="copy" size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                    {isProfinet && (
                      <ProfinetConnectionHelp
                        connection={connection}
                        onCopy={copy}
                      />
                    )}
                    {isMpls && (
                      <MplsConnectionHelp
                        connection={connection}
                        onCopy={copy}
                      />
                    )}
                    {isIgmp && (
                      <IgmpConnectionHelp
                        connection={connection}
                        onCopy={copy}
                      />
                    )}
                    {isCustomEthernet && (
                      <CustomEthernetConnectionHelp
                        connection={connection}
                        onCopy={copy}
                      />
                    )}
                    {isArpClient && (
                      <ArpClientConnectionHelp
                        connection={connection}
                        onCopy={copy}
                      />
                    )}
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
                  ? guideText("shared.overview.app.250")
                  : `${selectedProtocol?.name || "HTTP"}${guideText("shared.overview.app.251")}`}
              </h2>
              <p>
                {selectedProtocol?.error ||
                  environment?.config_error ||
                  (loading
                    ? guideText("shared.connection.app.076")
                    : selected && !knownWorkspace
                      ? guideText("shared.connection.app.077")
                      : guideText("shared.connection.app.078"))}
              </p>
              <div className="supported-paths">
                {isProfinet ? (
                  <>
                    <code>PROFINET · native DCP + PTCP-N/F</code>
                    <span>{guideText("profinet.overview.app.252")}</span>
                  </>
                ) : isMpls ? (
                  <>
                    <code>{guideText("mpls.overview.app.253")}</code>
                    <span>{guideText("mpls.overview.app.254")}</span>
                  </>
                ) : isIgmp ? (
                  <>
                    <code>{guideText("igmp.overview.app.255")}</code>
                    <span>{guideText("igmp.overview.app.256")}</span>
                  </>
                ) : isCustomEthernet ? (
                  <>
                    <code>{guideText("custom-ethernet.overview.app.257")}</code>
                    <span>{guideText("custom-ethernet.overview.app.258")}</span>
                  </>
                ) : isArpClient ? (
                  <>
                    <code>{guideText("arp-client.overview.app.259")}</code>
                    <span>{guideText("arp-client.overview.app.260")}</span>
                  </>
                ) : isVxlan ? (
                  <>
                    <code>{guideText("vxlan.overview.app.261")}</code>
                    <span>{guideText("vxlan.overview.app.262")}</span>
                  </>
                ) : isBfd ? (
                  <>
                    <code>{guideText("bfd.overview.app.263")}</code>
                    <span>{guideText("bfd.overview.app.264")}</span>
                  </>
                ) : isIec101 ? (
                  <>
                    <code>{guideText("iec101.overview.app.265")}</code>
                    <span>single 1/1/1/1 · double 2/2/2/3</span>
                  </>
                ) : isDlt645 ? (
                  <>
                    <code>{guideText("dlt645.overview.app.266")}</code>
                    <span>{guideText("dlt645.overview.app.267")}</span>
                  </>
                ) : isRtcp ? (
                  <>
                    <code>RTCPv2 · SR+SDES</code>
                    <span>{guideText("rtcp.overview.app.268")}</span>
                  </>
                ) : isRtp ? (
                  <>
                    <code>{guideText("rtp.overview.app.269")}</code>
                    <span>{guideText("rtp.overview.app.270")}</span>
                  </>
                ) : isMqttSn ? (
                  <>
                    <code>UDP</code>
                    <code>{guideText("mqtt-sn.overview.app.271")}</code>
                    <code>{guideText("mqtt-sn.overview.app.272")}</code>
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
                    <span>UDP · TCP · TLS</span>
                  </>
                ) : selectedProtocol?.id === "http" ? (
                  <>
                    <code>/ok</code>
                    <code>/chunked</code>
                    <code>/close</code>
                    <span>{methods.join(" · ")}{guideText("http.overview.app.273")}</span>
                  </>
                ) : null}
              </div>
            </section>
          )}
        </div>
        <footer className="page-footer">
          <span>Protocol Target Lab</span>
          <span>{guideText("shared.connection.app.274")}</span>
        </footer>
      </main>
    </div>
  );
}
