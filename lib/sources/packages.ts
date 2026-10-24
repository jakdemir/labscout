// Packages (PyPI + npm + crates.io + CRAN + Docker Hub) — builder signal (stage 2, wave 2): published packages with real monthly downloads.
// Wave 2: package names are derived from GitHub repo signals (and Hugging Face artifacts) found in wave 1.
// Endpoints (verified 200, no key):
//   https://pypi.org/pypi/<name>/json                       -> {info:{name, author, maintainer, home_page, project_urls, package_url}, urls:[{upload_time_iso_8601}]}
//   https://pypistats.org/api/packages/<name>/recent        -> {data:{last_day, last_week, last_month}}
//   https://registry.npmjs.org/<name>/latest                -> {name, repository:{url}|string, author:{name}|string, homepage}
//   https://api.npmjs.org/downloads/point/last-month/<name> -> {downloads}
//   https://crates.io/api/v1/crates/<name>  (403 without a User-Agent) -> {crate:{name, repository, homepage, recent_downloads (90 d), updated_at}}
//   https://crandb.r-pkg.org/<Name>         (404 unknown)               -> {Package, URL, BugReports, date}  (github links live in URL/BugReports)
//   https://cranlogs.r-pkg.org/downloads/total/last-month/<Name>         -> [{downloads, package}]  (200 + downloads 0 for unknown names)
//   https://hub.docker.com/v2/repositories/<ns>/<repo>/  (404 unknown)   -> {namespace, name, pull_count (lifetime), last_updated}
// Registry probes are gated to keep wave 2 inside its budget: crates.io only for repos whose GitHub label says Rust, CRAN only
// for R repos (case-sensitive name = repo name as-is), Docker Hub only for the top 3 repos.
// Quirk: the full npm packument (/<name>) can be many MB; /latest is small but has no publish time (date = null).
// Disambiguation: a package counts only if its metadata links the candidate's GitHub repo, or (for names without a
// repo, e.g. from HF) the PyPI/npm author namesMatch the candidate. Otherwise it is a namesake package.
import type { Candidate } from "../types.ts";
import type { Signal, SourceModule } from "./types.ts";
import { namesMatch } from "./match.ts";

export type PkgCandidate = { name: string; repo: string | null }; // repo = "owner/name" (lowercase) when from GitHub

const H = { "user-agent": "labscout/0.1 (jak@protocogni.com)" }; // crates.io rejects requests without a descriptive UA
const fmt = (n: number) => (n >= 1e9 ? `${Math.round(n / 1e8) / 10}B` : n >= 1e6 ? `${Math.round(n / 1e5) / 10}M` : n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));

