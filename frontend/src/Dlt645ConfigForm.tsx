import {
  dlt645FixtureDefaults,
  type Dlt645Config,
  type Dlt645Security,
} from "./dlt645-config";

export default function Dlt645ConfigForm({
  config,
  onChange,
  disabled,
}: {
  config: Dlt645Config;
  onChange: (config: Dlt645Config) => void;
  disabled: boolean;
}) {
  const security = config.security;
  const updateFixture = (
    key: Exclude<keyof Extract<Dlt645Security, { mode: "fixture" }>, "mode">,
    value: string,
  ) => {
    if (security.mode === "fixture")
      onChange({ ...config, security: { ...security, [key]: value } });
  };
  return (
    <>
      <div className="protocol-binding-note">
        <strong>固定线格式</strong>
        <p>
          <code>dlt645-2007-tcp</code>：DL/T645-2007 软件电表，以 TCP
          承载串口字节流。不是 1997 模式，不代表物理
          RS-485、波特率、偶校验或真实电表验收。
        </p>
      </div>
      <div className="field-row">
        <label htmlFor="dlt645-bind">
          绑定地址
          <input
            id="dlt645-bind"
            value={config.bind_ip}
            onChange={(e) => onChange({ ...config, bind_ip: e.target.value })}
            disabled={disabled}
            required
            autoComplete="off"
            spellCheck={false}
          />
          <span className="field-help">
            单播 IPv4；0.0.0.0 表示全部 IPv4 接口。
          </span>
        </label>
        <label htmlFor="dlt645-port">
          TCP 端口
          <input
            id="dlt645-port"
            type="number"
            min="1"
            max="65535"
            step="1"
            value={Number.isFinite(config.port) ? config.port : ""}
            onChange={(e) =>
              onChange({ ...config, port: e.currentTarget.valueAsNumber })
            }
            disabled={disabled}
            required
          />
        </label>
      </div>
      <label htmlFor="dlt645-address">
        表地址启动初值
        <input
          id="dlt645-address"
          value={config.meter_address}
          onChange={(e) =>
            onChange({ ...config, meter_address: e.target.value })
          }
          disabled={disabled}
          required
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
        />
        <span className="field-help">
          恰好 12 位 ASCII 十进制数字，保留前导 0；不使用 999999999999
          广播地址。
        </span>
      </label>
      <div className="field-row">
        <label htmlFor="dlt645-energy">
          软件能量启动初值（百分之一单位）
          <input
            id="dlt645-energy"
            type="number"
            min="0"
            max="99999999"
            step="1"
            value={
              Number.isFinite(config.energy_hundredths)
                ? config.energy_hundredths
                : ""
            }
            onChange={(e) =>
              onChange({
                ...config,
                energy_hundredths: e.currentTarget.valueAsNumber,
              })
            }
            disabled={disabled}
            required
          />
          <span className="field-help">
            0～99999999 的整数软件计数，不是物理测量值。
          </span>
        </label>
        <label htmlFor="dlt645-period">
          周期启动初值（分钟）
          <input
            id="dlt645-period"
            type="number"
            min="1"
            max="99"
            step="1"
            value={
              Number.isFinite(config.period_minutes)
                ? config.period_minutes
                : ""
            }
            onChange={(e) =>
              onChange({
                ...config,
                period_minutes: e.currentTarget.valueAsNumber,
              })
            }
            disabled={disabled}
            required
          />
        </label>
      </div>
      <label htmlFor="dlt645-connections">
        最大并发连接数
        <input
          id="dlt645-connections"
          type="number"
          min="1"
          max="128"
          step="1"
          value={
            Number.isFinite(config.max_connections)
              ? config.max_connections
              : ""
          }
          onChange={(e) =>
            onChange({
              ...config,
              max_connections: e.currentTarget.valueAsNumber,
            })
          }
          disabled={disabled}
          required
        />
        <span className="field-help">
          1～128；按当前并发连接计数，不按累计连接次数计数。
        </span>
      </label>
      <label className="point-boolean" htmlFor="dlt645-programming-key">
        <input
          id="dlt645-programming-key"
          type="checkbox"
          checked={config.programming_key_enabled}
          onChange={(e) =>
            onChange({ ...config, programming_key_enabled: e.target.checked })
          }
          disabled={disabled}
        />
        启用模拟编程键
      </label>
      <p className="field-help">
        这是有限软件写操作的条件，不是全局只读开关。启用并应用后，可选“写周期并恢复”会先读取当前周期，写入、读回并恢复原值；默认
        ALL 始终仅运行四类核心只读测试。
      </p>
      <details className="connection-help">
        <summary>高级：扩展 03 固定传输 fixture</summary>
        <div className="connection-content">
          <label htmlFor="dlt645-security-mode">
            扩展 03 处理
            <select
              id="dlt645-security-mode"
              value={security.mode}
              onChange={(e) =>
                onChange({
                  ...config,
                  security:
                    e.target.value === "fixture"
                      ? { ...dlt645FixtureDefaults }
                      : { mode: "reject" },
                })
              }
              disabled={disabled}
            >
              <option value="reject">明确拒绝（默认）</option>
              <option value="fixture">精确匹配固定传输 fixture</option>
            </select>
          </label>
          <p className="field-help">
            仅验证固定字节请求与回应；不提供认证、加密、MAC 或 ESAM，结果
            crypto_verified=false。请仅填写实验字节，不导入真实设备凭据。此可选测试不包含在
            ALL。
          </p>
          {security.mode === "fixture" && (
            <div className="field-row">
              <label htmlFor="dlt645-request_di">
                请求 DI
                <select
                  id="dlt645-request_di"
                  value={security.request_di}
                  onChange={(e) => updateFixture("request_di", e.target.value)}
                  disabled={disabled}
                >
                  <option value="07000001">07000001</option>
                  <option value="07000002">07000002</option>
                  <option value="07000003">07000003</option>
                </select>
              </label>
              <div>
                <span className="field-label">固定回应 DI</span>
                <p>
                  <code>{security.response_di}</code>
                </p>
                <span className="field-help">
                  本实验 profile 固定为 070000FF。
                </span>
              </div>
              {(
                [
                  ["operator", "实验 operator（4 字节）", 8],
                  ["request_hex", "固定请求（8 字节）", 16],
                  ["response_hex", "固定回应（12 字节）", 24],
                ] as const
              ).map(([key, label, length]) => (
                <label key={key} htmlFor={`dlt645-${key}`}>
                  {label}
                  <input
                    id={`dlt645-${key}`}
                    value={security[key]}
                    onChange={(e) => updateFixture(key, e.target.value)}
                    disabled={disabled}
                    required
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <span className="field-help">
                    恰好 {length} 位十六进制字符，不带 0x 或分隔符。
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      </details>
      <div className="response-description">
        <p>
          显示的是新 worker
          启动初值；实际线协议可修改运行中的表地址、能量和周期等软件状态。TCP
          重连保留当前状态，重新启动 worker
          才按生效配置初始化；当前值以真实读表回应为准。
        </p>
        <p>
          服务保留有限软件读写、冻结、控制等功能，控制与输出仅改变模拟内存，不驱动真实继电器或仪表。保存只更新配置，需显式运行或重启才应用。
        </p>
      </div>
    </>
  );
}
