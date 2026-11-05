import {
  changeIgmpLink,
  type IgmpConfig,
  type IgmpLinkDrafts,
  type IgmpLinkMode,
  type IgmpVxlanLink,
} from "./igmp-config";
export default function IgmpConfigForm({
  config,
  linkDrafts,
  onLinkDrafts,
  onChange,
  disabled,
}: {
  config: IgmpConfig;
  linkDrafts: IgmpLinkDrafts;
  onLinkDrafts: (d: IgmpLinkDrafts) => void;
  onChange: (c: IgmpConfig) => void;
  disabled: boolean;
}) {
  const l = config.link;
  const text = (
    key: string,
    label: string,
    value: string,
    change: (v: string) => void,
    help: string,
  ) => (
    <label key={key} htmlFor={`igmp-${key}`}>
      {label}
      <input
        id={`igmp-${key}`}
        value={value}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => change(e.target.value)}
      />
      <span className="field-help">{help}</span>
    </label>
  );
  const vxlan = (patch: Partial<IgmpVxlanLink>) => {
    if (l.mode === "owned-vxlan")
      onChange({ ...config, link: { ...l, ...patch } });
  };
  function move(index: number, direction: number) {
    const groups = [...config.groups];
    [groups[index], groups[index + direction]] = [
      groups[index + direction],
      groups[index],
    ];
    onChange({ ...config, groups });
  }
  return (
    <>
      <div className="protocol-binding-note">
        <strong>持续Linux内核组成员</strong>
        <p>
          worker仅保持IP_ADD_MEMBERSHIP引用并只读观察，Report由实际Linux内核产生；不手写raw
          Report或ACK。运行/成员引用保持不等于该轮查询成功；IGMP没有应用TCP/UDP端口或连接Up。
        </p>
      </div>
      <label htmlFor="igmp-link">
        二层链路
        <select
          id="igmp-link"
          disabled={disabled}
          value={l.mode}
          onChange={(e) => {
            const result = changeIgmpLink(
              config,
              e.target.value as IgmpLinkMode,
              linkDrafts,
            );
            onLinkDrafts(result.cache);
            onChange(result.config);
          }}
        >
          <option value="docker-bridge">受管隔离内部bridge（默认）</option>
          <option value="host-interface">
            既有宿主Ethernet接口（只读参数预检）
          </option>
          <option value="owned-vxlan">本工作台专属kernel VXLAN</option>
        </select>
        <span className="field-help">
          各链路编辑在当前页面缓存；保存完整替换所选link分支，刷新后不保留未保存或非活跃link编辑，不声称三种link都持久保存。
        </span>
      </label>
      {l.mode === "docker-bridge" ? (
        <p className="field-help">
          创建独立internal网络，源和一次性peer为两个真实veth。接口/IP/MAC从实际endpoint派生，不能在这里造role
          IP或虚假端口。force2仅用于新建netns专属接口；容器仍使用宿主Linux内核。软件L2不等于物理组播链路。
        </p>
      ) : l.mode === "host-interface" ? (
        <>
          <div className="field-row">
            {text(
              "interface",
              "目标既有接口名",
              l.interface,
              (v) => onChange({ ...config, link: { ...l, interface: v } }),
              "实际UP Ethernet，恰好一个primary IPv4；不猜接口、不修改IP/MAC/路由或sysctl。",
            )}
            {text(
              "interface-ip",
              "目标实际primary IPv4",
              l.interface_ip,
              (v) => onChange({ ...config, link: { ...l, interface_ip: v } }),
              "必须已分配给该接口且没有secondary/多地址歧义；不是实验role IP。",
            )}
          </div>
          {text(
            "peer-interface",
            "本机测试端既有接口（可选）",
            l.peer_interface ?? "",
            (v) =>
              onChange({
                ...config,
                link: { ...l, peer_interface: v === "" ? null : v },
              }),
            "必须是同一管理宿主机上的不同真实UP Ethernet/单IPv4接口；留空=null，仅提供外部客户端命令，内置测试不可用，不自动发现peer。",
          )}
          <p className="field-help">
            host actual force只读：0为自动兼容；2仍可能因v1
            Query回退v1。不会为了通过测试写物理接口或global/default。外部peer使用其自己的实际接口名，Web不会SSH配置对端。
          </p>
        </>
      ) : (
        <>
          <div className="protocol-binding-note">
            <strong>仅管理本项目新建的专属设备</strong>
            <p>
              root helper按明确归属创建/接管/停止新的kernel
              VXLAN，只有新设备写force2；不是既有有限ARP-VXLAN工作台，也不改旧manual资源。外层接口/IP需填写真实环境，内层默认值仅为实验示例。
            </p>
          </div>
          {text(
            "outer-interface",
            "本机外层实际接口",
            l.outer_interface,
            (v) => vxlan({ outer_interface: v }),
            "只读预检UP、实际地址归属与MTU；不自动创建underlay或修改路由。",
          )}
          <div className="field-row">
            {text(
              "local-outer-ip",
              "本机外层实际IPv4",
              l.local_outer_ip,
              (v) => vxlan({ local_outer_ip: v }),
              "须已分配给指定underlay；此处允许已存在secondary，和host成员模式规则不同。",
            )}
            {text(
              "peer-outer-ip",
              "对端外层实际IPv4",
              l.peer_outer_ip,
              (v) => vxlan({ peer_outer_ip: v }),
              "须与本地不同；route检查不等于远端已连通。",
            )}
          </div>
          <div className="field-row">
            {(["vni", "udp_port", "mtu"] as const).map((key) => (
              <label key={key} htmlFor={`igmp-${key}`}>
                {key === "vni"
                  ? "VXLAN VNI（非零）"
                  : key === "udp_port"
                    ? "VXLAN承载UDP端口（非IGMP端口）"
                    : "VXLAN MTU"}
                <input
                  id={`igmp-${key}`}
                  type="number"
                  min={key === "vni" ? 1 : key === "udp_port" ? 1024 : 576}
                  max={
                    key === "vni" ? 16777215 : key === "udp_port" ? 65535 : 9000
                  }
                  step={1}
                  disabled={disabled}
                  value={Number.isFinite(l[key]) ? l[key] : ""}
                  onChange={(e) =>
                    vxlan({ [key]: e.currentTarget.valueAsNumber })
                  }
                />
              </label>
            ))}
          </div>
          <span className="field-help">
            MTU还须≤实际underlay
            MTU-50。承载UDP是overlay依赖，不是IGMP业务socket；不生成udp://IGMP入口。
          </span>
          <div className="field-row">
            {text(
              "local-inner-cidr",
              "目标新设备内层IPv4/CIDR",
              l.local_inner_cidr,
              (v) => vxlan({ local_inner_cidr: v }),
              "前缀/16～/30，可用主机地址；helper仅在本工作台新接口设置，检查无外部地址/路由冲突。",
            )}
            {text(
              "peer-inner-ip",
              "对端内层IPv4",
              l.peer_inner_ip,
              (v) => vxlan({ peer_inner_ip: v }),
              "同前缀不同可用主机地址，不与任一外层地址相同。",
            )}
          </div>
          <div className="field-row">
            {text(
              "local-inner-mac",
              "目标新设备内层MAC",
              l.local_inner_mac,
              (v) => vxlan({ local_inner_mac: v }),
              "实际赋给新专属设备的非零单播MAC，保存小写。",
            )}
            {text(
              "peer-inner-mac",
              "对端新设备内层MAC",
              l.peer_inner_mac,
              (v) => vxlan({ peer_inner_mac: v }),
              "不同的非零单播MAC；对端helper需用户在对端明确执行，不复制目标underlay名。",
            )}
          </div>
          <p className="field-help">
            相同link仅改groups可复用设备。改变核心链路后显式重启可能进入commit/rollback；OS失败会报告实际恢复结果，不能承诺旧PID/boot永远不变。Web不自动SSH或启动远端helper。
          </p>
        </>
      )}
      <div className="dns-record-heading">
        <h3>内核成员组（{config.groups.length}/16）</h3>
        <button
          type="button"
          className="button"
          disabled={disabled || config.groups.length >= 16}
          onClick={() =>
            onChange({ ...config, groups: [...config.groups, ""] })
          }
        >
          添加成员组
        </button>
      </div>
      <p className="field-help">
        仅239/8标准IPv4，1～16个唯一组，顺序保留。General
        Query每轮验证全部applied组；Group-specific两轮仅第一组。不同L3组不可因映射到相同L2
        MAC而合并覆盖统计。
      </p>
      {config.groups.map((g, index) => (
        <div className="field-row" key={index}>
          {text(
            `group-${index}`,
            `成员组 ${index + 1}${index === 0 ? "（首组 / Group-specific目标）" : ""}`,
            g,
            (v) =>
              onChange({
                ...config,
                groups: config.groups.map((x, i) => (i === index ? v : x)),
              }),
            "保存不立即改变内核成员；运行/重启才应用。",
          )}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              alignItems: "center",
            }}
          >
            <button
              type="button"
              className="button"
              disabled={disabled || index === 0}
              onClick={() => move(index, -1)}
            >
              上移组 {index + 1}
            </button>
            <button
              type="button"
              className="button"
              disabled={disabled || index === config.groups.length - 1}
              onClick={() => move(index, 1)}
            >
              下移组 {index + 1}
            </button>
            <button
              type="button"
              className="button"
              disabled={disabled || config.groups.length <= 1}
              onClick={() =>
                onChange({
                  ...config,
                  groups: config.groups.filter((_, i) => i !== index),
                })
              }
            >
              移除成员组 {index + 1}
            </button>
          </div>
        </div>
      ))}
      <div className="response-description">
        <strong>固定查询验收profile：v2 / MRT100 = 10秒</strong>
        <p>
          这是客户端发出的Query及期望Report
          profile，不是worker生成回复的选择器。每轮保留12秒随机响应窗口，含保守暖机的整个测试上限90秒；缺报告不会2秒提前判失败。
        </p>
        <p>
          暖机根据join时if/all force、sysctl
          QRV、interval与年龄计算保守上界；auto路径为未导出的learned
          mr_qrv保留最大7上界，不把sysctl或上界叫实际effective
          QRV。其他成员引用或参数变化可能使查询测试不可用，内核成员服务仍可健康。
        </p>
        <p>
          Query、Report和检查组分别统计；测试前看到的Report不自动称为唯一unsolicited，更不能当本轮查询响应。没有wire事务ID/ACK，报告抑制和外部querier影响如实记录。
        </p>
      </div>
    </>
  );
}
