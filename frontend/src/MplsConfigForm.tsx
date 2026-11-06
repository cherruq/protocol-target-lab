import { guideText } from "./protocol-description.ts";
import {
  changeMplsLink,
  mplsScenarios,
  mplsScenarioLabels,
  type MplsConfig,
  type MplsLink,
  type MplsScenario,
} from "./mpls-config";
export default function MplsConfigForm({
  config,
  onChange,
  disabled,
  interfaceDraft,
  onInterfaceDraftChange,
}: {
  config: MplsConfig;
  onChange: (c: MplsConfig) => void;
  disabled: boolean;
  interfaceDraft: string;
  onInterfaceDraftChange: (v: string) => void;
}) {
  const text = (
    key: "source_mac" | "client_mac" | "source_ip" | "client_ip",
    label: string,
    help: string,
  ) => (
    <label key={key} htmlFor={`mpls-${key}`}>
      {label}
      <input
        id={`mpls-${key}`}
        value={config[key]}
        required
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange({ ...config, [key]: e.target.value })}
      />
      <span className="field-help">{help}</span>
    </label>
  );
  const num = (
    key: "label" | "reply_ttl",
    label: string,
    min: number,
    max: number,
  ) => (
    <label key={key} htmlFor={`mpls-${key}`}>
      {label}
      <input
        id={`mpls-${key}`}
        type="number"
        step={1}
        min={min}
        max={max}
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
        <strong>{guideText("mpls.configuration.mplsconfigform.001")}</strong>
        <p>{guideText("mpls.configuration.mplsconfigform.002")}</p>
      </div>
      <label htmlFor="mpls-link">{guideText("mpls.configuration.mplsconfigform.016")}<select
          id="mpls-link"
          value={config.link.mode}
          disabled={disabled}
          onChange={(e) => {
            if (config.link.mode === "host-interface")
              onInterfaceDraftChange(config.link.interface);
            onChange(
              changeMplsLink(
                config,
                e.target.value as MplsLink["mode"],
                interfaceDraft,
              ),
            );
          }}
        >
          <option value="docker-bridge">{guideText("mpls.configuration.mplsconfigform.017")}</option>
          <option value="host-interface">{guideText("mpls.configuration.mplsconfigform.018")}</option>
        </select>
        <span className="field-help">{guideText("mpls.configuration.mplsconfigform.003")}</span>
      </label>
      {config.link.mode === "host-interface" ? (
        <>
          <label htmlFor="mpls-interface">{guideText("mpls.configuration.mplsconfigform.019")}<input
              id="mpls-interface"
              value={config.link.interface}
              required
              maxLength={15}
              disabled={disabled}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                onInterfaceDraftChange(e.target.value);
                onChange({
                  ...config,
                  link: { mode: "host-interface", interface: e.target.value },
                });
              }}
            />
          </label>
          <p className="field-help">{guideText("mpls.configuration.mplsconfigform.004")}</p>
        </>
      ) : (
        <p className="field-help">{guideText("mpls.configuration.mplsconfigform.005")}</p>
      )}
      <div className="field-row">
        {text(
          "source_mac",
          guideText("mpls.configuration.mplsconfigform.020"),
          guideText("mpls.configuration.mplsconfigform.006"),
        )}
        {text(
          "client_mac",
          guideText("mpls.configuration.mplsconfigform.021"),
          guideText("mpls.configuration.mplsconfigform.007"),
        )}
      </div>
      <div className="field-row">
        {text(
          "source_ip",
          guideText("mpls.configuration.mplsconfigform.022"),
          guideText("mpls.configuration.mplsconfigform.008"),
        )}
        {text(
          "client_ip",
          guideText("mpls.configuration.mplsconfigform.023"),
          guideText("mpls.configuration.mplsconfigform.009"),
        )}
      </div>
      <div className="field-row">
        {num("label", guideText("mpls.configuration.mplsconfigform.010"), 16, 1048575)}
        {num("reply_ttl", guideText("mpls.configuration.mplsconfigform.011"), 1, 255)}
      </div>
      <p className="field-help">{guideText("mpls.configuration.mplsconfigform.012")}</p>
      <label htmlFor="mpls-scenario">{guideText("mpls.configuration.mplsconfigform.024")}<select
          id="mpls-scenario"
          value={config.scenario.mode}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              ...config,
              scenario: { mode: e.target.value as MplsScenario },
            })
          }
        >
          {mplsScenarios.map((mode) => (
            <option key={mode} value={mode}>
              {mplsScenarioLabels[mode]}
            </option>
          ))}
        </select>
      </label>
      <div
        className={
          config.scenario.mode === "short-ethernet"
            ? "test-config-notice"
            : "response-description"
        }
      >
        {config.scenario.mode === "short-ethernet" ? (
          <p>{guideText("mpls.configuration.mplsconfigform.013")}</p>
        ) : (
          <p>{guideText("mpls.configuration.mplsconfigform.014")}</p>
        )}
        <p>{guideText("mpls.configuration.mplsconfigform.015")}</p>
      </div>
    </>
  );
}
