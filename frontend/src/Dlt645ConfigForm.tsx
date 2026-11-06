import { guideText } from "./protocol-description.ts";
import {
  dlt645FixtureDefaults,
  type Dlt645Config,
  type Dlt645Security,
} from "./dlt645-config";

export default function Dlt645ConfigForm({
  config,
  onChange,
  disabled,
}: {
  config: Dlt645Config;
  onChange: (config: Dlt645Config) => void;
  disabled: boolean;
}) {
  const security = config.security;
  const updateFixture = (
    key: Exclude<keyof Extract<Dlt645Security, { mode: "fixture" }>, "mode">,
    value: string,
  ) => {
    if (security.mode === "fixture")
      onChange({ ...config, security: { ...security, [key]: value } });
  };
  return (
    <>
      <div className="protocol-binding-note">
        <strong>{guideText("dlt645.configuration.dlt645configform.001")}</strong>
        <p>
          <code>{guideText("dlt645.configuration.dlt645configform.002")}</code>{guideText("dlt645.configuration.dlt645configform.003")}</p>
      </div>
      <div className="field-row">
        <label htmlFor="dlt645-bind">{guideText("dlt645.configuration.dlt645configform.016")}<input
            id="dlt645-bind"
            value={config.bind_ip}
            onChange={(e) => onChange({ ...config, bind_ip: e.target.value })}
            disabled={disabled}
            required
            autoComplete="off"
            spellCheck={false}
          />
          <span className="field-help">{guideText("dlt645.configuration.dlt645configform.004")}</span>
        </label>
        <label htmlFor="dlt645-port">{guideText("dlt645.configuration.dlt645configform.017")}<input
            id="dlt645-port"
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
      <label htmlFor="dlt645-address">{guideText("dlt645.configuration.dlt645configform.018")}<input
          id="dlt645-address"
          value={config.meter_address}
          onChange={(e) =>
            onChange({ ...config, meter_address: e.target.value })
          }
          disabled={disabled}
          required
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
        />
        <span className="field-help">{guideText("dlt645.configuration.dlt645configform.005")}</span>
      </label>
      <div className="field-row">
        <label htmlFor="dlt645-energy">{guideText("dlt645.configuration.dlt645configform.019")}<input
            id="dlt645-energy"
            type="number"
            min="0"
            max="99999999"
            step="1"
            value={
              Number.isFinite(config.energy_hundredths)
                ? config.energy_hundredths
                : ""
            }
            onChange={(e) =>
              onChange({
                ...config,
                energy_hundredths: e.currentTarget.valueAsNumber,
              })
            }
            disabled={disabled}
            required
          />
          <span className="field-help">{guideText("dlt645.configuration.dlt645configform.006")}</span>
        </label>
        <label htmlFor="dlt645-period">{guideText("dlt645.configuration.dlt645configform.020")}<input
            id="dlt645-period"
            type="number"
            min="1"
            max="99"
            step="1"
            value={
              Number.isFinite(config.period_minutes)
                ? config.period_minutes
                : ""
            }
            onChange={(e) =>
              onChange({
                ...config,
                period_minutes: e.currentTarget.valueAsNumber,
              })
            }
            disabled={disabled}
            required
          />
        </label>
      </div>
      <label htmlFor="dlt645-connections">{guideText("dlt645.configuration.dlt645configform.021")}<input
          id="dlt645-connections"
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
        <span className="field-help">{guideText("dlt645.configuration.dlt645configform.007")}</span>
      </label>
      <label className="point-boolean" htmlFor="dlt645-programming-key">
        <input
          id="dlt645-programming-key"
          type="checkbox"
          checked={config.programming_key_enabled}
          onChange={(e) =>
            onChange({ ...config, programming_key_enabled: e.target.checked })
          }
          disabled={disabled}
        />{guideText("dlt645.configuration.dlt645configform.022")}</label>
      <p className="field-help">{guideText("dlt645.configuration.dlt645configform.008")}</p>
      <details className="connection-help">
        <summary>{guideText("dlt645.configuration.dlt645configform.023")}</summary>
        <div className="connection-content">
          <label htmlFor="dlt645-security-mode">{guideText("dlt645.configuration.dlt645configform.024")}<select
              id="dlt645-security-mode"
              value={security.mode}
              onChange={(e) =>
                onChange({
                  ...config,
                  security:
                    e.target.value === "fixture"
                      ? { ...dlt645FixtureDefaults }
                      : { mode: "reject" },
                })
              }
              disabled={disabled}
            >
              <option value="reject">{guideText("dlt645.configuration.dlt645configform.025")}</option>
              <option value="fixture">{guideText("dlt645.configuration.dlt645configform.026")}</option>
            </select>
          </label>
          <p className="field-help">{guideText("dlt645.configuration.dlt645configform.009")}</p>
          {security.mode === "fixture" && (
            <div className="field-row">
              <label htmlFor="dlt645-request_di">{guideText("dlt645.configuration.dlt645configform.027")}<select
                  id="dlt645-request_di"
                  value={security.request_di}
                  onChange={(e) => updateFixture("request_di", e.target.value)}
                  disabled={disabled}
                >
                  <option value="07000001">07000001</option>
                  <option value="07000002">07000002</option>
                  <option value="07000003">07000003</option>
                </select>
              </label>
              <div>
                <span className="field-label">{guideText("dlt645.configuration.dlt645configform.028")}</span>
                <p>
                  <code>{security.response_di}</code>
                </p>
                <span className="field-help">{guideText("dlt645.configuration.dlt645configform.010")}</span>
              </div>
              {(
                [
                  ["operator", guideText("dlt645.configuration.dlt645configform.011"), 8],
                  ["request_hex", guideText("dlt645.configuration.dlt645configform.029"), 16],
                  ["response_hex", guideText("dlt645.configuration.dlt645configform.030"), 24],
                ] as const
              ).map(([key, label, length]) => (
                <label key={key} htmlFor={`dlt645-${key}`}>
                  {label}
                  <input
                    id={`dlt645-${key}`}
                    value={security[key]}
                    onChange={(e) => updateFixture(key, e.target.value)}
                    disabled={disabled}
                    required
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <span className="field-help">{guideText("dlt645.configuration.dlt645configform.012")}{length}{guideText("dlt645.configuration.dlt645configform.013")}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </details>
      <div className="response-description">
        <p>{guideText("dlt645.configuration.dlt645configform.014")}</p>
        <p>{guideText("dlt645.configuration.dlt645configform.015")}</p>
      </div>
    </>
  );
}
