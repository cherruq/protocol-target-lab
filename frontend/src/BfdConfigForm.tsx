import {
  bfdModes,
  bfdModeLabels,
  changeBfdMode,
  type BfdConfig,
  type BfdMode,
} from "./bfd-config";

export default function BfdConfigForm({
  config,
  onChange,
  disabled,
}: {
  config: BfdConfig;
  onChange: (config: BfdConfig) => void;
  disabled: boolean;
}) {
  const number = (
    key:
      | "source_port"
      | "local_discriminator"
      | "min_tx_us"
      | "min_rx_us"
      | "detect_mult",
    label: string,
    min: number,
    max: number,
  ) => (
    <label htmlFor={`bfd-${key}`} key={key}>
      {label}
      <input
        id={`bfd-${key}`}
        type="number"
        min={min}
        max={max}
        step={1}
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
        <strong>IPv4 单跳异步 BFD · 固定 UDP 3784</strong>
        <p>
          本地主动角色，24 字节无认证
          Control。地址和接口必须已在实际机器上配置；保存仅校验格式，启动 /
          重启前服务端会核对目标绑定地址、接口归属和端点占用。
        </p>
      </div>
      <div className="field-row">
        {(["bind_ip", "peer_ip"] as const).map((key) => (
          <label key={key} htmlFor={`bfd-${key}`}>
            {key === "bind_ip" ? "目标绑定 IPv4" : "固定对端 IPv4"}
            <input
              id={`bfd-${key}`}
              value={config[key]}
              required
              disabled={disabled}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => onChange({ ...config, [key]: e.target.value })}
            />
            <span className="field-help">
              明确单播地址，两端须不同；不允许 0.0.0.0。
            </span>
          </label>
        ))}
      </div>
      <label htmlFor="bfd-interface">
        目标宿主机接口
        <input
          id="bfd-interface"
          value={config.interface}
          maxLength={15}
          required
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange({ ...config, interface: e.target.value })}
        />
        <span className="field-help">
          这是目标服务绑定地址所属接口，不是异机客户端接口名。默认 127.0.0.1 /
          127.0.0.2 使用 lo。
        </span>
      </label>
      <div className="field-row">
        {number("source_port", "稳定源 UDP 端口", 49152, 65535)}
        {number("local_discriminator", "本地 discriminator", 1, 4294967295)}
      </div>
      <div className="field-row">
        {number("min_tx_us", "最小发送间隔（微秒）", 1000000, 4294967295)}
        {number("min_rx_us", "最小接收间隔（微秒）", 1000000, 4294967295)}
      </div>
      {number("detect_mult", "检测倍数", 1, 255)}
      <label htmlFor="bfd-mode">
        目标场景
        <select
          id="bfd-mode"
          value={config.scenario.mode}
          disabled={disabled}
          onChange={(e) =>
            onChange(changeBfdMode(config, e.target.value as BfdMode))
          }
        >
          {bfdModes.map((mode) => (
            <option key={mode} value={mode}>
              {bfdModeLabels[mode]}
            </option>
          ))}
        </select>
      </label>
      {config.scenario.mode !== "normal" && (
        <label htmlFor="bfd-after-up">
          双向 Up 后延迟（毫秒）
          <input
            id="bfd-after-up"
            type="number"
            min={0}
            max={3600000}
            step={1}
            required
            disabled={disabled}
            value={
              Number.isFinite(config.scenario.after_up_ms)
                ? config.scenario.after_up_ms
                : ""
            }
            onChange={(e) => {
              if (config.scenario.mode !== "normal")
                onChange({
                  ...config,
                  scenario: {
                    ...config.scenario,
                    after_up_ms: e.currentTarget.valueAsNumber,
                  },
                });
            }}
          />
        </label>
      )}
      {"duration_ms" in config.scenario && (
        <label htmlFor="bfd-duration">
          故障窗口持续时间（毫秒）
          <input
            id="bfd-duration"
            type="number"
            min={1}
            max={3600000}
            step={1}
            required
            disabled={disabled}
            value={
              Number.isFinite(config.scenario.duration_ms)
                ? config.scenario.duration_ms
                : ""
            }
            onChange={(e) => {
              if ("duration_ms" in config.scenario)
                onChange({
                  ...config,
                  scenario: {
                    ...config.scenario,
                    duration_ms: e.currentTarget.valueAsNumber,
                  },
                });
            }}
          />
        </label>
      )}
      <div className="response-description">
        <p>
          服务运行与对端会话 Up 分别显示。无真实对端时 Down
          是正常监测状态；运行态轮询只读取目标状态，不创建 BFD
          对端或发送业务探测。
        </p>
        <p>
          场景在每个新鲜对端身份完成双向 Up
          后触发一次；同一身份恢复不会重新触发故障。ALL
          仅验证当前已生效模式的全部阶段，运行两个新鲜会话轮次，不会执行其余五种模式。
        </p>
        <p>
          内置客户端要求对端地址已属于执行客户端的宿主机；远端 LAN
          对端不能在目标本机伪造。接口、占用和测试时间预算不满足时会明确拒绝；合法的大间隔或过短故障窗口仍可能无法在有界测试中验收。
        </p>
        <p>
          保存不自动应用，需显式运行或重启。此有限 profile 不含
          Echo、认证、Demand、多跳、IPv6 或路由收敛集成；默认环回验证不代表 LAN
          或物理故障验收。
        </p>
      </div>
    </>
  );
}
