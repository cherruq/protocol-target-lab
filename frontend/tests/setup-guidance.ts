import { readFileSync } from "node:fs";
import { installGuidanceCatalog } from "../src/protocol-description.ts";
// Tests load the authoritative backend fixture; the production Web bundle does not import it.
installGuidanceCatalog({ ...JSON.parse(readFileSync(new URL("../../backend/descriptions/zh-CN.json", import.meta.url), "utf8")), manager_version: "test-fixture" });
