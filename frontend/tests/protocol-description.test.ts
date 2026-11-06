import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { installGuidanceCatalog, guideText, lazyGuidanceLabels, loadGuidance, guidanceState } from "../src/protocol-description.ts";
import { profinetCaseLabels } from "../src/profinet-config.ts";
const catalog = () => ({ ...JSON.parse(readFileSync(new URL("../../backend/descriptions/zh-CN.json", import.meta.url), "utf8")), manager_version: "test-fixture" });

test("every Web guidance key resolves to the authoritative backend catalog", () => {
  const data = catalog(), ids = new Set(data.entries.map((e: {id:string}) => e.id));
  for (const file of readdirSync(new URL("../src/",import.meta.url)).filter((f) => /\.tsx?$/.test(f))) {
    const source = readFileSync(new URL("../src/"+file,import.meta.url),"utf8");
    for (const match of source.matchAll(/guideText\("([^"]+)"\)/g)) assert.ok(ids.has(match[1]),file+":"+match[1]);
  }
  for (const id of data.protocols)
    for (const section of ["overview","configuration","connection","verification"])
      assert.ok(data.entries.some((e: {protocols:string[],section:string}) => e.protocols.includes(id)&&e.section===section),id+"/"+section);
});
test("already imported labels follow backend edits; malformed catalogs cannot partially replace guidance", () => {
  const data = catalog(), entry=data.entries.find((e: {protocols:string[],choice?:{group:string,value:string}}) => e.protocols.includes("profinet")&&e.choice?.group==="case_labels"&&e.choice.value==="ALL");
  const original=profinetCaseLabels.ALL;
  try {
    entry.text="服务端修改的说明"; installGuidanceCatalog(data);
    assert.equal(profinetCaseLabels.ALL,entry.text);
    const lazy=lazyGuidanceLabels(()=>({all:guideText(entry.id)}));assert.equal(JSON.parse(JSON.stringify(lazy)).all,entry.text);
    assert.throws(()=>installGuidanceCatalog({...data,entries:[...data.entries,data.entries[0]]}));
    assert.equal(profinetCaseLabels.ALL,entry.text);
  } finally { installGuidanceCatalog(catalog()); }
  assert.equal(profinetCaseLabels.ALL,original);
});
test("manager upgrade rejects an old in-flight catalog and retries without a stale fallback", async () => {
  const previousFetch=globalThis.fetch;let finish!: (r:Response)=>void;
  try {
    globalThis.fetch=(()=>new Promise<Response>((resolve)=>{finish=resolve;})) as typeof fetch;
    const pending=loadGuidance("upgrade-1");const newer=loadGuidance("upgrade-2");
    assert.equal(guideText("nonexistent"),"说明暂不可用");
    finish(new Response(JSON.stringify({...catalog(),manager_version:"upgrade-1"}),{status:200}));
    await assert.rejects(pending);await assert.rejects(newer);
    assert.equal(guidanceState().ready,false);
    globalThis.fetch=(async()=>new Response(JSON.stringify({...catalog(),manager_version:"upgrade-2"}),{status:200})) as typeof fetch;
    await loadGuidance("upgrade-2");assert.equal(guidanceState().version,"upgrade-2");
  } finally { globalThis.fetch=previousFetch;installGuidanceCatalog(catalog()); }
});
