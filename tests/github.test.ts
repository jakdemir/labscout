import { test } from "node:test";
import assert from "node:assert/strict";
import { pickUser, sameName, toSignals, type GhUser } from "../lib/sources/github.ts";
import { collectSignals } from "../lib/search.ts";
import type { Candidate } from "../lib/types.ts";
import type { SourceModule } from "../lib/sources/types.ts";

const cand = (o: Partial<Candidate> = {}): Candidate => ({
  authorId: "A1", name: "José Ramírez", orcid: null, institutions: ["Columbia"], works: [], worksCount: 1, citedByCount: 0,
  firstPubYear: 2024, recentWorksCount: 1, reasons: [], mentions: [], education: [], isCurrentStudent: null, score: 0, brief: null, signals: [], ...o,
});
const user = (o: Partial<GhUser> = {}): GhUser => ({
  login: "jr", name: "Jose Ramirez", bio: null, company: null, location: null, websiteUrl: null, url: "https://github.com/jr", email: null,
  repositories: { nodes: [] }, ...o,
});

test("name match is accent/case/spacing-insensitive and allows middle-name omission", () => {
  assert.ok(sameName("José  Ramírez", "jose ramirez"));
  assert.ok(sameName("Jose A. Ramirez", "Jose Ramirez"));
  assert.ok(!sameName("Jose Ramirez", "Joseph Ramirez"));
});
test("exact name + Columbia bio is accepted", () => {
  const u = user({ bio: "PhD student @ Columbia University" });
  assert.equal(pickUser(cand(), [user({ login: "other", name: "Someone Else", bio: "Columbia" }), u], "x"), u);
});
test("same name without institution or topic evidence is rejected", () => {
  assert.equal(pickUser(cand(), [user({ bio: "I like cats", location: "Madrid" })], "protein design"), null);
});
test("two thesis keywords in repos are enough evidence for a unique name", () => {
  const u = user({ repositories: { nodes: [{ nameWithOwner: "jr/x", url: "u", description: "Protein design toolkit", stargazerCount: 1, forkCount: 0, pushedAt: null, primaryLanguage: null }] } });
  assert.equal(pickUser(cand(), [u], "protein design"), u);
  assert.equal(pickUser(cand(), [u, user({ login: "jr2" })], "protein design"), null); // namesake present -> topic-only not enough
});
test("a single generic keyword hit is not enough", () => {
  const u = user({ repositories: { nodes: [{ nameWithOwner: "jr/x", url: "u", description: "Image generation", stargazerCount: 1, forkCount: 0, pushedAt: null, primaryLanguage: null }] } });
  assert.equal(pickUser(cand(), [u], "code generation agents"), null);
});
test(".edu.cn alone is not institution evidence", () => {
  assert.equal(pickUser(cand(), [user({ websiteUrl: "https://www.sdu.edu.cn/" })], "x"), null);
});
test("two equally good matches -> null", () => {
  assert.equal(pickUser(cand(), [user({ login: "a", bio: "Columbia" }), user({ login: "b", company: "Columbia University" })], "x"), null);
});
test("more institution evidence wins a tie on name", () => {
  const strong = user({ login: "a", company: "Columbia", email: "jr@cs.columbia.edu" });
  assert.equal(pickUser(cand(), [user({ login: "b", bio: "Columbia" }), strong], "x"), strong);
});
test("toSignals: profile + qualifying repos with weights", () => {
  const now = Date.parse("2026-10-01");
  const s = toSignals(user({ company: "Columbia", repositories: { nodes: [
    { nameWithOwner: "jr/big", url: "https://github.com/jr/big", description: null, stargazerCount: 1300, forkCount: 40, pushedAt: "2026-09-01T00:00:00Z", primaryLanguage: { name: "Python" } },
    { nameWithOwner: "jr/old", url: "https://github.com/jr/old", description: null, stargazerCount: 1, forkCount: 0, pushedAt: "2020-01-01T00:00:00Z", primaryLanguage: null },
  ] } }), now);
  assert.equal(s.length, 2);
  assert.equal(s[0].kind, "profile");
  assert.equal(s[0].label, "GitHub @jr — Columbia");
  assert.equal(s[1].label, "jr/big — 1.3k★, 40 forks, Python");
  assert.equal(s[1].weight, 8); // min(6, round(3.11*3)=9) + recent 1 + forks 1
});
test("collectSignals: failing, hanging-free and disabled sources never break the search", async () => {
  const ok: SourceModule = { id: "github", enabled: () => true, enrich: async () => [{ source: "github", stage: 2, kind: "repo", label: "a/b", url: null, date: null, weight: 3 }] };
  const bad: SourceModule = { id: "arxiv", enabled: () => true, enrich: async () => { throw new Error("boom"); } };
  const off: SourceModule = { id: "nsf", enabled: () => false, enrich: async () => { throw new Error("should not run"); } };
  const c = cand();
  const cov = await collectSignals([c], { query: "q", keywords: "k" }, [ok, bad, off]);
  assert.equal(c.signals.length, 1);
  assert.equal(c.signals[0].label, "a/b");
  // coverage: every registered source reported, including the failing and the disabled one
  assert.deepEqual(cov.map((r) => [r.id, r.status, r.candidates, r.signals]), [["github", "hit", 1, 1], ["arxiv", "none", 0, 0], ["nsf", "off", 0, 0]]);
  assert.equal(cov[2].reason, "disabled");
});
test("collectSignals coverage: off reason for keyed sources, wave recorded", async () => {
  const gh: SourceModule = { id: "github", enabled: () => false, enrich: async () => [] };
  const w2: SourceModule = { id: "hackernews", wave: 2, enabled: () => true, enrich: async () => [] };
  const cov = await collectSignals([cand()], { query: "q", keywords: "k" }, [gh, w2]);
  assert.equal(cov[0].reason, "needs GITHUB_TOKEN");
  assert.equal(cov[1].wave, 2);
  assert.equal(cov[1].status, "none");
});
