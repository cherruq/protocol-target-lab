import {
  changeMplsLink,
  mplsScenarios,
  mplsScenarioLabels,
  type MplsConfig,
  type MplsLink,
  type MplsScenario,
} from "./mpls-config";
export default function MplsConfigForm({
  config,
  onChange,
  disabled,
  interfaceDraft,
  onInterfaceDraftChange,
}: {
  config: MplsConfig;
  onChange: (c: MplsConfig) => void;
  disabled: boolean;
  interfaceDraft: string;
  onInterfaceDraftChange: (v: string) => void;
}) {
  const text = (
    key: "source_mac" | "client_mac" | "source_ip" | "client_ip",
    label: string,
    help: string,
  ) => (
    <label key={key} htmlFor={`mpls-${key}`}>
      {label}
      <input
        id={`mpls-${key}`}
        value={config[key]}
        required
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange({ ...config, [key]: e.target.value })}
      />
      <span className="field-help">{help}</span>
    </label>
  );
  const num = (
    key: "label" | "reply_ttl",
    label: string,
    min: number,
    max: number,
  ) => (
    <label key={key} htmlFor={`mpls-${key}`}>
      {label}
      <input
        id={`mpls-${key}`}
        type="number"
        step={1}
        min={min}
        max={max}
        required
        disabled={disabled}
        value={Number.isFinite(config[key]) ? config[key] : ""}
        onChange={(e) =>
          onChange({ ...config, [key]: e.currentTarget.valueAsNumber })
        }
      />
    </label>
  );
  return (
    <>
      <div className="protocol-binding-note">
        <strong>单标签 MPLS / IPv4 / ICMP Echo 软件目标</strong>
        <p>
          真实 incoming EtherType 0x8847 + 一个 shim，按完整当前请求生成普通
          0x0800 IPv4 输出。不是通用 LSR/LER、标签交换、LDP/RSVP 或 MPLS
          OAM；不加载宿主模块、不改路由/sysctl，也不依赖其他协议工作台。
        </p>
      </div>
      <label htmlFor="mpls-link">
        二层链路
        <select
          id="mpls-link"
          value={config.link.mode}
          disabled={disabled}
          onChange={(e) => {
            if (config.link.mode === "host-interface")
              onInterfaceDraftChange(config.link.interface);
            onChange(
              changeMplsLink(
                config,
                e.target.value as MplsLink["mode"],
                interfaceDraft,
              ),
            );
          }}
        >
          <option value="docker-bridge">受管隔离内部 bridge（默认）</option>
          <option value="host-interface">现有宿主 Ethernet 接口</option>
        </select>
        <span className="field-help">
          两种接口编辑只在本页缓存；保存完整替换所选link，刷新不会保留未保存或非活跃分支。
        </span>
      </label>
      {config.link.mode === "host-interface" ? (
        <>
          <label htmlFor="mpls-interface">
            目标宿主现有接口名
            <input
              id="mpls-interface"
              value={config.link.interface}
              required
              maxLength={15}
              disabled={disabled}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                onInterfaceDraftChange(e.target.value);
                onChange({
                  ...config,
                  link: { mode: "host-interface", interface: e.target.value },
                });
              }}
            />
          </label>
          <p className="field-help">
            只读核对实际 Ethernet / MAC /
            MTU；目标MAC必须与现有NIC一致。内置客户端须找到client_mac对应唯一且不同的本机真实接口，否则明确不可用；外部peer显式选自己的接口，不猜目标名称。既有原生MPLS同标签路由/角色IP冲突必须诊断，不自动修改系统。
          </p>
        </>
      ) : (
        <p className="field-help">
          新建本工作台拥有的internal
          bridge，目标与一次性peer使用不同veth；MAC实际分配给endpoint。IP是协议角色，不配置成OS地址；不复用默认bridge或创建永驻假对端，软件链路不等于物理LAN。
        </p>
      )}
      <div className="field-row">
        {text(
          "source_mac",
          "目标实际 MAC",
          "非零单播；bridge实际使用此MAC，host须与真实NIC匹配。保存统一小写。",
        )}
        {text(
          "client_mac",
          "测试对端实际 MAC",
          "须与目标不同；host外部peer须在其主机明确选择真实接口。",
        )}
      </div>
      <div className="field-row">
        {text(
          "source_ip",
          "目标协议角色 IPv4",
          "MPLS内层请求目的 / 普通回复源；不是bind地址、URL或OS配置。",
        )}
        {text(
          "client_ip",
          "对端协议角色 IPv4",
          "内层请求源 / 回复目的；不能与角色或当前场景变异地址的真实OS端点冲突。",
        )}
      </div>
      <div className="field-row">
        {num("label", "单 shim MPLS label（20bit）", 16, 1048575)}
        {num("reply_ttl", "新 IPv4 回复 TTL", 1, 255)}
      </div>
      <p className="field-help">
        仅单标签S=1；请求shim
        TTL须≥2，TC可0～7。reply_ttl是新普通IPv4包的TTL，不是shim
        TTL传播；TC不映射为TOS。Ethernet padding独立于IP/ICMP载荷。
      </p>
      <label htmlFor="mpls-scenario">
        目标输出场景
        <select
          id="mpls-scenario"
          value={config.scenario.mode}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              ...config,
              scenario: { mode: e.target.value as MplsScenario },
            })
          }
        >
          {mplsScenarios.map((mode) => (
            <option key={mode} value={mode}>
              {mplsScenarioLabels[mode]}
            </option>
          ))}
        </select>
      </label>
      <div
        className={
          config.scenario.mode === "short-ethernet"
            ? "test-config-notice"
            : "response-description"
        }
      >
        {config.scenario.mode === "short-ethernet" ? (
          <p>
            保留13字节真实输出意图；kernel可能拒绝并记录tx_error/errno，正向案例须明确环境不可用，不能把无回复当silent通过、补成14/60字节或隐藏切normal。局部发送失败不应伪造成整个软件服务已停止。
          </p>
        ) : (
          <p>
            故障场景“测试通过”仅说明当前故障被真实核验，不表示正常Echo互通。silent仍须本次accepted
            + suppressed与真实quiet窗口，不能从超时或空结果推造成功。
          </p>
        )}
        <p>
          ALL只测当前生效场景8项，不自动覆盖14场景。单案例两轮、每阶段3秒绝对期限，client总30秒/manager45秒；保存草稿不自动应用，显式运行/重启后才生效。没有应用端口、连接Up或MPLS协议ACK；send成功仅为提交。
        </p>
      </div>
    </>
  );
}
