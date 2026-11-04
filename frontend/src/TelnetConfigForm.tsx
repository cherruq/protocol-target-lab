import { bannerByteLength, type TelnetConfig } from "./telnet-config";

export default function TelnetConfigForm({
  config,
  onChange,
  disabled,
}: {
  config: TelnetConfig;
  onChange: (config: TelnetConfig) => void;
  disabled: boolean;
}) {
  return (
    <>
      <div className="field-row">
        <label htmlFor="telnet-bind">
          绑定地址
          <input
            id="telnet-bind"
            value={config.bind_ip}
            onChange={(e) => onChange({ ...config, bind_ip: e.target.value })}
            required
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
          />
          <span className="field-help">0.0.0.0 表示全部 IPv4 接口</span>
        </label>
        <label htmlFor="telnet-port">
          TCP 端口
          <input
            id="telnet-port"
            type="number"
            min="1"
            max="65535"
            value={Number.isFinite(config.port) ? config.port : ""}
            onChange={(e) =>
              onChange({ ...config, port: e.currentTarget.valueAsNumber })
            }
            required
            disabled={disabled}
          />
        </label>
      </div>
      <label htmlFor="telnet-banner">
        欢迎语（Banner）
        <input
          id="telnet-banner"
          value={config.banner}
          onChange={(e) => onChange({ ...config, banner: e.target.value })}
          required
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
        />
        <span className="field-help">
          UTF-8 {bannerByteLength(config.banner)} / 256
          字节；单行非空文本，不能包含 ASCII 控制字符。
        </span>
      </label>
      <div className="field-row">
        <label htmlFor="telnet-connections">
          最大连接数
          <input
            id="telnet-connections"
            type="number"
            min="1"
            max="128"
            step="1"
            value={
              Number.isFinite(config.max_connections)
                ? config.max_connections
                : ""
            }
            onChange={(e) =>
              onChange({
                ...config,
                max_connections: e.currentTarget.valueAsNumber,
              })
            }
            required
            disabled={disabled}
          />
          <span className="field-help">1～128 个客户端连接</span>
        </label>
        <label htmlFor="telnet-line-bytes">
          最大输入行（字节）
          <input
            id="telnet-line-bytes"
            type="number"
            min="64"
            max="65536"
            step="1"
            value={
              Number.isFinite(config.max_line_bytes)
                ? config.max_line_bytes
                : ""
            }
            onChange={(e) =>
              onChange({
                ...config,
                max_line_bytes: e.currentTarget.valueAsNumber,
              })
            }
            required
            disabled={disabled}
          />
          <span className="field-help">
            64～65536 字节，去掉行尾 CRLF 后计数。
          </span>
        </label>
      </div>
      <div className="response-description">
        <p>
          使用 telnetlib3 4.0.3 进行真实 Telnet 协议协商，实验应用提供
          ECHO、INFO、CLOSE 命令；不提供系统登录或 shell。
        </p>
        <p>保存只修改配置；显式运行或重启后应用新的欢迎语与限制。</p>
      </div>
    </>
  );
}
