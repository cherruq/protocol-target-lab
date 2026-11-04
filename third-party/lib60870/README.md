# lib60870-C source for the IEC101 workbench

The original public archive is fixed at commit `7a388e3e133999e1ca77ba7521d55d074b7cd2bc` of https://github.com/mz-automation/lib60870 (source version 2.4.1). `source.json` records URL, SHA256 and GPL-3.0-or-later license. The archive and full COPYING are distributed with the runtime and exported assets. No native library modifications are applied.

`workers/iec101/native_slave.c` is the corresponding GPL-3.0-or-later project wrapper. It uses the original SerialPort, unbalanced link layer, ASDU parser/queues and GI callbacks. The Python bridge and independent client are MIT. Prepare the compiler image explicitly online with `scripts/iec101-fetch-deps.sh`; `scripts/iec101-images.sh` verifies the source hash and compiles the static library and wrapper in a network-disabled build. The runtime has no compiler, TLS dependency, mounted physical serial device, or Python replacement slave.

The public archive includes upstream examples and test fixtures; those are upstream material, not local operator configuration. There is no claim that rebuilding produces an identical compiler output across toolchain versions. Retain the prepared build image, pinned base and source inputs for offline rebuilding. Base OS and CPython retain their own license/copyright materials.
