SHELL := /bin/bash
.DEFAULT_GOAL := help
OFFLINE ?= 0
TARGET ?= ubuntu24.04
ARCH ?= amd64
SCENARIO ?= http-basic
TARGET_ADDR ?= 127.0.0.1
TARGET_PORT ?= 18090
RESPONSE_LENGTH ?= 64
RESPONSE_MODE ?= fixed
export OFFLINE TARGET ARCH SCENARIO TARGET_ADDR TARGET_PORT RESPONSE_LENGTH RESPONSE_MODE DNS_CONFIG_FILE DNS_TRANSPORT DNS_NAME
ifneq ($(origin RESPONSE_BODY),undefined)
export RESPONSE_BODY
endif

.PHONY: fetch-iec101-deps iec101-images iec101-assets fetch-dlt645-deps dlt645-images dlt645-assets fetch-rtcp-deps rtcp-images rtcp-assets fetch-rtp-deps rtp-images rtp-assets fetch-mqtt-sn-deps mqtt-sn-images mqtt-sn-assets fetch-iec104-deps iec104-images iec104-assets fetch-telnet-deps telnet-images telnet-assets fetch-mqtt-deps mqtt-images mqtt-assets fetch-dns-deps dns-images dns-assets licenses help fetch-deps verify-deps build build-ubuntu24 images assets deb smoke test
help:
	@printf '%s\n' 'Protocol Target Lab — HTTP, DNS, MQTT, Telnet, IEC104, MQTT-SN, RTP, RTCP, DL/T645 and IEC101' 'make fetch-deps   prepare locked Cargo/npm packages and the public HTTP base image' 'make verify-deps  check the prepared caches and base image' 'make build       build Web, then the native Rust manager' 'make build-ubuntu24  build Web, then Rust in the supported Ubuntu baseline' 'make images      build the HTTP image from the locked local base' 'make deb         package a Ubuntu 24.04-compatible binary (PLAB_BINARY=...)' 'make smoke SCENARIO=http-basic TARGET_ADDR=... TARGET_PORT=...' 'make test        worker/helper Python, Rust and frontend checks' 'OFFLINE=1        disallow Cargo/npm/build-container network access'

fetch-deps:
	./scripts/fetch-deps.sh
verify-deps:
	./scripts/verify-deps.sh
build:
	./scripts/build.sh
build-ubuntu24:
	./scripts/build-ubuntu24.sh
images:
	./scripts/images.sh
assets:
	./scripts/export-http-assets.sh
deb:
	./scripts/package-deb.sh
smoke:
	./scripts/smoke.sh
licenses:
	python3 scripts/collect-third-party-licenses.py

test:
	python3 -B -m unittest discover -s workers/iec101 -p 'test_*.py'
	python3 -B -m unittest discover -s client-tools -p 'test_*.py'
	python3 -B -m unittest discover -s workers/dlt645 -p 'test_*.py'
	python3 -B -m unittest discover -s workers/rtcp -p 'test_*.py'
	python3 -B -m unittest discover -s workers/rtp -p 'test_*.py'
	python3 -B -m unittest discover -s workers/mqtt-sn -p 'test_*.py'
	python3 -B -m unittest discover -s workers/iec104 -p 'test_*.py'
	python3 -B -m unittest discover -s workers/telnet -p 'test_*.py'
	python3 -B -m unittest discover -s workers/mqtt -p 'test_*.py'
	python3 -B -m unittest discover -s workers/dns -p 'test_*.py'
	python3 scripts/collect-third-party-licenses.py --check
	cd frontend && npm test && npm run typecheck && npm run build
	cargo fmt --all -- --check
	cargo test --locked

# DNS has an explicit source/compiler preparation step; builds use local inputs.
fetch-dns-deps:
	./scripts/dns-fetch-deps.sh
dns-images:
	./scripts/dns-images.sh
dns-assets:
	./scripts/dns-assets.sh

fetch-mqtt-deps:
	./scripts/mqtt-fetch-deps.sh
mqtt-images:
	./scripts/mqtt-images.sh
mqtt-assets:
	./scripts/mqtt-assets.sh

fetch-telnet-deps:
	./scripts/telnet-fetch-deps.sh
telnet-images:
	./scripts/telnet-images.sh
telnet-assets:
	./scripts/telnet-assets.sh

fetch-iec104-deps:
	./scripts/iec104-fetch-deps.sh
iec104-images:
	./scripts/iec104-images.sh
iec104-assets:
	./scripts/iec104-assets.sh

fetch-mqtt-sn-deps:
	./scripts/mqtt-sn-fetch-deps.sh
mqtt-sn-images:
	./scripts/mqtt-sn-images.sh
mqtt-sn-assets:
	./scripts/mqtt-sn-assets.sh

rtp-images:
	./scripts/rtp-images.sh
rtp-assets:
	./scripts/rtp-assets.sh

fetch-rtp-deps:
	./scripts/rtp-fetch-deps.sh

fetch-rtcp-deps:
	./scripts/rtcp-fetch-deps.sh
rtcp-images:
	./scripts/rtcp-images.sh
rtcp-assets:
	./scripts/rtcp-assets.sh

fetch-dlt645-deps:
	./scripts/dlt645-fetch-deps.sh
dlt645-images:
	./scripts/dlt645-images.sh
dlt645-assets:
	./scripts/dlt645-assets.sh

fetch-iec101-deps:
	./scripts/iec101-fetch-deps.sh
iec101-images:
	./scripts/iec101-images.sh
iec101-assets:
	./scripts/iec101-assets.sh
