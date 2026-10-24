// Semantic Scholar — research momentum (stage 1): citations to recent papers.
// Endpoints (all verified 200, keyless):
//   POST https://api.semanticscholar.org/graph/v1/paper/batch?fields=externalIds,authors   {ids:["DOI:…","ARXIV:…"]} (≤500)
//   POST https://api.semanticscholar.org/graph/v1/author/batch?fields=<author fields>        {ids:["116310873",…]}  (≤1000)
//   GET  https://api.semanticscholar.org/graph/v1/author/search?query=<name>                 (fallback)
// Optional S2_API_KEY (x-api-key). Unauthenticated works but is shared-rate-limited.
//
// 429 fix. lib/search.ts calls enrich() for 10 candidates at once. The old code sent 10 simultaneous author searches and
// the keyless pool answered 429 to 6–7 of them (live, 4 warm runs). Probing the keyless pool showed it sustains only about
// one request every 2–3 s after a burst of ~2, so per-candidate requests can't fit 10 candidates in 12 s however they
// are spaced (spacing alone at 400 ms made it worse: 9–17 429s with 15–20 requests). So now:
//  1. enrich() calls that arrive within BATCH_WINDOW_MS (30 ms) are coalesced. ONE paper/batch request resolves the
//     candidates' OpenAlex DOIs (arXiv DOIs sent as ARXIV:<id>, ≤20 per candidate) to author lists. An author whose name
//     namesMatch()es the candidate on one of the candidate's own papers is corroborated by that shared work. ONE
//     author/batch request then fetches stats for the best authorId per candidate (most shared papers).
//  2. Candidates whose papers S2 doesn't know (no DOIs / not indexed) fall back to author/search + matchS2Author (as
//     before). If S2 knows their papers but lists them only by initials ("T. Egg"), nothing is emitted (no initials).
//  3. Every request goes through a module-level start limiter (SPACING_MS 1100 keyless / 100 with key). On 429 the two
//     batch calls retry up to twice (after 2 s, then 4 s), author/search once (after 2 s). Requests that cannot START
//     within START_DEADLINE_MS (9 s) of the group are dropped. If a batch call is still 429, fallbacks are skipped.
// Budget (10 candidates, keyless): best case 2 requests ≈ 2.5 s. Worst case: paper/batch 0 s → 429 → 3 s → 429 → 8 s
// → 200 ≈ 9 s; author/batch can no longer start (> 9 s) -> []. No request starts after 9 s and each is aborted at
// min(12 s, deadline + 3 s), so S2 always settles by ≈12 s, inside the 14 s wave-1 budget.
// Live (scratch s2_probe.ts, same 10 NYC candidates, warm pool): before 6–7 of 10 requests 429, 1–3 candidates with a
// signal; after 3–4 requests total, 0–3 of them 429, 4–5 candidates with a signal in 4/5 runs, wall 2.5–10.9 s.
import type { Candidate } from "../types.ts";
import type { Signal, SourceModule } from "./types.ts";
import { mentionsInstitution, namesMatch, normalizeDoi, normalizeName, sharesWork } from "./match.ts";

export type S2Paper = { title: string | null; year: number | null; citationCount: number | null; externalIds?: Record<string, string | number> | null };
export type S2Author = { authorId: string; url: string; name: string; affiliations: string[] | null; paperCount: number | null; citationCount: number | null; hIndex: number | null; papers?: S2Paper[] | null };
export type S2BatchPaper = { paperId?: string; externalIds?: Record<string, string | number> | null; authors?: { authorId: string | null; name: string | null }[] } | null;

/** Pick the S2 author that matches name AND (affiliation evidence OR a shared paper title/DOI). */
export function matchS2Author(c: Candidate, authors: S2Author[]): S2Author | null {
  let best: S2Author | null = null, bestScore = 0;
  for (const a of authors ?? []) {
    if (!namesMatch(a.name, c.name)) continue;
    const shared = (a.papers ?? []).filter((p) => sharesWork(c, p.title, p.externalIds?.DOI as string | undefined)).length;
    const aff = (a.affiliations ?? []).some((x) => mentionsInstitution(x, c.institutions));
    if (!aff && shared === 0) continue;
    const s = shared + (aff ? 1 : 0);
    if (s > bestScore) { best = a; bestScore = s; }
  }
  return best;
}

