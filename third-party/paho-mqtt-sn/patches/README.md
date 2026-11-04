# Native REGISTER capacity correction

This original project patch is not an upstream backport. The unmodified pinned
Paho gateway dereferences the null return of `Topics::add` on its 51st distinct
normal REGISTER in a CleanSession, crashing the complete gateway. The patch
changes only `handleRegister`: preserve the existing table and use its native
REGACK construction and send queue to return TopicId 0, the original MsgId and
congestion return code 0x01 when insertion returns null. Successful insertion
retains the original accepted response. It does not enlarge or clear the table,
change identity lookup, or synthesize responses in Python.

`source.json` records the exact official source URL and original-file, patch
and result SHA-256. `python3 apply.py EXTRACTED_PAHO_ROOT` validates all three
hashes and unified-diff context before writing. A different or already patched
source is rejected. The original source archive and its notices are retained;
the edited native file retains its original dual-license/copyright header.

The image exposes capability
`io.protocol-target-lab.mqtt-sn-register-capacity=bounded-v1` and builds the
patched native source offline. The original 0.1.0 candidate remains a recorded
counterexample and is not the deployable image.
