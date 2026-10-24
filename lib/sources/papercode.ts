// Paper code — builder signal (stage 2, wave 2): the GitHub repository that implements one of the candidate's papers.
// github.ts finds repos through the candidate's *account*; this finds them through the *paper* — code published under a
// lab org (cambrian-mllm/cambrian) or a handle that never matched is otherwise invisible.
// Ported from negarmaleki96/spinout-intelligence (paper→repo matching + README/root-path analysis), tightened for VC use:
// a repo that merely cites the paper is NOT the paper's code — it becomes a count ("N repos cite this paper"), never a repo card.
// Endpoints (verified 200 with GITHUB_TOKEN; REST search = 30 req/min, so ≤2 searches per candidate):
//   https://api.github.com/search/repositories?q="2406.16860" in:readme&per_page=5     -> {total_count, items:[{full_name, html_url, description, stargazers_count, forks_count, pushed_at, language, fork, archived, owner:{login}}]}
//   https://api.github.com/repos/<o>/<r>/readme   (Accept: application/vnd.github.raw+json) -> README text
//   https://api.github.com/repos/<o>/<r>/contents -> [{name, type}] root entries
// Quirk: repository search does NOT look at README text unless the query carries `in:readme`; a bare quoted title or
// arXiv id returns 0 hits. arXiv ids beat DOIs beat titles (titles pull in awesome-lists and surveys).
// Ownership evidence (one needed, plus the paper reference in the README head): repo owner = the candidate's GitHub login
// (wave-1 github profile), the candidate's name in the README, an "official / code for our paper" phrase, the paper title
// as the repo description, or a CITATION.cff at the root.
import type { Candidate, Work } from "../types.ts";
import type { Signal, SourceModule } from "./types.ts";
import { normalizeDoi, normalizeName, normalizeTitle } from "./match.ts";

export type GhSearchRepo = {
  full_name: string; html_url: string; description: string | null; stargazers_count: number; forks_count: number;
  pushed_at: string | null; language: string | null; fork?: boolean; archived?: boolean; owner?: { login?: string };
};
export type RepoContents = { readme: string; paths: string[] };
export type PaperQuery = { work: Work; q: string; key: "arxiv" | "doi" | "title"; ref: string };
export type Maturity = "packaged" | "notebooks" | "scripts" | "docs only";
export type RepoAnalysis = { official: boolean; maturity: Maturity; evidence: string[] };

const MONTH = 30 * 24 * 3600 * 1000;
const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));
const H = () => ({ authorization: "bearer " + process.env.GITHUB_TOKEN, "user-agent": "labscout/0.1", accept: "application/vnd.github+json" });

export function arxivId(w: Pick<Work, "doi" | "url">): string | null {
  const m = `${w.doi ?? ""} ${w.url ?? ""}`.match(/(?:arxiv\.|arxiv\.org\/(?:abs|pdf|html)\/)(\d{4}\.\d{4,5})/i);
  return m ? m[1] : null;
}

/** ≤`max` search queries: first-author works first, then by citations. arXiv id > DOI > exact title (25–150 chars). */
export function paperQueries(c: Candidate, max = 2): PaperQuery[] {
  const works = [...(c.works ?? [])].sort((a, b) => Number(b.position === "first") - Number(a.position === "first") || (b.citedBy ?? 0) - (a.citedBy ?? 0));
  const out: PaperQuery[] = [];
  const seen = new Set<string>();
  for (const w of works) {
    if (out.length >= max) break;
    const id = arxivId(w), doi = id ? null : normalizeDoi(w.doi);
    const title = String(w.title ?? "").replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
    let q: PaperQuery | null = null;
    if (id) q = { work: w, q: `"${id}" in:readme`, key: "arxiv", ref: id };
    else if (doi) q = { work: w, q: `"${doi}" in:readme`, key: "doi", ref: doi };
    else if (title.length >= 25 && title.length <= 150) q = { work: w, q: `"${title}" in:readme,description`, key: "title", ref: title };
    if (!q || seen.has(q.ref)) continue;
    seen.add(q.ref);
    out.push(q);
  }
  return out;
}

/** Awesome-lists, paper feeds, surveys, course notes: they cite everything and implement nothing. */
export function isListRepo(r: Pick<GhSearchRepo, "full_name" | "description">): boolean {
  const t = `${r.full_name} ${r.description ?? ""}`.toLowerCase();
  return /awesome|paper[\s_-]?list|reading[\s_-]?list|arxiv[\s_-]?daily|daily[\s_-]?(arxiv|paper)|survey|curated|collection of|paper[\s_-]?notes|tutorial|course/.test(t);
}

