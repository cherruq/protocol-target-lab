import { guideText } from "./protocol-description.ts";
import { updateIec101Channel, type Iec101Config } from "./iec101-config";

export default function Iec101ConfigForm({
  config,
  onChange,
  disabled,
}: {
  config: Iec101Config;
  onChange: (config: Iec101Config) => void;
  disabled: boolean;
}) {
  return (
    <>
      <div className="protocol-binding-note">
        <strong>{guideText("iec101.configuration.iec101configform.001")}</strong>
        <p>
          <code>{guideText("iec101.configuration.iec101configform.002")}</code>{guideText("iec101.configuration.iec101configform.003")}</p>
        <p>{guideText("iec101.configuration.iec101configform.004")}<code>{guideText("iec101.configuration.iec101configform.005")}</code>{guideText("iec101.configuration.iec101configform.006")}</p>
      </div>
      <label htmlFor="iec101-bind">{guideText("iec101.configuration.iec101configform.015")}<input
          id="iec101-bind"
          value={config.bind_ip}
          onChange={(e) => onChange({ ...config, bind_ip: e.target.value })}
          disabled={disabled}
          required
          autoComplete="off"
          spellCheck={false}
        />
        <span className="field-help">{guideText("iec101.configuration.iec101configform.007")}</span>
      </label>
      {(["single", "double"] as const).map((kind) => {
        const c = config[kind];
        const max = kind === "single" ? 254 : 65534;
        return (
          <fieldset key={kind} className="protocol-point" disabled={disabled}>
            <legend>
              {kind === "single"
                ? guideText("iec101.configuration.iec101configform.008")
                : guideText("iec101.configuration.iec101configform.009")}
            </legend>
            <div className="field-row">
              {(
                [
                  ["port", guideText("iec101.configuration.iec101configform.016"), 1, 65535],
                  ["link_address", guideText("iec101.configuration.iec101configform.017"), 1, max],
                  ["common_address", guideText("iec101.configuration.iec101configform.018"), 1, max],
                ] as const
              ).map(([key, label, min, limit]) => (
                <label key={key} htmlFor={`iec101-${kind}-${key}`}>
                  {label}
                  <input
                    id={`iec101-${kind}-${key}`}
                    type="number"
                    min={min}
                    max={limit}
                    step="1"
                    value={Number.isFinite(c[key]) ? c[key] : ""}
                    onChange={(e) =>
                      onChange(
                        updateIec101Channel(config, kind, {
                          [key]: e.currentTarget.valueAsNumber,
                        }),
                      )
                    }
                    required
                  />
                </label>
              ))}
              {kind === "single" ? (
                <div>
                  <span>{guideText("iec101.configuration.iec101configform.019")}</span>
                  <p>
                    <code>{guideText("iec101.configuration.iec101configform.010")}</code>
                  </p>
                  <span className="field-help">{guideText("iec101.configuration.iec101configform.011")}</span>
                </div>
              ) : (
                <label htmlFor="iec101-double-originator_address">{guideText("iec101.configuration.iec101configform.020")}<input
                    id="iec101-double-originator_address"
                    type="number"
                    min="0"
                    max="255"
                    step="1"
                    value={
                      Number.isFinite(c.originator_address)
                        ? c.originator_address
                        : ""
                    }
                    onChange={(e) =>
                      onChange(
                        updateIec101Channel(config, kind, {
                          originator_address: e.currentTarget.valueAsNumber,
                        }),
                      )
                    }
                    required
                  />
                </label>
              )}
              <label htmlFor={`iec101-${kind}-ioa`}>{guideText("iec101.configuration.iec101configform.021")}<input
                  id={`iec101-${kind}-ioa`}
                  type="number"
                  min="1"
                  max={kind === "single" ? 255 : 16777215}
                  step="1"
                  value={Number.isFinite(c.point.ioa) ? c.point.ioa : ""}
                  onChange={(e) =>
                    onChange(
                      updateIec101Channel(config, kind, {
                        point: { ioa: e.currentTarget.valueAsNumber },
                      }),
                    )
                  }
                  required
                />
              </label>
            </div>
            <label className="point-boolean" htmlFor={`iec101-${kind}-value`}>
              <input
                id={`iec101-${kind}-value`}
                type="checkbox"
                checked={c.point.value}
                onChange={(e) =>
                  onChange(
                    updateIec101Channel(config, kind, {
                      point: { value: e.target.checked },
                    }),
                  )
                }
              />{guideText("iec101.configuration.iec101configform.022")}</label>
            <label className="point-boolean" htmlFor={`iec101-${kind}-e5`}>
              <input
                id={`iec101-${kind}-e5`}
                type="checkbox"
                checked={c.single_char_ack}
                onChange={(e) =>
                  onChange(
                    updateIec101Channel(config, kind, {
                      single_char_ack: e.target.checked,
                    }),
                  )
                }
              />{guideText("iec101.configuration.iec101configform.023")}</label>
            <p className="field-help">{guideText("iec101.configuration.iec101configform.012")}</p>
          </fieldset>
        );
      })}
      <div className="response-description">
        <p>{guideText("iec101.configuration.iec101configform.013")}</p>
        <p>{guideText("iec101.configuration.iec101configform.014")}</p>
      </div>
    </>
  );
}
