import { guideText } from "./protocol-description.ts";
import {
  customHexBytes,
  prepareCustomEthernetSave,
  type CustomEthernetConfig,
  type CustomEthernetDraft,
} from "./custom-ethernet-config";
function byteSummary(hex: string) {
  try {
    return `${customHexBytes(hex)}${guideText("custom-ethernet.configuration.customethernetconfigform.049")}`;
  } catch {
    return guideText("custom-ethernet.configuration.customethernetconfigform.001");
  }
}
export default function CustomEthernetConfigForm({
  config,
  saved,
  disabled,
  onChange,
  interfaceDraft,
  onInterfaceDraft,
  onCopy,
}: {
  config: CustomEthernetDraft;
  saved: CustomEthernetConfig;
  disabled: boolean;
  onChange: (c: CustomEthernetDraft) => void;
  interfaceDraft: string;
  onInterfaceDraft: (s: string) => void;
  onCopy: (s: string) => void | Promise<void>;
}) {
  const r = config.response,
    p = r.payload;
  const payload = (next: Partial<typeof p>) =>
    onChange({ ...config, response: { ...r, payload: { ...p, ...next } } });
  const text = (
    id: string,
    label: string,
    value: string,
    change: (s: string) => void,
    help?: string,
  ) => (
    <label htmlFor={`custom-${id}`} key={id}>
      {label}
      <input
        id={`custom-${id}`}
        value={value}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => change(e.target.value)}
      />
      {help && <span className="field-help">{help}</span>}
    </label>
  );
  const hex = (
    id: string,
    label: string,
    value: string,
    change: (s: string) => void,
    help: string,
  ) => (
    <label htmlFor={`custom-${id}`}>
      {label}
      <textarea
        id={`custom-${id}`}
        rows={4}
        maxLength={131070}
        value={value}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => change(e.target.value)}
      />
      <span className="field-help">
        {byteSummary(value)}{guideText("custom-ethernet.configuration.customethernetconfigform.002")}{help}
      </span>
    </label>
  );
  let retained: string[] = [];
  try {
    retained = prepareCustomEthernetSave(config, saved).retained;
  } catch {
    /* active validation is shown on explicit save */
  }
  return (
    <>
      <div className="protocol-binding-note">
        <strong>{guideText("custom-ethernet.configuration.customethernetconfigform.003")}</strong>
        <p>{guideText("custom-ethernet.configuration.customethernetconfigform.004")}</p>
      </div>
      <label htmlFor="custom-link">{guideText("custom-ethernet.configuration.customethernetconfigform.050")}<select
          id="custom-link"
          value={config.link.mode}
          disabled={disabled}
          onChange={(e) => {
            if (config.link.mode === "host-interface")
              onInterfaceDraft(config.link.interface);
            onChange({
              ...config,
              link:
                e.target.value === "docker-bridge"
                  ? { mode: "docker-bridge" }
                  : { mode: "host-interface", interface: interfaceDraft },
            });
          }}
        >
          <option value="docker-bridge">{guideText("custom-ethernet.configuration.customethernetconfigform.051")}</option>
          <option value="host-interface">{guideText("custom-ethernet.configuration.customethernetconfigform.052")}</option>
        </select>
      </label>
      {config.link.mode === "host-interface" ? (
        text(
          "interface",
          guideText("custom-ethernet.configuration.customethernetconfigform.053"),
          config.link.interface,
          (value) => {
            onInterfaceDraft(value);
            onChange({
              ...config,
              link: { mode: "host-interface", interface: value },
            });
          },
          guideText("custom-ethernet.configuration.customethernetconfigform.005"),
        )
      ) : (
        <p className="field-help">{guideText("custom-ethernet.configuration.customethernetconfigform.006")}</p>
      )}
      <p className="field-help">{guideText("custom-ethernet.configuration.customethernetconfigform.007")}</p>
      <div className="field-row">
        {text(
          "local-mac",
          guideText("custom-ethernet.configuration.customethernetconfigform.054"),
          config.local_mac,
          (v) => onChange({ ...config, local_mac: v }),
          guideText("custom-ethernet.configuration.customethernetconfigform.008"),
        )}
        {text(
          "peer-mac",
          guideText("custom-ethernet.configuration.customethernetconfigform.055"),
          config.peer_mac,
          (v) => onChange({ ...config, peer_mac: v }),
          guideText("custom-ethernet.configuration.customethernetconfigform.009"),
        )}
      </div>
      <div className="protocol-binding-note">
        <strong>{guideText("custom-ethernet.configuration.customethernetconfigform.010")}</strong>
        <p>{guideText("custom-ethernet.configuration.customethernetconfigform.011")}</p>
      </div>
      <label htmlFor="custom-filter">{guideText("custom-ethernet.configuration.customethernetconfigform.056")}<textarea
          id="custom-filter"
          rows={3}
          value={config.packet_filter}
          disabled={disabled}
          spellCheck={false}
          onChange={(e) =>
            onChange({ ...config, packet_filter: e.target.value })
          }
        />
        <span className="field-help">{guideText("custom-ethernet.configuration.customethernetconfigform.012")}</span>
      </label>
      <div className="response-description">
        <p>{guideText("custom-ethernet.configuration.customethernetconfigform.013")}</p>
        {[
          "ether proto 0x88b5",
          "ether src 02:00:00:00:02:10",
          "vlan 7 and ether proto 0x88b5",
        ].map((s, i) => (
          <div className="command" key={s}>
            <code>{s}</code>
            <button
              type="button"
              className="button"
              onClick={() => void onCopy(s)}
              aria-label={`${guideText("custom-ethernet.configuration.customethernetconfigform.057")}${i + 1}`}
            >{guideText("custom-ethernet.configuration.customethernetconfigform.058")}</button>
          </div>
        ))}
      </div>
      {text(
        "marker",
        guideText("custom-ethernet.configuration.customethernetconfigform.014"),
        config.request_marker_hex ?? "",
        (v) => onChange({ ...config, request_marker_hex: v }),
        guideText("custom-ethernet.configuration.customethernetconfigform.015"),
      )}
      <label htmlFor="custom-response-mode">{guideText("custom-ethernet.configuration.customethernetconfigform.059")}<select
          id="custom-response-mode"
          value={r.mode}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              ...config,
              response: { ...r, mode: e.target.value as "payload" | "frame" },
            })
          }
        >
          <option value="payload">{guideText("custom-ethernet.configuration.customethernetconfigform.060")}</option>
          <option value="frame">{guideText("custom-ethernet.configuration.customethernetconfigform.061")}</option>
        </select>
        <span className="field-help">{guideText("custom-ethernet.configuration.customethernetconfigform.016")}</span>
      </label>
      {retained.length > 0 && (
        <div className="test-error" role="status">{guideText("custom-ethernet.configuration.customethernetconfigform.062")}{retained.join("、")}{guideText("custom-ethernet.configuration.customethernetconfigform.063")}</div>
      )}
      {r.mode === "payload" ? (
        <>
          {text(
            "destination",
            guideText("custom-ethernet.configuration.customethernetconfigform.064"),
            p.destination_mac,
            (v) => payload({ destination_mac: v }),
            guideText("custom-ethernet.configuration.customethernetconfigform.017"),
          )}
          <label htmlFor="custom-source-mode">{guideText("custom-ethernet.configuration.customethernetconfigform.065")}<select
              id="custom-source-mode"
              value={p.source_mac.mode}
              disabled={disabled}
              onChange={(e) =>
                payload({
                  source_mac: {
                    ...p.source_mac,
                    mode: e.target.value as "interface" | "override",
                  },
                })
              }
            >
              <option value="interface">{guideText("custom-ethernet.configuration.customethernetconfigform.066")}</option>
              <option value="override">{guideText("custom-ethernet.configuration.customethernetconfigform.067")}</option>
            </select>
            <span className="field-help">{guideText("custom-ethernet.configuration.customethernetconfigform.018")}{config.local_mac}{guideText("custom-ethernet.configuration.customethernetconfigform.019")}</span>
          </label>
          {p.source_mac.mode === "override" &&
            text(
              "source-override",
              guideText("custom-ethernet.configuration.customethernetconfigform.068"),
              p.source_mac.value,
              (v) => payload({ source_mac: { ...p.source_mac, value: v } }),
              guideText("custom-ethernet.configuration.customethernetconfigform.020"),
            )}
          {text(
            "ether-type",
            guideText("custom-ethernet.configuration.customethernetconfigform.021"),
            typeof p.ether_type === "number"
              ? `0x${p.ether_type.toString(16)}`
              : p.ether_type,
            (v) => payload({ ether_type: v }),
            guideText("custom-ethernet.configuration.customethernetconfigform.022"),
          )}
          {hex(
            "payload",
            guideText("custom-ethernet.configuration.customethernetconfigform.069"),
            p.payload_hex,
            (v) => payload({ payload_hex: v }),
            guideText("custom-ethernet.configuration.customethernetconfigform.023"),
          )}
          <label className="point-boolean">
            <input
              type="checkbox"
              checked={p.vlan.enabled}
              disabled={disabled}
              onChange={(e) =>
                payload({ vlan: { ...p.vlan, enabled: e.target.checked } })
              }
            />{guideText("custom-ethernet.configuration.customethernetconfigform.070")}</label>
          {p.vlan.enabled && (
            <div className="field-row">
              {(["vid", "pcp"] as const).map((k) => (
                <label key={k} htmlFor={`custom-${k}`}>
                  {k === "vid" ? guideText("custom-ethernet.configuration.customethernetconfigform.024") : "VLAN PCP"}
                  <input
                    id={`custom-${k}`}
                    type="number"
                    min={0}
                    max={k === "vid" ? 4094 : 7}
                    step={1}
                    value={Number.isFinite(p.vlan[k]) ? p.vlan[k] : ""}
                    disabled={disabled}
                    onChange={(e) =>
                      payload({
                        vlan: { ...p.vlan, [k]: e.currentTarget.valueAsNumber },
                      })
                    }
                  />
                </label>
              ))}
              <label className="point-boolean">
                <input
                  type="checkbox"
                  checked={p.vlan.dei}
                  disabled={disabled}
                  onChange={(e) =>
                    payload({ vlan: { ...p.vlan, dei: e.target.checked } })
                  }
                />
                VLAN DEI
              </label>
            </div>
          )}
          <p className="field-help">{guideText("custom-ethernet.configuration.customethernetconfigform.025")}</p>
          <p className="field-help">{guideText("custom-ethernet.configuration.customethernetconfigform.026")}{byteSummary(r.frame_hex)}{guideText("custom-ethernet.configuration.customethernetconfigform.027")}</p>
        </>
      ) : (
        <>
          {hex(
            "frame",
            guideText("custom-ethernet.configuration.customethernetconfigform.028"),
            r.frame_hex,
            (v) => onChange({ ...config, response: { ...r, frame_hex: v } }),
            guideText("custom-ethernet.configuration.customethernetconfigform.029"),
          )}
          <p className="field-help">{guideText("custom-ethernet.configuration.customethernetconfigform.030")}</p>
          <p className="field-help">{guideText("custom-ethernet.configuration.customethernetconfigform.031")}{byteSummary(p.payload_hex)}{guideText("custom-ethernet.configuration.customethernetconfigform.032")}{p.vlan.enabled ? guideText("custom-ethernet.configuration.customethernetconfigform.033") : guideText("custom-ethernet.configuration.customethernetconfigform.034")}{guideText("custom-ethernet.configuration.customethernetconfigform.035")}{" "}
            {Number.isFinite(p.vlan.vid) ? p.vlan.vid : guideText("custom-ethernet.configuration.customethernetconfigform.036")}{guideText("custom-ethernet.configuration.customethernetconfigform.037")}{p.source_mac.mode === "interface" ? guideText("custom-ethernet.configuration.customethernetconfigform.038") : guideText("custom-ethernet.configuration.customethernetconfigform.039")}{guideText("custom-ethernet.configuration.customethernetconfigform.040")}</p>
        </>
      )}
      <div className="protocol-binding-note">
        <strong>{guideText("custom-ethernet.configuration.customethernetconfigform.041")}</strong>
        <p>{guideText("custom-ethernet.configuration.customethernetconfigform.042")}</p>
      </div>
      <label className="point-boolean">
        <input
          type="checkbox"
          checked={config.promiscuous}
          disabled={disabled}
          onChange={(e) =>
            onChange({ ...config, promiscuous: e.target.checked })
          }
        />{guideText("custom-ethernet.configuration.customethernetconfigform.071")}</label>
      <label htmlFor="custom-multicast">{guideText("custom-ethernet.configuration.customethernetconfigform.072")}<textarea
          id="custom-multicast"
          rows={3}
          value={
            typeof config.multicast_macs === "string"
              ? config.multicast_macs
              : config.multicast_macs.join("\n")
          }
          disabled={disabled}
          onChange={(e) =>
            onChange({ ...config, multicast_macs: e.target.value })
          }
        />
        <span className="field-help">{guideText("custom-ethernet.configuration.customethernetconfigform.043")}</span>
      </label>
      <div className="protocol-binding-note">
        <strong>{guideText("custom-ethernet.configuration.customethernetconfigform.044")}</strong>
        <p>{guideText("custom-ethernet.configuration.customethernetconfigform.045")}</p>
      </div>
      {hex(
        "test-request",
        guideText("custom-ethernet.configuration.customethernetconfigform.046"),
        config.test_request.frame_hex,
        (v) => onChange({ ...config, test_request: { frame_hex: v } }),
        guideText("custom-ethernet.configuration.customethernetconfigform.047"),
      )}
      <p className="field-help">{guideText("custom-ethernet.configuration.customethernetconfigform.048")}</p>
    </>
  );
}
