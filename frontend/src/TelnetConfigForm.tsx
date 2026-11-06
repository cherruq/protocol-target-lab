import { guideText } from "./protocol-description.ts";
import { bannerByteLength, type TelnetConfig } from "./telnet-config";

export default function TelnetConfigForm({
  config,
  onChange,
  disabled,
}: {
  config: TelnetConfig;
  onChange: (config: TelnetConfig) => void;
  disabled: boolean;
}) {
  return (
    <>
      <div className="field-row">
        <label htmlFor="telnet-bind">{guideText("telnet.configuration.telnetconfigform.008")}<input
            id="telnet-bind"
            value={config.bind_ip}
            onChange={(e) => onChange({ ...config, bind_ip: e.target.value })}
            required
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
          />
          <span className="field-help">{guideText("telnet.configuration.telnetconfigform.001")}</span>
        </label>
        <label htmlFor="telnet-port">{guideText("telnet.configuration.telnetconfigform.009")}<input
            id="telnet-port"
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
      <label htmlFor="telnet-banner">{guideText("telnet.configuration.telnetconfigform.010")}<input
          id="telnet-banner"
          value={config.banner}
          onChange={(e) => onChange({ ...config, banner: e.target.value })}
          required
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
        />
        <span className="field-help">{guideText("telnet.configuration.telnetconfigform.002")}{bannerByteLength(config.banner)}{guideText("telnet.configuration.telnetconfigform.003")}</span>
      </label>
      <div className="field-row">
        <label htmlFor="telnet-connections">{guideText("telnet.configuration.telnetconfigform.011")}<input
            id="telnet-connections"
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
            required
            disabled={disabled}
          />
          <span className="field-help">{guideText("telnet.configuration.telnetconfigform.004")}</span>
        </label>
        <label htmlFor="telnet-line-bytes">{guideText("telnet.configuration.telnetconfigform.012")}<input
            id="telnet-line-bytes"
            type="number"
            min="64"
            max="65536"
            step="1"
            value={
              Number.isFinite(config.max_line_bytes)
                ? config.max_line_bytes
                : ""
            }
            onChange={(e) =>
              onChange({
                ...config,
                max_line_bytes: e.currentTarget.valueAsNumber,
              })
            }
            required
            disabled={disabled}
          />
          <span className="field-help">{guideText("telnet.configuration.telnetconfigform.005")}</span>
        </label>
      </div>
      <div className="response-description">
        <p>{guideText("telnet.configuration.telnetconfigform.006")}</p>
        <p>{guideText("telnet.configuration.telnetconfigform.007")}</p>
      </div>
    </>
  );
}
