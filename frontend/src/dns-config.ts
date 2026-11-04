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
  if (!config.udp_enabled && !config.tcp_enabled)
    throw new Error("UDP 和 TCP 至少启用一种传输。");
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
  return { ...config, records };
}
export function sameDnsConfig(a: DnsConfig, b: DnsConfig): boolean {
  return (
    a.bind_ip === b.bind_ip &&
    a.port === b.port &&
    a.udp_enabled === b.udp_enabled &&
    a.tcp_enabled === b.tcp_enabled &&
    JSON.stringify(a.records) === JSON.stringify(b.records)
  );
}
