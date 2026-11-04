# IEC104 public dependency sources

c104 2.2.1 is downloaded from the exact public PyPI release, not copied from an
installed private extension. Its official CPython 3.12 manylinux x86_64 wheel
and complete source distribution are hash-locked in
images/iec104/dependencies.lock.json. The original archive/wheel remain unchanged. Runtime applies the explicit
project compatibility correction in patches/ and uses the source-rebuilt wheel.

The c104 source distribution includes the corresponding lib60870-C, mbedtls,
and pybind11 source files and original licenses. The c104 CMake file identifies
lib60870-C 2.3.3 and the bundled mbedtls build_info identifies 3.6.3. It must
not be described as using a separately installed newer lib60870 release.

Licenses copied verbatim from the source distribution are under licenses/:
- c104: GNU GPL version 3, copyright Fraunhofer FIT and contributors.
- lib60870-C: GNU GPL version 3, copyright MZ Automation and contributors.
- mbedtls: Apache-2.0/GPL option as stated in the bundled upstream materials.
- pybind11: BSD-style license, copyright Wenzel Jakob and contributors.
The full source archive retains all additional original per-file notices.

setuptools 75.8.0 and wheel 0.45.1 wheels/sdists are separate build tools, not
runtime dependencies of the official native wheel. Their complete distributions
retain upstream license and vendored notices. Build recipes use the pinned
Python base, Debian compiler/CMake/make cache and these hash-locked tools.
The runtime Docker build rebuilds the patched c104 source with network disabled
and stores a rebuilt-wheel hash report plus generated installation hash lock.
Runtime installs that patched rebuilt wheel. The original official wheel is
kept solely for provenance/regression; rebuild is not claimed byte-identical.

The runtime image and exported assets carry all these archives/notices and the
exact recipes, plus the original worker sources. Preserve GPL corresponding
source and build/install information with redistribution; they must not exist
only in an ignored reference snapshot. Project source MIT notices do not
relicense the GPL native library. Base-image software retains its own licenses.
