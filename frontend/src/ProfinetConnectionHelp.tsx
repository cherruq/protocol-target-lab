import { guideText } from "./protocol-description.ts";
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
      <p key={key}>{guideText("profinet.connection.profinetconnectionhelp.001")}</p>
    );
  };
  return (
    <section
      className="protocol-binding-note"
      style={{ gridColumn: "1 / -1", minWidth: 0 }}
      aria-label="PROFINET 三节点二层接入说明"
    >
      <strong>{guideText("profinet.connection.profinetconnectionhelp.002")}</strong>
      <p>{guideText("profinet.connection.profinetconnectionhelp.003")}</p>
      {connection?.notes?.length ? (
        <ul>
          {connection.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}
      {connection?.access?.available ? (
        <>
          <h3>{guideText("profinet.connection.profinetconnectionhelp.004")}</h3>
          <pre className="protocol-wire">
            {boundedWireSummary(connection.access).text}
          </pre>
          <p>{guideText("profinet.connection.profinetconnectionhelp.005")}</p>
        </>
      ) : (
        <p>{guideText("profinet.connection.profinetconnectionhelp.006")}{connection?.access?.reason || guideText("profinet.connection.profinetconnectionhelp.007")}{guideText("profinet.connection.profinetconnectionhelp.008")}</p>
      )}
      {external && (
        <>
          <h3>{guideText("profinet.connection.profinetconnectionhelp.009")}</h3>
          <p>{guideText("profinet.connection.profinetconnectionhelp.010")}</p>
          {external.requires?.length ? (
            <ul>
              {external.requires.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : null}
          {command(external.argv, guideText("profinet.connection.profinetconnectionhelp.011"), "external")}
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
          <h3>{guideText("profinet.connection.profinetconnectionhelp.012")}</h3>
          {connection.tool_commands.map((c, i) =>
            command(c.argv, "复制 " + c.label, "tool" + i),
          )}
          <p>{guideText("profinet.connection.profinetconnectionhelp.013")}</p>
        </>
      ) : null}
      {connection?.nodes && (
        <details>
          <summary>{guideText("profinet.connection.profinetconnectionhelp.014")}</summary>
          <pre className="protocol-wire">
            {boundedWireSummary(connection.nodes).text}
          </pre>
        </details>
      )}
    </section>
  );
}
