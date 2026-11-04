import { updateIec101Channel, type Iec101Config } from "./iec101-config";

export default function Iec101ConfigForm({
  config,
  onChange,
  disabled,
}: {
  config: Iec101Config;
  onChange: (config: Iec101Config) => void;
  disabled: boolean;
}) {
  return (
    <>
      <div className="protocol-binding-note">
        <strong>固定双通道 · 非平衡传输</strong>
        <p>
          <code>iec101-unbalanced-dual</code>；两个通道同时存在，宽度按 link /
          COT / CA / IOA 字节数固定，不提供宽度二选一或单边禁用。
        </p>
        <p>
          原生 PTY termios 请求为 <code>9600 / 8 / N / 1</code>
          ；这是软件串行链路参数，不代表物理串口电气线速、奇偶校验或 RS-485
          验收。
        </p>
      </div>
      <label htmlFor="iec101-bind">
        绑定地址
        <input
          id="iec101-bind"
          value={config.bind_ip}
          onChange={(e) => onChange({ ...config, bind_ip: e.target.value })}
          disabled={disabled}
          required
          autoComplete="off"
          spellCheck={false}
        />
        <span className="field-help">
          单播 IPv4；0.0.0.0 表示全部 IPv4 接口。两个通道使用同一绑定地址。
        </span>
      </label>
      {(["single", "double"] as const).map((kind) => {
        const c = config[kind];
        const max = kind === "single" ? 254 : 65534;
        return (
          <fieldset key={kind} className="protocol-point" disabled={disabled}>
            <legend>
              {kind === "single"
                ? "单字节通道 single · 1/1/1/1"
                : "双字节通道 double · 2/2/2/3"}
            </legend>
            <div className="field-row">
              {(
                [
                  ["port", "TCP端口", 1, 65535],
                  ["link_address", "链路地址", 1, max],
                  ["common_address", "公共地址 CA", 1, max],
                ] as const
              ).map(([key, label, min, limit]) => (
                <label key={key} htmlFor={`iec101-${kind}-${key}`}>
                  {label}
                  <input
                    id={`iec101-${kind}-${key}`}
                    type="number"
                    min={min}
                    max={limit}
                    step="1"
                    value={Number.isFinite(c[key]) ? c[key] : ""}
                    onChange={(e) =>
                      onChange(
                        updateIec101Channel(config, kind, {
                          [key]: e.currentTarget.valueAsNumber,
                        }),
                      )
                    }
                    required
                  />
                </label>
              ))}
              {kind === "single" ? (
                <div>
                  <span>发起地址 OA</span>
                  <p>
                    <code>0 · 不在线编码</code>
                  </p>
                  <span className="field-help">
                    单字节 COT 不含 OA；报告使用 null /
                    encoded=false，不合成线上 OA。
                  </span>
                </div>
              ) : (
                <label htmlFor="iec101-double-originator_address">
                  发起地址 OA
                  <input
                    id="iec101-double-originator_address"
                    type="number"
                    min="0"
                    max="255"
                    step="1"
                    value={
                      Number.isFinite(c.originator_address)
                        ? c.originator_address
                        : ""
                    }
                    onChange={(e) =>
                      onChange(
                        updateIec101Channel(config, kind, {
                          originator_address: e.currentTarget.valueAsNumber,
                        }),
                      )
                    }
                    required
                  />
                </label>
              )}
              <label htmlFor={`iec101-${kind}-ioa`}>
                单点 IOA
                <input
                  id={`iec101-${kind}-ioa`}
                  type="number"
                  min="1"
                  max={kind === "single" ? 255 : 16777215}
                  step="1"
                  value={Number.isFinite(c.point.ioa) ? c.point.ioa : ""}
                  onChange={(e) =>
                    onChange(
                      updateIec101Channel(config, kind, {
                        point: { ioa: e.currentTarget.valueAsNumber },
                      }),
                    )
                  }
                  required
                />
              </label>
            </div>
            <label className="point-boolean" htmlFor={`iec101-${kind}-value`}>
              <input
                id={`iec101-${kind}-value`}
                type="checkbox"
                checked={c.point.value}
                onChange={(e) =>
                  onChange(
                    updateIec101Channel(config, kind, {
                      point: { value: e.target.checked },
                    }),
                  )
                }
              />
              模拟单点值
            </label>
            <label className="point-boolean" htmlFor={`iec101-${kind}-e5`}>
              <input
                id={`iec101-${kind}-e5`}
                type="checkbox"
                checked={c.single_char_ack}
                onChange={(e) =>
                  onChange(
                    updateIec101Channel(config, kind, {
                      single_char_ack: e.target.checked,
                    }),
                  )
                }
              />
              启用单字符 E5 应答
            </label>
            <p className="field-help">
              E5 仅是合法链路 ACK / 空数据应答，不能代表总召唤完成。GI
              测试须取得 ACT_CON、COT20 单点数据及 ACT_TERM。
            </p>
          </fieldset>
        );
      })}
      <div className="response-description">
        <p>
          真实 lib60870-C 原生从站经 PTY / TCP 传输 FT1.2
          字节；每通道仅一个活动主站连接，两个通道互相独立。外部串口桥占用通道时，先在对应测试主机停止桥接再运行内置测试；管理器不会驱逐已有会话。
        </p>
        <p>
          默认 dual / ALL 共 16 项，single 或 double 可分别验证；测试按实际 ACD
          / DFC 和原生 GI 数据核对，不把 TCP 连接或任意 ACK
          当业务成功。保存后需显式重启，两个通道按一份生效快照共同应用。
        </p>
      </div>
    </>
  );
}
