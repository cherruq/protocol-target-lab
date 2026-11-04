#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
version=${VERSION:-0.12.0}
architecture=${ARCH:-amd64}
[[ $architecture == amd64 ]] || { printf '%s\n' 'Phase 1 supports amd64 only.' >&2; exit 2; }
dpkg --validate-version "$version"
# Packaging is offline and must not silently ship stale/missing legal notices.
if ! sha256sum --check --quiet third-party/license-inputs.sha256; then
    printf '%s\n' 'Third-party notices are missing or stale. Prepare dependencies, run make licenses, and review the inventory.' >&2
    exit 1
fi
binary=${PLAB_BINARY:-${BINARY:-$project_root/target/release/protocol-target-lab}}
binary=$(realpath "$binary")
[[ -x $binary ]] || { printf '%s\n' "Missing executable: $binary. Run make build or set PLAB_BINARY." >&2; exit 1; }
for tool in readelf dpkg-shlibdeps dpkg-deb; do command -v "$tool" > /dev/null; done
readelf -h "$binary" | grep -q 'Advanced Micro Devices X86-64' || { printf '%s\n' 'The manager binary must target Linux amd64.' >&2; exit 1; }
max_glibc=$(readelf --version-info "$binary" | grep -oE 'GLIBC_[0-9][0-9.]*' | sed 's/GLIBC_//' | sort -Vu | tail -n 1)
if [[ -n $max_glibc ]] && ! dpkg --compare-versions "$max_glibc" le 2.39; then
    printf '%s\n' "Binary requires glibc $max_glibc; Ubuntu 24.04 provides 2.39. Build on the supported baseline and set PLAB_BINARY." >&2
    exit 1
fi
mkdir -p build dist
stage=$(mktemp -d "$project_root/build/deb.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
mkdir -p "$stage/debian"
cat > "$stage/debian/control" <<'CONTROL'
Source: protocol-target-lab
Section: net
Priority: optional
Maintainer: Protocol Target Lab contributors <maintainers@example.invalid>

Package: protocol-target-lab
Architecture: amd64
Description: Local protocol target management service
CONTROL
mkdir -p "$stage/root/DEBIAN" "$stage/root/usr/bin" "$stage/root/usr/lib/systemd/system" \
    "$stage/root/etc/default" "$stage/root/usr/share/doc/protocol-target-lab/docs"
install -m 0755 "$binary" "$stage/root/usr/bin/protocol-target-lab"
ln -s protocol-target-lab "$stage/root/usr/bin/plabctl"
install -m 0644 packaging/debian/protocol-target-lab.service "$stage/root/usr/lib/systemd/system/"
install -m 0644 packaging/debian/default "$stage/root/etc/default/protocol-target-lab"
install -m 0644 README.md LICENSE THIRD_PARTY_NOTICES THIRD_PARTY_LICENSES.txt "$stage/root/usr/share/doc/protocol-target-lab/"
install -m 0644 third-party/licenses.json "$stage/root/usr/share/doc/protocol-target-lab/third-party-licenses.json"
# Keep notices alongside the optional standalone binary distribution as well.
install -m 0644 LICENSE THIRD_PARTY_NOTICES THIRD_PARTY_LICENSES.txt "$project_root/dist/"
install -m 0644 third-party/licenses.json "$project_root/dist/third-party-licenses.json"
install -m 0644 docs/http.md docs/dns.md docs/dns-acceptance.md docs/mqtt.md docs/mqtt-acceptance.md docs/telnet.md docs/telnet-acceptance.md docs/iec104.md docs/iec104-acceptance.md docs/mqtt-sn.md docs/mqtt-sn-acceptance.md docs/rtp.md docs/rtp-acceptance.md docs/rtcp.md docs/rtcp-acceptance.md docs/cli.md docs/phase1-acceptance.md "$stage/root/usr/share/doc/protocol-target-lab/docs/"
for script in postinst prerm postrm; do install -m 0755 "packaging/debian/$script" "$stage/root/DEBIAN/$script"; done
shlibs=$(cd "$stage" && dpkg-shlibdeps -O -e"$stage/root/usr/bin/protocol-target-lab")
shlibs=${shlibs#shlibs:Depends=}
# Reject an unexpanded debhelper placeholder rather than shipping it literally.
# shellcheck disable=SC2016
[[ -n $shlibs && $shlibs != *'${'* ]] || { printf '%s\n' 'Could not resolve native library dependencies.' >&2; exit 1; }
cat > "$stage/root/DEBIAN/control" <<CONTROL
Package: protocol-target-lab
Version: $version
Section: net
Priority: optional
Architecture: $architecture
Maintainer: Protocol Target Lab contributors <maintainers@example.invalid>
Depends: $shlibs, docker.io, systemd, init-system-helpers
Description: Native protocol test target management service
 Rust management service with an embedded Web UI and Docker HTTP, DNS, MQTT, Telnet, IEC104 and MQTT-SN targets.
 Provides HTTP/DNS/MQTT/Telnet/IEC104/MQTT-SN configuration, lifecycle, live logs and disposable client tests.
CONTROL
printf '%s\n' '/etc/default/protocol-target-lab' > "$stage/root/DEBIAN/conffiles"
(cd "$stage/root" && find usr etc -type f -print0 | sort -z | xargs -0 md5sum) > "$stage/root/DEBIAN/md5sums"
output="$project_root/dist/protocol-target-lab_${version}_${architecture}.deb"
dpkg-deb --build --root-owner-group "$stage/root" "$output"
(cd "$project_root/dist" && sha256sum "$(basename -- "$output")") > "$output.sha256"
printf '%s\n' "Built $output" "Native dependencies: $shlibs"
