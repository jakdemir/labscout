import { aggregate, shortlist } from "./aggregate.ts";
import { score, isCurrentStudent } from "./score.ts";
import { searchWorks, getAuthors } from "./openalex.ts";
import { getEducation } from "./orcid.ts";
import { parseQuery, writeBrief, checkFit, sessionFor } from "./llm.ts";
import { cleanCriteria } from "./fit.ts";
import { marketSignals, personMentions, aktaEnabled } from "./akta.ts";
import { saveShortlist, readShortlist, parseShortlist, diffShortlist, roundtableEnabled } from "./roundtable.ts";
import { trace, prismEnabled } from "./prism.ts";
import { SOURCES } from "./sources/index.ts";
import type { SourceContext, SourceId, SourceModule } from "./sources/types.ts";
import type { Candidate, SearchResponse, SourceCoverage } from "./types.ts";

const cache = new Map<string, SearchResponse>();

// Per-wave budgets: 14 s + 9 s keeps signal collection well inside the 60 s function limit.
const WAVE_TIMEOUT_MS = { 1: 14000, 2: 9000 } as const;

// Why a source is off. Shown in the search-result source coverage so a missing source is never silent.
const OFF_REASON: Partial<Record<SourceId, string>> = {
  github: "needs GITHUB_TOKEN", papercode: "needs GITHUB_TOKEN", releases: "needs GITHUB_TOKEN",
  patentsview: "needs PATENTSVIEW_API_KEY (USPTO moved PatentsView to the Open Data Portal)",
  sbir: "SBIR.gov API is down (HTTP 403, maintenance)",
};

/** Runs every enabled source on every candidate in parallel, in two waves (wave 2 may read wave-1 signals).
 *  One source can never break or stall the search. Returns per-source coverage for the result view. */
export async function collectSignals(cands: Candidate[], ctx: SourceContext, sources: SourceModule[] = SOURCES): Promise<SourceCoverage[]> {
  const cov = new Map<SourceId, SourceCoverage>();
  const active: SourceModule[] = [];
  for (const s of sources) {
    let on = false;
    try { on = s.enabled(); } catch { /* treat as off */ }
    cov.set(s.id, { id: s.id, wave: s.wave ?? 1, status: on ? "none" : "off", candidates: 0, signals: 0, timeouts: 0, ms: 0, ...(on ? {} : { reason: OFF_REASON[s.id] ?? "disabled" }) });
    if (on) active.push(s);
  }
  await runWave(cands, ctx, active.filter((s) => (s.wave ?? 1) === 1), WAVE_TIMEOUT_MS[1], cov);
  await runWave(cands, ctx, active.filter((s) => s.wave === 2), WAVE_TIMEOUT_MS[2], cov);
  return [...cov.values()];
}

async function runWave(cands: Candidate[], ctx: SourceContext, active: SourceModule[], timeoutMs: number, cov: Map<SourceId, SourceCoverage>): Promise<void> {
  if (!active.length) return;
  await Promise.all(cands.flatMap((c) => {
    c.signals ??= [];
    return active.map(async (s) => {
      const row = cov.get(s.id)!;
      const t0 = Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
        const out = await Promise.race([s.enrich(c, ctx), timeout]);
        if (out === null) row.timeouts++;
        const got = Array.isArray(out) ? out.filter((x) => x && typeof x.label === "string") : [];
        if (got.length) { c.signals.push(...got); row.signals += got.length; row.candidates++; row.status = "hit"; }
      } catch { /* source failures are non-fatal */ } finally {
        clearTimeout(timer);
        row.ms = Math.max(row.ms, Date.now() - t0);
      }
    });
  }));
}

export async function runSearch(q: string, criteriaIn: unknown = []): Promise<SearchResponse> {
  const criteria = cleanCriteria(criteriaIn);
  const key = criteria.length ? `${q}\u0000${criteria.join("|")}` : q;
  const hit = cache.get(key);
  if (hit) return hit;
  const t0 = Date.now();
  // Previous saved shortlist for this thesis ("since last run"). Starts now so it costs no wall time.
  const prevP = readShortlist(q);
  const { keywords } = await parseQuery(q);
  // akta.pro market pull runs in parallel with the academic search
  const marketP = marketSignals(keywords);
  const works = await searchWorks(keywords);
  const candidates = aggregate(works);
  candidates.forEach((c) => (c.score = score(c)));
  candidates.sort((a, b) => b.score - a.score);
  // Per-institution works fetch (lib/openalex.ts) so one dominant school can't fill the pool; the shortlist keeps
  // ≥5 seats per campus family (Cornell+Cornell Tech = one) for enrichment; the final 10 are pure score.
  const top = shortlist(candidates, 20, 5);
  // Author stats for all 20 in ONE OpenAlex call (rate budget), ORCID education per candidate in parallel.
  const [stats, educations] = await Promise.all([
    getAuthors(top.map((c) => c.authorId)),
    Promise.all(top.map((c) => getEducation(c.orcid))),
  ]);
  top.forEach((c, i) => {
    const author = stats.get(c.authorId.replace("https://openalex.org/", "")) ?? {};
    const education = educations[i];
    Object.assign(c, author, { education, isCurrentStudent: isCurrentStudent(education, { worksCount: c.worksCount, firstPubYear: c.firstPubYear, ...author }) });
    c.score = score(c);
  });
  top.sort((a, b) => b.score - a.score);
  // Founder signals (GitHub, arXiv, NSF, ...): every enabled source on each of the top 10, all in parallel.
  const sources = await collectSignals(top.slice(0, 10), { query: q, keywords });
  top.forEach((c) => (c.score = score(c)));
  top.sort((a, b) => b.score - a.score);
  const final = top.slice(0, 10);
  // Briefs, thesis-fit checks and press mentions all run in parallel.
  await Promise.all([
    ...final.map(async (c) => { try { c.brief = await writeBrief(c, q); } catch { c.brief = null; } }),
    ...final.map(async (c) => { try { c.fit = await checkFit(c, criteria, q); } catch { c.fit = []; } }),
    ...final.slice(0, 5).map(async (c) => { c.mentions = (await personMentions(c.name, 3, [...c.institutions, ...keywords.split(/\s+/)])).slice(0, 3); }),
  ]);
  if (criteria.length) { final.forEach((c) => (c.score = score(c))); final.sort((a, b) => b.score - a.score); }
  const market = await marketP;
  const prevMd = await prevP;
  const prev = prevMd ? parseShortlist(prevMd) : null;
  const changes = prev && prev.names.length ? diffShortlist(prev, final.map((c) => c.name)) : null;
  const roundtable = await saveShortlist(q, keywords, final);
  const tookMs = Date.now() - t0;
  const payload: SearchResponse = {
    query: q, keywords, criteria, totalWorks: works.length, candidates: final, market, roundtable, changes, tookMs, sources,
    integrations: { nicrron: true, prism: prismEnabled(), akta: aktaEnabled(), roundtable: roundtableEnabled() },
  };
  // One summary trace per search so PRISM shows the whole run, not only the model calls.
  void trace({ model: "labscout-pipeline", input: q, output: `${final.length} candidates; top: ${final.map((c) => c.name).join(", ")}`,
    latencyMs: tookMs, sessionId: sessionFor(q), agentId: "search-orchestrator",
    metadata: { keywords, criteria: criteria.length, totalWorks: works.length, market: market.length, roundtable: roundtable?.path ?? null, newSinceLastRun: changes?.added.length ?? null } });
  cache.set(key, payload);
  return payload;
}