export function s2ToSignals(a: S2Author, now = new Date()): Signal[] {
  const y = now.getFullYear(), from = y - 2;
  const recent = (a.papers ?? []).filter((p) => (p.year ?? 0) >= from);
  const n = recent.reduce((s, p) => s + (p.citationCount ?? 0), 0);
  if (n <= 0) return [];
  return [{
    source: "semanticscholar", stage: 1, kind: "citation_velocity",
    label: `S2: ${n} citations to ${from}-${String(y).slice(2)} papers, h-index ${a.hIndex ?? 0}`,
    url: a.url || `https://www.semanticscholar.org/author/${a.authorId}`,
    date: null, weight: Math.min(8, Math.max(1, Math.round(Math.log2(1 + n)))),
  }];
}

/** S2 paper id for an OpenAlex DOI: arXiv DOIs resolve better as ARXIV:<id>. */
export function s2PaperId(doi: string | null | undefined): string | null {
  const d = normalizeDoi(doi);
  if (!d) return null;
  const ax = d.match(/^10\.48550\/arxiv\.(.+)$/);
  return ax ? `ARXIV:${ax[1]}` : `DOI:${d}`;
}

/** namesMatch, plus given names written with/without a hyphen or space ("Ling-Ting Shi" = "Lingting Shi").
 *  Bare initials ("T. Egg", "J. L. Fan") never match. */
export function s2NameMatch(a: string, b: string): boolean {
  if (namesMatch(a, b)) return true;
  const pa = normalizeName(a).split(" "), pb = normalizeName(b).split(" ");
  if (pa.length < 2 || pb.length < 2 || pa[pa.length - 1] !== pb[pb.length - 1]) return false;
  const fa = pa.slice(0, -1).join(""), fb = pb.slice(0, -1).join("");
  const noInitials = [...pa, ...pb].every((t) => t.length > 1);
  return noInitials && fa.length > 3 && fa === fb;
}

const paperDoi = (p: NonNullable<S2BatchPaper>): string | undefined =>
  (p.externalIds?.DOI as string | undefined) ?? (p.externalIds?.ArXiv ? `10.48550/arXiv.${p.externalIds.ArXiv}` : undefined);

/** True if paper/batch found at least one of c's papers (then author/search can't do better than the paper author list). */
export function s2KnowsPapers(c: Candidate, papers: S2BatchPaper[]): boolean {
  return (papers ?? []).some((p) => p && sharesWork(c, null, paperDoi(p)));
}

/** Best S2 authorId for `c` from paper/batch results: an author on one of c's own papers (by DOI) whose name matches
 *  c.name (s2NameMatch; never bare initials). Most shared papers wins. */
export function authorIdFromPapers(c: Candidate, papers: S2BatchPaper[]): string | null {
  const count = new Map<string, number>();
  for (const p of papers ?? []) {
    if (!p || !sharesWork(c, null, paperDoi(p))) continue;
    for (const a of p.authors ?? []) if (a?.authorId && s2NameMatch(a.name ?? "", c.name)) count.set(a.authorId, (count.get(a.authorId) ?? 0) + 1);
  }
  let best: string | null = null, n = 0;
  for (const [id, k] of count) if (k > n) { best = id; n = k; }
  return best;
}

// ---- rate limiting (module scope: shared by every concurrent enrich() call in this process)
export const S2_LIMITS = { SPACING_MS: 1100, KEYED_SPACING_MS: 100, RETRY_MS: 2000, START_DEADLINE_MS: 9000, BATCH_WINDOW_MS: 30, MAX_IDS_PER_CANDIDATE: 20 };
let nextStart = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reserve the next start slot. Resolves true when it is time to send, false (no slot taken) if it would be after `deadline`. */
export async function s2Slot(deadline: number, spacing = process.env.S2_API_KEY ? S2_LIMITS.KEYED_SPACING_MS : S2_LIMITS.SPACING_MS): Promise<boolean> {
  const now = Date.now();
  const at = Math.max(now, nextStart);
  if (at > deadline) return false;
  nextStart = at + spacing;
  if (at > now) await sleep(at - now);
  return true;
}
export function _resetS2Limiter(): void { nextStart = 0; }

const FIELDS = "name,affiliations,paperCount,citationCount,hIndex,url,papers.title,papers.year,papers.citationCount,papers.externalIds";
const API = "https://api.semanticscholar.org/graph/v1";
type Got = { json: any; limited: boolean };

