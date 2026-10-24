import { test } from "node:test";
import assert from "node:assert/strict";
import { toStats, searchWorks, INSTITUTION_IDS } from "../lib/openalex.ts";
import { shortlist } from "../lib/aggregate.ts";
import type { Candidate } from "../lib/types.ts";

test("INSTITUTION_IDS covers all four NYC campuses", () => {
  assert.deepEqual(INSTITUTION_IDS.sort(), ["I205783295", "I4405261073", "I57206974", "I78577930"].sort());
});
test("toStats: unknown fields stay null, never 0", () => {
  assert.deepEqual(toStats({}), { worksCount: null, citedByCount: null, firstPubYear: null, recentWorksCount: null });
  const s = toStats({ works_count: 12, cited_by_count: 40, counts_by_year: [{ year: 2026, works_count: 3 }, { year: 2024, works_count: 2 }] });
  assert.equal(s.worksCount, 12); assert.equal(s.firstPubYear, 2024);
});
test("searchWorks: one query per institution, merged + deduped; a failed campus does not fail the search", async () => {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    calls.push(String(url));
    if (/I57206974/.test(String(url))) return new Response("", { status: 429 });
    const inst = /institutions\.id:(I\d+)/.exec(String(url))![1];
    return new Response(JSON.stringify({ results: [{ id: `W-${inst}` }, { id: "W-shared" }] }), { status: 200 });
  }) as any;
  try {
    const works = await searchWorks("x", 30, ["I78577930", "I57206974", "I205783295"]);
    assert.equal(calls.length, 3);
    assert.deepEqual(works.map((w) => w.id).sort(), ["W-I205783295", "W-I78577930", "W-shared"].sort());
  } finally { globalThis.fetch = realFetch; }
});
test("searchWorks throws only when every campus query fails", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("", { status: 429 })) as any;
  try { await assert.rejects(searchWorks("x", 30, ["I78577930", "I57206974"])); } finally { globalThis.fetch = realFetch; }
});

const cand = (name: string, inst: string, score: number): Candidate => ({
  authorId: name, name, orcid: null, institutions: [inst], works: [], worksCount: null, citedByCount: null, firstPubYear: null, recentWorksCount: null,
  reasons: [], mentions: [], education: [], isCurrentStudent: null, score, brief: null, signals: [], fit: [],
});
test("shortlist keeps >=3 seats per campus that has candidates, displacing the lowest picks", () => {
  const sorted = [
    ...Array.from({ length: 20 }, (_, i) => cand(`C${i}`, "Cornell", 100 - i)),
    cand("N1", "NYU", 20), cand("N2", "NYU", 19), cand("N3", "NYU", 18), cand("N4", "NYU", 17),
    cand("U1", "Columbia", 10),
  ];
  const out = shortlist(sorted, 15, 3);
  assert.equal(out.length, 15);
  assert.equal(out.filter((c) => c.institutions[0] === "NYU").length, 3);
  assert.equal(out.filter((c) => c.institutions[0] === "Columbia").length, 1); // only one exists
  assert.equal(out.filter((c) => c.institutions[0] === "Cornell").length, 11);
  assert.equal(out[0].name, "C0"); // merit order kept
  assert.ok(out.every((c, i) => i === 0 || out[i - 1].score >= c.score));
});
test("shortlist with fewer candidates than n returns all", () => {
  assert.equal(shortlist([cand("a", "NYU", 1), cand("b", "Cornell", 2)], 15).length, 2);
});
test("shortlist: Cornell Tech counts toward Cornell's quota (one campus family), not a separate 3 seats", () => {
  const sorted = [
    ...Array.from({ length: 10 }, (_, i) => cand(`C${i}`, "Cornell", 100 - i)),
    ...Array.from({ length: 10 }, (_, i) => cand(`T${i}`, "Cornell Tech", 80 - i)),
    cand("N1", "NYU", 20), cand("N2", "NYU", 19), cand("N3", "NYU", 18),
    cand("U1", "Columbia", 10), cand("U2", "Columbia", 9), cand("U3", "Columbia", 8),
  ];
  const out = shortlist(sorted, 15, 3);
  assert.equal(out.filter((c) => c.institutions[0] === "NYU").length, 3);
  assert.equal(out.filter((c) => c.institutions[0] === "Columbia").length, 3);
  assert.equal(out.filter((c) => /Cornell/.test(c.institutions[0])).length, 9);
});
