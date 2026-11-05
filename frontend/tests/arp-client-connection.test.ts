import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import {
  quoteShellArg,
  quoteShellCommand,
} from "../src/arp-client-connection.ts";

test("ARP manual templates survive a real POSIX-shell argv roundtrip without expanding data", () => {
  const args = [
    "",
    "space value",
    "O'Reilly",
    '{"interface":"x\'y","nested":{"mode":"host-interface"}}',
    "line one\nline two",
    "$(exit 71)",
    "`exit 72`",
    "; exit 73 #",
    "<peer-interface>",
    "<target-ssh>",
    "<runtime.boot_id>",
    "<runtime.runtime_id>",
    "--config-json",
    "--method",
    "$HOME",
    "\\literal",
  ];
  const command = quoteShellCommand([
    process.execPath,
    "-e",
    "process.stdout.write(JSON.stringify(process.argv.slice(1)))",
    "--",
    ...args,
  ]);
  const output = spawnSync("/bin/sh", ["-c", command], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(output.status, 0, output.stderr);
  assert.deepEqual(JSON.parse(output.stdout), args);
});
test("ARP manual template quoting preserves empty args and rejects impossible NUL/non-string argv", () => {
  assert.equal(quoteShellArg(""), "''");
  assert.equal(quoteShellArg("safe"), "'safe'");
  assert.throws(() => quoteShellArg("bad\0arg"), /NUL/);
  assert.throws(() => quoteShellCommand([]), /非空/);
  assert.throws(
    () => quoteShellCommand([true] as unknown as string[]),
    /非字符串/,
  );
});
