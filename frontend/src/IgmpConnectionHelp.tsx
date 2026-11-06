import { guideText } from "./protocol-description.ts";
import {
  quoteShellCommand,
  type ArpConnectionInfo,
} from "./arp-client-connection";
import { boundedWireSummary } from "./protocol-tests";
export type IgmpConnectionInfo = ArpConnectionInfo & {
  peer_helper?: {
    spec: Record<string, unknown>;
    start_argv: string[];
    status_argv: string[];
    stop_argv: string[];
    requires: string[];
    notes: string[];
  } | null;
};
function quote(v: unknown) {
  try {
    return Array.isArray(v) ? quoteShellCommand(v) : null;
  } catch {
    return null;
  }
}
export default function IgmpConnectionHelp({
  connection,
  onCopy,
}: {
  connection: IgmpConnectionInfo | null;
  onCopy: (s: string) => void | Promise<void>;
}) {
  const external = connection?.external_peer,
    helper = connection?.peer_helper;
  const command = (argv: unknown, label: string) => {
    const text = quote(argv);
    return (
      <div className="command" key={label}>
        {text ? (
          <>
            <code>{text}</code>
            <button
              type="button"
              className="button"
              onClick={() => void onCopy(text)}
            >
              {label}
            </button>
          </>
        ) : (
          <p>{guideText("igmp.connection.igmpconnectionhelp.001")}</p>
        )}
      </div>
    );
  };
  return (
    <section
      className="protocol-binding-note"
      style={{ gridColumn: "1 / -1", minWidth: 0 }}
      aria-label="IGMP 内核成员接入说明"
    >
      <strong>{guideText("igmp.connection.igmpconnectionhelp.002")}</strong>
      {connection?.client_execution && (
        <dl>
          {Object.entries({
            role: guideText("igmp.connection.igmpconnectionhelp.003"),
            bridge: guideText("igmp.connection.igmpconnectionhelp.004"),
            host: guideText("igmp.connection.igmpconnectionhelp.005"),
            observer: guideText("igmp.connection.igmpconnectionhelp.006"),
          }).map(
            ([key, label]) =>
              typeof connection.client_execution?.[
                key as keyof NonNullable<ArpConnectionInfo["client_execution"]>
              ] === "string" && (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>
                    {
                      connection.client_execution?.[
                        key as keyof NonNullable<
                          ArpConnectionInfo["client_execution"]
                        >
                      ]
                    }
                  </dd>
                </div>
              ),
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
      {helper && (
        <>
          <h3>{guideText("igmp.connection.igmpconnectionhelp.007")}</h3>
          <p>{guideText("igmp.connection.igmpconnectionhelp.008")}<code>{guideText("igmp.connection.igmpconnectionhelp.009")}</code>{guideText("igmp.connection.igmpconnectionhelp.010")}</p>
          {helper.requires?.length ? (
            <ul>
              {helper.requires.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : null}
          <details>
            <summary>{guideText("igmp.connection.igmpconnectionhelp.011")}</summary>
            <pre className="protocol-wire">
              {boundedWireSummary(helper.spec).text}
            </pre>
          </details>
          {command(helper.start_argv, guideText("igmp.connection.igmpconnectionhelp.012"))}
          {command(helper.status_argv, guideText("igmp.connection.igmpconnectionhelp.013"))}
          {command(helper.stop_argv, guideText("igmp.connection.igmpconnectionhelp.014"))}
          {helper.notes?.length ? (
            <ul>
              {helper.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      {external ? (
        <>
          <h3>{guideText("igmp.connection.igmpconnectionhelp.015")}</h3>
          <p>{guideText("igmp.connection.igmpconnectionhelp.016")}<code>{guideText("igmp.connection.igmpconnectionhelp.017")}</code>{guideText("igmp.connection.igmpconnectionhelp.018")}</p>
          {external.requires?.length ? (
            <ul>
              {external.requires.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : null}
          {command(external.observer_forward, guideText("igmp.connection.igmpconnectionhelp.019"))}
          {command(external.argv, guideText("igmp.connection.igmpconnectionhelp.020"))}
          {external.notes?.length ? (
            <ul>
              {external.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p>{guideText("igmp.connection.igmpconnectionhelp.021")}</p>
      )}
      <p>{guideText("igmp.connection.igmpconnectionhelp.022")}</p>
    </section>
  );
}
