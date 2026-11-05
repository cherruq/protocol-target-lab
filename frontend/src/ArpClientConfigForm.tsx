import {
  arpClientModes,
  arpClientModeLabels,
  arpClientScenarioLabels,
  arpClientAllowedScenarios,
  arpClientBudget,
  positiveArpClientScenario,
  validArpClientPair,
  changeArpClientLink,
  type ArpClientConfig,
  type ArpClientMode,
  type ArpClientScenario,
  type ArpClientLink,
} from "./arp-client-config";
export function ArpClientBudgetNotice({
  config,
  draft = false,
}: {
  config: ArpClientConfig;
  draft?: boolean;
}) {
  let budget;
  try {
    budget = arpClientBudget(config);
  } catch {
    return draft ? (
      <p className="field-help">
        完成合法草稿后可查看测试预算；非法模式 / 场景不会自动重置。
      </p>
    ) : null;
  }
  return (
    <div className="test-config-notice">
      <strong>
        {draft ? "当前草稿" : "当前生效快照"}的 ALL 预算上界：
        {(budget.total_ms / 1000).toFixed(3)} 秒
      </strong>
      <p>
        {budget.testable
          ? "满足合同的30秒总预算、4秒阶段上限与250ms最短响应期限；实际执行仍需后端核对链路、身份与反向对端。"
          : `${budget.reason} 合法运行配置不等于测试可执行；单项预算须另算，不能绕过250ms最短期限或4秒阶段上限，最终由后端按所选案例预检。`}{" "}
        此处不缩短计时器、不保存或重启目标；反向工具不会用进程睡眠替代实际
        pending 到期。
      </p>
    </div>
  );
}
export default function ArpClientConfigForm({
  config,
  onChange,
  disabled,
}: {
  config: ArpClientConfig;
  onChange: (c: ArpClientConfig) => void;
  disabled: boolean;
}) {
  const allowed = arpClientAllowedScenarios[config.mode],
    pair = validArpClientPair(config.mode, config.request_scenario.mode);
  const text = (
    key:
      | "source_mac"
      | "server_mac"
      | "source_ip"
      | "server_ip"
      | "assigned_ip",
    label: string,
    help: string,
  ) => (
    <label htmlFor={`arp-${key}`} key={key}>
      {label}
      <input
        id={`arp-${key}`}
        value={config[key]}
        disabled={disabled || (key === "assigned_ip" && config.mode !== "rarp")}
        required
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange({ ...config, [key]: e.target.value })}
      />
      <span className="field-help">{help}</span>
    </label>
  );
  const number = (
    key: "interval_ms" | "timeout_ms" | "retries",
    label: string,
    min: number,
    max: number,
  ) => (
    <label htmlFor={`arp-${key}`} key={key}>
      {label}
      <input
        id={`arp-${key}`}
        type="number"
        min={min}
        max={max}
        step={1}
        value={Number.isFinite(config[key]) ? config[key] : ""}
        required
        disabled={disabled}
        onChange={(e) =>
          onChange({ ...config, [key]: e.currentTarget.valueAsNumber })
        }
      />
    </label>
  );
  return (
    <>
      <div className="protocol-binding-note">
        <strong>目标是主动请求端，临时测试工具是反向应答端</strong>
        <p>
          持续发送 Ethernet / IPv4 ARP、RARP 或 InARP Request，按实际 incoming
          回应形成映射。运行不等于已解析；没有协议事务ID或响应ACK，不提供RTP依赖、DHCP或系统地址分配。
        </p>
      </div>
      <label htmlFor="arp-link">
        二层链路
        <select
          id="arp-link"
          value={config.link.mode}
          disabled={disabled}
          onChange={(e) =>
            onChange(
              changeArpClientLink(
                config,
                e.target.value as ArpClientLink["mode"],
              ),
            )
          }
        >
          <option value="docker-bridge">受管隔离内部 bridge（默认）</option>
          <option value="host-interface">现有宿主 Ethernet 接口</option>
        </select>
      </label>
      {config.link.mode === "host-interface" ? (
        <>
          <label htmlFor="arp-interface">
            目标宿主机现有接口名
            <input
              id="arp-interface"
              value={config.link.interface}
              maxLength={15}
              required
              disabled={disabled}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) =>
                onChange({
                  ...config,
                  link: { mode: "host-interface", interface: e.target.value },
                })
              }
            />
          </label>
          <p className="field-help">
            启动核对真实Ethernet类型及source_mac，不猜接口、不改MAC/IP、路由、邻居或sysctl。内置工具只能按server_mac查找本机唯一、不同的真实接口；没有该路径会明确不可用。异机反向工具必须显式选择自己的接口名，不复制目标接口名。
          </p>
        </>
      ) : (
        <p className="field-help">
          管理器仅创建本工作台拥有的internal
          bridge，目标与一次性反向工具使用两个不同veth的实际incoming帧。网络是内部依赖，不是新工作台或永久假对端；不复用共享默认bridge，也不等于物理LAN验收。
        </p>
      )}
      <div className="field-row">
        {text(
          "source_mac",
          "目标实际 MAC",
          "bridge中由Docker赋给目标eth0；host模式须等于现有接口MAC。非零单播，保存统一小写。",
        )}
        {text(
          "server_mac",
          "反向对端实际 MAC",
          "bridge临时peer实际使用的MAC；host由真实外部或不同接口满足，须与目标MAC不同。",
        )}
      </div>
      <div className="field-row">
        {text(
          "source_ip",
          "实验源协议 IPv4",
          "报文角色值，不表示宿主或虚拟网卡已配置此IP；RARP请求协议地址槽不使用该值，仍保留。",
        )}
        {text(
          "server_ip",
          "预期对端协议 IPv4",
          "ARP查询目标 / RARP及InARP的响应校验地址，须与实验源IP不同。",
        )}
      </div>
      {text(
        "assigned_ip",
        "RARP 预期实验分配 IPv4",
        "仅RARP使用；可等于实验源IP。其他模式保留此必填值，映射结果不会配置系统IP或邻居表。",
      )}
      <div className="field-row">
        <label htmlFor="arp-mode">
          主动请求模式
          <select
            id="arp-mode"
            value={config.mode}
            disabled={disabled}
            onChange={(e) =>
              onChange({ ...config, mode: e.target.value as ArpClientMode })
            }
          >
            {arpClientModes.map((mode) => (
              <option key={mode} value={mode}>
                {arpClientModeLabels[mode]}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="arp-scenario">
          目标请求场景
          <select
            id="arp-scenario"
            value={config.request_scenario.mode}
            disabled={disabled}
            onChange={(e) =>
              onChange({
                ...config,
                request_scenario: { mode: e.target.value as ArpClientScenario },
              })
            }
          >
            {!pair && (
              <option value={config.request_scenario.mode} disabled>
                {config.request_scenario.mode}（当前模式不适用，请选择）
              </option>
            )}
            {allowed.map((mode) => (
              <option key={mode} value={mode}>
                {arpClientScenarioLabels[mode]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!pair ? (
        <div className="test-error" role="alert">
          请求模式与场景不兼容。请明确选择适用场景；不会静默改回normal，也不会保存或应用非法组合。
        </div>
      ) : (
        <p className="field-help">
          {positiveArpClientScenario(config)
            ? "正向组合：接收完整匹配当前请求的真实回应后才形成映射。非零RARP协议字段 / 非零ARP请求THA仍是正向组合。"
            : "负向组合：即使收到完整规范回应，也不得形成映射；有可归属回应时计unexpected而不计negative_silent。"}{" "}
          切模式只改草稿，15个合法组合不会由一次ALL自动轮换。
        </p>
      )}
      <div className="field-row">
        {number("interval_ms", "重试组完成后的间隔（毫秒）", 10, 60000)}
        {number("timeout_ms", "单次尝试响应期限（毫秒）", 10, 60000)}
      </div>
      {number("retries", "首次尝试之外的额外重试次数", 0, 10)}
      <p className="field-help">
        每次实际发送和重试都有新的本地query_id，错误流量不延长期限；成功映射后取消重试组。服务持续运行，不以轮数、累计请求或测试日志预算退出。
      </p>
      <ArpClientBudgetNotice config={config} draft />
      <div className="response-description">
        <p>
          short-arp是提交37字节意图；实际链路可能补齐为60字节。报告保留提交与实际incoming长度/哈希，仅明确的37字节前缀加23零可作为已测补齐，不宣称真实物理runt。
        </p>
        <p>
          保存模式与场景作为完整快照原子提交；草稿不自动作用于持续运行的请求端。响应padding只作测试关联证据，不是协议txid或ACK；相同地址元组的迟到相同回应仍有歧义，不提供认证保证。
        </p>
      </div>
    </>
  );
}
