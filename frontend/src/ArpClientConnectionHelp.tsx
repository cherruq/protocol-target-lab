import { guideText } from "./protocol-description.ts";
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
      <strong>{guideText("arp-client.connection.arpclientconnectionhelp.001")}</strong>
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
          <h3>{guideText("arp-client.connection.arpclientconnectionhelp.002")}</h3>
          <p>{guideText("arp-client.connection.arpclientconnectionhelp.003")}{" "}
            <code>{guideText("arp-client.connection.arpclientconnectionhelp.004")}</code>{" "}{guideText("arp-client.connection.arpclientconnectionhelp.005")}</p>
          {external.requires?.length ? (
            <ul>
              {external.requires.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          ) : null}
          <h4>{guideText("arp-client.connection.arpclientconnectionhelp.006")}</h4>
          {forwardCommand ? (
            <div className="command">
              <code>{forwardCommand}</code>
              <button
                type="button"
                className="button"
                onClick={() => void onCopy(forwardCommand)}
              >{guideText("arp-client.connection.arpclientconnectionhelp.007")}</button>
            </div>
          ) : (
            <p>{guideText("arp-client.connection.arpclientconnectionhelp.008")}</p>
          )}
          <h4>{guideText("arp-client.connection.arpclientconnectionhelp.009")}</h4>
          {peerCommand ? (
            <div className="command">
              <code>{peerCommand}</code>
              <button
                type="button"
                className="button"
                onClick={() => void onCopy(peerCommand)}
              >{guideText("arp-client.connection.arpclientconnectionhelp.010")}</button>
            </div>
          ) : (
            <p>{guideText("arp-client.connection.arpclientconnectionhelp.011")}</p>
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
        <p>{guideText("arp-client.connection.arpclientconnectionhelp.012")}</p>
      )}
    </section>
  );
}
