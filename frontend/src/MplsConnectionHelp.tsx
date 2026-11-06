import { guideText } from "./protocol-description.ts";
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
      <strong>{guideText("mpls.connection.mplsconnectionhelp.001")}</strong>
      <p>{guideText("mpls.connection.mplsconnectionhelp.002")}</p>
      {connection?.client_execution && (
        <dl>
          {Object.entries(connection.client_execution).map(([key, value]) =>
            typeof value === "string" ? (
              <div key={key}>
                <dt>
                  {(
                    {
                      role: guideText("mpls.connection.mplsconnectionhelp.003"),
                      bridge: guideText("mpls.connection.mplsconnectionhelp.004"),
                      host: guideText("mpls.connection.mplsconnectionhelp.005"),
                      observer: guideText("mpls.connection.mplsconnectionhelp.006"),
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
          <h3>{guideText("mpls.connection.mplsconnectionhelp.007")}</h3>
          <p>{guideText("mpls.connection.mplsconnectionhelp.008")}<code>{guideText("mpls.connection.mplsconnectionhelp.009")}</code>{guideText("mpls.connection.mplsconnectionhelp.010")}</p>
          {e.requires?.length ? (
            <ul>
              {e.requires.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : null}
          {[
            [forward, guideText("mpls.connection.mplsconnectionhelp.011")],
            [peer, guideText("mpls.connection.mplsconnectionhelp.012")],
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
              <p key={label!}>{guideText("mpls.connection.mplsconnectionhelp.013")}</p>
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
        <p>{guideText("mpls.connection.mplsconnectionhelp.014")}</p>
      )}
      <p>{guideText("mpls.connection.mplsconnectionhelp.015")}</p>
    </section>
  );
}
