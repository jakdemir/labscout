// Hackathon tab: turns the Deal Flow attendee sheet into Labscout candidates, then ranks them with the
// same founder-signal score the Scout tab uses. Pure helpers here; the batch runner is scripts/hackathon.ts.
import type { Candidate, Work } from "./types.ts";
import type { Signal } from "./sources/types.ts";
import { rankPeople, type Components } from "./rank.ts";
import { namesMatch, mentionsInstitution } from "./sources/match.ts";
import { QUERY as GH_QUERY, toSignals as ghSignals, type GhUser } from "./sources/github.ts";

export const SHEET_CSV = "https://docs.google.com/spreadsheets/d/1ho885oj_UhJCnMJx-fP2K60XQ38p7K7mxhlDWPEO3KA/export?format=csv&gid=2067946409";

export type Attendee = {
  key: string;            // stable id (hash of email); emails never leave the batch script
  name: string;
  team: number | null;
  teamName: string;
  theme: string;
  type: string;           // Founder / Engineer / Student / Operator / Investor
  org: string;
  title: string;
  skills: string[];
  linkedin: string | null;
  email: string;          // used for matching only; stripped before publishing
};

export type RankedAttendee = Omit<Attendee, "email"> & {
  rank: number;
  score: number;                 // 0-100 composite (lib/rank.ts)
  components: Components;        // builder / traction / identity / role / skills / team points
  tier: "A" | "B" | "C" | "D";   // top 5% / next 15% / next 30% / rest
  percentile: number;
  reasons: string[];
  signals: Signal[];
  openalex: { id: string; works: number; citations: number; papers: Work[] } | null;
  commonName: boolean;    // true → only handle-verified sources counted (see strictSignals)
  brief: string | null;
};

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF, newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(f); f = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(f); rows.push(row); row = []; f = "";
    } else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

/** Free-text sheet cells sometimes hold contact details (an email typed into "Company"). Never publish them. */
export function scrubContact(s: string): string {
  return s.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "").replace(/\+?\d[\d\s().-]{8,}\d/g, "").replace(/\s{2,}/g, " ").replace(/^[\s,;|·-]+|[\s,;|·-]+$/g, "");
}

/** Sheet rows → unique attendees (deduped by email, else name). Blank spacer rows are skipped. */
export function toAttendees(rows: string[][]): Attendee[] {
  const [head, ...body] = rows;
  if (!head) return [];
  const col = (n: string) => head.findIndex((h) => h.trim().toLowerCase() === n.toLowerCase());
  const I = { team: col("Team #"), teamName: col("Team Name"), theme: col("Team idea / theme"), name: col("Member"), email: col("Email"),
    type: col("Type"), org: col("Company / Fund / Org"), title: col("Job title"), skills: col("Brings (skills)"), linkedin: col("LinkedIn") };
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const txt = (r: string[], i: number) => scrubContact(get(r, i));
  const seen = new Set<string>();
  const out: Attendee[] = [];
  for (const r of body) {
    const name = get(r, I.name);
    if (!name) continue;
    const email = get(r, I.email).toLowerCase();
    const id = email || name.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    const li = get(r, I.linkedin);
    const team = Number.parseInt(get(r, I.team), 10);
    out.push({
      key: fnv(id), name: txt(r, I.name), team: Number.isFinite(team) ? team : null, teamName: txt(r, I.teamName), theme: txt(r, I.theme),
      type: txt(r, I.type), org: txt(r, I.org), title: txt(r, I.title),
      skills: txt(r, I.skills).split(",").map((s) => s.trim()).filter(Boolean),
      linkedin: /^https?:\/\/([a-z]+\.)?linkedin\.com\//i.test(li) ? li : null, email,
    });
  }
  return out;
}

const NOT_ORG = /^(none|n\/?a|student|self[- ]?employed|freelanc\w*|independent|stealth|unemployed|-+|\.)$/i;
const EDU: [RegExp, string][] = [[/(^|\.)nyu\.edu$/, "NYU"], [/(^|\.)columbia\.edu$/, "Columbia"], [/(^|\.)cornell\.edu$/, "Cornell"]];

