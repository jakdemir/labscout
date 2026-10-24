import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, toAttendees, scrubContact, affiliations, strictSignals, pickAuthor, rankAttendees, rankTeams, candidateFor, contextFor, COMMON_NAME } from "../lib/hackathon.ts";
import type { Signal } from "../lib/sources/types.ts";

const CSV = 'Team #,Team Name,Basis,Team idea / theme,Member,Email,Type,Company / Fund / Org,Job title,Brings (skills),LinkedIn\r\n' +
  '2,Tricorder,kept,"Sourcing, diligence — memo",Ken St Clair,Ken@Example.com,Founder,Steady Thread,Founder,"Design, AI/ML",https://linkedin.com/in/kenstclair\r\n' +
  '2,Tricorder,kept,"Sourcing, diligence — memo",Aadit Fadia,aaf9407@nyu.edu,Engineer,OGMVP,Founding Engineer,"Backend, AI/ML",https://linkedin.com/in/aadit\r\n' +
  ',,,,,,,,,,\r\n' +
  '3,Ledger,kept,"K-1 ""reader""\nmultiline",Ken St Clair,ken@example.com,Founder,Steady Thread,Founder,Design,\r\n' +
  '3,Ledger,kept,K-1,Anne Kelly,anne@x.com,Student,Zurich AM and Columbia Business School,Lead,VC/finance background,javascript:alert(1)\r\n';

const sig = (source: any, label: string, weight = 5): Signal => ({ source, stage: 2, kind: "x", label, url: null, date: null, weight });

test("scrubContact removes emails and phone numbers from free text", () => {
  assert.equal(scrubContact("Devolution Productions me1977@gmail.com"), "Devolution Productions");
  assert.equal(scrubContact("Latinum Fund 6465938452 Google"), "Latinum Fund Google");
  assert.equal(scrubContact("Cornell Tech, prev Reddit"), "Cornell Tech, prev Reddit");
  assert.equal(scrubContact("Class of 2026"), "Class of 2026");
});

test("parseCsv handles quotes, doubled quotes, CRLF and embedded newlines", () => {
  const rows = parseCsv(CSV);
  assert.equal(rows[0].length, 11);
  assert.equal(rows[4][3], 'K-1 "reader"\nmultiline');
});

test("toAttendees skips spacer rows, dedupes by email, rejects non-LinkedIn URLs", () => {
  const a = toAttendees(parseCsv(CSV));
  assert.deepEqual(a.map((x) => x.name), ["Ken St Clair", "Aadit Fadia", "Anne Kelly"]);
  assert.equal(a[0].team, 2);
  assert.deepEqual(a[0].skills, ["Design", "AI/ML"]);
  assert.equal(a[2].linkedin, null);
  assert.equal(a[0].email, "ken@example.com");
});

test("affiliations: splits orgs, drops placeholders, adds university from .edu email", () => {
  assert.deepEqual(affiliations({ org: "OGMVP", email: "aaf9407@nyu.edu" }), ["OGMVP", "NYU"]);
  assert.deepEqual(affiliations({ org: "Zurich AM and Columbia Business School", email: "a@columbia.edu" }), ["Zurich AM", "Columbia Business School"]);
  assert.deepEqual(affiliations({ org: "None", email: "x@gmail.com" }), []);
  assert.deepEqual(affiliations({ org: "self-employed", email: "x@gmail.com" }), []);
});

test("contextFor never feeds keywords to sources (topic overlap matches strangers)", () => {
  const [a] = toAttendees(parseCsv(CSV));
  assert.equal(contextFor(a).keywords, "");
});

test("strictSignals: entity registries must name the attendee's org", () => {
  const s = [sig("nycorp", "NY entity: STEADY THREAD LLC (filed 2025-01)"), sig("nycorp", "NY entity: MY HVAC SUPPLY, LLC")];
  assert.deepEqual(strictSignals({ org: "Steady Thread", email: "" }, s, 0).map((x) => x.label), [s[0].label]);
  assert.equal(strictSignals({ org: "None", email: "" }, s, 0).length, 0);
});

test("strictSignals: common or unknown names keep only handle-verified sources", () => {
  const s = [sig("github", "GitHub @x (public email matches registration)"), sig("arxiv", "arXiv: paper"), sig("yc", "YC founder")];
  s[0].kind = "profile";
  assert.deepEqual(strictSignals({ org: "", email: "" }, s, COMMON_NAME).map((x) => x.source), ["github", "yc"]);
  assert.deepEqual(strictSignals({ org: "", email: "" }, s, null).map((x) => x.source), ["github", "yc"]);
  assert.equal(strictSignals({ org: "", email: "" }, s, 3).length, 3);
});

test("strictSignals: name-searched GitHub needs org/university in bio, else it and its packages drop", () => {
  const prof = (label: string): Signal => ({ ...sig("github", label, 2), kind: "profile" });
  const derived = [sig("github", "x/repo — 3★"), sig("packages", "PyPI x — 1k downloads/month")];
  const keep = strictSignals({ org: "Acme Robotics", email: "a@nyu.edu" }, [prof("GitHub @x — CS @ NYU"), ...derived], 0);
  assert.equal(keep.length, 3);
  const drop = strictSignals({ org: "Independent", email: "a@gmail.com" }, [prof("GitHub @jacobandreas — @lingo-mit"), ...derived], 0);
  assert.equal(drop.length, 0);
  const noAff = strictSignals({ org: "None", email: "a@gmail.com" }, [prof("GitHub @x — Columbia"), ...derived], 0);
  assert.equal(noAff.length, 0, "no affiliations must not fall back to the default Columbia/NYU/Cornell list");
});

test("strictSignals: SBIR-style grants must name the attendee's org or university", () => {
  const s = [sig("nih", "NIH R44 — PRIVO TECHNOLOGIES, LLC: trial"), sig("nsf", "NSF grant (PI) — Columbia University: x")];
  assert.deepEqual(strictSignals({ org: "Echoed LLC", email: "m@columbia.edu" }, s, 0).map((x) => x.source), ["nsf"]);
});

test("pickAuthor needs name + affiliation, and a unique match", () => {
  const [, aadit] = toAttendees(parseCsv(CSV));
  const c = candidateFor(aadit);
  const nyu = { display_name: "Aadit Fadia", last_known_institutions: [{ display_name: "New York University" }] };
  const other = { display_name: "Aadit Fadia", last_known_institutions: [{ display_name: "IIT Bombay" }] };
  assert.equal(pickAuthor(c, [nyu, other]), nyu);
  assert.equal(pickAuthor(c, [other]), null);
  assert.equal(pickAuthor(c, [nyu, { ...nyu }]), null);
});

test("rankAttendees: strips email, verified evidence outranks self-reported role, components add up", () => {
  const ppl = toAttendees(parseCsv(CSV));
  const items = ppl.map((a, i) => { const c = candidateFor(a); c.signals = i === 1 ? [sig("github", "GitHub @aadit", 9)] : []; return { a, c }; });
  const r = rankAttendees(items);
  assert.equal(r[0].name, "Aadit Fadia");
  assert.ok(r[0].components.builder > 0);
  assert.deepEqual(r.map((x) => x.rank), [1, 2, 3]);
  assert.ok(r.every((x) => !("email" in x)));
  for (const x of r) assert.equal(x.score, Math.round(Object.values(x.components).reduce((a, b) => a + b, 0) * 10) / 10);
  assert.ok(r.every((x) => x.reasons.some((y) => y.startsWith("role (self-reported)"))));
  const t = rankTeams(r);
  assert.equal(t[0].team, 2);
});
