import { NYC_INSTITUTIONS } from "./institutions.ts";

const BASE = "https://api.openalex.org";

/** `mailto` identifies us; `api_key` (free, $1/day own budget) escapes the per-IP daily budget that the
 *  keyless tier shares with everyone on the same network — Vercel's egress IPs run out mid-afternoon. */
export const oaParams = () =>
  (process.env.OPENALEX_MAILTO ? `&mailto=${process.env.OPENALEX_MAILTO}` : "") +
  (process.env.OPENALEX_API_KEY ? `&api_key=${process.env.OPENALEX_API_KEY}` : "");

export const INSTITUTION_IDS = Object.keys(NYC_INSTITUTIONS).map((u) => u.replace("https://openalex.org/", ""));

/** Works search, one query PER institution (in parallel), merged and deduped by work id.
 *  A single query filtered to all institutions returns the 50 most relevant works, and for topics where one
 *  school dominates (Cornell for materials/batteries) that is 50 works from one school — every other campus
 *  disappears before ranking even starts. Per-institution fetch gives each school its own slice of the pool;
 *  the ranking stays merit-based. One failed query (429 budget) drops that school, not the search. */
export async function searchWorks(keywords: string, perPage = 30, institutionIds: string[] = INSTITUTION_IDS): Promise<any[]> {
  const results = await Promise.all(institutionIds.map((id) => searchWorksAt(keywords, id, perPage)));
  const seen = new Set<string>();
  const out: any[] = [];
  for (const list of results) for (const w of list) if (w?.id && !seen.has(w.id)) { seen.add(w.id); out.push(w); }
  if (out.length === 0 && results.every((r) => r === EMPTY_FAILED)) throw new Error("OpenAlex works: every institution query failed");
  return out;
}

const EMPTY_FAILED: any[] = [];
async function searchWorksAt(keywords: string, institutionId: string, perPage: number): Promise<any[]> {
  const url = `${BASE}/works?search=${encodeURIComponent(keywords)}&filter=authorships.institutions.id:${institutionId},publication_year:2024-2026&per-page=${perPage}&select=id,title,publication_year,authorships,primary_location,cited_by_count,doi${oaParams()}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return EMPTY_FAILED;
    return (await r.json()).results ?? [];
  } catch { return EMPTY_FAILED; }
}

export type AuthorStats = { worksCount: number | null; citedByCount: number | null; firstPubYear: number | null; recentWorksCount: number | null };
const UNKNOWN: AuthorStats = { worksCount: null, citedByCount: null, firstPubYear: null, recentWorksCount: null };

/** Author stats for many authors in ONE request (filter=ids.openalex:A|B|C) instead of one request each.
 *  Unknown on failure (null, never 0): a 0 would read as "no publication record" and silently lift a
 *  700-paper PI past the established-author penalty. */
export async function getAuthors(authorIds: string[]): Promise<Map<string, AuthorStats>> {
  const out = new Map<string, AuthorStats>();
  const ids = [...new Set(authorIds.map((a) => a.replace("https://openalex.org/", "")).filter(Boolean))];
  if (!ids.length) return out;
  try {
    const r = await fetch(`${BASE}/authors?filter=ids.openalex:${ids.join("|")}&per-page=${Math.max(ids.length, 1)}&select=id,works_count,cited_by_count,counts_by_year${oaParams()}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return out;
    for (const a of (await r.json()).results ?? []) out.set(String(a.id).replace("https://openalex.org/", ""), toStats(a));
  } catch { /* unknown */ }
  return out;
}

export function toStats(a: any): AuthorStats {
  const years = (a.counts_by_year ?? []).map((y: any) => y.year).filter((y: number) => !!y);
  const nowY = new Date().getFullYear();
  const recent = (a.counts_by_year ?? []).filter((y: any) => y.year >= nowY - 1).reduce((n: number, y: any) => n + (y.works_count ?? 0), 0);
  return { worksCount: a.works_count ?? null, citedByCount: a.cited_by_count ?? null, firstPubYear: years.length ? Math.min(...years) : null, recentWorksCount: a.counts_by_year ? recent : null };
}

/** Single-author stats (kept for callers outside the search pipeline). */
export async function getAuthor(authorId: string): Promise<AuthorStats> {
  return (await getAuthors([authorId])).get(authorId.replace("https://openalex.org/", "")) ?? UNKNOWN;
}
