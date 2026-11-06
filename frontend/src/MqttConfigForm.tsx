import { guideText } from "./protocol-description.ts";
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
        <label htmlFor="mqtt-bind">{guideText("mqtt.configuration.mqttconfigform.006")}<input
            id="mqtt-bind"
            value={config.bind_ip}
            onChange={(e) => onChange({ ...config, bind_ip: e.target.value })}
            disabled={disabled}
            required
            autoComplete="off"
            spellCheck={false}
          />
          <span className="field-help">{guideText("mqtt.configuration.mqttconfigform.001")}</span>
        </label>
        <label htmlFor="mqtt-port">{guideText("mqtt.configuration.mqttconfigform.007")}<input
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
        <label htmlFor="mqtt-connections">{guideText("mqtt.configuration.mqttconfigform.008")}<input
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
          <span className="field-help">{guideText("mqtt.configuration.mqttconfigform.002")}</span>
        </label>
        <label htmlFor="mqtt-packet-size">{guideText("mqtt.configuration.mqttconfigform.009")}<input
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
          <span className="field-help">{guideText("mqtt.configuration.mqttconfigform.003")}</span>
        </label>
      </div>
      <div className="response-description">
        <p>{guideText("mqtt.configuration.mqttconfigform.004")}</p>
        <p>{guideText("mqtt.configuration.mqttconfigform.005")}</p>
      </div>
    </>
  );
}
