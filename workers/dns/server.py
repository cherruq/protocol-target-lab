#!/usr/bin/env python3
"""Validate public workspace configuration, then exec the real dnsmasq process."""
import argparse
import json
import os
import sys
from dns_wire import validate_config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config-json", required=True)
    args = parser.parse_args()
    try:
        config = validate_config(json.loads(args.config_json))
        command = ["/usr/local/sbin/dnsmasq", "--conf-file=/dev/null", "--keep-in-foreground", "--port=15353", "--no-resolv", "--no-hosts", "--local=/#/", "--cache-size=0", "--log-queries=extra", "--log-facility=-", "--pid-file=", "--edns-packet-max=1232"]
        for record in config["records"]:
            command.append("--host-record={name},{value},{ttl}".format(**record))
        print(json.dumps(dict(event="dnsmasq_exec", implementation="dnsmasq", version="2.90", internal_port=15353, config=config), separators=(",", ":")), flush=True)
        os.execv(command[0], command)
    except (ValueError, TypeError, OSError) as exc:
        print(json.dumps(dict(event="configuration_error", error=str(exc)[:1024])), file=sys.stderr, flush=True)
        return 2


if __name__ == "__main__":
    sys.exit(main())
