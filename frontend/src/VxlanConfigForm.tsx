import {
  vxlanModeLabels,
  vxlanModes,
  type VxlanConfig,
  type VxlanMode,
} from "./vxlan-config";
export default function VxlanConfigForm({
  config,
  onChange,
  disabled,
}: {
  config: VxlanConfig;
  onChange: (config: VxlanConfig) => void;
  disabled: boolean;
}) {
  const text = (
    key:
      | "bind_ip"
      | "peer_ip"
      | "inner_ip"
      | "inner_mac"
      | "requester_ip"
      | "requester_mac",
    label: string,
  ) => (
    <label htmlFor={`vxlan-${key}`} key={key}>
      {label}
      <input
        id={`vxlan-${key}`}
        value={config[key]}
        disabled={disabled}
        required
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange({ ...config, [key]: e.target.value })}
      />
    </label>
  );
  const number = (
    key: "port" | "peer_port" | "source_port" | "vni",
    label: string,
    min: number,
    max: number,
  ) => (
    <label htmlFor={`vxlan-${key}`} key={key}>
      {label}
      <input
        id={`vxlan-${key}`}
        type="number"
        min={min}
        max={max}
        step={1}
        value={Number.isFinite(config[key]) ? config[key] : ""}
        disabled={disabled}
        required
        onChange={(e) =>
          onChange({ ...config, [key]: e.currentTarget.valueAsNumber })
        }
      />
    </label>
  );
  return (
    <>
      <div className="protocol-binding-note">
        <strong>
          有限 IPv4 单播 VTEP · Ethernet / IPv4 ARP Request → Reply
        </strong>
        <p>
          仅完整验证当前合法 Request 后生成回复或按场景抑制。不是任意 UDP
          echo，也不是通用二层学习桥或隧道载体；不提供 IPv4 / ICMP ping 服务。
        </p>
      </div>
      <div className="field-row">
        {text("bind_ip", "外层目标绑定 IPv4")}
        {number("port", "目标接收 UDP 端口", 1, 65535)}
      </div>
      <div className="field-row">
        {text("peer_ip", "固定对端 IPv4")}
        {number("peer_port", "固定对端接收 UDP 端口", 1, 65535)}
      </div>
      <div className="field-row">
        {number("source_port", "目标回复源 UDP 端口", 49152, 65535)}
        {number("vni", "VNI（允许 0）", 0, 16777215)}
      </div>
      <p className="field-help">
        目标回复始终发往固定对端 IP / 接收端口，不复制 Request 源端口。不同外层
        IP 可使用同数字端口；同一外层 IP
        时三个端口必须互不相同。外层绑定地址必须已属于目标宿主机，启动前核对，不自动配置地址或路由。
      </p>
      <div className="field-row">
        {text("inner_ip", "模拟目标内层 IPv4")}
        {text("inner_mac", "模拟目标内层 MAC")}
      </div>
      <div className="field-row">
        {text("requester_ip", "预期请求者内层 IPv4")}
        {text("requester_mac", "预期请求者 MAC")}
      </div>
      <p className="field-help">
        内层 IP / MAC 是协议角色配置，不会添加到宿主网卡。请求者 IP 可为
        0.0.0.0（ARP probe）；目标内层 IP 必须非零且不同。MAC
        为六组十六进制字节组成的不同非零单播地址，大小写均可输入，保存后统一小写。
      </p>
      <label htmlFor="vxlan-padding">
        Reply 内层零补齐
        <select
          id="vxlan-padding"
          value={config.reply_padding}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              ...config,
              reply_padding: Number(e.target.value) as 0 | 18,
            })
          }
        >
          <option value={0}>0 字节 · inner 42 / UDP 50 字节</option>
          <option value={18}>18 字节 · inner 60 / UDP 68 字节</option>
        </select>
        <span className="field-help">
          内层大小不含 FCS；short-arp 场景始终发送49字节，与补齐设置无关。
        </span>
      </label>
      <label htmlFor="vxlan-mode">
        目标回复场景
        <select
          id="vxlan-mode"
          value={config.scenario.mode}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              ...config,
              scenario: { mode: e.target.value as VxlanMode },
            })
          }
        >
          {vxlanModes.map((mode) => (
            <option key={mode} value={mode}>
              {vxlanModeLabels[mode]}
            </option>
          ))}
        </select>
      </label>
      <div className="response-description">
        <p>
          11种模式均作用于每个合法 Request 的目标端 Reply；无效 Request
          不回复。normal 使用 I=1 / 保留字节清零；请求中其他基础头标志/保留位和
          THA 被忽略并记录，不表示实现 GBP / GPE。
        </p>
        <p>
          ALL
          只验证当前生效模式的四个案例各两轮（8项），不自动切换其余模式。silent
          需要新鲜合法请求及因果抑制证据；只观察没有收到数据不能判通过。保存不自动应用，需显式运行或重启。
        </p>
        <p>
          只读运行态显示本地就绪、接收 / 拒绝 / 发送 /
          抑制计数，不显示虚构的隧道 Up 或对端连接状态。发送成功只证明本地
          socket 提交；实际交付以客户端接收及因果请求哈希为准。
        </p>
        <p>
          内置客户端要求对端 IP
          已属于执行客户端的主机，固定对端接收端口可独占绑定；异机 LAN
          对端不能在目标本机伪造，也不会自动 SSH。VXLAN 不采用 BFD
          的接口/TTL255限制；实际出站路由由操作系统决定，不修改宿主网络、网桥、FDB、网卡或
          offload。
        </p>
      </div>
    </>
  );
}
