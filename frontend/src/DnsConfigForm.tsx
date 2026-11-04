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
        <label htmlFor="dns-bind">
          绑定地址
          <input
            id="dns-bind"
            value={config.bind_ip}
            onChange={(e) => onChange({ ...config, bind_ip: e.target.value })}
            disabled={disabled}
            required
            spellCheck={false}
          />
          <span className="field-help">0.0.0.0 表示全部 IPv4 接口</span>
        </label>
        <label htmlFor="dns-port">
          DNS 端口
          <input
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
        <legend>启用传输（至少一项）</legend>
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
      </fieldset>
      <div className="dns-record-heading">
        <h3>应答记录</h3>
        <span>{config.records.length} / 32 条</span>
      </div>
      <p className="field-help">
        仅支持 A /
        AAAA；名称不区分大小写，保存时转为小写并移除末尾点。同名称、同类型最多
        16 条且 TTL 必须一致。
      </p>
      <div className="dns-records">
        {config.records.map((r, i) => (
          <fieldset className="dns-record" key={i} disabled={disabled}>
            <legend>记录 {i + 1}</legend>
            <label htmlFor={`dns-name-${i}`}>
              名称
              <input
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
              <label htmlFor={`dns-type-${i}`}>
                类型
                <select
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
              <label htmlFor={`dns-ttl-${i}`}>
                TTL（秒）
                <input
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
              {r.record_type === "A" ? "IPv4 地址" : "IPv6 地址"}
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
            >
              移除此记录
            </button>
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
      >
        添加 DNS 记录
      </button>
      <p className="field-help">
        添加或移除记录只修改草稿；保存后仍需显式运行或重启才会生效。
      </p>
    </div>
  );
}
