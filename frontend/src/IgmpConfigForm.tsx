import { guideText } from "./protocol-description.ts";
import {
  changeIgmpLink,
  type IgmpConfig,
  type IgmpLinkDrafts,
  type IgmpLinkMode,
  type IgmpVxlanLink,
} from "./igmp-config";
export default function IgmpConfigForm({
  config,
  linkDrafts,
  onLinkDrafts,
  onChange,
  disabled,
}: {
  config: IgmpConfig;
  linkDrafts: IgmpLinkDrafts;
  onLinkDrafts: (d: IgmpLinkDrafts) => void;
  onChange: (c: IgmpConfig) => void;
  disabled: boolean;
}) {
  const l = config.link;
  const text = (
    key: string,
    label: string,
    value: string,
    change: (v: string) => void,
    help: string,
  ) => (
    <label key={key} htmlFor={`igmp-${key}`}>
      {label}
      <input
        id={`igmp-${key}`}
        value={value}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => change(e.target.value)}
      />
      <span className="field-help">{help}</span>
    </label>
  );
  const vxlan = (patch: Partial<IgmpVxlanLink>) => {
    if (l.mode === "owned-vxlan")
      onChange({ ...config, link: { ...l, ...patch } });
  };
  function move(index: number, direction: number) {
    const groups = [...config.groups];
    [groups[index], groups[index + direction]] = [
      groups[index + direction],
      groups[index],
    ];
    onChange({ ...config, groups });
  }
  return (
    <>
      <div className="protocol-binding-note">
        <strong>{guideText("igmp.configuration.igmpconfigform.001")}</strong>
        <p>{guideText("igmp.configuration.igmpconfigform.002")}</p>
      </div>
      <label htmlFor="igmp-link">{guideText("igmp.configuration.igmpconfigform.031")}<select
          id="igmp-link"
          disabled={disabled}
          value={l.mode}
          onChange={(e) => {
            const result = changeIgmpLink(
              config,
              e.target.value as IgmpLinkMode,
              linkDrafts,
            );
            onLinkDrafts(result.cache);
            onChange(result.config);
          }}
        >
          <option value="docker-bridge">{guideText("igmp.configuration.igmpconfigform.032")}</option>
          <option value="host-interface">{guideText("igmp.configuration.igmpconfigform.033")}</option>
          <option value="owned-vxlan">{guideText("igmp.configuration.igmpconfigform.034")}</option>
        </select>
        <span className="field-help">{guideText("igmp.configuration.igmpconfigform.003")}</span>
      </label>
      {l.mode === "docker-bridge" ? (
        <p className="field-help">{guideText("igmp.configuration.igmpconfigform.004")}</p>
      ) : l.mode === "host-interface" ? (
        <>
          <div className="field-row">
            {text(
              "interface",
              guideText("igmp.configuration.igmpconfigform.035"),
              l.interface,
              (v) => onChange({ ...config, link: { ...l, interface: v } }),
              guideText("igmp.configuration.igmpconfigform.005"),
            )}
            {text(
              "interface-ip",
              guideText("igmp.configuration.igmpconfigform.006"),
              l.interface_ip,
              (v) => onChange({ ...config, link: { ...l, interface_ip: v } }),
              guideText("igmp.configuration.igmpconfigform.007"),
            )}
          </div>
          {text(
            "peer-interface",
            guideText("igmp.configuration.igmpconfigform.008"),
            l.peer_interface ?? "",
            (v) =>
              onChange({
                ...config,
                link: { ...l, peer_interface: v === "" ? null : v },
              }),
            guideText("igmp.configuration.igmpconfigform.009"),
          )}
          <p className="field-help">{guideText("igmp.configuration.igmpconfigform.010")}</p>
        </>
      ) : (
        <>
          <div className="protocol-binding-note">
            <strong>{guideText("igmp.configuration.igmpconfigform.011")}</strong>
            <p>{guideText("igmp.configuration.igmpconfigform.012")}</p>
          </div>
          {text(
            "outer-interface",
            guideText("igmp.configuration.igmpconfigform.036"),
            l.outer_interface,
            (v) => vxlan({ outer_interface: v }),
            guideText("igmp.configuration.igmpconfigform.013"),
          )}
          <div className="field-row">
            {text(
              "local-outer-ip",
              guideText("igmp.configuration.igmpconfigform.037"),
              l.local_outer_ip,
              (v) => vxlan({ local_outer_ip: v }),
              guideText("igmp.configuration.igmpconfigform.014"),
            )}
            {text(
              "peer-outer-ip",
              guideText("igmp.configuration.igmpconfigform.038"),
              l.peer_outer_ip,
              (v) => vxlan({ peer_outer_ip: v }),
              guideText("igmp.configuration.igmpconfigform.015"),
            )}
          </div>
          <div className="field-row">
            {(["vni", "udp_port", "mtu"] as const).map((key) => (
              <label key={key} htmlFor={`igmp-${key}`}>
                {key === "vni"
                  ? guideText("igmp.configuration.igmpconfigform.016")
                  : key === "udp_port"
                    ? guideText("igmp.configuration.igmpconfigform.017")
                    : "VXLAN MTU"}
                <input
                  id={`igmp-${key}`}
                  type="number"
                  min={key === "vni" ? 1 : key === "udp_port" ? 1024 : 576}
                  max={
                    key === "vni" ? 16777215 : key === "udp_port" ? 65535 : 9000
                  }
                  step={1}
                  disabled={disabled}
                  value={Number.isFinite(l[key]) ? l[key] : ""}
                  onChange={(e) =>
                    vxlan({ [key]: e.currentTarget.valueAsNumber })
                  }
                />
              </label>
            ))}
          </div>
          <span className="field-help">{guideText("igmp.configuration.igmpconfigform.018")}</span>
          <div className="field-row">
            {text(
              "local-inner-cidr",
              guideText("igmp.configuration.igmpconfigform.019"),
              l.local_inner_cidr,
              (v) => vxlan({ local_inner_cidr: v }),
              guideText("igmp.configuration.igmpconfigform.020"),
            )}
            {text(
              "peer-inner-ip",
              guideText("igmp.configuration.igmpconfigform.039"),
              l.peer_inner_ip,
              (v) => vxlan({ peer_inner_ip: v }),
              guideText("igmp.configuration.igmpconfigform.021"),
            )}
          </div>
          <div className="field-row">
            {text(
              "local-inner-mac",
              guideText("igmp.configuration.igmpconfigform.040"),
              l.local_inner_mac,
              (v) => vxlan({ local_inner_mac: v }),
              guideText("igmp.configuration.igmpconfigform.022"),
            )}
            {text(
              "peer-inner-mac",
              guideText("igmp.configuration.igmpconfigform.041"),
              l.peer_inner_mac,
              (v) => vxlan({ peer_inner_mac: v }),
              guideText("igmp.configuration.igmpconfigform.023"),
            )}
          </div>
          <p className="field-help">{guideText("igmp.configuration.igmpconfigform.024")}</p>
        </>
      )}
      <div className="dns-record-heading">
        <h3>{guideText("igmp.configuration.igmpconfigform.042")}{config.groups.length}/16）</h3>
        <button
          type="button"
          className="button"
          disabled={disabled || config.groups.length >= 16}
          onClick={() =>
            onChange({ ...config, groups: [...config.groups, ""] })
          }
        >{guideText("igmp.configuration.igmpconfigform.043")}</button>
      </div>
      <p className="field-help">{guideText("igmp.configuration.igmpconfigform.025")}</p>
      {config.groups.map((g, index) => (
        <div className="field-row" key={index}>
          {text(
            `group-${index}`,
            `${guideText("igmp.configuration.igmpconfigform.044")}${index + 1}${index === 0 ? guideText("igmp.configuration.igmpconfigform.026") : ""}`,
            g,
            (v) =>
              onChange({
                ...config,
                groups: config.groups.map((x, i) => (i === index ? v : x)),
              }),
            guideText("igmp.configuration.igmpconfigform.027"),
          )}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              alignItems: "center",
            }}
          >
            <button
              type="button"
              className="button"
              disabled={disabled || index === 0}
              onClick={() => move(index, -1)}
            >{guideText("igmp.configuration.igmpconfigform.045")}{index + 1}
            </button>
            <button
              type="button"
              className="button"
              disabled={disabled || index === config.groups.length - 1}
              onClick={() => move(index, 1)}
            >{guideText("igmp.configuration.igmpconfigform.046")}{index + 1}
            </button>
            <button
              type="button"
              className="button"
              disabled={disabled || config.groups.length <= 1}
              onClick={() =>
                onChange({
                  ...config,
                  groups: config.groups.filter((_, i) => i !== index),
                })
              }
            >{guideText("igmp.configuration.igmpconfigform.047")}{index + 1}
            </button>
          </div>
        </div>
      ))}
      <div className="response-description">
        <strong>{guideText("igmp.configuration.igmpconfigform.048")}</strong>
        <p>{guideText("igmp.configuration.igmpconfigform.028")}</p>
        <p>{guideText("igmp.configuration.igmpconfigform.029")}</p>
        <p>{guideText("igmp.configuration.igmpconfigform.030")}</p>
      </div>
    </>
  );
}