async function get(url: string): Promise<any> {
  try {
    const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(12000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/** Package names to check: GitHub repo names (with -/_ variants) first, then HF model/space names; max 6 bases. */
export function packageCandidates(c: Candidate, max = 6): PkgCandidate[] {
  const out: PkgCandidate[] = [];
  const seen = new Set<string>();
  const add = (name: string, repo: string | null) => {
    const n = name.toLowerCase().replace(/\.git$/, "");
    if (!/^[a-z0-9][a-z0-9._-]{1,213}$/.test(n) || seen.has(n)) return;
    seen.add(n);
    out.push({ name: n, repo });
  };
  const bases: { name: string; repo: string | null }[] = [];
  for (const s of c.signals ?? []) {
    const gh = s.source === "github" && s.kind === "repo" && s.url?.match(/^https:\/\/github\.com\/([^/]+)\/([^/?#]+)/i);
    if (gh) bases.push({ name: gh[2], repo: `${gh[1]}/${gh[2]}`.toLowerCase() });
    const hf = s.source === "huggingface" && (s.kind === "model" || s.kind === "space") && s.url?.match(/huggingface\.co\/(?:spaces\/)?[^/]+\/([^/?#]+)/);
    if (hf) bases.push({ name: hf[1], repo: null });
  }
  for (const b of bases.slice(0, max)) {
    add(b.name, b.repo);
    add(b.name.replace(/_/g, "-"), b.repo);
    add(b.name.replace(/-/g, "_"), b.repo);
  }
  return out;
}

/** `text` links github.com/<repo> exactly (allowing .git, /subpath, #anchor; rejecting repo-suffix namesakes). */
export function linksRepo(text: string, repo: string): boolean {
  const esc = repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`github\\.com[/:]${esc}(?![\\w-]|\\.(?!git\\b))`).test(text.toLowerCase());
}

const authorNames = (s: unknown) => String(s ?? "").split(/,|;|\band\b/).map((x) => x.replace(/<[^>]*>/g, "").trim()).filter(Boolean);

/** True if PyPI metadata links the repo, or (no repo known) an author/maintainer name matches the candidate. */
export function pypiOwned(c: Candidate, info: any, repo: string | null): boolean {
  if (!info) return false;
  const links = [info.home_page, info.download_url, info.project_url, ...Object.values(info.project_urls ?? {})].join(" ").toLowerCase();
  if (repo) return linksRepo(links, repo);
  return [...authorNames(info.author), ...authorNames(info.maintainer)].some((n) => namesMatch(n, c.name));
}

/** Same for an npm /latest document. */
export function npmOwned(c: Candidate, doc: any, repo: string | null): boolean {
  if (!doc) return false;
  const r = typeof doc.repository === "string" ? doc.repository : doc.repository?.url;
  const links = `${r ?? ""} ${doc.homepage ?? ""} ${typeof doc.bugs === "string" ? doc.bugs : doc.bugs?.url ?? ""}`.toLowerCase();
  if (repo) return linksRepo(links, repo);
  const a = typeof doc.author === "string" ? doc.author.replace(/<.*$/, "") : doc.author?.name;
  return authorNames(a).some((n) => namesMatch(n, c.name));
}

export function packageSignal(registry: "PyPI" | "npm", name: string, monthly: number, date: string | null): Signal | null {
  const weight = Math.min(7, Math.round(Math.log10(monthly + 1) * 1.75));
  if (!(weight >= 1)) return null;
  const url = registry === "PyPI" ? `https://pypi.org/project/${name}/` : `https://www.npmjs.com/package/${name}`;
  return { source: "packages", stage: 2, kind: "package", label: `${registry} ${name} — ${fmt(monthly)} downloads/month`, url, date, weight };
}

/** Dedupe by url, highest weight first, total <= 15. */
export function capSignals(all: Signal[]): Signal[] {
  const out: Signal[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const s of [...all].sort((a, b) => b.weight - a.weight)) {
    if (seen.has(String(s.url)) || total + s.weight > 15) continue;
    seen.add(String(s.url));
    total += s.weight;
    out.push(s);
  }
  return out;
}

// ---- crates.io / CRAN / Docker Hub
export type RepoProbe = { owner: string; name: string; repo: string; lang: string | null }; // name keeps its case (CRAN); repo lowercase

/** GitHub repo signals (first `max`, same order as packageCandidates) with the language parsed from the github.ts label
 *  ("owner/name — 12★, 3 forks, Rust"). */
export function repoProbes(c: Candidate, max = 6): RepoProbe[] {
  const out: RepoProbe[] = [];
  for (const s of c.signals ?? []) {
    const gh = s.source === "github" && s.kind === "repo" && s.url?.match(/^https:\/\/github\.com\/([^/]+)\/([^/?#]+)/i);
    if (!gh) continue;
    const name = gh[2].replace(/\.git$/, "");
    const parts = String(s.label ?? "").split(" — ")[1]?.split(", ") ?? [];
    const last = parts.length >= 3 ? parts[parts.length - 1].trim() : "";
    out.push({ owner: gh[1], name, repo: `${gh[1]}/${name}`.toLowerCase(), lang: last && !/[★\d]/.test(last) ? last : null });
  }
  return out.slice(0, max);
}

/** Which registries to probe for which repo: crates.io = Rust repos, CRAN = R repos, Docker Hub = first 3 repos. */
export function registryPlan(probes: RepoProbe[]): { crates: RepoProbe[]; cran: RepoProbe[]; docker: RepoProbe[] } {
  return {
    crates: probes.filter((p) => p.lang?.toLowerCase() === "rust"),
    cran: probes.filter((p) => p.lang === "R"),
    docker: probes.slice(0, 3),
  };
}

const monthlyWeight = (monthly: number) => Math.min(7, Math.round(Math.log10(monthly + 1) * 1.75));

/** crates.io: crate.repository/homepage must link the repo; recent_downloads is 90 days -> monthly ≈ recent/3. */
export function crateSignal(doc: any, repo: string): Signal | null {
  const c = doc?.crate;
  if (!c || !linksRepo(`${c.repository ?? ""} ${c.homepage ?? ""}`, repo)) return null;
  const monthly = Math.round(Number(c.recent_downloads ?? 0) / 3);
  const weight = monthlyWeight(monthly);
  if (!(weight >= 1)) return null;
  const name = String(c.name ?? c.id);
  return { source: "packages", stage: 2, kind: "package", label: `crates.io ${name} — ${fmt(monthly)} downloads/mo`,
    url: `https://crates.io/crates/${name}`, date: c.updated_at ?? null, weight };
}

/** CRAN: the crandb URL / BugReports fields must link the repo; downloads from cranlogs last-month. */
export function cranSignal(doc: any, logs: any, repo: string): Signal | null {
  if (!doc?.Package || !linksRepo(`${doc.URL ?? ""} ${doc.BugReports ?? ""}`, repo)) return null;
  const monthly = Number((Array.isArray(logs) ? logs[0] : logs)?.downloads ?? 0);
  const weight = monthlyWeight(monthly);
  if (!(weight >= 1)) return null;
  return { source: "packages", stage: 2, kind: "package", label: `CRAN ${doc.Package} — ${fmt(monthly)} downloads/mo`,
    url: `https://cran.r-project.org/package=${doc.Package}`, date: doc.date ?? null, weight };
}

/** Docker Hub. Images carry no source-repo link, so ownership is weaker than the other registries: the Docker namespace
 *  must equal the GitHub login that owns the repo (case-insensitive) and the image name must equal the repo name.
 *  pull_count is lifetime (not monthly), hence the flatter weight min(5, round(log10(pulls+1))). */
export function dockerSignal(doc: any, p: Pick<RepoProbe, "owner" | "name">): Signal | null {
  if (!doc || String(doc.namespace ?? "").toLowerCase() !== p.owner.toLowerCase() || String(doc.name ?? "").toLowerCase() !== p.name.toLowerCase()) return null;
  const pulls = Number(doc.pull_count ?? 0);
  const weight = Math.min(5, Math.round(Math.log10(pulls + 1)));
  if (!(weight >= 1)) return null;
  const id = `${doc.namespace}/${doc.name}`;
  return { source: "packages", stage: 2, kind: "package", label: `Docker Hub ${id} — ${fmt(pulls)} pulls`,
    url: `https://hub.docker.com/r/${id}`, date: doc.last_updated ?? null, weight };
}

async function crates(p: RepoProbe): Promise<Signal | null> {
  return crateSignal(await get(`https://crates.io/api/v1/crates/${encodeURIComponent(p.name.toLowerCase())}`), p.repo);
}

async function cran(p: RepoProbe): Promise<Signal | null> {
  const doc = await get(`https://crandb.r-pkg.org/${encodeURIComponent(p.name)}`);
  if (!doc?.Package || !linksRepo(`${doc.URL ?? ""} ${doc.BugReports ?? ""}`, p.repo)) return null;
  return cranSignal(doc, await get(`https://cranlogs.r-pkg.org/downloads/total/last-month/${encodeURIComponent(doc.Package)}`), p.repo);
}

async function docker(p: RepoProbe): Promise<Signal | null> {
  const ns = p.owner.toLowerCase(), name = p.name.toLowerCase();
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(ns) || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(name)) return null; // not a valid Docker id
  return dockerSignal(await get(`https://hub.docker.com/v2/repositories/${ns}/${name}/`), p);
}

async function pypi(c: Candidate, p: PkgCandidate): Promise<Signal | null> {
  const j = await get(`https://pypi.org/pypi/${encodeURIComponent(p.name)}/json`);
  if (!pypiOwned(c, j?.info, p.repo)) return null;
  const name = String(j.info.name ?? p.name);
  const st = await get(`https://pypistats.org/api/packages/${encodeURIComponent(name.toLowerCase())}/recent`);
  const date = Array.isArray(j.urls) && j.urls[0]?.upload_time_iso_8601 ? j.urls[0].upload_time_iso_8601 : null;
  return packageSignal("PyPI", name, Number(st?.data?.last_month ?? 0), date);
}

async function npm(c: Candidate, p: PkgCandidate): Promise<Signal | null> {
  const d = await get(`https://registry.npmjs.org/${encodeURIComponent(p.name)}/latest`);
  if (!npmOwned(c, d, p.repo)) return null;
  const st = await get(`https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(p.name)}`);
  return packageSignal("npm", p.name, Number(st?.downloads ?? 0), null);
}

export const source: SourceModule = {
  id: "packages",
  wave: 2,
  enabled: () => true,
  async enrich(c: Candidate): Promise<Signal[]> {
    try {
      const cands = packageCandidates(c);
      if (!cands.length) return [];
      const plan = registryPlan(repoProbes(c));
      // PyPI treats -/_ as equivalent, so only probe one spelling per base there; npm gets every variant.
      const py = cands.filter((p, i) => cands.findIndex((q) => q.name.replace(/[-_.]/g, "-") === p.name.replace(/[-_.]/g, "-")) === i);
      const res = await Promise.all([...py.map((p) => pypi(c, p)), ...cands.map((p) => npm(c, p)),
        ...plan.crates.map(crates), ...plan.cran.map(cran), ...plan.docker.map(docker)]);
      return capSignals(res.filter((s): s is Signal => !!s));
    } catch {
      return [];
    }
  },
};
