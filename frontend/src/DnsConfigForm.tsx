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
      <label htmlFor="dns-tls-port">
        TLS 端口
        <input
          id="dns-tls-port"
          type="number"
          min="1"
          max="65535"
          value={Number.isFinite(config.tls_port ?? 1853) ? config.tls_port ?? 1853 : ""}
          disabled={disabled || !config.tls_enabled}
          onChange={(e) => onChange({ ...config, tls_port: e.currentTarget.valueAsNumber })}
          required={Boolean(config.tls_enabled)}
        />
        <span className="field-help">
          默认 1853；使用内置公开实验室证书。启用 TCP 时两者端口必须不同。
          {" "}<a href="/api/tls/lab.crt" download="lab.crt">下载实验室证书 lab.crt</a>
        </span>
      </label>
      <label htmlFor="dns-response-profile">
        应答模式
        <select
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
          <option value="standard">标准 DNS（dnsmasq 静态记录）</option>
          <option value="legacy-fixtures">旧脚本固定场景</option>
        </select>
      </label>
      {config.response_profile === "legacy-fixtures" && (
        <>
          <label htmlFor="dns-fixture-set">
            场景集
            <select
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
              <option value="short">short（仅 UDP）</option>
              <option value="wrong-id">wrong-id（仅 UDP）</option>
            </select>
          </label>
          <p className="field-help">
            精确匹配旧脚本请求字节并输出预设报文，包括畸形、截断和受控 NOTIFY / UPDATE / DSO 响应。
            这不代表真实区域更新或 DSO 订阅；下方记录保留给标准模式，固定场景不使用这些记录。
            short / wrong-id 场景集仅支持 UDP，切换场景不会自动关闭其他传输。
          </p>
        </>
      )}
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
