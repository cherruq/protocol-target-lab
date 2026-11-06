import { guideText } from "./protocol-description.ts";
import {
  arpClientModes,
  arpClientModeLabels,
  arpClientScenarioLabels,
  arpClientAllowedScenarios,
  arpClientBudget,
  positiveArpClientScenario,
  validArpClientPair,
  changeArpClientLink,
  type ArpClientConfig,
  type ArpClientMode,
  type ArpClientScenario,
  type ArpClientLink,
} from "./arp-client-config";
export function ArpClientBudgetNotice({
  config,
  draft = false,
}: {
  config: ArpClientConfig;
  draft?: boolean;
}) {
  let budget;
  try {
    budget = arpClientBudget(config);
  } catch {
    return draft ? (
      <p className="field-help">{guideText("arp-client.configuration.arpclientconfigform.001")}</p>
    ) : null;
  }
  return (
    <div className="test-config-notice">
      <strong>
        {draft ? guideText("arp-client.configuration.arpclientconfigform.002") : guideText("arp-client.configuration.arpclientconfigform.003")}{guideText("arp-client.configuration.arpclientconfigform.004")}{(budget.total_ms / 1000).toFixed(3)}{guideText("arp-client.configuration.arpclientconfigform.005")}</strong>
      <p>
        {budget.testable
          ? guideText("arp-client.configuration.arpclientconfigform.006")
          : `${budget.reason}${guideText("arp-client.configuration.arpclientconfigform.007")}`}{" "}{guideText("arp-client.configuration.arpclientconfigform.008")}</p>
    </div>
  );
}
export default function ArpClientConfigForm({
  config,
  onChange,
  disabled,
}: {
  config: ArpClientConfig;
  onChange: (c: ArpClientConfig) => void;
  disabled: boolean;
}) {
  const allowed = arpClientAllowedScenarios[config.mode],
    pair = validArpClientPair(config.mode, config.request_scenario.mode);
  const text = (
    key:
      | "source_mac"
      | "server_mac"
      | "source_ip"
      | "server_ip"
      | "assigned_ip",
    label: string,
    help: string,
  ) => (
    <label htmlFor={`arp-${key}`} key={key}>
      {label}
      <input
        id={`arp-${key}`}
        value={config[key]}
        disabled={disabled || (key === "assigned_ip" && config.mode !== "rarp")}
        required
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange({ ...config, [key]: e.target.value })}
      />
      <span className="field-help">{help}</span>
    </label>
  );
  const number = (
    key: "interval_ms" | "timeout_ms" | "retries",
    label: string,
    min: number,
    max: number,
  ) => (
    <label htmlFor={`arp-${key}`} key={key}>
      {label}
      <input
        id={`arp-${key}`}
        type="number"
        min={min}
        max={max}
        step={1}
        value={Number.isFinite(config[key]) ? config[key] : ""}
        required
        disabled={disabled}
        onChange={(e) =>
          onChange({ ...config, [key]: e.currentTarget.valueAsNumber })
        }
      />
    </label>
  );
  return (
    <>
      <div className="protocol-binding-note">
        <strong>{guideText("arp-client.configuration.arpclientconfigform.009")}</strong>
        <p>{guideText("arp-client.configuration.arpclientconfigform.010")}</p>
      </div>
      <label htmlFor="arp-link">{guideText("arp-client.configuration.arpclientconfigform.027")}<select
          id="arp-link"
          value={config.link.mode}
          disabled={disabled}
          onChange={(e) =>
            onChange(
              changeArpClientLink(
                config,
                e.target.value as ArpClientLink["mode"],
              ),
            )
          }
        >
          <option value="docker-bridge">{guideText("arp-client.configuration.arpclientconfigform.028")}</option>
          <option value="host-interface">{guideText("arp-client.configuration.arpclientconfigform.029")}</option>
        </select>
      </label>
      {config.link.mode === "host-interface" ? (
        <>
          <label htmlFor="arp-interface">{guideText("arp-client.configuration.arpclientconfigform.030")}<input
              id="arp-interface"
              value={config.link.interface}
              maxLength={15}
              required
              disabled={disabled}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) =>
                onChange({
                  ...config,
                  link: { mode: "host-interface", interface: e.target.value },
                })
              }
            />
          </label>
          <p className="field-help">{guideText("arp-client.configuration.arpclientconfigform.011")}</p>
        </>
      ) : (
        <p className="field-help">{guideText("arp-client.configuration.arpclientconfigform.012")}</p>
      )}
      <div className="field-row">
        {text(
          "source_mac",
          guideText("arp-client.configuration.arpclientconfigform.031"),
          guideText("arp-client.configuration.arpclientconfigform.013"),
        )}
        {text(
          "server_mac",
          guideText("arp-client.configuration.arpclientconfigform.032"),
          guideText("arp-client.configuration.arpclientconfigform.014"),
        )}
      </div>
      <div className="field-row">
        {text(
          "source_ip",
          guideText("arp-client.configuration.arpclientconfigform.033"),
          guideText("arp-client.configuration.arpclientconfigform.015"),
        )}
        {text(
          "server_ip",
          guideText("arp-client.configuration.arpclientconfigform.034"),
          guideText("arp-client.configuration.arpclientconfigform.016"),
        )}
      </div>
      {text(
        "assigned_ip",
        guideText("arp-client.configuration.arpclientconfigform.017"),
        guideText("arp-client.configuration.arpclientconfigform.018"),
      )}
      <div className="field-row">
        <label htmlFor="arp-mode">{guideText("arp-client.configuration.arpclientconfigform.035")}<select
            id="arp-mode"
            value={config.mode}
            disabled={disabled}
            onChange={(e) =>
              onChange({ ...config, mode: e.target.value as ArpClientMode })
            }
          >
            {arpClientModes.map((mode) => (
              <option key={mode} value={mode}>
                {arpClientModeLabels[mode]}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="arp-scenario">{guideText("arp-client.configuration.arpclientconfigform.036")}<select
            id="arp-scenario"
            value={config.request_scenario.mode}
            disabled={disabled}
            onChange={(e) =>
              onChange({
                ...config,
                request_scenario: { mode: e.target.value as ArpClientScenario },
              })
            }
          >
            {!pair && (
              <option value={config.request_scenario.mode} disabled>
                {config.request_scenario.mode}{guideText("arp-client.configuration.arpclientconfigform.037")}</option>
            )}
            {allowed.map((mode) => (
              <option key={mode} value={mode}>
                {arpClientScenarioLabels[mode]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!pair ? (
        <div className="test-error" role="alert">{guideText("arp-client.configuration.arpclientconfigform.038")}</div>
      ) : (
        <p className="field-help">
          {positiveArpClientScenario(config)
            ? guideText("arp-client.configuration.arpclientconfigform.019")
            : guideText("arp-client.configuration.arpclientconfigform.020")}{" "}{guideText("arp-client.configuration.arpclientconfigform.021")}</p>
      )}
      <div className="field-row">
        {number("interval_ms", guideText("arp-client.configuration.arpclientconfigform.022"), 10, 60000)}
        {number("timeout_ms", guideText("arp-client.configuration.arpclientconfigform.039"), 10, 60000)}
      </div>
      {number("retries", guideText("arp-client.configuration.arpclientconfigform.023"), 0, 10)}
      <p className="field-help">{guideText("arp-client.configuration.arpclientconfigform.024")}</p>
      <ArpClientBudgetNotice config={config} draft />
      <div className="response-description">
        <p>{guideText("arp-client.configuration.arpclientconfigform.025")}</p>
        <p>{guideText("arp-client.configuration.arpclientconfigform.026")}</p>
      </div>
    </>
  );
}
