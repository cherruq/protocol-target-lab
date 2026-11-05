import {
  profinetNScenarios,
  profinetFScenarios,
  profinetScenarioLabels,
  type ProfinetConfig,
  type ProfinetIpSuite,
  type ProfinetNScenario,
  type ProfinetFScenario,
} from "./profinet-config";
export default function ProfinetConfigForm({
  config: c,
  onChange,
  disabled,
}: {
  config: ProfinetConfig;
  onChange: (c: ProfinetConfig) => void;
  disabled: boolean;
}) {
  const dcp = (delta: Partial<ProfinetConfig["dcp"]>) =>
    onChange({ ...c, dcp: { ...c.dcp, ...delta } });
  const text = (
    id: string,
    label: string,
    value: string,
    change: (v: string) => void,
    help: string,
    maxLength?: number,
  ) => (
    <label htmlFor={`profinet-${id}`} key={id}>
      {label}
      <input
        id={`profinet-${id}`}
        value={value}
        required
        maxLength={maxLength}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => change(e.target.value)}
      />
      <span className="field-help">{help}</span>
    </label>
  );
  return (
    <>
      <div className="protocol-binding-note">
        <strong>一个工作台 · 三个真实节点同时运行</strong>
        <p>
          DCP由原生p-net0.2.0处理；PTCP-N/F是独立软件节点，N固定Delay
          FF43、F固定FF41+FF42。二者都接纳单步Sync、Sync+FollowUp和Announce；没有单节点禁用或Delay模式二选一。
        </p>
        <p>
          仅新受管management/data二层网络；实际接口和外部工具接入见只读运行态/接入说明。DCP/PTCP没有应用端口或URL；不证明PLC循环IO、IRT、硬件同步精度或物理LED。
        </p>
      </div>
      {text(
        "peer-mac",
        "默认内置测试peer实际MAC",
        c.test_peer_mac,
        (v) => onChange({ ...c, test_peer_mac: v }),
        "与三个源MAC不同；不是源访问控制，合法外部工具可以使用自己的实际MAC。",
      )}
      <fieldset className="protocol-point" disabled={disabled}>
        <legend>DCP · 原生 p-net 0.2.0</legend>
        {text(
          "dcp-mac",
          "DCP数据接口实际MAC",
          c.dcp.mac,
          (v) => dcp({ mac: v }),
          "由独占数据接口实际使用；不把报文source覆盖值冒充网卡身份。",
        )}
        {text(
          "initial-name",
          "新存储初始站名",
          c.dcp.initial_station_name,
          (v) => dcp({ initial_station_name: v }),
          "小写ASCII标签/总≤240；仅新native-store初始化使用，不是实时站名编辑。",
          240,
        )}
        <div className="field-row">
          {(["ip", "netmask", "gateway"] as const).map((k) =>
            text(
              `initial-${k}`,
              {
                ip: "新存储初始IPv4",
                netmask: "初始子网掩码",
                gateway: "初始网关",
              }[k],
              c.dcp.initial_ip_suite[k],
              (v) =>
                dcp({
                  initial_ip_suite: {
                    ...c.dcp.initial_ip_suite,
                    [k]: v,
                  } as ProfinetIpSuite,
                }),
              k === "gateway"
                ? "0.0.0.0表示无数据默认路由；route存在不代表网关可达。"
                : "完整全零suite表示未配置；否则须符合native host/连续mask规则。",
            ),
          )}
        </div>
        <div className="test-config-notice">
          <strong>已有native存储优先，不会因保存或重启被清空</strong>
          <p>
            initial_*是初始化参数；当前native站名/IP、NV内存、文件持久化与实际OS应用在运行态分别显示。原生临时Set会清对应NV值，不能当作普通“保存草稿”。DCP
            ACK或Get新值不等于系统应用成功。
          </p>
        </div>
        <p className="field-help">
          固定DeviceID/Vendor/Role/Options由真实native读回，只读展示。运行恢复保留自有store，不提供清空存储来制造默认值的快捷按钮。
        </p>
      </fieldset>
      {(["ptcp_n", "ptcp_f"] as const).map((node) => {
        const n = c[node],
          f = node === "ptcp_f";
        return (
          <fieldset key={node} className="protocol-point" disabled={disabled}>
            <legend>
              {f
                ? "PTCP-F · Delay带FollowUp（FF41+FF42）"
                : "PTCP-N · Delay无FollowUp（FF43）"}
            </legend>
            {text(
              node + "-mac",
              "节点实际MAC",
              n.mac,
              (v) => onChange({ ...c, [node]: { ...n, mac: v } }),
              "三个源节点及测试peer的MAC全部不同；两PTCP节点始终并发。",
            )}
            <label htmlFor={`profinet-${node}-scenario`}>
              Delay输出场景
              <select
                id={`profinet-${node}-scenario`}
                value={n.scenario.mode}
                disabled={disabled}
                onChange={(e) =>
                  onChange(
                    f
                      ? {
                          ...c,
                          ptcp_f: {
                            ...c.ptcp_f,
                            scenario: {
                              mode: e.target.value as ProfinetFScenario,
                            },
                          },
                        }
                      : {
                          ...c,
                          ptcp_n: {
                            ...c.ptcp_n,
                            scenario: {
                              mode: e.target.value as ProfinetNScenario,
                            },
                          },
                        },
                  )
                }
              >
                {(f ? profinetFScenarios : profinetNScenarios).map((mode) => (
                  <option key={mode} value={mode}>
                    {profinetScenarioLabels[mode]}
                  </option>
                ))}
              </select>
            </label>
            {f && (
              <label htmlFor="profinet-truncated-size">
                FollowUp截断长度（字节，非活跃仍保存）
                <input
                  id="profinet-truncated-size"
                  type="number"
                  min={16}
                  max={45}
                  step={1}
                  required
                  disabled={
                    disabled || c.ptcp_f.scenario.mode !== "truncated-follow-up"
                  }
                  value={
                    Number.isFinite(c.ptcp_f.truncated_follow_up_size)
                      ? c.ptcp_f.truncated_follow_up_size
                      : ""
                  }
                  onChange={(e) =>
                    onChange({
                      ...c,
                      ptcp_f: {
                        ...c.ptcp_f,
                        truncated_follow_up_size: e.currentTarget.valueAsNumber,
                      },
                    })
                  }
                />
                <span className="field-help">
                  仅截断场景使用，其他场景保留原值并参与配置指纹；提交长度不保证物理线上不被补长。
                </span>
              </label>
            )}
            <p className="field-help">
              两节点都核验Sync/FollowUp配对与Announce。这里只改变本节点Delay故障输出，不同步宿主时钟、不提供线上同步ACK；软件时戳不是硬件同步精度。
            </p>
          </fieldset>
        );
      })}
      <p className="field-help">
        保存只改完整启动配置草稿，不发送DCP
        Set、不自动应用。显式运行/重启后PTCP/MAC参数生效，已有native存储仍优先于初始DCP参数。
      </p>
    </>
  );
}
