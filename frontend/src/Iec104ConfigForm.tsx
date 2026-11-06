import { guideText } from "./protocol-description.ts";
import {
  FLOAT32_MAX,
  type Iec104Address,
  type Iec104Config,
} from "./iec104-config";

export default function Iec104ConfigForm({
  config,
  onChange,
  disabled,
}: {
  config: Iec104Config;
  onChange: (config: Iec104Config) => void;
  disabled: boolean;
}) {
  function changeAddress(
    role: keyof Iec104Config["points"],
    update: Partial<Iec104Address>,
  ) {
    onChange({
      ...config,
      points: {
        ...config.points,
        [role]: { ...config.points[role], ...update },
      },
    });
  }
  function addressFields(role: keyof Iec104Config["points"]) {
    const point = config.points[role];
    return (
      <div className="field-row">
        <label htmlFor={`iec104-${role}-ca`}>{guideText("iec104.configuration.iec104configform.013")}<input
            id={`iec104-${role}-ca`}
            type="number"
            min="1"
            max="65534"
            step="1"
            value={Number.isFinite(point.ca) ? point.ca : ""}
            onChange={(e) =>
              changeAddress(role, { ca: e.currentTarget.valueAsNumber })
            }
            required
          />
        </label>
        <label htmlFor={`iec104-${role}-ioa`}>{guideText("iec104.configuration.iec104configform.014")}<input
            id={`iec104-${role}-ioa`}
            type="number"
            min="1"
            max="16777215"
            step="1"
            value={Number.isFinite(point.ioa) ? point.ioa : ""}
            onChange={(e) =>
              changeAddress(role, { ioa: e.currentTarget.valueAsNumber })
            }
            required
          />
        </label>
      </div>
    );
  }
  return (
    <>
      <div className="field-row">
        <label htmlFor="iec104-bind">{guideText("iec104.configuration.iec104configform.015")}<input
            id="iec104-bind"
            value={config.bind_ip}
            onChange={(e) => onChange({ ...config, bind_ip: e.target.value })}
            required
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
          />
          <span className="field-help">{guideText("iec104.configuration.iec104configform.001")}</span>
        </label>
        <label htmlFor="iec104-port">{guideText("iec104.configuration.iec104configform.016")}<input
            id="iec104-port"
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
      <label htmlFor="iec104-connections">{guideText("iec104.configuration.iec104configform.017")}<input
          id="iec104-connections"
          type="number"
          min="1"
          max="64"
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
        <span className="field-help">{guideText("iec104.configuration.iec104configform.002")}</span>
      </label>
      <div className="iec104-points">
        <fieldset className="protocol-point" disabled={disabled}>
          <legend>{guideText("iec104.configuration.iec104configform.018")}</legend>
          {addressFields("single")}
          <label className="point-boolean" htmlFor="iec104-single-value">
            <input
              id="iec104-single-value"
              type="checkbox"
              checked={config.points.single.value}
              onChange={(e) =>
                onChange({
                  ...config,
                  points: {
                    ...config.points,
                    single: {
                      ...config.points.single,
                      value: e.target.checked,
                    },
                  },
                })
              }
            />{guideText("iec104.configuration.iec104configform.019")}{config.points.single.value ? "true（1）" : "false（0）"}
          </label>
          <p className="field-help">{guideText("iec104.configuration.iec104configform.003")}</p>
        </fieldset>
        <fieldset className="protocol-point" disabled={disabled}>
          <legend>{guideText("iec104.configuration.iec104configform.020")}</legend>
          {addressFields("measured")}
          <label htmlFor="iec104-measured-value">{guideText("iec104.configuration.iec104configform.021")}<input
              id="iec104-measured-value"
              type="number"
              min={-FLOAT32_MAX}
              max={FLOAT32_MAX}
              step="any"
              value={
                Number.isFinite(config.points.measured.value)
                  ? config.points.measured.value
                  : ""
              }
              onChange={(e) =>
                onChange({
                  ...config,
                  points: {
                    ...config.points,
                    measured: {
                      ...config.points.measured,
                      value: e.currentTarget.valueAsNumber,
                    },
                  },
                })
              }
              required
            />
          </label>
          <p className="field-help">{guideText("iec104.configuration.iec104configform.004")}</p>
        </fieldset>
        <fieldset className="protocol-point" disabled={disabled}>
          <legend>{guideText("iec104.configuration.iec104configform.022")}</legend>
          {addressFields("command")}
          <p className="field-help">{guideText("iec104.configuration.iec104configform.005")}{config.points.command.ca}{guideText("iec104.configuration.iec104configform.006")}{" "}
            {config.points.command.ioa}{guideText("iec104.configuration.iec104configform.007")}{config.points.single.ca}{" "}{guideText("iec104.configuration.iec104configform.008")}{config.points.single.ioa}{guideText("iec104.configuration.iec104configform.009")}</p>
          <p className="field-help">{guideText("iec104.configuration.iec104configform.010")}</p>
        </fieldset>
      </div>
      <div className="response-description">
        <p>{guideText("iec104.configuration.iec104configform.011")}</p>
        <p>{guideText("iec104.configuration.iec104configform.012")}</p>
      </div>
    </>
  );
}
