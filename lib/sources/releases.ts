// Releases — builder signal (stage 2, wave 2): GitHub release cadence on the candidate's repos. Shipping versioned
// releases repeatedly (not just pushing commits) is a product habit; asset downloads show someone installs them.
// Wave 2: repos come from wave-1 github "repo" signals and papercode "paper_code" signals (highest weight first, ≤6).
// Endpoint (verified 200 with GITHUB_TOKEN; 404 for unknown repos):
//   https://api.github.com/repos/<o>/<r>/releases?per_page=30
//     -> [{tag_name, published_at, draft, prerelease, html_url, assets:[{name, download_count}]}] newest first
// Quirks: per_page=30 is one page only, so a repo with ≥30 releases in 12 months is labelled "30+". Drafts are skipped
// (published_at is null for them anyway); prereleases count — an rc is still a ship. Repos with no releases return [].
import type { Candidate } from "../types.ts";
import type { Signal, SourceModule } from "./types.ts";
import { capTotal } from "./entity.ts";

export type GhRelease = {
  tag_name: string; published_at: string | null; draft?: boolean; prerelease?: boolean; html_url: string;
  assets?: { name?: string; download_count?: number }[];
};
export type RepoRef = { owner: string; name: string; weight: number };

const YEAR = 365 * 24 * 3600 * 1000;
const PER_PAGE = 30;
const fmt = (n: number) => (n >= 1e9 ? `${Math.round(n / 1e8) / 10}B` : n >= 1e6 ? `${Math.round(n / 1e5) / 10}M` : n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));

/** github.com repos from wave-1 github repo signals and papercode paper_code signals; deduped, highest weight first. */
export function releaseRepos(c: Candidate, max = 6): RepoRef[] {
  const best = new Map<string, RepoRef>();
  for (const s of c.signals ?? []) {
    const ok = (s.source === "github" && s.kind === "repo") || (s.source === "papercode" && s.kind === "paper_code");
    const m = ok && s.url?.match(/^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#]|$)/i);
    if (!m) continue;
    const key = `${m[1]}/${m[2]}`.toLowerCase();
    const prev = best.get(key);
    if (!prev || s.weight > prev.weight) best.set(key, { owner: m[1], name: m[2], weight: s.weight });
  }
  return [...best.values()].sort((a, b) => b.weight - a.weight).slice(0, max);
}

/** One release_cadence signal when ≥2 non-draft releases were published in the last 12 months, else null. */
export function cadenceSignal(repo: string, releases: GhRelease[], now = Date.now()): Signal | null {
  if (!Array.isArray(releases)) return null;
  const recent = releases
    .filter((r) => r && !r.draft && r.published_at && now - Date.parse(r.published_at) <= YEAR && Date.parse(r.published_at) <= now + 864e5)
    .sort((a, b) => Date.parse(b.published_at!) - Date.parse(a.published_at!));
  const n = recent.length;
  if (n < 2) return null;
  const downloads = recent.reduce((a, r) => a + (r.assets ?? []).reduce((x, as) => x + (Number(as?.download_count) || 0), 0), 0);
  const weight = Math.min(5, 1 + Math.floor(n / 3)) + (downloads >= 1000 ? 1 : 0);
  const latest = recent[0];
  const count = n >= PER_PAGE && releases.length >= PER_PAGE ? `${PER_PAGE}+` : String(n);
  const label = `${repo}: ${count} releases in 12 mo, latest ${latest.tag_name} (${latest.published_at!.slice(0, 10)})${downloads > 0 ? ` — ${fmt(downloads)} downloads` : ""}`;
  return { source: "releases", stage: 2, kind: "release_cadence", label, url: latest.html_url || `https://github.com/${repo}/releases`, date: latest.published_at, weight };
}

/** ≤3 repos, highest weight first, source total ≤ 15. */
export function capReleaseSignals(sig: Signal[]): Signal[] {
  return capTotal([...sig].sort((a, b) => b.weight - a.weight).slice(0, 3));
}

async function releases(r: RepoRef): Promise<GhRelease[]> {
  try {
    const res = await fetch(`https://api.github.com/repos/${r.owner}/${r.name}/releases?per_page=${PER_PAGE}`, {
      headers: { authorization: "Bearer " + process.env.GITHUB_TOKEN, accept: "application/vnd.github+json", "user-agent": "labscout/0.1" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return [];
    const j: any = await res.json().catch(() => null);
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}

export const source: SourceModule = {
  id: "releases",
  wave: 2,
  enabled: () => !!process.env.GITHUB_TOKEN,
  async enrich(c: Candidate): Promise<Signal[]> {
    try {
      const repos = releaseRepos(c);
      if (!repos.length) return [];
      const now = Date.now();
      const sig = await Promise.all(repos.map(async (r) => cadenceSignal(`${r.owner}/${r.name}`, await releases(r), now)));
      return capReleaseSignals(sig.filter((s): s is Signal => !!s));
    } catch {
      return [];
    }
  },
};
