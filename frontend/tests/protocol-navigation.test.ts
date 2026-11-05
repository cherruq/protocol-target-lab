import assert from "node:assert/strict";
import { test } from "node:test";
import { protocolNavigationItems } from "../src/protocol-navigation.ts";

test("navigation sorts display names without case and preserves the original catalog", () => {
  const protocols = [{ id: "z", name: "http" }, { id: "a", name: "BFD" }, { id: "b", name: "arp" }];
  assert.deepEqual(protocolNavigationItems(protocols, "").map((p) => p.name), ["arp", "BFD", "http"]);
  assert.equal(protocols[0].name, "http");
});
test("search accepts mixed-case names and protocol IDs, trims spaces and returns no matches", () => {
  const protocols = [{ id: "iec101", name: "IEC 101" }, { id: "dns", name: "DNS" }];
  assert.deepEqual(protocolNavigationItems(protocols, "  iEc101 "), [protocols[0]]);
  assert.deepEqual(protocolNavigationItems(protocols, "dNs"), [protocols[1]]);
  assert.deepEqual(protocolNavigationItems(protocols, "missing"), []);
  assert.equal(protocolNavigationItems(protocols, "   ").length, 2);
});
