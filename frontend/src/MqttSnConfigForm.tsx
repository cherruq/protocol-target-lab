import type { MqttSnConfig, PredefinedTopic } from "./mqtt-sn-config";

export default function MqttSnConfigForm({
  config,
  onChange,
  disabled,
}: {
  config: MqttSnConfig;
  onChange: (config: MqttSnConfig) => void;
  disabled: boolean;
}) {
  function changeTopic(index: number, update: Partial<PredefinedTopic>) {
    onChange({
      ...config,
      predefined_topics: config.predefined_topics.map((t, i) =>
        i === index ? { ...t, ...update } : t,
      ),
    });
  }
  return (
    <>
      <div className="protocol-binding-note">
        <strong>固定原生绑定</strong>
        <p>
          网关 UDP：<code>{config.bind_ip}</code>；同容器私有 Broker：
          <code>{config.broker_host}</code>
          （仅环回监听）。这些地址固定，不提供任意 IP 选项。
        </p>
        <p>
          使用主机网络；私有 Broker 随本 MQTT-SN
          服务启停，不额外创建工作台，也不依赖公开 MQTT
          服务是否运行。客户端表使用原生固定容量。
        </p>
      </div>
      <div className="field-row">
        <label htmlFor="mqtt-sn-port">
          主 UDP 端口
          <input
            id="mqtt-sn-port"
            type="number"
            min="1"
            max="65535"
            step="1"
            value={Number.isFinite(config.port) ? config.port : ""}
            onChange={(e) =>
              onChange({ ...config, port: e.currentTarget.valueAsNumber })
            }
            required
            disabled={disabled}
          />
        </label>
        <label htmlFor="mqtt-sn-gateway-id">
          网关 ID
          <input
            id="mqtt-sn-gateway-id"
            type="number"
            min="1"
            max="255"
            step="1"
            value={Number.isFinite(config.gateway_id) ? config.gateway_id : ""}
            onChange={(e) =>
              onChange({ ...config, gateway_id: e.currentTarget.valueAsNumber })
            }
            required
            disabled={disabled}
          />
        </label>
      </div>
      <div className="field-row">
        <label htmlFor="mqtt-sn-group">
          发现组播地址
          <input
            id="mqtt-sn-group"
            value={config.discovery_group}
            onChange={(e) =>
              onChange({ ...config, discovery_group: e.target.value })
            }
            required
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label htmlFor="mqtt-sn-discovery-port">
          发现 UDP 端口
          <input
            id="mqtt-sn-discovery-port"
            type="number"
            min="1"
            max="65535"
            step="1"
            value={
              Number.isFinite(config.discovery_port)
                ? config.discovery_port
                : ""
            }
            onChange={(e) =>
              onChange({
                ...config,
                discovery_port: e.currentTarget.valueAsNumber,
              })
            }
            required
            disabled={disabled}
          />
          <span className="field-help">须与主 UDP 端口不同。</span>
        </label>
      </div>
      <label htmlFor="mqtt-sn-broker-port">
        私有 Broker TCP 端口
        <input
          id="mqtt-sn-broker-port"
          type="number"
          min="1"
          max="65535"
          step="1"
          value={Number.isFinite(config.broker_port) ? config.broker_port : ""}
          onChange={(e) =>
            onChange({ ...config, broker_port: e.currentTarget.valueAsNumber })
          }
          required
          disabled={disabled}
        />
        <span className="field-help">
          固定仅 127.0.0.1 TCP；可与 UDP 使用相同端口数字。
        </span>
      </label>
      <div className="dns-record-heading">
        <h3>预定义主题</h3>
        <span>{config.predefined_topics.length} / 16 条</span>
      </div>
      <p className="field-help">
        ID 与名称分别唯一；名称只允许 1～128 字节可见
        ASCII，不能含空白、逗号、+、#，不能以 $ 开头。plab/test
        及其下级命名空间保留给测试；名称区分大小写。
      </p>
      <div className="mqtt-sn-topics">
        {config.predefined_topics.map((item, index) => (
          <fieldset className="protocol-point" key={index} disabled={disabled}>
            <legend>预定义主题 {index + 1}</legend>
            <label htmlFor={`mqtt-sn-topic-id-${index}`}>
              主题 ID
              <input
                id={`mqtt-sn-topic-id-${index}`}
                type="number"
                min="1"
                max="65534"
                step="1"
                value={Number.isFinite(item.topic_id) ? item.topic_id : ""}
                onChange={(e) =>
                  changeTopic(index, {
                    topic_id: e.currentTarget.valueAsNumber,
                  })
                }
                required
              />
            </label>
            <label htmlFor={`mqtt-sn-topic-name-${index}`}>
              主题名称
              <input
                id={`mqtt-sn-topic-name-${index}`}
                value={item.topic}
                onChange={(e) => changeTopic(index, { topic: e.target.value })}
                required
                autoComplete="off"
                spellCheck={false}
              />
              <span className="field-help">
                {new TextEncoder().encode(item.topic).length} / 128 字节
              </span>
            </label>
            <button
              className="button"
              type="button"
              disabled={disabled || config.predefined_topics.length <= 1}
              onClick={() =>
                onChange({
                  ...config,
                  predefined_topics: config.predefined_topics.filter(
                    (_, i) => i !== index,
                  ),
                })
              }
            >
              移除此主题
            </button>
          </fieldset>
        ))}
      </div>
      <button
        className="button"
        type="button"
        disabled={disabled || config.predefined_topics.length >= 16}
        onClick={() => {
          const used = new Set(config.predefined_topics.map((t) => t.topic_id));
          let id = 1;
          while (used.has(id)) id++;
          onChange({
            ...config,
            predefined_topics: [
              ...config.predefined_topics,
              { topic_id: id, topic: "" },
            ],
          });
        }}
      >
        添加预定义主题
      </button>
      <div className="response-description">
        <p>
          本轮验收 QoS 1 端到端收发和真实组播 GWINFO；原生栈的其他 QoS
          能力未在本轮验收。
        </p>
        <p>主题增删和端口编辑只修改草稿；保存后仍需显式运行或重启才会生效。</p>
      </div>
    </>
  );
}
