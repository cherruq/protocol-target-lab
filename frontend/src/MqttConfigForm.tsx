import type { MqttConfig } from "./mqtt-config";

export default function MqttConfigForm({
  config,
  onChange,
  disabled,
}: {
  config: MqttConfig;
  onChange: (config: MqttConfig) => void;
  disabled: boolean;
}) {
  return (
    <>
      <div className="field-row">
        <label htmlFor="mqtt-bind">
          绑定地址
          <input
            id="mqtt-bind"
            value={config.bind_ip}
            onChange={(e) => onChange({ ...config, bind_ip: e.target.value })}
            disabled={disabled}
            required
            autoComplete="off"
            spellCheck={false}
          />
          <span className="field-help">0.0.0.0 表示全部 IPv4 接口</span>
        </label>
        <label htmlFor="mqtt-port">
          TCP 端口
          <input
            id="mqtt-port"
            type="number"
            min="1"
            max="65535"
            value={Number.isFinite(config.port) ? config.port : ""}
            onChange={(e) =>
              onChange({ ...config, port: e.currentTarget.valueAsNumber })
            }
            disabled={disabled}
            required
          />
        </label>
      </div>
      <div className="field-row">
        <label htmlFor="mqtt-connections">
          最大连接数
          <input
            id="mqtt-connections"
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
          <span className="field-help">1～128 个客户端连接</span>
        </label>
        <label htmlFor="mqtt-packet-size">
          最大报文（字节）
          <input
            id="mqtt-packet-size"
            type="number"
            min="128"
            max="1048576"
            step="1"
            value={
              Number.isFinite(config.max_packet_size)
                ? config.max_packet_size
                : ""
            }
            onChange={(e) =>
              onChange({
                ...config,
                max_packet_size: e.currentTarget.valueAsNumber,
              })
            }
            disabled={disabled}
            required
          />
          <span className="field-help">
            128～1048576 字节，包含完整 MQTT 报文的头部和负载。
          </span>
        </label>
      </div>
      <div className="response-description">
        <p>
          使用匿名 TCP 接入，支持 MQTT 3.1.1 / 5.0 与 QoS 0 / 1 /
          2。当前阶段不提供 TLS、密码认证、WebSocket 或 SCRAM。
        </p>
        <p>保存只修改配置；显式运行或重启后应用新的连接数与报文限制。</p>
      </div>
    </>
  );
}
