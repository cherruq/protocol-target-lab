import {
  quoteShellCommand,
  type ArpConnectionInfo,
} from "./arp-client-connection";
function template(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  try {
    return quoteShellCommand(value);
  } catch {
    return null;
  }
}
export default function ArpClientConnectionHelp({
  connection,
  onCopy,
}: {
  connection: ArpConnectionInfo | null;
  onCopy: (text: string) => void | Promise<void>;
}) {
  const execution = connection?.client_execution,
    external = connection?.external_peer;
  const peerCommand = external ? template(external.argv) : null;
  const forwardCommand = external ? template(external.observer_forward) : null;
  const labels = {
    role: "反向工具角色",
    bridge: "隔离 bridge",
    host: "现有接口与反向对端",
    observer: "私有只读观察通道",
  } as const;
  return (
    <section
      className="protocol-binding-note"
      style={{ gridColumn: "1 / -1", minWidth: 0 }}
      aria-label="ARP-client 二层接入说明"
    >
      <strong>二层执行位置与私有观察</strong>
      {execution && (
        <dl>
          {(Object.keys(labels) as (keyof typeof labels)[]).map(
            (key) =>
              typeof execution[key] === "string" && (
                <div key={key}>
                  <dt>{labels[key]}</dt>
                  <dd>{execution[key]}</dd>
                </div>
              ),
          )}
        </dl>
      )}
      {connection?.notes?.length ? (
        <ul>
          {connection.notes.map((note, index) => (
            <li key={index}>{note}</li>
          ))}
        </ul>
      ) : null}
      {external ? (
        <>
          <h3>外部同镜像反向 peer 模板（仅 host-interface）</h3>
          <p>
            模板仅展示 / 复制，Web不会执行。先用{" "}
            <code>plabctl runtime arp-client</code>{" "}
            核对实际源身份，再明确替换本机peer接口、boot/runtime
            ID及SSH目标占位符；SSH目标是实际测试服务器，不是实验role
            IP。只读转发不等于ARP应答或ACK，结束后须再次核对源身份。
          </p>
          {external.requires?.length ? (
            <ul>
              {external.requires.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          ) : null}
          <h4>1. 显式只读观察通道转发</h4>
          {forwardCommand ? (
            <div className="command">
              <code>{forwardCommand}</code>
              <button
                type="button"
                className="button"
                onClick={() => void onCopy(forwardCommand)}
              >
                复制转发模板
              </button>
            </div>
          ) : (
            <p>转发模板参数不可用，请核对管理服务版本。</p>
          )}
          <h4>2. 本机真实接口上的反向 peer</h4>
          {peerCommand ? (
            <div className="command">
              <code>{peerCommand}</code>
              <button
                type="button"
                className="button"
                onClick={() => void onCopy(peerCommand)}
              >
                复制外部 peer 模板
              </button>
            </div>
          ) : (
            <p>反向peer模板参数不可用，请核对管理服务版本。</p>
          )}
          {external.notes?.length ? (
            <ul>
              {external.notes.map((note, index) => (
                <li key={index}>{note}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p>
          当前链路不提供虚构的外部host命令。受管bridge使用上方内置测试，临时peer进入同一个exact
          owned network；不会自动连接物理LAN、SSH或修改网卡。
        </p>
      )}
    </section>
  );
}
