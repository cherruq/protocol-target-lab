import type { RtcpConfig } from "./rtcp-config";

export default function RtcpConfigForm({
  config,
  onChange,
  disabled,
}: {
  config: RtcpConfig;
  onChange: (config: RtcpConfig) => void;
  disabled: boolean;
}) {
  return (
    <>
      <div className="protocol-binding-note">
        <strong>固定接收 profile</strong>
        <p>
          <code>sr-sdes</code>：compound 首子包为 SR（PT200），仅接收 SR /
          SDES（PT202），并要求匹配主 SR SSRC 的非空 UTF-8 CNAME。整个 compound
          验证通过后才记录接收。
        </p>
        <p>
          RR、BYE、APP、feedback 和 reduced-size RTCP 不在本实验 profile
          内；不表示这些格式不属于 RTCP。
        </p>
      </div>
      <div className="field-row">
        <label htmlFor="rtcp-bind">
          绑定地址
          <input
            id="rtcp-bind"
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
        <label htmlFor="rtcp-port">
          UDP 端口
          <input
            id="rtcp-port"
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
      <label htmlFor="rtcp-packet-size">
        最大数据报容量（字节）
        <input
          id="rtcp-packet-size"
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
          64～65507 字节，按完整 UDP 载荷容量计算。RTCP
          数据报须四字节对齐，因此容量设为 65507 时，最大合法报文为 65504
          字节；65507 仍是合法容量输入。
        </span>
      </label>
      <div className="response-description">
        <p>
          独立接收并结构观察 RTCPv2 SR+SDES，不依赖 RTP 工作台运行，不发送 RR 或
          ACK，不解码或播放媒体。
        </p>
        <p>
          发送者在 SR 中声明的 packet / octet count
          与本接收器实际收到的数据报数分别记录；不据此推算网络丢包率、抖动或时间同步质量。NTP
          时间以两个 32 位字和精确 ntp64_hex 展示，不转换为 JavaScript 64
          位数值。
        </p>
        <p>
          内置测试通过受管接收容器的私有只读观察器核对新鲜接收事件与完整哈希；观察器不对外发布，也不是
          RTCP 线上的回复。保存后需显式运行或重启才会应用。
        </p>
      </div>
    </>
  );
}
