export type ArpExternalPeer = {
  argv: string[];
  observer_forward: string[];
  requires: string[];
  notes: string[];
};
export type ArpConnectionInfo = {
  client_execution?: {
    role?: string;
    bridge?: string;
    host?: string;
    observer?: string;
  };
  notes?: string[];
  external_peer?: ArpExternalPeer | null;
};
/** POSIX shell presentation only; every argument remains one literal argument. Never execute here. */
export function quoteShellArg(argument: string): string {
  if (typeof argument !== "string" || argument.includes("\0"))
    throw new Error("模板参数不能含 NUL 或非字符串值。");
  return "'" + argument.replace(/'/g, "'\\''") + "'";
}
export function quoteShellCommand(argv: readonly string[]): string {
  if (!Array.isArray(argv) || !argv.length)
    throw new Error("模板必须提供非空 argv 数组。");
  return argv.map(quoteShellArg).join(" ");
}