/** The candidate's GitHub login from the wave-1 github profile signal, lowercase, or null. */
export function ghLogin(c: Candidate): string | null {
  const s = (c.signals ?? []).find((x) => x.source === "github" && x.kind === "profile");
  const m = s?.url?.match(/^https?:\/\/(?:www\.)?github\.com\/([\w-]+)\/?$/i);
  return m ? m[1].toLowerCase() : null;
}

/** Repos github.ts already credited to the candidate (lowercase "owner/name"). */
export function knownRepos(c: Candidate): Set<string> {
  const out = new Set<string>();
  for (const s of c.signals ?? []) {
    const m = s.source === "github" && s.kind === "repo" && s.url?.match(/^https?:\/\/(?:www\.)?github\.com\/([\w.-]+\/[\w.-]+)/i);
    if (m) out.add(m[1].toLowerCase());
  }
  return out;
}

const CONFIG = new Set(["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "environment.yml", "environment.yaml", "package.json", "cargo.toml", "go.mod", "dockerfile", "pixi.toml", "cmakelists.txt", "makefile"]);
const CODE = /\.(py|ipynb|r|jl|java|cpp|cc|c|h|js|ts|go|rs|m|cu|sh)$/i;
const OFFICIAL = /\b(official (code|implementation|repo|repository|release|pytorch|source)|this (repo|repository) (contains|is|provides|hosts|holds|accompanies)|(code|implementation|data( and code)?|source code) (for|of|accompanying) (the|our) (paper|work|article|preprint)|accompanying code|code to reproduce|reproduce (the|our) (results|experiments|paper))\b/i;
const UNOFFICIAL = /\b(unofficial|re-?implementation|reimpl\w*|port of|from scratch|minimal implementation|my implementation|inspired by|based on the paper)\b/i;

/** Short name of a paper: the part before ":" when it is 1–2 tokens ("Mamba: Linear-Time…" -> "mamba"), else null. */
export function shortName(title: string): string | null {
  const m = String(title ?? "").split(/[:—–-]\s/)[0];
  if (!m || m === title) return null;
  const n = normalizeName(m).replace(/\s+/g, "");
  return n.length >= 3 && m.trim().split(/\s+/).length <= 2 ? n : null;
}

export function maturityOf(paths: string[]): Maturity {
  const names = paths.map((p) => p.toLowerCase());
  if (names.some((n) => CONFIG.has(n))) return "packaged";
  if (names.some((n) => n.endsWith(".ipynb"))) return "notebooks";
  if (names.some((n) => CODE.test(n) || ["src", "lib", "scripts", "code"].includes(n))) return "scripts";
  return "docs only";
}

/** Is `repo` the code for `q.work`? null when the README does not reference the paper at all (or the repo is a list). */
export function analyzeRepo(c: Candidate, q: PaperQuery, repo: GhSearchRepo, contents: RepoContents, login: string | null): RepoAnalysis | null {
  if (isListRepo(repo)) return null;
  const readme = contents.readme ?? "", head = readme.slice(0, 2500);
  const nTitle = normalizeTitle(q.work.title ?? ""), nDesc = normalizeTitle(repo.description ?? "");
  const refIn = (s: string) => q.key === "title" ? normalizeTitle(s).includes(nTitle) : s.toLowerCase().includes(q.ref.toLowerCase());
  const titleIn = (s: string) => nTitle.length > 10 && normalizeTitle(s).includes(nTitle);
  const refHead = refIn(head) || titleIn(head), refAny = refHead || refIn(readme) || titleIn(readme) || titleIn(repo.description ?? "");
  if (!refAny) return null;
  const evidence: string[] = [];
  const owner = (repo.owner?.login ?? repo.full_name.split("/")[0]).toLowerCase();
  if (login && owner === login) evidence.push(`owned by the candidate's GitHub account @${login}`);
  // Everything below reads the README head only: a downstream repo cites the paper (BibTeX, author list) at the bottom;
  // the paper's own repo puts the title, authors and "official" line at the top.
  if (refHead && !UNOFFICIAL.test(head)) {
    const name = normalizeName(c.name);
    if (name && normalizeName(head).includes(name)) evidence.push("candidate named in README");
    if (OFFICIAL.test(head)) evidence.push("README says it is the paper's code");
    if (nTitle.length > 10 && (nDesc === nTitle || nDesc.includes(nTitle))) evidence.push("repo description is the paper title");
    if (contents.paths.some((p) => p.toLowerCase() === "citation.cff")) evidence.push("CITATION.cff");
    const sn = shortName(q.work.title ?? "");
    if (!evidence.length && sn && normalizeName(repo.full_name.split("/")[1] ?? "").replace(/\s+/g, "") === sn) evidence.push(`repo is named after the paper (${sn})`);
  }
  return { official: evidence.length > 0, maturity: maturityOf(contents.paths), evidence };
}

export function repoSignal(q: PaperQuery, repo: GhSearchRepo, a: RepoAnalysis, now = Date.now()): Signal {
  const pushed = repo.pushed_at ? Date.parse(repo.pushed_at) : NaN;
  const recent = Number.isFinite(pushed) && now - pushed <= 6 * MONTH && !repo.archived;
  const stars = repo.stargazers_count ?? 0;
  const weight = Math.min(9, 3 + Math.min(4, Math.round(Math.log10(stars + 1) * 1.5)) + (a.maturity === "packaged" ? 1 : 0) + (recent ? 1 : 0));
  const title = String(q.work.title ?? "").replace(/\s+/g, " ").trim();
  const bits = [`${fmt(stars)}★`, repo.language ?? "", a.maturity, repo.archived ? "archived" : ""].filter(Boolean).join(", ");
  return { source: "papercode", stage: 2, kind: "paper_code", label: `Code for "${title}": ${repo.full_name} — ${bits} (${a.evidence[0]})`,
    url: repo.html_url, date: repo.pushed_at ?? null, weight };
}

/** "N repos cite this paper" from the search total — only for id-keyed queries (title search is too loose). */
export function citedBySignal(q: PaperQuery, total: number): Signal | null {
  if (q.key === "title" || !(total >= 3)) return null;
  const title = String(q.work.title ?? "").replace(/\s+/g, " ").trim();
  return { source: "papercode", stage: 2, kind: "cited_by_repos", label: `${total} GitHub repos cite "${title}"`,
    url: `https://github.com/search?q=${encodeURIComponent(q.q)}&type=repositories`, date: null, weight: total >= 30 ? 3 : total >= 10 ? 2 : 1 };
}

/** Highest-weight first, ≤2 repo signals, ≤2 citation counts, total ≤ 15. */
export function capSignals(repos: Signal[], cites: Signal[]): Signal[] {
  const out: Signal[] = [];
  let total = 0;
  for (const s of [...repos.sort((a, b) => b.weight - a.weight).slice(0, 2), ...cites.sort((a, b) => b.weight - a.weight).slice(0, 2)]) {
    const w = Math.min(s.weight, 15 - total);
    if (w <= 0) continue;
    total += w;
    out.push({ ...s, weight: w });
  }
  return out;
}

async function get(url: string, accept?: string): Promise<Response | null> {
  try {
    const r = await fetch(url, { headers: { ...H(), ...(accept ? { accept } : {}) }, signal: AbortSignal.timeout(12000) });
    return r.ok ? r : null;
  } catch { return null; }
}

export async function fetchContents(fullName: string): Promise<RepoContents> {
  const [rd, ct] = await Promise.all([
    get(`https://api.github.com/repos/${fullName}/readme`, "application/vnd.github.raw+json"),
    get(`https://api.github.com/repos/${fullName}/contents`),
  ]);
  let readme = "";
  try { readme = rd ? (await rd.text()).slice(0, 100000) : ""; } catch { readme = ""; }
  let paths: string[] = [];
  try { const j: any = ct ? await ct.json() : null; paths = Array.isArray(j) ? j.map((x: any) => String(x?.name ?? "")).filter(Boolean) : []; } catch { paths = []; }
  return { readme, paths };
}

export const source: SourceModule = {
  id: "papercode",
  wave: 2,
  enabled: () => !!process.env.GITHUB_TOKEN,
  async enrich(c: Candidate): Promise<Signal[]> {
    try {
      const queries = paperQueries(c);
      if (!queries.length) return [];
      const login = ghLogin(c), known = knownRepos(c);
      const results = await Promise.all(queries.map(async (q) => {
        const r = await get(`https://api.github.com/search/repositories?q=${encodeURIComponent(q.q)}&per_page=5`);
        const j: any = r ? await r.json().catch(() => null) : null;
        return { q, total: Number(j?.total_count ?? 0), items: (Array.isArray(j?.items) ? j.items : []) as GhSearchRepo[] };
      }));
      const cites = results.map((r) => citedBySignal(r.q, r.total)).filter((s): s is Signal => !!s);
      const seen = new Set<string>();
      const picks: { q: PaperQuery; repo: GhSearchRepo }[] = [];
      for (const r of results) {
        let n = 0;
        for (const repo of r.items) {
          const key = String(repo?.full_name ?? "").toLowerCase();
          if (!key || repo.fork || seen.has(key) || known.has(key) || isListRepo(repo) || n >= 3) continue;
          seen.add(key); picks.push({ q: r.q, repo }); n++;
        }
      }
      const analyzed = await Promise.all(picks.slice(0, 4).map(async ({ q, repo }) => {
        const a = analyzeRepo(c, q, repo, await fetchContents(repo.full_name), login);
        return a?.official ? repoSignal(q, repo, a) : null;
      }));
      return capSignals(analyzed.filter((s): s is Signal => !!s), cites);
    } catch {
      return [];
    }
  },
};
