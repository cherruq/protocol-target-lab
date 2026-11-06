import { guideText } from "./protocol-description.ts";
import {
  profinetNScenarios,
  profinetFScenarios,
  profinetScenarioLabels,
  type ProfinetConfig,
  type ProfinetIpSuite,
  type ProfinetNScenario,
  type ProfinetFScenario,
} from "./profinet-config";
export default function ProfinetConfigForm({
  config: c,
  onChange,
  disabled,
}: {
  config: ProfinetConfig;
  onChange: (c: ProfinetConfig) => void;
  disabled: boolean;
}) {
  const dcp = (delta: Partial<ProfinetConfig["dcp"]>) =>
    onChange({ ...c, dcp: { ...c.dcp, ...delta } });
  const text = (
    id: string,
    label: string,
    value: string,
    change: (v: string) => void,
    help: string,
    maxLength?: number,
  ) => (
    <label htmlFor={`profinet-${id}`} key={id}>
      {label}
      <input
        id={`profinet-${id}`}
        value={value}
        required
        maxLength={maxLength}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => change(e.target.value)}
      />
      <span className="field-help">{help}</span>
    </label>
  );
  return (
    <>
      <div className="protocol-binding-note">
        <strong>{guideText("profinet.configuration.profinetconfigform.001")}</strong>
        <p>{guideText("profinet.configuration.profinetconfigform.002")}</p>
        <p>{guideText("profinet.configuration.profinetconfigform.003")}</p>
      </div>
      {text(
        "peer-mac",
        guideText("profinet.configuration.profinetconfigform.004"),
        c.test_peer_mac,
        (v) => onChange({ ...c, test_peer_mac: v }),
        guideText("profinet.configuration.profinetconfigform.005"),
      )}
      <fieldset className="protocol-point" disabled={disabled}>
        <legend>{guideText("profinet.configuration.profinetconfigform.019")}</legend>
        {text(
          "dcp-mac",
          guideText("profinet.configuration.profinetconfigform.020"),
          c.dcp.mac,
          (v) => dcp({ mac: v }),
          guideText("profinet.configuration.profinetconfigform.006"),
        )}
        {text(
          "initial-name",
          guideText("profinet.configuration.profinetconfigform.021"),
          c.dcp.initial_station_name,
          (v) => dcp({ initial_station_name: v }),
          guideText("profinet.configuration.profinetconfigform.007"),
          240,
        )}
        <div className="field-row">
          {(["ip", "netmask", "gateway"] as const).map((k) =>
            text(
              `initial-${k}`,
              {
                ip: guideText("profinet.configuration.profinetconfigform.022"),
                netmask: guideText("profinet.configuration.profinetconfigform.023"),
                gateway: guideText("profinet.configuration.profinetconfigform.024"),
              }[k],
              c.dcp.initial_ip_suite[k],
              (v) =>
                dcp({
                  initial_ip_suite: {
                    ...c.dcp.initial_ip_suite,
                    [k]: v,
                  } as ProfinetIpSuite,
                }),
              k === "gateway"
                ? guideText("profinet.configuration.profinetconfigform.008")
                : guideText("profinet.configuration.profinetconfigform.009"),
            ),
          )}
        </div>
        <div className="test-config-notice">
          <strong>{guideText("profinet.configuration.profinetconfigform.010")}</strong>
          <p>{guideText("profinet.configuration.profinetconfigform.011")}</p>
        </div>
        <p className="field-help">{guideText("profinet.configuration.profinetconfigform.012")}</p>
      </fieldset>
      {(["ptcp_n", "ptcp_f"] as const).map((node) => {
        const n = c[node],
          f = node === "ptcp_f";
        return (
          <fieldset key={node} className="protocol-point" disabled={disabled}>
            <legend>
              {f
                ? guideText("profinet.configuration.profinetconfigform.013")
                : guideText("profinet.configuration.profinetconfigform.014")}
            </legend>
            {text(
              node + "-mac",
              guideText("profinet.configuration.profinetconfigform.025"),
              n.mac,
              (v) => onChange({ ...c, [node]: { ...n, mac: v } }),
              guideText("profinet.configuration.profinetconfigform.015"),
            )}
            <label htmlFor={`profinet-${node}-scenario`}>{guideText("profinet.configuration.profinetconfigform.026")}<select
                id={`profinet-${node}-scenario`}
                value={n.scenario.mode}
                disabled={disabled}
                onChange={(e) =>
                  onChange(
                    f
                      ? {
                          ...c,
                          ptcp_f: {
                            ...c.ptcp_f,
                            scenario: {
                              mode: e.target.value as ProfinetFScenario,
                            },
                          },
                        }
                      : {
                          ...c,
                          ptcp_n: {
                            ...c.ptcp_n,
                            scenario: {
                              mode: e.target.value as ProfinetNScenario,
                            },
                          },
                        },
                  )
                }
              >
                {(f ? profinetFScenarios : profinetNScenarios).map((mode) => (
                  <option key={mode} value={mode}>
                    {profinetScenarioLabels[mode]}
                  </option>
                ))}
              </select>
            </label>
            {f && (
              <label htmlFor="profinet-truncated-size">{guideText("profinet.configuration.profinetconfigform.027")}<input
                  id="profinet-truncated-size"
                  type="number"
                  min={16}
                  max={45}
                  step={1}
                  required
                  disabled={
                    disabled || c.ptcp_f.scenario.mode !== "truncated-follow-up"
                  }
                  value={
                    Number.isFinite(c.ptcp_f.truncated_follow_up_size)
                      ? c.ptcp_f.truncated_follow_up_size
                      : ""
                  }
                  onChange={(e) =>
                    onChange({
                      ...c,
                      ptcp_f: {
                        ...c.ptcp_f,
                        truncated_follow_up_size: e.currentTarget.valueAsNumber,
                      },
                    })
                  }
                />
                <span className="field-help">{guideText("profinet.configuration.profinetconfigform.016")}</span>
              </label>
            )}
            <p className="field-help">{guideText("profinet.configuration.profinetconfigform.017")}</p>
          </fieldset>
        );
      })}
      <p className="field-help">{guideText("profinet.configuration.profinetconfigform.018")}</p>
    </>
  );
}
