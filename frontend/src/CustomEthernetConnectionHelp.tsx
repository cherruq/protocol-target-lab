import {
  quoteShellCommand,
  type ArpConnectionInfo,
} from "./arp-client-connection";
function command(v: unknown): string | null {
  try {
    return Array.isArray(v) ? quoteShellCommand(v) : null;
  } catch {
    return null;
  }
}
export default function CustomEthernetConnectionHelp({
  connection,
  onCopy,
}: {
  connection: ArpConnectionInfo | null;
  onCopy: (s: string) => void | Promise<void>;
}) {
  const external = connection?.external_peer,
    forward = command(external?.observer_forward),
    peer = command(external?.argv);
  const execution = connection?.client_execution;
  return (
    <section
      className="protocol-binding-note"
      style={{ gridColumn: "1 / -1", minWidth: 0 }}
      aria-label="Custom Ethernet 二层接入说明"
    >
      <strong>真实二层接入与私有只读观察</strong>
      {execution && (
        <dl>
          {Object.entries({
            role: "测试角色",
            bridge: "受管隔离链路",
            host: "现有接口与异机客户端",
            observer: "私有观察通道",
          }).map(
            ([key, label]) =>
              typeof execution[key as keyof typeof execution] === "string" && (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{execution[key as keyof typeof execution]}</dd>
                </div>
              ),
          )}
        </dl>
      )}
      {connection?.notes?.length ? (
        <ul>
          {connection.notes.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      ) : null}
      {external ? (
        <>
          <h3>外部同镜像主动客户端模板（host-interface）</h3>
          <p>
            只展示/复制，Web不会执行。先用
            <code>plabctl runtime custom-ethernet</code>
            核对源真实image/boot/runtime，再替换实际客户端本机接口、源镜像ID及所有身份占位；SSH目标是实际目标服务器，不是MAC或虚构协议IP。只读observer不发送协议回应。结束后再次核对源身份。
          </p>
          {external.requires?.length ? (
            <ul>
              {external.requires.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          ) : null}
          {[
            [forward, "复制只读转发模板"],
            [peer, "复制外部以太网客户端模板"],
          ].map(([s, label]) => (
            <div key={label} className="command">
              {s ? (
                <>
                  <code>{s}</code>
                  <button
                    type="button"
                    className="button"
                    onClick={() => void onCopy(s)}
                  >
                    {label}
                  </button>
                </>
              ) : (
                <p>模板参数不可用，请核对管理服务版本。</p>
              )}
            </div>
          ))}
          {external.notes?.length ? (
            <ul>
              {external.notes.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p>
          受管bridge使用上方内置客户端，临时peer进入当前exact owned
          network。没有虚构host命令，不自动SSH、不创建VLAN设备或配置宿主网卡。
        </p>
      )}
      <p>
        源是被动固定响应端，客户端主动发送当前显式fixture；不透明BPF可能不匹配。没有应用TCP/UDP端口、连接Up或标准事务ID/ACK。软件VLAN/AUXDATA证据与物理线上标签分别记录。
      </p>
    </section>
  );
}
