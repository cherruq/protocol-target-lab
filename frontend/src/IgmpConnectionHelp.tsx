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
          <p>命令数组不可用，请核对管理服务版本；不会猜测或自动执行。</p>
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
      <strong>内核成员与实际查询对端</strong>
      {connection?.client_execution && (
        <dl>
          {Object.entries({
            role: "测试角色",
            bridge: "隔离软件二层",
            host: "既有接口 / 外部客户端",
            observer: "私有只读观察",
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
          <h3>对端专属kernel VXLAN helper（仅复制，不执行）</h3>
          <p>
            以下是已对调角色的typed spec，必须在实际对端由root执行，并将
            <code>&lt;peer-underlay-interface&gt;</code>
            替换为对端本机真实接口；不能复制目标underlay名或假装Web已SSH创建。命令只管理有归属的新设备，不改旧接口/路由/防火墙。承载UDP不是IGMP端口。
          </p>
          {helper.requires?.length ? (
            <ul>
              {helper.requires.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : null}
          <details>
            <summary>查看对端helper结构化参数</summary>
            <pre className="protocol-wire">
              {boundedWireSummary(helper.spec).text}
            </pre>
          </details>
          {command(helper.start_argv, "复制对端helper start")}
          {command(helper.status_argv, "复制对端helper status")}
          {command(helper.stop_argv, "复制对端helper stop")}
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
          <h3>外部同镜像Query客户端模板</h3>
          <p>
            先用<code>plabctl runtime igmp</code>核对实际kernel、source
            IPv4/MAC、CID/image/boot/runtime。明确替换所有source身份和客户端本机接口/IP占位，SSH目标是管理服务器；只读转发不承载IGMP数据。测试端不IP加入目标组，避免抑制目标报告。执行后再核源身份并精确清理自有forward/helper。
          </p>
          {external.requires?.length ? (
            <ul>
              {external.requires.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : null}
          {command(external.observer_forward, "复制IGMP只读转发模板")}
          {command(external.argv, "复制外部IGMP客户端模板")}
          {external.notes?.length ? (
            <ul>
              {external.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p>
          当前配置不提供虚构的外部host命令。默认bridge可用上方一次性客户端；其他link是否可内置测试由真实peer接口/helper预检决定，不自动猜测或SSH。
        </p>
      )}
      <p>
        目标是持久内核成员，不是raw报告或ACK服务。General
        Query发往224.0.0.1、Report发往成员组；Group-specific只验证第一applied组。每轮12秒/global90秒，startup/测试前候选Report不冒作本轮响应。停止只释放本工作台引用，不承诺共享host整体离组。
      </p>
    </section>
  );
}