/** Affiliations to disambiguate name matches: the stated org plus a university implied by a .edu email. */
export function affiliations(a: Pick<Attendee, "org" | "email">): string[] {
  const out: string[] = [];
  for (const part of a.org.split(/\s+(?:and|&)\s+|[,;/]/)) {
    const p = part.trim();
    if (p.length >= 3 && !NOT_ORG.test(p)) out.push(p);
  }
  const domain = a.email.split("@")[1] ?? "";
  for (const [re, inst] of EDU) if (re.test(domain) && !out.some((o) => mentionsInstitution(o, [inst]))) out.push(inst);
  return out;
}

/** Context for the signal sources. Keywords stay empty on purpose: the Scout pipeline's topic-overlap fallback
 *  assumes a pre-filtered, on-thesis population; on 500 mixed attendees it matches common names to strangers. */
export function contextFor(a: Attendee): { query: string; keywords: string } {
  return { query: a.theme || a.title, keywords: "" };
}

// Registries keyed only on a person's name (+ NY location). Kept only when the filing names the attendee's own org.
const ENTITY_SOURCES = new Set(["nycorp", "edgar", "usaspending", "sbir", "patentsview", "clinicaltrials"]);
// Federal grants: kept only when the award names the attendee's org or university (SBIR awards name a company).
const GRANT_SOURCES = new Set(["nsf", "nih"]);
// Sources whose identity comes from a verified handle / ID chain (GitHub profile with affiliation in bio, packages and
// HN posts linked to that GitHub, YC founder pages, ORCID iD) rather than a bare name. Safe for common names.
const HANDLE_SOURCES = new Set(["github", "packages", "hackernews", "yc", "huggingface", "orcid", "papercode"]);
// Wave-2 sources that only exist because of the GitHub account found in wave 1.
const FROM_GITHUB = new Set(["github", "packages", "hackernews"]);
/** ORCID records with the same given + family name at or above which a name counts as common. */
export const COMMON_NAME = 25;
export const VERIFIED_GH = /\((public email matches registration|same handle \+ name as LinkedIn)\)$/;

/** Hackathon-strict filter on top of the Scout sources (which assume a pre-filtered student population):
 *  - registries must name the attendee's own company; NSF/NIH awards must name their org or university;
 *  - a GitHub account found by name search (not email/handle) needs the attendee's org or university in its
 *    company/bio, else it and everything derived from it (packages, HN) is dropped — `.edu` alone is not enough;
 *  - common or unknown-commonness names keep only handle-verified sources. */
export function strictSignals(a: Pick<Attendee, "org" | "email">, signals: Signal[], nameCount: number | null = null): Signal[] {
  const orgs = affiliations({ org: a.org, email: "" });
  const affs = affiliations(a);
  const common = nameCount === null || nameCount >= COMMON_NAME;
  const gh = signals.find((s) => s.source === "github" && s.kind === "profile");
  const ghOk = !!gh && (VERIFIED_GH.test(gh.label) || (affs.length > 0 && mentionsInstitution(gh.label.replace(/^GitHub @\S+/, ""), affs)));
  const ghBad = !!gh && !ghOk; // YC / Bluesky may have been derived from this rejected account's company or login
  return signals.filter((s) => {
    if (ENTITY_SOURCES.has(s.source)) return orgs.length > 0 && mentionsInstitution(s.label, orgs);
    if (FROM_GITHUB.has(s.source) && !ghOk) return false;
    if (ghBad && (s.source === "yc" || s.source === "bluesky")) return false;
    if (GRANT_SOURCES.has(s.source) && !(affs.length > 0 && mentionsInstitution(s.label, affs))) return false;
    return !common || HANDLE_SOURCES.has(s.source);
  });
}

