import {
  FLOAT32_MAX,
  type Iec104Address,
  type Iec104Config,
} from "./iec104-config";

export default function Iec104ConfigForm({
  config,
  onChange,
  disabled,
}: {
  config: Iec104Config;
  onChange: (config: Iec104Config) => void;
  disabled: boolean;
}) {
  function changeAddress(
    role: keyof Iec104Config["points"],
    update: Partial<Iec104Address>,
  ) {
    onChange({
      ...config,
      points: {
        ...config.points,
        [role]: { ...config.points[role], ...update },
      },
    });
  }
  function addressFields(role: keyof Iec104Config["points"]) {
    const point = config.points[role];
    return (
      <div className="field-row">
        <label htmlFor={`iec104-${role}-ca`}>
          公共地址（CA）
          <input
            id={`iec104-${role}-ca`}
            type="number"
            min="1"
            max="65534"
            step="1"
            value={Number.isFinite(point.ca) ? point.ca : ""}
            onChange={(e) =>
              changeAddress(role, { ca: e.currentTarget.valueAsNumber })
            }
            required
          />
        </label>
        <label htmlFor={`iec104-${role}-ioa`}>
          信息体地址（IOA）
          <input
            id={`iec104-${role}-ioa`}
            type="number"
            min="1"
            max="16777215"
            step="1"
            value={Number.isFinite(point.ioa) ? point.ioa : ""}
            onChange={(e) =>
              changeAddress(role, { ioa: e.currentTarget.valueAsNumber })
            }
            required
          />
        </label>
      </div>
    );
  }
  return (
    <>
      <div className="field-row">
        <label htmlFor="iec104-bind">
          绑定地址
          <input
            id="iec104-bind"
            value={config.bind_ip}
            onChange={(e) => onChange({ ...config, bind_ip: e.target.value })}
            required
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
          />
          <span className="field-help">0.0.0.0 表示全部 IPv4 接口</span>
        </label>
        <label htmlFor="iec104-port">
          TCP 端口
          <input
            id="iec104-port"
            type="number"
            min="1"
            max="65535"
            value={Number.isFinite(config.port) ? config.port : ""}
            onChange={(e) =>
              onChange({ ...config, port: e.currentTarget.valueAsNumber })
            }
            required
            disabled={disabled}
          />
        </label>
      </div>
      <label htmlFor="iec104-connections">
        最大连接数
        <input
          id="iec104-connections"
          type="number"
          min="1"
          max="64"
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
          required
          disabled={disabled}
        />
        <span className="field-help">
          1～64 个连接；固定三种点角色，所有 (CA, IOA) 地址组合必须不同。
        </span>
      </label>
      <div className="iec104-points">
        <fieldset className="protocol-point" disabled={disabled}>
          <legend>单点遥信 · M_SP_NA_1</legend>
          {addressFields("single")}
          <label className="point-boolean" htmlFor="iec104-single-value">
            <input
              id="iec104-single-value"
              type="checkbox"
              checked={config.points.single.value}
              onChange={(e) =>
                onChange({
                  ...config,
                  points: {
                    ...config.points,
                    single: {
                      ...config.points.single,
                      value: e.target.checked,
                    },
                  },
                })
              }
            />
            启动初值：{config.points.single.value ? "true（1）" : "false（0）"}
          </label>
          <p className="field-help">
            此值仅是启动初值；运行时可被真实协议命令修改。实时值请通过 GI / READ
            的实际返回查看。
          </p>
        </fieldset>
        <fieldset className="protocol-point" disabled={disabled}>
          <legend>浮点测量 · M_ME_NC_1</legend>
          {addressFields("measured")}
          <label htmlFor="iec104-measured-value">
            启动初值（float32）
            <input
              id="iec104-measured-value"
              type="number"
              min={-FLOAT32_MAX}
              max={FLOAT32_MAX}
              step="any"
              value={
                Number.isFinite(config.points.measured.value)
                  ? config.points.measured.value
                  : ""
              }
              onChange={(e) =>
                onChange({
                  ...config,
                  points: {
                    ...config.points,
                    measured: {
                      ...config.points.measured,
                      value: e.currentTarget.valueAsNumber,
                    },
                  },
                })
              }
              required
            />
          </label>
          <p className="field-help">
            有限 32 位浮点数；实际协议值按 float32 表示，以真实读回报告为准。
          </p>
        </fieldset>
        <fieldset className="protocol-point" disabled={disabled}>
          <legend>直接命令 · C_SC_NA_1 · DIRECT</legend>
          {addressFields("command")}
          <p className="field-help">
            固定映射：命令 CA {config.points.command.ca} / IOA{" "}
            {config.points.command.ioa} → 模拟单点 CA {config.points.single.ca}{" "}
            / IOA {config.points.single.ioa}。
          </p>
          <p className="field-help">
            命令仅修改本实验服务的模拟内存，不连接或驱动物理开关；不提供设备控制验收。
          </p>
        </fieldset>
      </div>
      <div className="response-description">
        <p>
          保存与生效区展示的是启动参数快照，不是实时遥信。显式运行或重启后使用上述初值初始化。
        </p>
        <p>
          COMMAND
          测试会读取当前模拟单点，取反后再恢复；实际帧和读回点值见测试报告。
        </p>
      </div>
    </>
  );
}
