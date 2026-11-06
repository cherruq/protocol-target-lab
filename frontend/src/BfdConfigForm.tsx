import { guideText } from "./protocol-description.ts";
import {
  bfdModes,
  bfdModeLabels,
  changeBfdMode,
  type BfdConfig,
  type BfdMode,
} from "./bfd-config";

export default function BfdConfigForm({
  config,
  onChange,
  disabled,
}: {
  config: BfdConfig;
  onChange: (config: BfdConfig) => void;
  disabled: boolean;
}) {
  const number = (
    key:
      | "source_port"
      | "local_discriminator"
      | "min_tx_us"
      | "min_rx_us"
      | "detect_mult",
    label: string,
    min: number,
    max: number,
  ) => (
    <label htmlFor={`bfd-${key}`} key={key}>
      {label}
      <input
        id={`bfd-${key}`}
        type="number"
        min={min}
        max={max}
        step={1}
        required
        disabled={disabled}
        value={Number.isFinite(config[key]) ? config[key] : ""}
        onChange={(e) =>
          onChange({ ...config, [key]: e.currentTarget.valueAsNumber })
        }
      />
    </label>
  );
  return (
    <>
      <div className="protocol-binding-note">
        <strong>{guideText("bfd.configuration.bfdconfigform.001")}</strong>
        <p>{guideText("bfd.configuration.bfdconfigform.002")}</p>
      </div>
      <div className="field-row">
        {(["bind_ip", "peer_ip"] as const).map((key) => (
          <label key={key} htmlFor={`bfd-${key}`}>
            {key === "bind_ip" ? guideText("bfd.configuration.bfdconfigform.010") : guideText("bfd.configuration.bfdconfigform.011")}
            <input
              id={`bfd-${key}`}
              value={config[key]}
              required
              disabled={disabled}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => onChange({ ...config, [key]: e.target.value })}
            />
            <span className="field-help">{guideText("bfd.configuration.bfdconfigform.003")}</span>
          </label>
        ))}
      </div>
      <label htmlFor="bfd-interface">{guideText("bfd.configuration.bfdconfigform.012")}<input
          id="bfd-interface"
          value={config.interface}
          maxLength={15}
          required
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange({ ...config, interface: e.target.value })}
        />
        <span className="field-help">{guideText("bfd.configuration.bfdconfigform.004")}</span>
      </label>
      <div className="field-row">
        {number("source_port", guideText("bfd.configuration.bfdconfigform.013"), 49152, 65535)}
        {number("local_discriminator", guideText("bfd.configuration.bfdconfigform.005"), 1, 4294967295)}
      </div>
      <div className="field-row">
        {number("min_tx_us", guideText("bfd.configuration.bfdconfigform.014"), 1000000, 4294967295)}
        {number("min_rx_us", guideText("bfd.configuration.bfdconfigform.015"), 1000000, 4294967295)}
      </div>
      {number("detect_mult", guideText("bfd.configuration.bfdconfigform.016"), 1, 255)}
      <label htmlFor="bfd-mode">{guideText("bfd.configuration.bfdconfigform.017")}<select
          id="bfd-mode"
          value={config.scenario.mode}
          disabled={disabled}
          onChange={(e) =>
            onChange(changeBfdMode(config, e.target.value as BfdMode))
          }
        >
          {bfdModes.map((mode) => (
            <option key={mode} value={mode}>
              {bfdModeLabels[mode]}
            </option>
          ))}
        </select>
      </label>
      {config.scenario.mode !== "normal" && (
        <label htmlFor="bfd-after-up">{guideText("bfd.configuration.bfdconfigform.018")}<input
            id="bfd-after-up"
            type="number"
            min={0}
            max={3600000}
            step={1}
            required
            disabled={disabled}
            value={
              Number.isFinite(config.scenario.after_up_ms)
                ? config.scenario.after_up_ms
                : ""
            }
            onChange={(e) => {
              if (config.scenario.mode !== "normal")
                onChange({
                  ...config,
                  scenario: {
                    ...config.scenario,
                    after_up_ms: e.currentTarget.valueAsNumber,
                  },
                });
            }}
          />
        </label>
      )}
      {"duration_ms" in config.scenario && (
        <label htmlFor="bfd-duration">{guideText("bfd.configuration.bfdconfigform.019")}<input
            id="bfd-duration"
            type="number"
            min={1}
            max={3600000}
            step={1}
            required
            disabled={disabled}
            value={
              Number.isFinite(config.scenario.duration_ms)
                ? config.scenario.duration_ms
                : ""
            }
            onChange={(e) => {
              if ("duration_ms" in config.scenario)
                onChange({
                  ...config,
                  scenario: {
                    ...config.scenario,
                    duration_ms: e.currentTarget.valueAsNumber,
                  },
                });
            }}
          />
        </label>
      )}
      <div className="response-description">
        <p>{guideText("bfd.configuration.bfdconfigform.006")}</p>
        <p>{guideText("bfd.configuration.bfdconfigform.007")}</p>
        <p>{guideText("bfd.configuration.bfdconfigform.008")}</p>
        <p>{guideText("bfd.configuration.bfdconfigform.009")}</p>
      </div>
    </>
  );
}
