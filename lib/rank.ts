// Hackathon ranking v2: a multi-factor, explainable "founder signal" model.
// Six components, each capped, summing to 100. Verified public evidence (builder, traction, identity) carries 65 points;
// self-reported roster fields (role, skills) carry 30 and are labeled as such; team context carries 5.
// Saturating curves (1 - e^-x/k) give diminishing returns, so one huge repo cannot dominate, and every
// component reports its points in `reasons` so a judge can see where each number comes from.
import type { Signal } from "./sources/types.ts";

export const MAX = { builder: 35, traction: 15, identity: 15, role: 20, skills: 10, team: 5 } as const;
export type Component = keyof typeof MAX;
export type Components = Record<Component, number>;
export type Person = { name: string; type: string; title: string; org: string; skills: string[]; linkedin: string | null; team: number | null; signals: Signal[] };
export type Scored = { score: number; components: Components; reasons: string[]; tier: "A" | "B" | "C" | "D"; percentile: number; rank: number };

const r1 = (n: number) => Math.round(n * 10) / 10;
const sat = (raw: number, max: number, k: number) => max * (1 - Math.exp(-Math.max(0, raw) / k));
const DAY = 86400000;

/** "owner/repo — 1.2k★, 34 forks, TypeScript" → numbers. Missing parts → 0 / null. */
export function parseRepo(label: string): { stars: number; forks: number; lang: string | null } {
  const num = (s: string | undefined) => (s ? (s.endsWith("k") ? parseFloat(s) * 1000 : parseFloat(s)) : 0);
  const stars = num(/([\d.]+k?)★/.exec(label)?.[1]);
  const forks = num(/([\d.]+k?) forks?/.exec(label)?.[1]);
  const lang = /forks?, ([^,—]+)$/.exec(label)?.[1]?.trim() ?? null;
  return { stars, forks, lang };
}

/** "PyPI x — 4.3k downloads/month" → 4300. */
export function parseDownloads(label: string): number {
  const m = /([\d.]+)(k|m)? downloads/i.exec(label);
  if (!m) return 0;
  return parseFloat(m[1]) * (m[2]?.toLowerCase() === "k" ? 1e3 : m[2]?.toLowerCase() === "m" ? 1e6 : 1);
}

/** Activity multiplier: last push within 90 days counts fully, within a year 0.7, older 0.4, unknown 0.6. */
export function recency(date: string | null, now: number): number {
  const t = date ? Date.parse(date) : NaN;
  if (!Number.isFinite(t)) return 0.6;
  const age = (now - t) / DAY;
  return age <= 90 ? 1 : age <= 365 ? 0.7 : 0.4;
}

const BUILDER_SOURCES = new Set(["github", "packages", "huggingface", "zenodo"]);

export function builder(signals: Signal[], now: number): { pts: number; why: string | null } {
  let raw = 0, repos = 0, stars = 0, pkgs = 0, dl = 0, other = 0;
  const langs = new Set<string>();
  for (const s of signals) {
    if (!BUILDER_SOURCES.has(s.source) || s.kind === "profile") continue;
    if (s.source === "github" && s.kind === "repo") {
      const p = parseRepo(s.label);
      raw += (1 + 2 * Math.log2(1 + p.stars) + Math.log2(1 + p.forks)) * recency(s.date, now);
      repos++; stars += p.stars;
      if (p.lang) langs.add(p.lang);
    } else if (s.source === "packages") {
      const d = parseDownloads(s.label);
      raw += 2 + 1.5 * Math.log10(1 + d);
      pkgs++; dl += d;
    } else { raw += Math.max(0, s.weight); other++; }
  }
  raw += Math.min(3, Math.max(0, langs.size - 1));
  if (raw <= 0) return { pts: 0, why: null };
  const pts = sat(raw, MAX.builder, 18);
  const parts = [repos && `${repos} repo${repos > 1 ? "s" : ""}, ${stars}★`, langs.size > 1 && `${langs.size} languages`, pkgs && `${pkgs} package${pkgs > 1 ? "s" : ""}, ${Math.round(dl)} dl/mo`, other && `${other} other artifact${other > 1 ? "s" : ""}`].filter(Boolean);
  return { pts, why: `builder: ${parts.join(" · ")} (recency-weighted) +${r1(pts)}` };
}

