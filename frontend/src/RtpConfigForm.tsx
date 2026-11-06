import { guideText } from "./protocol-description.ts";
import type { RtpConfig } from "./rtp-config";

export default function RtpConfigForm({
  config,
  onChange,
  disabled,
}: {
  config: RtpConfig;
  onChange: (config: RtpConfig) => void;
  disabled: boolean;
}) {
  return (
    <>
      <div className="field-row">
        <label htmlFor="rtp-bind">{guideText("rtp.configuration.rtpconfigform.006")}<input
            id="rtp-bind"
            value={config.bind_ip}
            onChange={(e) => onChange({ ...config, bind_ip: e.target.value })}
            disabled={disabled}
            required
            autoComplete="off"
            spellCheck={false}
          />
          <span className="field-help">{guideText("rtp.configuration.rtpconfigform.001")}</span>
        </label>
        <label htmlFor="rtp-port">{guideText("rtp.configuration.rtpconfigform.007")}<input
            id="rtp-port"
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
      <label htmlFor="rtp-packet-size">{guideText("rtp.configuration.rtpconfigform.008")}<input
          id="rtp-packet-size"
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
        <span className="field-help">{guideText("rtp.configuration.rtpconfigform.002")}</span>
      </label>
      <div className="response-description">
        <p>{guideText("rtp.configuration.rtpconfigform.003")}</p>
        <p>{guideText("rtp.configuration.rtpconfigform.004")}</p>
        <p>{guideText("rtp.configuration.rtpconfigform.005")}</p>
      </div>
    </>
  );
}