/** Request through the limiter with one retry on 429. json=null on any failure; limited=true if the last answer was 429. */
async function s2Fetch(url: string, deadline: number, body?: unknown, retries = 1): Promise<Got> {
  const headers: Record<string, string> = { "user-agent": "labscout/0.1" };
  if (process.env.S2_API_KEY) headers["x-api-key"] = process.env.S2_API_KEY;
  if (body) headers["content-type"] = "application/json";
  let limited = false;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (!(await s2Slot(deadline))) return { json: null, limited };
    try {
      const r = await fetch(url, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(Math.max(1000, Math.min(12000, deadline + 3000 - Date.now()))) });
      limited = r.status === 429;
      if (limited && attempt < retries) { await sleep(S2_LIMITS.RETRY_MS * (attempt + 1)); continue; }
      if (!r.ok) return { json: null, limited };
      return { json: await r.json(), limited: false };
    } catch {
      return { json: null, limited };
    }
  }
  return { json: null, limited };
}

async function searchFallback(c: Candidate, deadline: number): Promise<Signal[]> {
  const { json } = await s2Fetch(`${API}/author/search?query=${encodeURIComponent(c.name)}&fields=${FIELDS}&limit=5`, deadline);
  const a = matchS2Author(c, Array.isArray(json?.data) ? json.data : []);
  return a ? s2ToSignals(a) : [];
}

/** Resolve a group of candidates: 1 paper/batch + 1 author/batch, then author/search for the rest. Never throws. */
export async function resolveGroup(cands: Candidate[]): Promise<Signal[][]> {
  const deadline = Date.now() + S2_LIMITS.START_DEADLINE_MS;
  const out: (Signal[] | null)[] = cands.map(() => null);   // null = still unresolved -> author/search fallback
  let exhausted = false;
  try {
    const ids = [...new Set(cands.flatMap((c) => (c.works ?? []).map((w) => s2PaperId(w.doi)).filter((x): x is string => !!x)
      .slice(0, S2_LIMITS.MAX_IDS_PER_CANDIDATE)))].slice(0, 500);
    if (ids.length) {
      const pb = await s2Fetch(`${API}/paper/batch?fields=externalIds,authors`, deadline, { ids }, 2);
      exhausted = pb.limited;
      const papers: S2BatchPaper[] = Array.isArray(pb.json) ? pb.json : [];
      const aids = cands.map((c) => authorIdFromPapers(c, papers));
      // S2 has the candidate's papers but no name-matching author on them (e.g. listed as "T. Egg"): search won't help.
      cands.forEach((c, i) => { if (!aids[i] && s2KnowsPapers(c, papers)) out[i] = []; });
      const want = [...new Set(aids.filter((x): x is string => !!x))];
      if (want.length) {
        const ab = await s2Fetch(`${API}/author/batch?fields=${FIELDS}`, deadline, { ids: want }, 2);
        exhausted ||= ab.limited;
        const byId = new Map<string, S2Author>((Array.isArray(ab.json) ? ab.json : []).filter((a: any) => a?.authorId).map((a: S2Author) => [a.authorId, a]));
        aids.forEach((id, i) => { const a = id ? byId.get(id) : undefined; if (a) out[i] = s2ToSignals(a); });
      }
    }
  } catch { /* fall through to per-candidate search */ }
  if (exhausted) return out.map((s) => s ?? []);
  return Promise.all(out.map(async (s, i) => s ?? (cands[i]?.name ? searchFallback(cands[i], deadline).catch(() => []) : [])));
}

// ---- coalescing: concurrent enrich() calls within BATCH_WINDOW_MS share one resolveGroup()
let pending: { c: Candidate; resolve: (s: Signal[]) => void }[] | null = null;
function enqueue(c: Candidate): Promise<Signal[]> {
  return new Promise((resolve) => {
    if (!pending) {
      const group: { c: Candidate; resolve: (s: Signal[]) => void }[] = (pending = []);
      setTimeout(async () => {
        if (pending === group) pending = null;
        let res: Signal[][] = [];
        try { res = await resolveGroup(group.map((g) => g.c)); } catch { /* [] */ }
        group.forEach((g, i) => g.resolve(res[i] ?? []));
      }, S2_LIMITS.BATCH_WINDOW_MS);
    }
    pending.push({ c, resolve });
  });
}

export const source: SourceModule = {
  id: "semanticscholar",
  enabled: () => true,
  async enrich(c: Candidate): Promise<Signal[]> {
    try {
      if (!c?.name) return [];
      return await enqueue(c);
    } catch {
      return [];
    }
  },
};
