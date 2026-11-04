# cs104-incremental-length-read-v1

This is an original project compatibility correction to the lib60870 source
bundled in c104 2.2.1, not an upstream backport. The official archive and wheel
remain unchanged for provenance and regression reproduction. The distributed
runtime wheel is rebuilt from that archive with this explicit patch.

A nonblocking socket may deliver the IEC104 start byte 0x68 separately from its
length byte. The original receiveMessage function treats a temporary no-data
result while reading the length as a connection error. A complete TESTFR works,
but a valid TESTFR split after its first byte disconnects. Splits after the
length byte and coalesced frames work. This is independently reproducible with
ordinary socket writes; it is not an application acknowledgement issue.

The minimal change stores recvBufPos=1 and returns pending when readLength==0.
A negative read result still resets/disconnects. All other native APCI/ASDU,
sequence, timing, command and confirmation behavior is preserved. In the
bundled Linux HAL, Socket_read maps EAGAIN to zero and EOF/error to negative.
No Python stream proxy, fabricated ACK, or changed TCP packet boundaries hide
the issue. Source/result/patch SHA-256 and exact target path are in source.json.

After extracting c104-2.2.1.tar.gz, run:

    python3 patches/apply.py /path/to/c104-2.2.1

The application script validates the original file hash, patch hash, exact
unified-diff context and final source hash. It fails closed on source drift or
repeat application. The complete archive, patch, application recipe, native
licenses and original worker sources accompany both the image and assets.
The correction retains the native source GPL-3.0-or-later license.
