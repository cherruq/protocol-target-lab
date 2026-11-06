export type Config = {
  bind_ip: string;
  port: number;
  tls_enabled?: boolean;
  response_length: number;
  response_mode: "fixed" | "random";
};

export type LegacyConfig = {
  bind_ip: string;
  port: number;
  tls_enabled?: boolean;
  response_body: string;
};

export type StoredConfig = Config | LegacyConfig;

export function isHttpConfig(value: unknown): value is StoredConfig {
  if (
    !value ||
    typeof value !== "object" ||
    !("bind_ip" in value) ||
    !("port" in value)
  )
    return false;
  return (
    isLegacyConfig(value) ||
    ("response_length" in value && "response_mode" in value)
  );
}

export const defaults: Config = {
  bind_ip: "0.0.0.0",
  port: 18090,
  response_length: 64,
  response_mode: "fixed",
};

export const supportedMethods = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
];

export function isLegacyConfig(config: unknown): config is LegacyConfig {
  return Boolean(
    config && typeof config === "object" && "response_body" in config,
  );
}

// This conversion is only an editor draft. Saving or applying remains explicit.
export function normalizeConfig(config: StoredConfig): Config {
  return {
    bind_ip: config.bind_ip,
    port: config.port,
    response_length: isLegacyConfig(config)
      ? new TextEncoder().encode(config.response_body).length
      : config.response_length,
    response_mode: isLegacyConfig(config) ? "fixed" : config.response_mode,
    ...(config.tls_enabled ? { tls_enabled: true } : {}),
  };
}

export function sameGeneratedConfig(a: Config, b: Config): boolean {
  return (
    a.bind_ip === b.bind_ip &&
    a.port === b.port &&
    Boolean(a.tls_enabled) === Boolean(b.tls_enabled) &&
    a.response_length === b.response_length &&
    a.response_mode === b.response_mode
  );
}

export function sameStoredConfig(a: StoredConfig, b: StoredConfig): boolean {
  if (isLegacyConfig(a) || isLegacyConfig(b)) {
    return (
      isLegacyConfig(a) &&
      isLegacyConfig(b) &&
      a.bind_ip === b.bind_ip &&
      a.port === b.port &&
      Boolean(a.tls_enabled) === Boolean(b.tls_enabled) &&
      a.response_body === b.response_body
    );
  }
  return sameGeneratedConfig(a, b);
}

export function validateConfig(config: Config): void {
  if (config.tls_enabled !== undefined && typeof config.tls_enabled !== "boolean")
    throw new Error("HTTPS 开关必须是布尔值。");
  if (
    !Number.isInteger(config.response_length) ||
    config.response_length < 0 ||
    config.response_length > 1048576
  ) {
    throw new Error("响应长度必须是 0～1048576 之间的整数字节数。");
  }
  if (!["fixed", "random"].includes(config.response_mode)) {
    throw new Error("请选择固定或随机响应模式。");
  }
}
