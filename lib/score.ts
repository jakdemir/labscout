import type { Candidate, Education } from "./types.ts";
import type { Signal } from "./sources/types.ts";
import { fitPoints } from "./fit.ts";

/** ORCID education with no end date = enrolled now — unless the entry started >8 years ago (people leave
 *  end dates blank) or the publication record is faculty-scale (a 700-paper PI with an open "PhD" entry is
 *  not a current student). `author` is optional so callers without OpenAlex stats keep the plain rule. */
export function isCurrentStudent(edu: Education[], author?: { worksCount: number | null; firstPubYear: number | null }): boolean | null {
  if (edu.length === 0) return null;
  const nowY = new Date().getFullYear();
  const open = edu.filter((e) => e.endYear === null && (e.startYear === null || e.startYear >= nowY - 8));
  if (!open.length) return false;
  if (author && ((author.worksCount ?? 0) > FACULTY_WORKS || (author.firstPubYear !== null && author.firstPubYear < nowY - 12))) return false;
  return true;
}

export const FACULTY_WORKS = 60;
const WORKS_PTS_CAP = 45;
const POS: Record<string, number> = { first: 10, middle: 3, last: 1 };

/** Deterministic, explainable score. Returns the number and fills c.reasons with the breakdown. */
export function score(c: Candidate): number {
  const reasons: string[] = [];
  let s = 0;
  const firsts = c.works.filter((w) => w.position === "first").length;
  const others = c.works.length - firsts;
  let wPts = 0;
  for (const w of c.works) {
    wPts += POS[w.position] ?? 2;
    wPts += Math.min(w.citedBy, 20) * 0.25;
    if (w.year >= 2025) wPts += 2;
  }
  // Cap: a PI whose lab put out 12 matching papers must not out-score every student on volume alone.
  const capped = wPts > WORKS_PTS_CAP;
  wPts = Math.min(WORKS_PTS_CAP, wPts);
  s += wPts;
  reasons.push(`${c.works.length} matching paper${c.works.length === 1 ? "" : "s"} (${firsts} first-author${others ? `, ${others} co-author` : ""}) +${r1(wPts)}${capped ? " (capped)" : ""}`);

  // PI proxy from the papers themselves (works even when author stats are unavailable):
  // last/corresponding author on 2+ matching papers and first author on none.
  const lasts = c.works.filter((w) => w.position === "last" || (w.isCorresponding && w.position !== "first")).length;
  if (firsts === 0 && lasts >= 2) { s -= 10; reasons.push(`senior/corresponding author on ${lasts} papers, first on none −10`); }

  if (c.isCurrentStudent === true) { s += 15; reasons.push("verified current student (ORCID) +15"); }
  if (c.isCurrentStudent === false) { s -= 15; reasons.push("education ended (ORCID) −15"); }

  // Momentum: velocity over totals. Share of the author's output in the last 2 years.
  if (c.worksCount !== null && c.worksCount > 0 && c.recentWorksCount !== null) {
    const share = Math.min(1, c.recentWorksCount / c.worksCount);
    const m = Math.round(share * 10 * 10) / 10;
    s += m;
    reasons.push(`momentum: ${c.recentWorksCount}/${c.worksCount} papers in last 2 yrs +${m}`);
  }

  // Faculty leakage: scales with the record and is relative to today, not a hardcoded year.
  if (c.worksCount !== null && c.worksCount > 30) { const p = Math.min(40, (c.worksCount - 30) / 4); s -= p; reasons.push(`established author (${c.worksCount} papers) −${r1(p)}`); }
  const nowY = new Date().getFullYear();
  if (c.firstPubYear !== null && c.firstPubYear < nowY - 8) { s -= 15; reasons.push(`publishing since ${c.firstPubYear} −15`); }

  // Founder signals (lib/sources/*): sum weights per source, capped at SOURCE_CAP each.
  const bySource = new Map<string, Signal[]>();
  for (const sig of c.signals ?? []) {
    const list = bySource.get(sig.source) ?? [];
    list.push(sig);
    bySource.set(sig.source, list);
  }
  for (const [src, list] of bySource) {
    const raw = list.reduce((a, x) => a + (Number.isFinite(x.weight) ? Math.max(0, x.weight) : 0), 0);
    const pts = r1(Math.min(SOURCE_CAP, raw));
    if (pts <= 0) continue;
    s += pts;
    reasons.push(`${src}: ${describe(list)} +${pts}`);
  }

  const fit = c.fit ?? [];
  if (fit.length) {
    const pts = fitPoints(fit);
    const yes = fit.filter((f) => f.verdict === "yes").length, part = fit.filter((f) => f.verdict === "partial").length;
    s += pts;
    reasons.push(`thesis fit: ${yes} yes, ${part} partial of ${fit.length} criteria +${pts}`);
  }

  c.reasons = reasons;
  return Math.round(s * 10) / 10;
}

export const SOURCE_CAP = 15;

function describe(list: Signal[]): string {
  const kinds = new Map<string, number>();
  for (const x of list) kinds.set(x.kind, (kinds.get(x.kind) ?? 0) + 1);
  const parts = [...kinds].map(([k, n]) => `${n} ${k}${n === 1 ? "" : "s"}`);
  const stars = list.reduce((a, x) => a + (Number(/(\d+(?:\.\d+)?k?)★/.exec(x.label)?.[1]?.replace("k", "e3")) || 0), 0);
  if (stars > 0) parts.push(`${stars >= 1000 ? r1(stars / 1000) + "k" : stars} stars`);
  return parts.join(", ");
}

const r1 = (n: number) => Math.round(n * 10) / 10;
