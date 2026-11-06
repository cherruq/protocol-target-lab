export type DnsRecord = {
  name: string;
  record_type: "A" | "AAAA";
  value: string;
  ttl: number;
};
export type DnsConfig = {
  bind_ip: string;
  port: number;
  udp_enabled: boolean;
  tcp_enabled: boolean;
  records: DnsRecord[];
  tls_enabled?: boolean;
  tls_port?: number;
  response_profile?: "standard" | "legacy-fixtures";
  fixture_set?: "final" | "short" | "wrong-id";
};
export const dnsDefaults: DnsConfig = {
  bind_ip: "0.0.0.0",
  port: 15353,
  udp_enabled: true,
  tcp_enabled: true,
  records: [
    { name: "device.test", record_type: "A", value: "192.0.2.28", ttl: 60 },
  ],
};
export function isDnsConfig(value: unknown): value is DnsConfig {
  return Boolean(value && typeof value === "object" && "records" in value);
}
export function normalizeDnsName(name: string): string {
  const normalized = name.toLowerCase().replace(/\.$/, "");
  if (
    normalized.length < 1 ||
    normalized.length > 253 ||
    normalized
      .split(".")
      .some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    throw new Error(
      "记录名称须为 ASCII DNS 名称，每段 1～63 个字母、数字或连字符，首尾不能为连字符，总长不超过 253。",
    );
  return normalized;
}
export function validIpv4(value: string): boolean {
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts.every(
      (part) =>
        /^\d+$/.test(part) &&
        String(Number(part)) === part &&
        Number(part) <= 255,
    )
  );
}
function canonicalAddress(
  value: string,
  type: DnsRecord["record_type"],
): string {
  if (type === "A") {
    if (!validIpv4(value)) throw new Error("A 记录必须填写有效 IPv4 地址。");
    return value;
  }
  try {
    if (!value.includes(":") || value.includes("%")) throw new Error();
    return new URL(`http://[${value}]/`).hostname.slice(1, -1);
  } catch {
    throw new Error("AAAA 记录必须填写有效 IPv6 地址。");
  }
}
export function normalizeDnsConfig(config: DnsConfig): DnsConfig {
  if (!validIpv4(config.bind_ip))
    throw new Error("绑定地址必须是有效 IPv4 地址。");
  const firstOctet = Number(config.bind_ip.split(".")[0]);
  if (
    (firstOctet >= 224 && firstOctet <= 239) ||
    config.bind_ip === "255.255.255.255"
  )
    throw new Error(
      "绑定地址须为单播 IPv4 地址或 0.0.0.0，不能使用组播或广播地址。",
    );
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
    throw new Error("端口必须是 1～65535 之间的整数。");
  if (config.tls_enabled !== undefined && typeof config.tls_enabled !== "boolean")
    throw new Error("TLS 开关必须是布尔值。");
  if (!config.udp_enabled && !config.tcp_enabled && !config.tls_enabled)
    throw new Error("UDP、TCP 和 TLS 至少启用一种传输。");
  if (config.tls_port !== undefined && (!Number.isInteger(config.tls_port) || config.tls_port < 1 || config.tls_port > 65535))
    throw new Error("TLS 端口必须是 1～65535 之间的整数。");
  if (config.tls_enabled && config.tcp_enabled && (config.tls_port ?? 1853) === config.port)
    throw new Error("TCP 和 TLS 不能共用同一监听端口。");
  if (config.response_profile !== undefined && !["standard", "legacy-fixtures"].includes(config.response_profile))
    throw new Error("请选择标准 DNS 或旧脚本固定场景。");
  if (config.fixture_set !== undefined && !["final", "short", "wrong-id"].includes(config.fixture_set))
    throw new Error("请选择有效的旧脚本场景集。");
  if (config.response_profile === "legacy-fixtures" && (config.fixture_set ?? "final") !== "final" && (config.tcp_enabled || config.tls_enabled))
    throw new Error("short / wrong-id 场景集仅支持 UDP，请先关闭 TCP 和 TLS。");
  if (config.records.length < 1 || config.records.length > 32)
    throw new Error("请配置 1～32 条 DNS 记录。");
  const sets = new Map<string, { ttl: number; count: number }>();
  const identities = new Set<string>();
  const records = config.records.map((record, index) => {
    try {
      if (record.record_type !== "A" && record.record_type !== "AAAA")
        throw new Error("记录类型仅支持 A / AAAA。");
      if (!Number.isInteger(record.ttl) || record.ttl < 0 || record.ttl > 86400)
        throw new Error("TTL 必须为 0～86400 之间的整秒数。");
      const name = normalizeDnsName(record.name);
      const value = canonicalAddress(record.value, record.record_type);
      const key = `${name}/${record.record_type}`;
      const set = sets.get(key) || { ttl: record.ttl, count: 0 };
      if (set.ttl !== record.ttl)
        throw new Error("同名称、同类型的一组记录必须使用相同 TTL。");
      if (++set.count > 16)
        throw new Error("同名称、同类型最多配置 16 条记录。");
      sets.set(key, set);
      const identity = `${key}/${value}`;
      if (identities.has(identity))
        throw new Error("存在重复的名称、类型和地址记录。");
      identities.add(identity);
      return { ...record, name, value };
    } catch (error) {
      throw new Error(`第 ${index + 1} 条记录：${(error as Error).message}`);
    }
  });
  const normalized = { ...config, records };
  if (!normalized.tls_enabled) delete normalized.tls_enabled;
  if (normalized.response_profile === "standard") delete normalized.response_profile;
  if (normalized.fixture_set === "final") delete normalized.fixture_set;
  return normalized;
}
export function sameDnsConfig(a: DnsConfig, b: DnsConfig): boolean {
  return (
    a.bind_ip === b.bind_ip &&
    a.port === b.port &&
    a.udp_enabled === b.udp_enabled &&
    a.tcp_enabled === b.tcp_enabled &&
    Boolean(a.tls_enabled) === Boolean(b.tls_enabled) &&
    (a.tls_port ?? 1853) === (b.tls_port ?? 1853) &&
    (a.response_profile ?? "standard") === (b.response_profile ?? "standard") &&
    (a.fixture_set ?? "final") === (b.fixture_set ?? "final") &&
    JSON.stringify(a.records) === JSON.stringify(b.records)
  );
}

/** Fallback examples reflect the selected applied profile, never disabled transports. */
export function dnsConnectionCommands(config: DnsConfig): string[] {
  if (config.response_profile === "legacy-fixtures")
    return ["plabctl tests run dns --method ALL --path ALL"];
  const name = config.records[0]?.name || "device.test";
  return [
    ...(config.udp_enabled ? [`dig @<目标IP> -p ${config.port} ${name} A`] : []),
    ...(config.tcp_enabled ? [`dig +tcp @<目标IP> -p ${config.port} ${name} A`] : []),
    ...(config.tls_enabled ? ["plabctl tests run dns --method TLS --path ALL"] : []),
  ];
}
