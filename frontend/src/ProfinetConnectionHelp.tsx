import { quoteShellCommand } from "./arp-client-connection";
import { boundedWireSummary } from "./protocol-tests";
export type ProfinetConnectionInfo = {
  notes?: string[];
  access?: {
    available: boolean;
    reason?: string;
    data_network?: Record<string, unknown>;
    management_network?: Record<string, unknown>;
    source_container_id?: string;
    source_endpoint_id?: string;
    host_veth?: Record<string, unknown>;
  };
  nodes?: Record<string, unknown>;
  external_peer?: {
    argv: string[];
    requires?: string[];
    notes?: string[];
  } | null;
  tool_commands?: { label: string; argv: string[] }[];
};
function quote(v: unknown) {
  try {
    return Array.isArray(v) ? quoteShellCommand(v) : null;
  } catch {
    return null;
  }
}
export default function ProfinetConnectionHelp({
  connection,
  onCopy,
}: {
  connection: ProfinetConnectionInfo | null;
  onCopy: (s: string) => void | Promise<void>;
}) {
  const external = connection?.external_peer;
  const command = (argv: unknown, label: string, key: string) => {
    const s = quote(argv);
    return s ? (
      <div className="command" key={key}>
        <code>{s}</code>
        <button type="button" className="button" onClick={() => void onCopy(s)}>
          {label}
        </button>
      </div>
    ) : (
      <p key={key}>
        命令参数不可用，请核对管理服务版本；不会猜网卡或自动执行。
      </p>
    );
  };
  return (
    <section
      className="protocol-binding-note"
      style={{ gridColumn: "1 / -1", minWidth: 0 }}
      aria-label="PROFINET 三节点二层接入说明"
    >
      <strong>DCP、PTCP-N/F三个MAC节点 · 同一数据二层</strong>
      <p>
        没有DCP/PTCP应用端口或URL。native附带内部RPC/LLDP不代表已验证PLC循环IO；私有management
        observer仅观察，不是协议ACK。外部工具可以用自己的真实unicast
        MAC，test_peer_mac不是源访问控制；DCP发现不自动回填N/F目标。
      </p>
      {connection?.notes?.length ? (
        <ul>
          {connection.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}
      {connection?.access?.available ? (
        <>
          <h3>真实已核验数据网络 / host-veth</h3>
          <pre className="protocol-wire">
            {boundedWireSummary(connection.access).text}
          </pre>
          <p>
            host-veth来自实际iflink/master/bridge/endpoint归属读回，不把源namespace内pn0/eth1猜成宿主接口。数据IP会被native改变，Docker初始IPAM不是当前OS状态。
          </p>
        </>
      ) : (
        <p>
          真实外部接入资源目前不可用：
          {connection?.access?.reason || "源未运行或尚未取得真实snapshot"}
          。不虚构接口、NetworkID或停止态客户端命令。
        </p>
      )}
      {external && (
        <>
          <h3>同镜像外部客户端（仅复制）</h3>
          <p>
            先核source CID/boot/runtime；在目标宿主对已确认CID
            inspect实际Image，再按本发布冻结asset核对immutable客户端。明确替换执行主机真实peer-interface/peer-mac，不复制源数据接口名。Web不SSH、不自动加入foreign网络或执行工具。
          </p>
          {external.requires?.length ? (
            <ul>
              {external.requires.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : null}
          {command(external.argv, "复制PROFINET同镜像客户端", "external")}
          {external.notes?.length ? (
            <ul>
              {external.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      {connection?.tool_commands?.length ? (
        <>
          <h3>任意外部工具接入已核验data网络</h3>
          {connection.tool_commands.map((c, i) =>
            command(c.argv, "复制 " + c.label, "tool" + i),
          )}
          <p>
            仅复制已核验argv，需在实际执行主机操作。source接受合法外部请求；停止只移除本工作台资源，仍有foreign客户端的data网络会保留并诊断，不会杀进程、强拆endpoint或删除native-store。外部工具退出后才能精确回收空网络。
          </p>
        </>
      ) : null}
      {connection?.nodes && (
        <details>
          <summary>三节点启动配置目标（不冒作native当前值）</summary>
          <pre className="protocol-wire">
            {boundedWireSummary(connection.nodes).text}
          </pre>
        </details>
      )}
    </section>
  );
}