export function traction(signals: Signal[]): { pts: number; why: string | null } {
  const hits = signals.filter((s) => !BUILDER_SOURCES.has(s.source) && s.kind !== "profile" && Math.max(0, s.weight) > 0);
  if (!hits.length) return { pts: 0, why: null };
  const raw = hits.reduce((a, s) => a + s.weight * Math.max(1, s.stage) / 3, 0);
  const pts = sat(raw, MAX.traction, 10);
  const srcs = [...new Set(hits.map((s) => s.source))];
  return { pts, why: `traction: ${hits.length} signal${hits.length > 1 ? "s" : ""} from ${srcs.join(", ")} (stage-weighted) +${r1(pts)}` };
}

export function identity(p: Pick<Person, "signals" | "linkedin">): { pts: number; why: string | null } {
  const gh = p.signals.find((s) => s.source === "github" && s.kind === "profile");
  let pts = 0;
  const parts: string[] = [];
  if (gh && /\((public email matches registration|same handle \+ name as LinkedIn)\)$/.test(gh.label)) { pts += 10; parts.push("GitHub verified by email/handle +10"); }
  else if (gh) { pts += 6; parts.push("GitHub matched by name + affiliation +6"); }
  const ids = new Set(p.signals.filter((s) => s.kind === "profile" && s.source !== "github").map((s) => s.source));
  if (ids.size) { const x = Math.min(3, ids.size * 1.5); pts += x; parts.push(`${[...ids].join(", ")} profile +${x}`); }
  if (p.linkedin) { pts += 2; parts.push("LinkedIn on roster +2"); }
  pts = Math.min(MAX.identity, pts);
  return { pts, why: parts.length ? `identity: ${parts.join(", ")}` : null };
}

// Founder-likelihood by self-reported role. First matching rule wins; order matters.
const ROLE: [RegExp, number, string][] = [
  [/\b(co-?founder|founder|ceo|cto)\b/i, 17, "founder / CEO / CTO"],
  [/\b(investor|partner|vc|ventures?|angel|scout)\b/i, 6, "investor"],
  [/\b(founding engineer|staff|principal|head of|lead|senior|sr\.?)\b/i, 13, "senior / founding builder"],
  [/\b(phd|doctoral|research(er| assistant| scientist)|scientist)\b/i, 12, "researcher"],
  [/\b(engineer|developer|swe|sde|programmer|mle|architect)\b/i, 11, "engineer"],
  [/\b(product|pm|designer|design)\b/i, 9, "product / design"],
  [/\b(student|candidate|undergrad|mba|ms|m\.s\.|master)\b/i, 8, "student"],
  [/\b(associate|analyst)\b/i, 6, "investor / analyst"],
];
const TYPE_ROLE: Record<string, [number, string]> = { founder: [15, "founder (type)"], engineer: [11, "engineer (type)"], student: [8, "student (type)"], operator: [7, "operator (type)"], investor: [6, "investor (type)"] };

export function role(p: Pick<Person, "type" | "title" | "org">): { pts: number; why: string } {
  const hit = ROLE.find(([re]) => re.test(p.title)) ?? null;
  let [pts, label] = hit ? [hit[1], hit[2]] : TYPE_ROLE[p.type.toLowerCase()] ?? [5, "unspecified"];
  const extras: string[] = [];
  if (/\b(ai|ml|machine learning|llm|agent)/i.test(p.title)) { pts += 2; extras.push("AI/ML title +2"); }
  if (/\bstealth\b/i.test(`${p.title} ${p.org}`) && pts >= 15) { pts += 1; extras.push("building in stealth +1"); }
  pts = Math.min(MAX.role, pts);
  return { pts, why: `role (self-reported): ${label}${extras.length ? ", " + extras.join(", ") : ""} +${pts}` };
}

