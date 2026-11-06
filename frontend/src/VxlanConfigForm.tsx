import { guideText } from "./protocol-description.ts";
import {
  vxlanModeLabels,
  vxlanModes,
  type VxlanConfig,
  type VxlanMode,
} from "./vxlan-config";
export default function VxlanConfigForm({
  config,
  onChange,
  disabled,
}: {
  config: VxlanConfig;
  onChange: (config: VxlanConfig) => void;
  disabled: boolean;
}) {
  const text = (
    key:
      | "bind_ip"
      | "peer_ip"
      | "inner_ip"
      | "inner_mac"
      | "requester_ip"
      | "requester_mac",
    label: string,
  ) => (
    <label htmlFor={`vxlan-${key}`} key={key}>
      {label}
      <input
        id={`vxlan-${key}`}
        value={config[key]}
        disabled={disabled}
        required
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange({ ...config, [key]: e.target.value })}
      />
    </label>
  );
  const number = (
    key: "port" | "peer_port" | "source_port" | "vni",
    label: string,
    min: number,
    max: number,
  ) => (
    <label htmlFor={`vxlan-${key}`} key={key}>
      {label}
      <input
        id={`vxlan-${key}`}
        type="number"
        min={min}
        max={max}
        step={1}
        value={Number.isFinite(config[key]) ? config[key] : ""}
        disabled={disabled}
        required
        onChange={(e) =>
          onChange({ ...config, [key]: e.currentTarget.valueAsNumber })
        }
      />
    </label>
  );
  return (
    <>
      <div className="protocol-binding-note">
        <strong>{guideText("vxlan.configuration.vxlanconfigform.001")}</strong>
        <p>{guideText("vxlan.configuration.vxlanconfigform.002")}</p>
      </div>
      <div className="field-row">
        {text("bind_ip", guideText("vxlan.configuration.vxlanconfigform.011"))}
        {number("port", guideText("vxlan.configuration.vxlanconfigform.012"), 1, 65535)}
      </div>
      <div className="field-row">
        {text("peer_ip", guideText("vxlan.configuration.vxlanconfigform.013"))}
        {number("peer_port", guideText("vxlan.configuration.vxlanconfigform.003"), 1, 65535)}
      </div>
      <div className="field-row">
        {number("source_port", guideText("vxlan.configuration.vxlanconfigform.014"), 49152, 65535)}
        {number("vni", guideText("vxlan.configuration.vxlanconfigform.015"), 0, 16777215)}
      </div>
      <p className="field-help">{guideText("vxlan.configuration.vxlanconfigform.004")}</p>
      <div className="field-row">
        {text("inner_ip", guideText("vxlan.configuration.vxlanconfigform.016"))}
        {text("inner_mac", guideText("vxlan.configuration.vxlanconfigform.017"))}
      </div>
      <div className="field-row">
        {text("requester_ip", guideText("vxlan.configuration.vxlanconfigform.018"))}
        {text("requester_mac", guideText("vxlan.configuration.vxlanconfigform.019"))}
      </div>
      <p className="field-help">{guideText("vxlan.configuration.vxlanconfigform.005")}</p>
      <label htmlFor="vxlan-padding">{guideText("vxlan.configuration.vxlanconfigform.020")}<select
          id="vxlan-padding"
          value={config.reply_padding}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              ...config,
              reply_padding: Number(e.target.value) as 0 | 18,
            })
          }
        >
          <option value={0}>{guideText("vxlan.configuration.vxlanconfigform.021")}</option>
          <option value={18}>{guideText("vxlan.configuration.vxlanconfigform.022")}</option>
        </select>
        <span className="field-help">{guideText("vxlan.configuration.vxlanconfigform.006")}</span>
      </label>
      <label htmlFor="vxlan-mode">{guideText("vxlan.configuration.vxlanconfigform.023")}<select
          id="vxlan-mode"
          value={config.scenario.mode}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              ...config,
              scenario: { mode: e.target.value as VxlanMode },
            })
          }
        >
          {vxlanModes.map((mode) => (
            <option key={mode} value={mode}>
              {vxlanModeLabels[mode]}
            </option>
          ))}
        </select>
      </label>
      <div className="response-description">
        <p>{guideText("vxlan.configuration.vxlanconfigform.007")}</p>
        <p>{guideText("vxlan.configuration.vxlanconfigform.008")}</p>
        <p>{guideText("vxlan.configuration.vxlanconfigform.009")}</p>
        <p>{guideText("vxlan.configuration.vxlanconfigform.010")}</p>
      </div>
    </>
  );
}
