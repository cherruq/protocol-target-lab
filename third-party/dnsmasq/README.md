# dnsmasq 2.90 corresponding source

The unmodified upstream archive `dnsmasq-2.90.tar.xz` comes from
https://thekelleys.org.uk/dnsmasq/dnsmasq-2.90.tar.xz . Its SHA-256 is
`8e50309bd837bfec9649a812e066c09b6988b73d749b7d293c06c57d46a109e4`.
Copyright (c) 2000-2024 Simon Kelley and other upstream contributors.
Upstream offers GNU GPL version 2 or, at your option, version 3; both complete
license texts are reproduced from the archive as COPYING and COPYING-v3.

The archive contains the full corresponding source, Makefile, headers, and
upstream documentation. No dnsmasq source patches are applied. The exact build
flags and installation instructions are in images/dns/Dockerfile; the compiler
preparation recipe is images/dns/build.Dockerfile and input identities are in
images/dns/dependencies.lock.json. `scripts/dns-fetch-deps.sh` prepares the
compiler cache online; `scripts/dns-images.sh` compiles without network access.

The runtime image contains this directory and both build recipes under
/usr/share/doc/protocol-target-lab-dns/. The DNS asset exporter also includes
these materials. Anyone redistributing a copied image must keep the
corresponding source and license materials with that distribution. The Python
wrapper/client are original project code under the repository MIT license;
this does not relicense dnsmasq or the Python/Debian base-image components.
