import type { RtpConfig } from "./rtp-config";

export default function RtpConfigForm({
  config,
  onChange,
  disabled,
}: {
  config: RtpConfig;
  onChange: (config: RtpConfig) => void;
  disabled: boolean;
}) {
  return (
    <>
      <div className="field-row">
        <label htmlFor="rtp-bind">
          绑定地址
          <input
            id="rtp-bind"
            value={config.bind_ip}
            onChange={(e) => onChange({ ...config, bind_ip: e.target.value })}
            disabled={disabled}
            required
            autoComplete="off"
            spellCheck={false}
          />
          <span className="field-help">
            单播 IPv4；0.0.0.0 表示全部 IPv4 接口。
          </span>
        </label>
        <label htmlFor="rtp-port">
          UDP 端口
          <input
            id="rtp-port"
            type="number"
            min="1"
            max="65535"
            step="1"
            value={Number.isFinite(config.port) ? config.port : ""}
            onChange={(e) =>
              onChange({ ...config, port: e.currentTarget.valueAsNumber })
            }
            disabled={disabled}
            required
          />
        </label>
      </div>
      <label htmlFor="rtp-packet-size">
        最大数据报容量（字节）
        <input
          id="rtp-packet-size"
          type="number"
          min="64"
          max="65507"
          step="1"
          value={
            Number.isFinite(config.max_packet_size)
              ? config.max_packet_size
              : ""
          }
          onChange={(e) =>
            onChange({
              ...config,
              max_packet_size: e.currentTarget.valueAsNumber,
            })
          }
          disabled={disabled}
          required
        />
        <span className="field-help">
          64～65507 字节，按完整 UDP 载荷中的 RTP
          数据报计算，包含头部、CSRC、扩展、载荷和填充。64
          是可配置的容量下限，并非 RTP 报文最小长度。
        </span>
      </label>
      <div className="response-description">
        <p>
          接收并结构解析 RTPv2 UDP
          数据报，载荷按原始字节记录；不解码或播放媒体，不发送 RTP ACK。
        </p>
        <p>
          内置测试发送真实数据报，并从受管接收容器的私有只读观察器核对新鲜接收记录、实际字段和完整哈希。观察器不对外发布，不提供可编辑地址；UDP
          发送成功本身不代表目标已接收。
        </p>
        <p>
          序号回绕、重复和来源计数仅表示本次实际观察，不据此保证网络顺序、计算丢包率或抖动。保存配置后需显式运行或重启才会应用。
        </p>
      </div>
    </>
  );
}