const SKILL_PTS: Record<string, number> = { "ai/ml": 3, backend: 2, frontend: 1.5, design: 1, product: 1.5, "sales/gtm": 1.5, "vc/finance background": 0.5 };
const TECH = ["ai/ml", "backend", "frontend"], BIZ = ["product", "sales/gtm"];

export function skills(list: string[]): { pts: number; why: string | null } {
  const s = new Set(list.map((x) => x.trim().toLowerCase()));
  let pts = [...s].reduce((a, k) => a + (SKILL_PTS[k] ?? 0.5), 0);
  const full = TECH.some((k) => s.has(k)) && BIZ.some((k) => s.has(k));
  if (full) pts += 2;
  pts = Math.min(MAX.skills, pts);
  if (!s.size) return { pts: 0, why: null };
  return { pts, why: `skills (self-reported): ${s.size}${full ? ", builder + go-to-market mix +2" : ""} +${r1(pts)}` };
}

/** Scores everyone, adds team context (teammates' verified evidence), then ranks, percentiles and tiers. */
export function rankPeople<T extends Person>(people: T[], now = Date.now()): (T & Scored)[] {
  const base = people.map((p) => {
    const parts = { builder: builder(p.signals, now), traction: traction(p.signals), identity: identity(p), role: role(p), skills: skills(p.skills) };
    return { p, parts, evidence: parts.builder.pts + parts.traction.pts + parts.identity.pts };
  });
  // Team context: mean verified evidence of the *other* members, scaled against the strongest team.
  const byTeam = new Map<number, number[]>();
  base.forEach((b, i) => { if (b.p.team !== null) byTeam.set(b.p.team, [...(byTeam.get(b.p.team) ?? []), i]); });
  const mates = base.map((b, i) => {
    const ids = b.p.team === null ? [] : (byTeam.get(b.p.team) ?? []).filter((j) => j !== i);
    return ids.length ? ids.reduce((a, j) => a + base[j].evidence, 0) / ids.length : 0;
  });
  const top = Math.max(1, ...mates);
  const scored = base.map((b, i) => {
    const team = MAX.team * mates[i] / top;
    const components: Components = { builder: r1(b.parts.builder.pts), traction: r1(b.parts.traction.pts), identity: r1(b.parts.identity.pts), role: r1(b.parts.role.pts), skills: r1(b.parts.skills.pts), team: r1(team) };
    const reasons = [b.parts.builder.why, b.parts.traction.why, b.parts.identity.why, b.parts.role.why, b.parts.skills.why,
      team >= 0.1 ? `team: teammates' verified evidence ${r1(mates[i])} pts avg +${r1(team)}` : null].filter((x): x is string => !!x);
    const score = r1(Object.values(components).reduce((a, x) => a + x, 0));
    return { ...b.p, score, components, reasons, tier: "D" as Scored["tier"], percentile: 0, rank: 0 };
  });
  scored.sort((x, y) => y.score - x.score || (y.components.builder + y.components.traction) - (x.components.builder + x.components.traction) || x.name.localeCompare(y.name));
  const n = scored.length;
  scored.forEach((s, i) => {
    s.rank = i > 0 && s.score === scored[i - 1].score ? scored[i - 1].rank : i + 1;
    s.percentile = Math.round(100 * (1 - (s.rank - 1) / Math.max(1, n)));
    const frac = (s.rank - 1) / Math.max(1, n);
    s.tier = frac < 0.05 ? "A" : frac < 0.2 ? "B" : frac < 0.5 ? "C" : "D";
  });
  return scored;
}
