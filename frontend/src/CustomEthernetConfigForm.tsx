import {
  customHexBytes,
  prepareCustomEthernetSave,
  type CustomEthernetConfig,
  type CustomEthernetDraft,
} from "./custom-ethernet-config";
function byteSummary(hex: string) {
  try {
    return `${customHexBytes(hex)} 字节`;
  } catch {
    return "尚非完整十六进制字节（草稿保留）";
  }
}
export default function CustomEthernetConfigForm({
  config,
  saved,
  disabled,
  onChange,
  interfaceDraft,
  onInterfaceDraft,
  onCopy,
}: {
  config: CustomEthernetDraft;
  saved: CustomEthernetConfig;
  disabled: boolean;
  onChange: (c: CustomEthernetDraft) => void;
  interfaceDraft: string;
  onInterfaceDraft: (s: string) => void;
  onCopy: (s: string) => void | Promise<void>;
}) {
  const r = config.response,
    p = r.payload;
  const payload = (next: Partial<typeof p>) =>
    onChange({ ...config, response: { ...r, payload: { ...p, ...next } } });
  const text = (
    id: string,
    label: string,
    value: string,
    change: (s: string) => void,
    help?: string,
  ) => (
    <label htmlFor={`custom-${id}`} key={id}>
      {label}
      <input
        id={`custom-${id}`}
        value={value}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => change(e.target.value)}
      />
      {help && <span className="field-help">{help}</span>}
    </label>
  );
  const hex = (
    id: string,
    label: string,
    value: string,
    change: (s: string) => void,
    help: string,
  ) => (
    <label htmlFor={`custom-${id}`}>
      {label}
      <textarea
        id={`custom-${id}`}
        rows={4}
        maxLength={131070}
        value={value}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => change(e.target.value)}
      />
      <span className="field-help">
        {byteSummary(value)} · {help}
      </span>
    </label>
  );
  let retained: string[] = [];
  try {
    retained = prepareCustomEthernetSave(config, saved).retained;
  } catch {
    /* active validation is shown on explicit save */
  }
  return (
    <>
      <div className="protocol-binding-note">
        <strong>被动固定响应端 · Ethernet II / 单802.1Q</strong>
        <p>
          每个实际内核过滤准入且匹配可选payload前缀的incoming请求，发送一条配置的固定响应。持续重复，无应用端口、连接Up、协议ACK、模板变量或多规则引擎。
        </p>
      </div>
      <label htmlFor="custom-link">
        二层链路
        <select
          id="custom-link"
          value={config.link.mode}
          disabled={disabled}
          onChange={(e) => {
            if (config.link.mode === "host-interface")
              onInterfaceDraft(config.link.interface);
            onChange({
              ...config,
              link:
                e.target.value === "docker-bridge"
                  ? { mode: "docker-bridge" }
                  : { mode: "host-interface", interface: interfaceDraft },
            });
          }}
        >
          <option value="docker-bridge">受管隔离内部 bridge（默认）</option>
          <option value="host-interface">现有宿主 Ethernet 接口</option>
        </select>
      </label>
      {config.link.mode === "host-interface" ? (
        text(
          "interface",
          "目标宿主机现有接口名",
          config.link.interface,
          (value) => {
            onInterfaceDraft(value);
            onChange({
              ...config,
              link: { mode: "host-interface", interface: value },
            });
          },
          "启动核对真实Ethernet及local_mac，不创建接口、不改全局MAC/IP/路由。内置客户端须有peer_mac对应的唯一不同真实接口；异机显式选择自己的接口。",
        )
      ) : (
        <p className="field-help">
          仅创建此工作台拥有的internal
          bridge，源与一次性客户端使用不同真实veth；编译探针是短时内部资源，不复用ARP网络，不代表物理LAN或交换机VLAN透传。
        </p>
      )}
      <p className="field-help">
        link使用完整分支替换：切换到bridge时接口编辑仅在当前页面保留，不写入bridge配置；响应两个bank则完整持久保存。
      </p>
      <div className="field-row">
        {text(
          "local-mac",
          "目标真实接口 MAC",
          config.local_mac,
          (v) => onChange({ ...config, local_mac: v }),
          "桥接由Docker赋给目标网卡；host必须与既有网卡一致。与发送源覆盖分开。",
        )}
        {text(
          "peer-mac",
          "客户端真实接口 MAC",
          config.peer_mac,
          (v) => onChange({ ...config, peer_mac: v }),
          "与目标不同的非零单播MAC；不强制成为接收过滤或响应目的。",
        )}
      </div>
      <div className="protocol-binding-note">
        <strong>独立内核接收过滤（BPF）</strong>
        <p>
          过滤器、测试fixture与响应头独立编辑。改变MAC、EtherType或VLAN不会重写表达式；运行前实际libpcap编译及内核安装失败会拒绝应用，不降级到用户态全量过滤。
        </p>
      </div>
      <label htmlFor="custom-filter">
        独立接收 BPF 表达式
        <textarea
          id="custom-filter"
          rows={3}
          value={config.packet_filter}
          disabled={disabled}
          spellCheck={false}
          onChange={(e) =>
            onChange({ ...config, packet_filter: e.target.value })
          }
        />
        <span className="field-help">
          保留原始文本，非空，最多2048 UTF-8字节；浏览器不伪造编译结果。
        </span>
      </label>
      <div className="response-description">
        <p>示例仅复制，不自动应用或覆盖。请替换实际测试端地址：</p>
        {[
          "ether proto 0x88b5",
          "ether src 02:00:00:00:02:10",
          "vlan 7 and ether proto 0x88b5",
        ].map((s, i) => (
          <div className="command" key={s}>
            <code>{s}</code>
            <button
              type="button"
              className="button"
              onClick={() => void onCopy(s)}
              aria-label={`复制BPF示例 ${i + 1}`}
            >
              复制
            </button>
          </div>
        ))}
      </div>
      {text(
        "marker",
        "可选请求 payload 前缀（十六进制）",
        config.request_marker_hex ?? "",
        (v) => onChange({ ...config, request_marker_hex: v }),
        "留空禁用；否则1～64字节，不含0x/空格。单VLAN按实际规范化payload起点检查，不是全帧固定偏移或子串搜索。",
      )}
      <label htmlFor="custom-response-mode">
        固定响应方式
        <select
          id="custom-response-mode"
          value={r.mode}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              ...config,
              response: { ...r, mode: e.target.value as "payload" | "frame" },
            })
          }
        >
          <option value="payload">构造头部 + 固定载荷</option>
          <option value="frame">完整固定原始帧</option>
        </select>
        <span className="field-help">
          两个bank、禁用VLAN及源覆盖值全部保存，跨保存/刷新/CLI保留；切换只改变选择器，不转换或改写另一bank。
        </span>
      </label>
      {retained.length > 0 && (
        <div className="test-error" role="status">
          仍有未保存的隐藏草稿：{retained.join("、")}
          。保存当前有效分支会提交这些字段最后一次服务端有效值；本地无效编辑继续保留，不能视为全部已保存。
        </div>
      )}
      {r.mode === "payload" ? (
        <>
          {text(
            "destination",
            "响应目的 MAC",
            p.destination_mac,
            (v) => payload({ destination_mac: v }),
            "非零完整6字节，允许单播、组播和广播；不会随peer_mac自动更改。",
          )}
          <label htmlFor="custom-source-mode">
            发送源 MAC 方式
            <select
              id="custom-source-mode"
              value={p.source_mac.mode}
              disabled={disabled}
              onChange={(e) =>
                payload({
                  source_mac: {
                    ...p.source_mac,
                    mode: e.target.value as "interface" | "override",
                  },
                })
              }
            >
              <option value="interface">使用实际接口 MAC</option>
              <option value="override">显式覆盖发送源 MAC</option>
            </select>
            <span className="field-help">
              当前接口身份：{config.local_mac}
              ；保存的覆盖值单独保留，不因此改变网卡MAC。
            </span>
          </label>
          {p.source_mac.mode === "override" &&
            text(
              "source-override",
              "发送源 MAC 覆盖值",
              p.source_mac.value,
              (v) => payload({ source_mac: { ...p.source_mac, value: v } }),
              "完整非零单播地址；这是报文源字段，不冒充实际接口身份。",
            )}
          {text(
            "ether-type",
            "构造响应 EtherType（十六进制）",
            typeof p.ether_type === "number"
              ? `0x${p.ether_type.toString(16)}`
              : p.ether_type,
            (v) => payload({ ether_type: v }),
            "范围0x0600～0xffff；禁止0x8100/0x88a8/0x9100，使用独立VLAN控件。",
          )}
          {hex(
            "payload",
            "固定响应载荷（十六进制）",
            p.payload_hex,
            (v) => payload({ payload_hex: v }),
            "允许0字节；默认64字节。完整帧普通头14字节、单VLAN头18字节，均不含FCS/前导码。",
          )}
          <label className="point-boolean">
            <input
              type="checkbox"
              checked={p.vlan.enabled}
              disabled={disabled}
              onChange={(e) =>
                payload({ vlan: { ...p.vlan, enabled: e.target.checked } })
              }
            />
            添加一个802.1Q VLAN标签
          </label>
          {p.vlan.enabled && (
            <div className="field-row">
              {(["vid", "pcp"] as const).map((k) => (
                <label key={k} htmlFor={`custom-${k}`}>
                  {k === "vid" ? "VLAN ID（0含优先级标签）" : "VLAN PCP"}
                  <input
                    id={`custom-${k}`}
                    type="number"
                    min={0}
                    max={k === "vid" ? 4094 : 7}
                    step={1}
                    value={Number.isFinite(p.vlan[k]) ? p.vlan[k] : ""}
                    disabled={disabled}
                    onChange={(e) =>
                      payload({
                        vlan: { ...p.vlan, [k]: e.currentTarget.valueAsNumber },
                      })
                    }
                  />
                </label>
              ))}
              <label className="point-boolean">
                <input
                  type="checkbox"
                  checked={p.vlan.dei}
                  disabled={disabled}
                  onChange={(e) =>
                    payload({ vlan: { ...p.vlan, dei: e.target.checked } })
                  }
                />
                VLAN DEI
              </label>
            </div>
          )}
          <p className="field-help">
            只描述报文标签，不创建VLAN子接口。接收过滤独立：接收VLAN7后发送不带标签帧可以是合法配置。VID0/TCI0仍是真实标签。
          </p>
          <p className="field-help">
            非活跃完整帧bank：{byteSummary(r.frame_hex)}，保留原始输入。
          </p>
        </>
      ) : (
        <>
          {hex(
            "frame",
            "完整固定响应帧（十六进制）",
            r.frame_hex,
            (v) => onChange({ ...config, response: { ...r, frame_hex: v } }),
            "14～65535字节，包含用户自己的Ethernet头；不会插入/删除MAC、VLAN或padding，不含FCS/前导码。",
          )}
          <p className="field-help">
            发送提交字节保持，不等于物理线上逐比特不变：驱动可能补齐，实际MTU/EMSGSIZE及peer收到长度分别验证。原始多层标签字节可opaque发送，不承诺多层接收/解析。
          </p>
          <p className="field-help">
            非活跃构造bank保留：载荷{byteSummary(p.payload_hex)}，VLAN
            {p.vlan.enabled ? "启用" : "禁用"}（VID{" "}
            {Number.isFinite(p.vlan.vid) ? p.vlan.vid : "未完成"}），发送源
            {p.source_mac.mode === "interface" ? "实际接口" : "覆盖"}。
          </p>
        </>
      )}
      <div className="protocol-binding-note">
        <strong>仅本socket成员资格</strong>
        <p>
          默认不启用混杂，不改全局promisc/allmulti；关闭源时释放此socket的组播/混杂引用。物理链路的VLAN/offload验证与隔离软件路径分开记录。
        </p>
      </div>
      <label className="point-boolean">
        <input
          type="checkbox"
          checked={config.promiscuous}
          disabled={disabled}
          onChange={(e) =>
            onChange({ ...config, promiscuous: e.target.checked })
          }
        />
        启用本socket混杂成员资格
      </label>
      <label htmlFor="custom-multicast">
        精确组播 MAC 列表（每行一个）
        <textarea
          id="custom-multicast"
          rows={3}
          value={
            typeof config.multicast_macs === "string"
              ? config.multicast_macs
              : config.multicast_macs.join("\n")
          }
          disabled={disabled}
          onChange={(e) =>
            onChange({ ...config, multicast_macs: e.target.value })
          }
        />
        <span className="field-help">
          最多16个不同组播MAC，排除广播；不会自动加入all-multicast。
        </span>
      </label>
      <div className="protocol-binding-note">
        <strong>当前配置的显式不透明测试请求</strong>
        <p>
          客户端主动发送此完整fixture，目标按独立BPF/前缀决定是否响应。任意BPF不保证匹配；失败诚实报告，不会偷偷更换过滤器、fixture或响应。默认ALL仅当前配置4组检查/8次交换，不等于完整release矩阵。
        </p>
      </div>
      {hex(
        "test-request",
        "测试请求完整帧（十六进制）",
        config.test_request.frame_hex,
        (v) => onChange({ ...config, test_request: { frame_hex: v } }),
        "14～65535字节；不会随MAC、EtherType、VLAN或响应模式自动同步，实际发送前核对客户端MTU。",
      )}
      <p className="field-help">
        运行前只对活跃响应检查真实MTU，两个bank仍须静态有效且完整帧≤65535字节。保存只更新草稿，显式运行/重启才应用完整快照（包含隐藏saved值）。
      </p>
    </>
  );
}
