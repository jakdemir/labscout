import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRepo, parseDownloads, recency, builder, traction, identity, role, skills, rankPeople, MAX } from "../lib/rank.ts";

const NOW = Date.parse("2026-10-24T12:00:00Z");
const repo = (label: string, date: string | null = "2026-10-01T00:00:00Z") => ({ source: "github" as const, stage: 2 as const, kind: "repo", label, url: null, date, weight: 2 });
const prof = (label: string) => ({ source: "github" as const, stage: 2 as const, kind: "profile", label, url: null, date: null, weight: 2 });
const person = (o: any = {}) => ({ name: "X", type: "Engineer", title: "", org: "", skills: [], linkedin: null, team: null, signals: [], ...o });

test("parseRepo / parseDownloads read the signal labels", () => {
  assert.deepEqual(parseRepo("a/b — 1.2k★, 34 forks, TypeScript"), { stars: 1200, forks: 34, lang: "TypeScript" });
  assert.deepEqual(parseRepo("a/b — 0★, 0 forks"), { stars: 0, forks: 0, lang: null });
  assert.equal(parseDownloads("PyPI agentglow — 4.3k downloads/month"), 4300);
  assert.equal(parseDownloads("nothing"), 0);
});
test("recency: 90 d full, 1 y 0.7, older 0.4, unknown 0.6", () => {
  assert.equal(recency("2026-10-01T00:00:00Z", NOW), 1);
  assert.equal(recency("2026-02-01T00:00:00Z", NOW), 0.7);
  assert.equal(recency("2023-01-01T00:00:00Z", NOW), 0.4);
  assert.equal(recency(null, NOW), 0.6);
});
test("builder: stars and recency matter, with diminishing returns and a hard cap", () => {
  const small = builder([repo("a/b — 1★, 0 forks, Python")], NOW).pts;
  const big = builder([repo("a/b — 500★, 40 forks, Python")], NOW).pts;
  const stale = builder([repo("a/b — 500★, 40 forks, Python", "2022-01-01T00:00:00Z")], NOW).pts;
  assert.ok(big > small && big > stale);
  const huge = builder(Array.from({ length: 50 }, () => repo("a/b — 100k★, 9k forks, Rust")), NOW).pts;
  assert.ok(huge <= MAX.builder && huge > 34);
  assert.equal(builder([prof("GitHub @x")], NOW).pts, 0);
});
test("traction weights by stage; builder sources excluded", () => {
  assert.equal(traction([repo("a/b — 5★, 0 forks")]).pts, 0);
  const hn = traction([{ source: "hackernews", stage: 5, kind: "hn_story", label: "HN", url: null, date: null, weight: 2 }]);
  assert.ok(hn.pts > 0 && /hackernews/.test(hn.why!));
});
test("identity: verified GitHub > name-matched GitHub; LinkedIn adds; capped", () => {
  assert.equal(identity({ signals: [prof("GitHub @x (public email matches registration)")], linkedin: "https://linkedin.com/in/x" }).pts, 12);
  assert.equal(identity({ signals: [prof("GitHub @x — NYU")], linkedin: null }).pts, 6);
  assert.equal(identity({ signals: [], linkedin: null }).pts, 0);
});
test("role: title beats type; founders > engineers > students > investors; AI title bonus", () => {
  assert.equal(role({ type: "Founder", title: "CTO", org: "" }).pts, 17);
  assert.equal(role({ type: "Founder", title: "founder @ Stealth", org: "" }).pts, 18);
  assert.equal(role({ type: "Engineer", title: "AI Engineer", org: "" }).pts, 13);
  assert.equal(role({ type: "Student", title: "", org: "" }).pts, 8);
  assert.equal(role({ type: "Investor", title: "Ventures Principal", org: "Plug and Play" }).pts, 6);
  assert.equal(role({ type: "", title: "", org: "" }).pts, 5);
});
test("skills: weighted, builder+GTM mix bonus, capped at 10", () => {
  assert.equal(skills([]).pts, 0);
  assert.equal(skills(["AI/ML", "Sales/GTM"]).pts, 6.5);
  assert.ok(skills(["AI/ML", "Backend", "Frontend", "Design", "Product", "Sales/GTM", "VC/finance background"]).pts <= 10);
});
test("rankPeople: differentiates people with no external evidence, teams add context, tiers by percentile", () => {
  const ppl = [
    person({ name: "Ada", type: "Founder", title: "CEO", skills: ["AI/ML", "Product"], linkedin: "https://linkedin.com/in/ada", team: 1 }),
    person({ name: "Bob", type: "Student", title: "Student", skills: ["Design"], team: 2 }),
    person({ name: "Cy", type: "Engineer", title: "Software Engineer", skills: ["Backend"], team: 1,
      signals: [prof("GitHub @cy (public email matches registration)"), repo("cy/x — 120★, 9 forks, Go")] }),
    person({ name: "Dee", type: "Investor", title: "Partner", team: 2 }),
  ];
  const r = rankPeople(ppl, NOW);
  assert.equal(r[0].name, "Cy");
  assert.deepEqual(r.map((x) => x.rank), [1, 2, 3, 4]);
  assert.ok(r.find((x) => x.name === "Ada")!.components.team > 0); // teammate Cy has evidence
  assert.equal(r.find((x) => x.name === "Bob")!.components.team, 0);
  assert.equal(r[0].tier, "A");
  assert.equal(r[3].tier, "D");
  for (const x of r) assert.equal(x.score, Math.round(Object.values(x.components).reduce((a, b) => a + b, 0) * 10) / 10);
  assert.ok(r[0].reasons.some((s) => s.startsWith("builder:")));
});
test("rankPeople: identical profiles share a rank", () => {
  const r = rankPeople([person({ name: "A" }), person({ name: "B" })], NOW);
  assert.deepEqual(r.map((x) => x.rank), [1, 1]);
});