/** How many ORCID records share this given + family name — a cheap, key-free "how common is this name" proxy. */
export async function orcidNameCount(name: string): Promise<number | null> {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const q = `given-names:${JSON.stringify(parts[0])} AND family-name:${JSON.stringify(parts[parts.length - 1])}`;
  try {
    const r = await fetch(`https://pub.orcid.org/v3.0/expanded-search/?q=${encodeURIComponent(q)}&rows=0`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const n = Number((await r.json())["num-found"]);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

/** GitHub account whose PUBLIC email equals the email the attendee registered with — identity by construction.
 *  Returns the profile + repo signals (same format as the github source), or [] when none / no token. */
export async function githubByEmail(email: string): Promise<Signal[]> {
  if (!/^[^\s@"\\]+@[^\s@"\\]+\.[a-z]{2,}$/i.test(email)) return [];
  const users = await ghSearch(`${email} in:email type:user`);
  if (users.length !== 1) return [];
  const out = ghSignals(users[0]);
  out[0] = { ...out[0], label: out[0].label + " (public email matches registration)" };
  return out;
}

/** GitHub account with the same handle as the attendee's LinkedIn slug AND the same display name. */
export async function githubByHandle(name: string, linkedin: string | null): Promise<Signal[]> {
  const slug = /linkedin\.com\/in\/([A-Za-z0-9-]{3,39})\/?$/i.exec(linkedin ?? "")?.[1];
  if (!slug) return [];
  const u = (await ghSearch(`user:${slug}`)).find((x) => x.login.toLowerCase() === slug.toLowerCase());
  if (!u || !u.name || !namesMatch(u.name, name)) return [];
  const out = ghSignals(u);
  out[0] = { ...out[0], label: out[0].label + " (same handle + name as LinkedIn)" };
  return out;
}

async function ghSearch(q: string): Promise<GhUser[]> {
  if (!process.env.GITHUB_TOKEN) return [];
  try {
    const r = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { authorization: "bearer " + process.env.GITHUB_TOKEN, "content-type": "application/json", "user-agent": "labscout" },
      body: JSON.stringify({ query: GH_QUERY, variables: { q } }),
      signal: AbortSignal.timeout(12000),
    });
    if (r.status !== 200) return [];
    return ((await r.json())?.data?.search?.nodes ?? []).filter((n: any) => n && n.login);
  } catch { return []; }
}

export function candidateFor(a: Attendee): Candidate {
  return {
    authorId: "", name: a.name, orcid: null, institutions: affiliations(a), works: [], worksCount: null, citedByCount: null,
    firstPubYear: null, recentWorksCount: null, reasons: [], mentions: [], education: [], isCurrentStudent: null, score: 0, brief: null, signals: [],
  };
}

/** Picks the OpenAlex author that is this attendee: exact name match AND an affiliation match. Null when ambiguous. */
export function pickAuthor(c: Candidate, authors: any[]): any | null {
  if (!c.institutions.length) return null;
  const ok = (authors ?? []).filter((x) => x && namesMatch(x.display_name ?? "", c.name)).filter((x) => {
    const insts = [...(x.last_known_institutions ?? []), ...(x.affiliations ?? []).map((f: any) => f.institution)]
      .map((i: any) => i?.display_name ?? "").join(" | ");
    return mentionsInstitution(insts, c.institutions);
  });
  return ok.length === 1 ? ok[0] : null;
}

/** Rank with the multi-factor hackathon model (lib/rank.ts): verified builder / traction / identity evidence plus
 *  self-reported role and skills and team context. Every component is capped and explained in `reasons`. */
export function rankAttendees(items: { a: Attendee; c: Candidate; brief?: string | null; openalex?: RankedAttendee["openalex"]; commonName?: boolean }[], now = Date.now()): RankedAttendee[] {
  const ranked = rankPeople(items.map(({ a, c, brief, openalex, commonName }) => {
    const { email: _drop, ...pub } = a;
    return { ...pub, signals: c.signals, openalex: openalex ?? null, commonName: !!commonName, brief: brief ?? null };
  }), now);
  return ranked;
}

export type TeamRow = { team: number; teamName: string; theme: string; members: number; score: number; top: string; withSignals: number };

/** Team leaderboard: sum of the top-3 member scores (so big teams don't win on headcount alone). */
export function rankTeams(people: RankedAttendee[]): TeamRow[] {
  const by = new Map<number, RankedAttendee[]>();
  for (const p of people) if (p.team !== null) by.set(p.team, [...(by.get(p.team) ?? []), p]);
  const rows = [...by].map(([team, ms]) => {
    const sorted = [...ms].sort((x, y) => y.score - x.score);
    return { team, teamName: ms[0].teamName, theme: ms[0].theme, members: ms.length,
      score: Math.round(sorted.slice(0, 3).reduce((n, m) => n + m.score, 0) * 10) / 10,
      top: sorted[0].name, withSignals: ms.filter((m) => m.signals.length > 0).length };
  });
  return rows.sort((x, y) => y.score - x.score || x.team - y.team);
}
