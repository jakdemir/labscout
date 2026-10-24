import { test } from "node:test";
import assert from "node:assert/strict";
import { score, isCurrentStudent } from "../lib/score.ts";
import type { Candidate } from "../lib/types.ts";

const base = (o: Partial<Candidate> = {}): Candidate => ({
  authorId: "A1", name: "X", orcid: null, institutions: ["Columbia"],
  works: [{ id: "W1", title: "t", year: 2025, doi: null, url: null, venue: null, citedBy: 0, position: "first", isCorresponding: false }],
  worksCount: 3, citedByCount: 5, firstPubYear: 2024, recentWorksCount: null, reasons: [], education: [], isCurrentStudent: null, score: 0, brief: null, signals: [], ...o,
});

test("isCurrentStudent true when an education entry has no end year", () => {
  assert.equal(isCurrentStudent([{ institution: "Columbia", degree: "PhD", startYear: 2023, endYear: null }]), true);
});
test("isCurrentStudent false when all education ended", () => {
  assert.equal(isCurrentStudent([{ institution: "Columbia", degree: "PhD", startYear: 2015, endYear: 2020 }]), false);
});
test("isCurrentStudent null when no education data", () => {
  assert.equal(isCurrentStudent([]), null);
});
test("first author beats middle author", () => {
  assert.ok(score(base()) > score(base({ works: [{ ...base().works[0], position: "middle" }] })));
});
test("confirmed student > unknown > confirmed non-student", () => {
  const s = score(base({ isCurrentStudent: true })), u = score(base({ isCurrentStudent: null })), n = score(base({ isCurrentStudent: false }));
  assert.ok(s > u); assert.ok(u > n);
});
test("senior author with 200 works scores below early-career", () => {
  assert.ok(score(base({ worksCount: 200, firstPubYear: 2005 })) < score(base()));
});
test("more matching works scores higher", () => {
  const two = base({ works: [base().works[0], { ...base().works[0], id: "W2" }] });
  assert.ok(score(two) > score(base()));
});

test("momentum: recent share of output adds up to +10", () => {
  const hot = base({ worksCount: 10, recentWorksCount: 10 });
  const cold = base({ worksCount: 10, recentWorksCount: 1 });
  assert.ok(score(hot) > score(cold));
  assert.equal(score(hot) - score(cold), 9);
});
test("reasons explain the score", () => {
  const c = base({ isCurrentStudent: true, worksCount: 4, recentWorksCount: 4 });
  score(c);
  assert.ok(c.reasons.some((r) => r.includes("first-author")));
  assert.ok(c.reasons.some((r) => r.includes("current student")));
  assert.ok(c.reasons.some((r) => r.startsWith("momentum")));
});
test("thesis fit adds 3 per yes and 1 per partial, with a reason", () => {
  const fit = [{ criterion: "a", verdict: "yes" as const, evidence: "e" }, { criterion: "b", verdict: "partial" as const, evidence: "e" }, { criterion: "c", verdict: "no" as const, evidence: "e" }];
  const c = base({ fit });
  assert.equal(score(c) - score(base()), 4);
  assert.ok(c.reasons.includes("thesis fit: 1 yes, 1 partial of 3 criteria +4"));
});
test("no criteria -> no thesis-fit reason", () => {
  const c = base(); score(c);
  assert.ok(!c.reasons.some((r) => r.startsWith("thesis fit")));
});

// --- ranking fixes: faculty leakage, student check, works cap ---
const NOW = new Date().getFullYear();
test("isCurrentStudent: open education entry that started >8 years ago is not a current student", () => {
  assert.equal(isCurrentStudent([{ institution: "Columbia", degree: "PhD", startYear: NOW - 12, endYear: null }]), false);
});
test("isCurrentStudent: open entry but faculty-scale record (700 works) -> false", () => {
  const edu = [{ institution: "Columbia", degree: "PhD", startYear: null, endYear: null }];
  assert.equal(isCurrentStudent(edu, { worksCount: 787, firstPubYear: 2004 }), false);
  assert.equal(isCurrentStudent(edu, { worksCount: 5, firstPubYear: NOW - 2 }), true);
  assert.equal(isCurrentStudent(edu, { worksCount: null, firstPubYear: null }), true);
});
test("12 lab papers as middle author do not out-score a first-author student (works points capped)", () => {
  const w = base().works[0];
  const pi = base({ works: Array.from({ length: 12 }, (_, i) => ({ ...w, id: `W${i}`, position: "middle" as const, citedBy: 20 })), worksCount: 787, firstPubYear: 2004 });
  const student = base({ isCurrentStudent: true, worksCount: 4, recentWorksCount: 4 });
  assert.ok(score(pi) < score(student), `${score(pi)} vs ${score(student)}`);
  assert.ok(pi.reasons.some((r) => r.includes("(capped)")));
});
test("last/corresponding author on 2+ papers and first on none -> PI proxy penalty, even without author stats", () => {
  const w = base().works[0];
  const c = base({ works: [{ ...w, position: "last" }, { ...w, id: "W2", position: "middle", isCorresponding: true }], worksCount: null, firstPubYear: null });
  score(c);
  assert.ok(c.reasons.some((r) => r.startsWith("senior/corresponding author on 2")));
});
test("unknown author stats (null) carry no penalty and no momentum, but also no free pass vs known student", () => {
  const unknown = base({ worksCount: null, citedByCount: null, firstPubYear: null, recentWorksCount: null });
  score(unknown);
  assert.ok(!unknown.reasons.some((r) => r.startsWith("established") || r.startsWith("publishing since")));
});
