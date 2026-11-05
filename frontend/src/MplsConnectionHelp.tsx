import {
  quoteShellCommand,
  type ArpConnectionInfo,
} from "./arp-client-connection";
function command(v: unknown) {
  try {
    return Array.isArray(v) ? quoteShellCommand(v) : null;
  } catch {
    return null;
  }
}
export default function MplsConnectionHelp({
  connection,
  onCopy,
}: {
  connection: ArpConnectionInfo | null;
  onCopy: (s: string) => void | Promise<void>;
}) {
  const e = connection?.external_peer;
  const peer = e ? command(e.argv) : null,
    forward = e ? command(e.observer_forward) : null;
  return (
    <section
      className="protocol-binding-note"
      style={{ gridColumn: "1 / -1", minWidth: 0 }}
      aria-label="MPLS 二层接入说明"
    >
      <strong>真实单标签请求 / 普通 IPv4 输出</strong>
      <p>
        MPLS没有应用TCP/UDP端口或URL。私有18089仅只读源身份/因果事件，不是MPLS回应或ACK。源、对端MAC必须是真实NIC；IP是协议角色，不当OS地址或SSH主机名。
      </p>
      {connection?.client_execution && (
        <dl>
          {Object.entries(connection.client_execution).map(([key, value]) =>
            typeof value === "string" ? (
              <div key={key}>
                <dt>
                  {(
                    {
                      role: "客户端角色",
                      bridge: "隔离二层",
                      host: "现有接口 / 外部对端",
                      observer: "私有只读观察",
                    } as Record<string, string>
                  )[key] || key}
                </dt>
                <dd>{value}</dd>
              </div>
            ) : null,
          )}
        </dl>
      )}
      {connection?.notes?.length ? (
        <ul>
          {connection.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}
      {e ? (
        <>
          <h3>外部同镜像客户端模板（仅展示 / 复制）</h3>
          <p>
            先用 <code>plabctl runtime mpls</code> 先核source
            CID/boot/runtime；Image需在目标宿主对已确认的CID执行docker inspect
            .Image，并按本发布冻结asset核对客户端immutable
            image。再替换peer本机接口、源身份与target
            SSH占位。不能复制目标接口名、自动SSH或用role
            IP当主机。发送/接收实际Ethernet帧，forward只传只读观察；结束后再次核source身份，清理自有forward。
          </p>
          {e.requires?.length ? (
            <ul>
              {e.requires.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : null}
          {[
            [forward, "复制MPLS只读转发模板"],
            [peer, "复制外部MPLS客户端模板"],
          ].map(([cmd, label]) =>
            cmd ? (
              <div className="command" key={label!}>
                <code>{cmd}</code>
                <button
                  type="button"
                  className="button"
                  onClick={() => void onCopy(cmd)}
                >
                  {label}
                </button>
              </div>
            ) : (
              <p key={label!}>模板参数未就绪，请核对管理服务版本。</p>
            ),
          )}
          {e.notes?.length ? (
            <ul>
              {e.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p>
          当前未提供外部模板；受管bridge使用上方内置测试。host模式若缺模板请核对管理服务版本，不推断客户端接口或镜像；Web不自动访问物理LAN。
        </p>
      )}
      <p>
        ALL只验证当前applied场景8检查，不自动轮换14场景；故障执行通过不等于normal
        Echo通过。short13若TX失败明确unavailable，不能补长/改silent；坏checksum与截断输出按实际opaque字节核对。
      </p>
    </section>
  );
}
