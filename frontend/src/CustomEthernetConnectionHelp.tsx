import { guideText } from "./protocol-description.ts";
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
      <strong>{guideText("custom-ethernet.connection.customethernetconnectionhelp.001")}</strong>
      {execution && (
        <dl>
          {Object.entries({
            role: guideText("custom-ethernet.connection.customethernetconnectionhelp.002"),
            bridge: guideText("custom-ethernet.connection.customethernetconnectionhelp.003"),
            host: guideText("custom-ethernet.connection.customethernetconnectionhelp.004"),
            observer: guideText("custom-ethernet.connection.customethernetconnectionhelp.005"),
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
          <h3>{guideText("custom-ethernet.connection.customethernetconnectionhelp.006")}</h3>
          <p>{guideText("custom-ethernet.connection.customethernetconnectionhelp.007")}<code>{guideText("custom-ethernet.connection.customethernetconnectionhelp.008")}</code>{guideText("custom-ethernet.connection.customethernetconnectionhelp.009")}</p>
          {external.requires?.length ? (
            <ul>
              {external.requires.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          ) : null}
          {[
            [forward, guideText("custom-ethernet.connection.customethernetconnectionhelp.010")],
            [peer, guideText("custom-ethernet.connection.customethernetconnectionhelp.011")],
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
                <p>{guideText("custom-ethernet.connection.customethernetconnectionhelp.012")}</p>
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
        <p>{guideText("custom-ethernet.connection.customethernetconnectionhelp.013")}</p>
      )}
      <p>{guideText("custom-ethernet.connection.customethernetconnectionhelp.014")}</p>
    </section>
  );
}
