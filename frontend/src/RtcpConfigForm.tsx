import { guideText } from "./protocol-description.ts";
import type { RtcpConfig } from "./rtcp-config";

export default function RtcpConfigForm({
  config,
  onChange,
  disabled,
}: {
  config: RtcpConfig;
  onChange: (config: RtcpConfig) => void;
  disabled: boolean;
}) {
  return (
    <>
      <div className="protocol-binding-note">
        <strong>{guideText("rtcp.configuration.rtcpconfigform.001")}</strong>
        <p>
          <code>{guideText("rtcp.configuration.rtcpconfigform.002")}</code>{guideText("rtcp.configuration.rtcpconfigform.003")}</p>
        <p>{guideText("rtcp.configuration.rtcpconfigform.004")}</p>
      </div>
      <div className="field-row">
        <label htmlFor="rtcp-bind">{guideText("rtcp.configuration.rtcpconfigform.010")}<input
            id="rtcp-bind"
            value={config.bind_ip}
            onChange={(e) => onChange({ ...config, bind_ip: e.target.value })}
            disabled={disabled}
            required
            autoComplete="off"
            spellCheck={false}
          />
          <span className="field-help">{guideText("rtcp.configuration.rtcpconfigform.005")}</span>
        </label>
        <label htmlFor="rtcp-port">{guideText("rtcp.configuration.rtcpconfigform.011")}<input
            id="rtcp-port"
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
      <label htmlFor="rtcp-packet-size">{guideText("rtcp.configuration.rtcpconfigform.012")}<input
          id="rtcp-packet-size"
          type="number"
          min="64"
          max="65507"
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
        <span className="field-help">{guideText("rtcp.configuration.rtcpconfigform.006")}</span>
      </label>
      <div className="response-description">
        <p>{guideText("rtcp.configuration.rtcpconfigform.007")}</p>
        <p>{guideText("rtcp.configuration.rtcpconfigform.008")}</p>
        <p>{guideText("rtcp.configuration.rtcpconfigform.009")}</p>
      </div>
    </>
  );
}
