# Telnet dependency sources and licenses

The wheels and source distributions here were downloaded directly from public
PyPI release metadata and files.pythonhosted.org, not copied from a private
runtime. Exact source URLs, versions and SHA-256 values are recorded in
images/telnet/dependencies.lock.json. Runtime installation uses only the
hash-locked wheels, with no index or dependency resolution. No library patches
are applied.

- telnetlib3 4.0.3: ISC, copyright Jeff Quast and upstream contributors;
  full notice in telnetlib3/licenses/LICENSE.txt.
- wcwidth 0.6.0: MIT, copyright Jeff Quast and upstream contributors;
  full notice in wcwidth/licenses/LICENSE.
- telnetlib3 also distributes a lightly modified CPython 3.12 telnetlib backport
  and related tests, as identified in the files themselves. The full CPython
  license/history is included in telnetlib3/licenses/CPYTHON-LICENSE.txt,
  with the official v3.12.0 source URL and SHA-256 in cpython-source.json.

Both complete upstream source distributions, wheels, all the notices above,
and the exact build recipes are included in the runtime image under
/usr/share/doc/protocol-target-lab-telnet/ and in exported assets. Installed
.dist-info license files remain in the image as well. Preserve these notices
when redistributing. The original project wrapper and independent wire client
are covered by the root MIT license; the base image retains its own licenses.
