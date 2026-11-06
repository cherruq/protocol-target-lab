import { guideText } from "./protocol-description.ts";
import type { DnsConfig, DnsRecord } from "./dns-config";

export default function DnsConfigForm({
  config,
  onChange,
  disabled,
}: {
  config: DnsConfig;
  onChange: (config: DnsConfig) => void;
  disabled: boolean;
}) {
  function record(index: number, patch: Partial<DnsRecord>) {
    onChange({
      ...config,
      records: config.records.map((r, i) =>
        i === index ? { ...r, ...patch } : r,
      ),
    });
  }
  return (
    <div className="dns-config-fields">
      <div className="field-row">
        <label htmlFor="dns-bind">{guideText("dns.configuration.dnsconfigform.007")}<input
            id="dns-bind"
            value={config.bind_ip}
            onChange={(e) => onChange({ ...config, bind_ip: e.target.value })}
            disabled={disabled}
            required
            spellCheck={false}
          />
          <span className="field-help">{guideText("dns.configuration.dnsconfigform.001")}</span>
        </label>
        <label htmlFor="dns-port">{guideText("dns.configuration.dnsconfigform.008")}<input
            id="dns-port"
            type="number"
            min="1"
            max="65535"
            value={Number.isFinite(config.port) ? config.port : ""}
            onChange={(e) =>
              onChange({ ...config, port: e.currentTarget.valueAsNumber })
            }
            disabled={disabled}
            required
          />
        </label>
      </div>
      <fieldset className="dns-transports" disabled={disabled}>
        <legend>{guideText("dns.configuration.dnsconfigform.009")}</legend>
        <label>
          <input
            type="checkbox"
            checked={config.udp_enabled}
            onChange={(e) =>
              onChange({ ...config, udp_enabled: e.target.checked })
            }
          />{" "}
          UDP
        </label>
        <label>
          <input
            type="checkbox"
            checked={config.tcp_enabled}
            onChange={(e) =>
              onChange({ ...config, tcp_enabled: e.target.checked })
            }
          />{" "}
          TCP
        </label>
        <label>
          <input
            type="checkbox"
            checked={Boolean(config.tls_enabled)}
            onChange={(e) => {
              const next = { ...config };
              if (e.target.checked) next.tls_enabled = true;
              else delete next.tls_enabled;
              onChange(next);
            }}
          /> TLS（DNS over TLS）
        </label>
      </fieldset>
      <label htmlFor="dns-tls-port">{guideText("dns.configuration.dnsconfigform.010")}<input
          id="dns-tls-port"
          type="number"
          min="1"
          max="65535"
          value={Number.isFinite(config.tls_port ?? 1853) ? config.tls_port ?? 1853 : ""}
          disabled={disabled || !config.tls_enabled}
          onChange={(e) => onChange({ ...config, tls_port: e.currentTarget.valueAsNumber })}
          required={Boolean(config.tls_enabled)}
        />
        <span className="field-help">{guideText("dns.configuration.dnsconfigform.002")}{" "}<a href="/api/tls/lab.crt" download="lab.crt">{guideText("dns.configuration.dnsconfigform.003")}</a>
        </span>
      </label>
      <label htmlFor="dns-response-profile">{guideText("dns.configuration.dnsconfigform.011")}<select
          id="dns-response-profile"
          value={config.response_profile ?? "standard"}
          disabled={disabled}
          onChange={(e) => {
            const next = { ...config };
            if (e.target.value === "standard") delete next.response_profile;
            else next.response_profile = "legacy-fixtures";
            onChange(next);
          }}
        >
          <option value="standard">{guideText("dns.configuration.dnsconfigform.012")}</option>
          <option value="legacy-fixtures">{guideText("dns.configuration.dnsconfigform.013")}</option>
        </select>
      </label>
      {config.response_profile === "legacy-fixtures" && (
        <>
          <label htmlFor="dns-fixture-set">{guideText("dns.configuration.dnsconfigform.014")}<select
              id="dns-fixture-set"
              value={config.fixture_set ?? "final"}
              disabled={disabled}
              onChange={(e) => {
                const next = { ...config };
                if (e.target.value === "final") delete next.fixture_set;
                else next.fixture_set = e.target.value as "short" | "wrong-id";
                onChange(next);
              }}
            >
              <option value="final">final（UDP / TCP / TLS）</option>
              <option value="short">{guideText("dns.configuration.dnsconfigform.015")}</option>
              <option value="wrong-id">{guideText("dns.configuration.dnsconfigform.016")}</option>
            </select>
          </label>
          <p className="field-help">{guideText("dns.configuration.dnsconfigform.004")}</p>
        </>
      )}
      <div className="dns-record-heading">
        <h3>{guideText("dns.configuration.dnsconfigform.017")}</h3>
        <span>{config.records.length}{guideText("dns.configuration.dnsconfigform.018")}</span>
      </div>
      <p className="field-help">{guideText("dns.configuration.dnsconfigform.005")}</p>
      <div className="dns-records">
        {config.records.map((r, i) => (
          <fieldset className="dns-record" key={i} disabled={disabled}>
            <legend>{guideText("dns.configuration.dnsconfigform.019")}{i + 1}</legend>
            <label htmlFor={`dns-name-${i}`}>{guideText("dns.configuration.dnsconfigform.020")}<input
                id={`dns-name-${i}`}
                value={r.name}
                onChange={(e) => record(i, { name: e.target.value })}
                required
                maxLength={254}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <div className="field-row">
              <label htmlFor={`dns-type-${i}`}>{guideText("dns.configuration.dnsconfigform.021")}<select
                  id={`dns-type-${i}`}
                  value={r.record_type}
                  onChange={(e) =>
                    record(i, {
                      record_type: e.target.value as DnsRecord["record_type"],
                    })
                  }
                >
                  <option>A</option>
                  <option>AAAA</option>
                </select>
              </label>
              <label htmlFor={`dns-ttl-${i}`}>{guideText("dns.configuration.dnsconfigform.022")}<input
                  id={`dns-ttl-${i}`}
                  type="number"
                  min="0"
                  max="86400"
                  step="1"
                  value={Number.isFinite(r.ttl) ? r.ttl : ""}
                  onChange={(e) =>
                    record(i, { ttl: e.currentTarget.valueAsNumber })
                  }
                  required
                />
              </label>
            </div>
            <label htmlFor={`dns-value-${i}`}>
              {r.record_type === "A" ? guideText("dns.configuration.dnsconfigform.023") : guideText("dns.configuration.dnsconfigform.024")}
              <input
                id={`dns-value-${i}`}
                value={r.value}
                onChange={(e) => record(i, { value: e.target.value })}
                required
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <button
              className="button dns-remove"
              type="button"
              onClick={() =>
                onChange({
                  ...config,
                  records: config.records.filter((_, n) => n !== i),
                })
              }
              disabled={disabled || config.records.length <= 1}
            >{guideText("dns.configuration.dnsconfigform.025")}</button>
          </fieldset>
        ))}
      </div>
      <button
        className="button"
        type="button"
        disabled={disabled || config.records.length >= 32}
        onClick={() =>
          onChange({
            ...config,
            records: [
              ...config.records,
              { name: "", record_type: "A", value: "", ttl: 60 },
            ],
          })
        }
      >{guideText("dns.configuration.dnsconfigform.026")}</button>
      <p className="field-help">{guideText("dns.configuration.dnsconfigform.006")}</p>
    </div>
  );
}
