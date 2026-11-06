import { guideText } from "./protocol-description.ts";
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
        <strong>{guideText("mqtt-sn.configuration.mqttsnconfigform.001")}</strong>
        <p>{guideText("mqtt-sn.configuration.mqttsnconfigform.002")}<code>{config.bind_ip}</code>{guideText("mqtt-sn.configuration.mqttsnconfigform.003")}<code>{config.broker_host}</code>{guideText("mqtt-sn.configuration.mqttsnconfigform.004")}</p>
        <p>{guideText("mqtt-sn.configuration.mqttsnconfigform.005")}</p>
      </div>
      <div className="field-row">
        <label htmlFor="mqtt-sn-port">{guideText("mqtt-sn.configuration.mqttsnconfigform.012")}<input
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
        <label htmlFor="mqtt-sn-gateway-id">{guideText("mqtt-sn.configuration.mqttsnconfigform.013")}<input
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
        <label htmlFor="mqtt-sn-group">{guideText("mqtt-sn.configuration.mqttsnconfigform.014")}<input
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
        <label htmlFor="mqtt-sn-discovery-port">{guideText("mqtt-sn.configuration.mqttsnconfigform.015")}<input
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
          <span className="field-help">{guideText("mqtt-sn.configuration.mqttsnconfigform.006")}</span>
        </label>
      </div>
      <label htmlFor="mqtt-sn-broker-port">{guideText("mqtt-sn.configuration.mqttsnconfigform.016")}<input
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
        <span className="field-help">{guideText("mqtt-sn.configuration.mqttsnconfigform.007")}</span>
      </label>
      <div className="dns-record-heading">
        <h3>{guideText("mqtt-sn.configuration.mqttsnconfigform.017")}</h3>
        <span>{config.predefined_topics.length}{guideText("mqtt-sn.configuration.mqttsnconfigform.018")}</span>
      </div>
      <p className="field-help">{guideText("mqtt-sn.configuration.mqttsnconfigform.008")}</p>
      <div className="mqtt-sn-topics">
        {config.predefined_topics.map((item, index) => (
          <fieldset className="protocol-point" key={index} disabled={disabled}>
            <legend>{guideText("mqtt-sn.configuration.mqttsnconfigform.019")}{index + 1}</legend>
            <label htmlFor={`mqtt-sn-topic-id-${index}`}>{guideText("mqtt-sn.configuration.mqttsnconfigform.020")}<input
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
            <label htmlFor={`mqtt-sn-topic-name-${index}`}>{guideText("mqtt-sn.configuration.mqttsnconfigform.021")}<input
                id={`mqtt-sn-topic-name-${index}`}
                value={item.topic}
                onChange={(e) => changeTopic(index, { topic: e.target.value })}
                required
                autoComplete="off"
                spellCheck={false}
              />
              <span className="field-help">
                {new TextEncoder().encode(item.topic).length}{guideText("mqtt-sn.configuration.mqttsnconfigform.009")}</span>
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
            >{guideText("mqtt-sn.configuration.mqttsnconfigform.022")}</button>
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
      >{guideText("mqtt-sn.configuration.mqttsnconfigform.023")}</button>
      <div className="response-description">
        <p>{guideText("mqtt-sn.configuration.mqttsnconfigform.010")}</p>
        <p>{guideText("mqtt-sn.configuration.mqttsnconfigform.011")}</p>
      </div>
    </>
  );
}
