import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candidate } from "../lib/types.ts";
import type { Signal } from "../lib/sources/types.ts";
import { releaseRepos, cadenceSignal, capReleaseSignals, source as releases } from "../lib/sources/releases.ts";
import { repoProbes, registryPlan, crateSignal, cranSignal, dockerSignal, source as packages } from "../lib/sources/packages.ts";

function cand(over: Partial<Candidate> = {}): Candidate {
  return {
    authorId: "https://openalex.org/A1", name: "Ellis Brown", orcid: null, institutions: ["NYU"], works: [],
    worksCount: 10, citedByCount: 100, firstPubYear: 2020, recentWorksCount: 3, reasons: [], mentions: [], education: [],
    isCurrentStudent: true, score: 0, brief: null, signals: [], ...over,
  };
}
const ctx = { query: "multimodal llm", keywords: "multimodal vision" };
const NOW = Date.parse("2026-10-24T12:00:00Z");
const total = (s: Signal[]) => s.reduce((a, x) => a + x.weight, 0);
const gh = (r: string, label = `${r} — 12★, 3 forks`, weight = 3): Signal =>
  ({ source: "github", stage: 2, kind: "repo", label, url: `https://github.com/${r}`, date: null, weight });

// ---- Releases (fixtures trimmed from real api.github.com/repos/<o>/<r>/releases responses, 2026-10-24)
const TOKENIZERS = [
  { tag_name: "v1.0.0-rc.3", published_at: "2026-10-19T17:08:27Z", draft: false, prerelease: true, html_url: "https://github.com/huggingface/tokenizers/releases/tag/v1.0.0-rc.3", assets: [] },
  { tag_name: "v0.23.3", published_at: "2026-10-09T10:20:12Z", draft: false, prerelease: false, html_url: "https://github.com/huggingface/tokenizers/releases/tag/v0.23.3", assets: [] },
  { tag_name: "v1.0.0-rc.2", published_at: "2026-09-21T11:28:00Z", draft: false, prerelease: true, html_url: "https://github.com/huggingface/tokenizers/releases/tag/v1.0.0-rc.2", assets: [] },
  { tag_name: "v0.23.2", published_at: "2026-09-03T10:09:56Z", draft: false, prerelease: false, html_url: "https://github.com/huggingface/tokenizers/releases/tag/v0.23.2", assets: [] },
  { tag_name: "v0.23.1", published_at: "2026-04-27T14:38:35Z", draft: false, prerelease: false, html_url: "https://github.com/huggingface/tokenizers/releases/tag/v0.23.1", assets: [] },
  { tag_name: "v0.22.2", published_at: "2025-12-02T13:01:19Z", draft: false, prerelease: false, html_url: "https://github.com/huggingface/tokenizers/releases/tag/v0.22.2", assets: [] },
  { tag_name: "v0.22.1", published_at: "2025-09-19T09:52:24Z", draft: false, prerelease: false, html_url: "https://github.com/huggingface/tokenizers/releases/tag/v0.22.1", assets: [] },
  { tag_name: "v0.22.0", published_at: "2025-08-29T10:25:50Z", draft: false, prerelease: false, html_url: "https://github.com/huggingface/tokenizers/releases/tag/v0.22.0", assets: [] },
];
const OLLAMA = [
  { tag_name: "v0.40.11", published_at: "2026-10-24T00:30:13Z", draft: false, prerelease: false, html_url: "https://github.com/ollama/ollama/releases/tag/v0.40.11",
    assets: [{ name: "install.ps1", download_count: 1090 }, { name: "install.sh", download_count: 2004 }] },
  { tag_name: "v0.40.10", published_at: "2026-10-23T15:03:59Z", draft: false, prerelease: false, html_url: "https://github.com/ollama/ollama/releases/tag/v0.40.10",
    assets: [{ name: "install.ps1", download_count: 16890 }, { name: "install.sh", download_count: 31671 }] },
  { tag_name: "v0.40.9", published_at: "2026-10-22T01:33:10Z", draft: false, prerelease: false, html_url: "https://github.com/ollama/ollama/releases/tag/v0.40.9",
    assets: [{ name: "install.ps1", download_count: 11426 }, { name: "install.sh", download_count: 21017 }] },
];

test("releases is a wave-2 GitHub-token source; repos from github repo + papercode signals, highest weight first, ≤6", () => {
  assert.equal(releases.id, "releases");
  assert.equal(releases.wave, 2);
  const c = cand({ signals: [
    gh("ellis/small", undefined, 2),
    { source: "github", stage: 2, kind: "profile", label: "GitHub @ellis", url: "https://github.com/ellis", date: null, weight: 2 },
    { source: "papercode", stage: 2, kind: "paper_code", label: "Code for …", url: "https://github.com/cambrian-mllm/cambrian", date: null, weight: 8 },
    { source: "papercode", stage: 2, kind: "cited_by_repos", label: "12 repos", url: "https://github.com/search?q=x", date: null, weight: 2 },
    gh("Ellis/Big.git", undefined, 6), gh("ellis/big", undefined, 4),
  ] });
  assert.deepEqual(releaseRepos(c).map((r) => `${r.owner}/${r.name}`), ["cambrian-mllm/cambrian", "Ellis/Big", "ellis/small"]);
  const many = cand({ signals: Array.from({ length: 9 }, (_, i) => gh(`u/r${i}`, undefined, i)) });
  assert.equal(releaseRepos(many).length, 6);
  assert.equal(releaseRepos(many)[0].name, "r8");
});

test("cadenceSignal: 12-month window, drafts ignored, weight and label", () => {
  const s = cadenceSignal("huggingface/tokenizers", [{ tag_name: "v9-draft", published_at: null, draft: true, html_url: "x" }, ...TOKENIZERS], NOW)!;
  // 6 releases within 12 months of 2026-10-24 (2025-09-19 and 2025-08-29 are older); no assets
  assert.equal(s.kind, "release_cadence");
  assert.equal(s.weight, 3);
  assert.equal(s.label, "huggingface/tokenizers: 6 releases in 12 mo, latest v1.0.0-rc.3 (2026-10-19)");
  assert.equal(s.url, "https://github.com/huggingface/tokenizers/releases/tag/v1.0.0-rc.3");
  assert.equal(s.date, "2026-10-19T17:08:27Z");
  const o = cadenceSignal("ollama/ollama", OLLAMA, NOW)!;
  assert.equal(o.weight, 3); // 1 + floor(3/3) + 1 (≥1000 downloads)
  assert.equal(o.label, "ollama/ollama: 3 releases in 12 mo, latest v0.40.11 (2026-10-24) — 84.1k downloads");
  assert.equal(cadenceSignal("x/y", [OLLAMA[0]], NOW), null);              // one release is not a cadence
  assert.equal(cadenceSignal("x/y", TOKENIZERS.slice(5), NOW), null);      // only one in the window
  assert.equal(cadenceSignal("x/y", [], NOW), null);
  const thirty = Array.from({ length: 30 }, (_, i) => ({ ...OLLAMA[0], tag_name: `v${i}`, published_at: new Date(NOW - i * 864e5).toISOString() }));
  const t = cadenceSignal("ollama/ollama", thirty, NOW)!;
  assert.equal(t.weight, 6);
  assert.match(t.label, /^ollama\/ollama: 30\+ releases in 12 mo/);
});

test("capReleaseSignals: ≤3 repos, total ≤ 15", () => {
  const sig = ["a", "b", "c", "d"].map((r) => cadenceSignal(`u/${r}`, Array.from({ length: 30 }, (_, i) => ({ ...OLLAMA[0], published_at: new Date(NOW - i * 864e5).toISOString() })), NOW)!);
  const capped = capReleaseSignals(sig);
  assert.equal(capped.length, 3);
  assert.equal(total(capped), 15);
});

// ---- Packages: crates.io / CRAN / Docker Hub (fixtures trimmed from real responses, 2026-10-24)
const CRATE = { crate: { id: "tokenizers", name: "tokenizers", repository: "https://github.com/huggingface/tokenizers", homepage: "https://github.com/huggingface/tokenizers",
  recent_downloads: 17749423, downloads: 41766916, updated_at: "2026-10-19T16:38:18.313095Z", max_version: "1.0.0-rc.3" } };
const CRANDB = { Package: "dplyr", Version: "1.2.1", URL: "https://dplyr.tidyverse.org, https://github.com/tidyverse/dplyr", BugReports: "https://github.com/tidyverse/dplyr/issues",
  Maintainer: "Hadley Wickham <hadley@posit.co>", date: "2026-04-03T06:30:08+00:00" };
const CRANLOGS = [{ start: "2026-09-24", end: "2026-10-23", downloads: 1801441, package: "dplyr" }];
const DOCKER = { user: "ollama", name: "ollama", namespace: "ollama", repository_type: "image", status: 1, star_count: 1618, pull_count: 191352999,
  last_updated: "2026-10-24T17:51:09.802678Z", is_private: false };

test("repoProbes/registryPlan: language from the github label gates crates.io / CRAN; Docker only top 3", () => {
  const c = cand({ signals: [gh("huggingface/tokenizers", "huggingface/tokenizers — 10.6k★, 1100 forks, Rust"), gh("tidyverse/dplyr", "tidyverse/dplyr — 4.9k★, 2.1k forks, R"),
    gh("ollama/ollama", "ollama/ollama — 160k★, 14k forks, Go"), gh("u/plain"), gh("u/five", "u/five — 1★, 0 forks")] });
  const p = repoProbes(c);
  assert.deepEqual(p.map((x) => x.lang), ["Rust", "R", "Go", null, null]);
  assert.equal(p[1].name, "dplyr");
  assert.equal(p[0].repo, "huggingface/tokenizers");
  const plan = registryPlan(p);
  assert.deepEqual(plan.crates.map((x) => x.name), ["tokenizers"]);
  assert.deepEqual(plan.cran.map((x) => x.name), ["dplyr"]);
  assert.deepEqual(plan.docker.map((x) => x.name), ["tokenizers", "dplyr", "ollama"]);
  assert.equal(repoProbes(cand({ signals: Array.from({ length: 9 }, (_, i) => gh(`u/r${i}`)) })).length, 6);
  assert.equal(repoProbes(cand({ signals: [gh("Lab/MyRPkg", "Lab/MyRPkg — 3★, 0 forks, R")] }))[0].name, "MyRPkg"); // CRAN names are case-sensitive
});

test("crateSignal: repository must link the exact repo; 90-day downloads / 3", () => {
  const s = crateSignal(CRATE, "huggingface/tokenizers")!;
  assert.equal(s.weight, 7);
  assert.equal(s.label, "crates.io tokenizers — 5.9M downloads/mo");
  assert.equal(s.url, "https://crates.io/crates/tokenizers");
  assert.equal(s.date, "2026-10-19T16:38:18.313095Z");
  assert.equal(crateSignal(CRATE, "someone/tokenizers"), null);
  assert.equal(crateSignal({ crate: { ...CRATE.crate, recent_downloads: 0 } }, "huggingface/tokenizers"), null);
  assert.equal(crateSignal({ errors: [{ detail: "crate `x` does not exist" }] }, "huggingface/tokenizers"), null);
  assert.equal(crateSignal({ crate: { ...CRATE.crate, recent_downloads: 300 } }, "huggingface/tokenizers")!.weight, 4);
});

test("cranSignal: URL/BugReports must link the repo; cranlogs last-month downloads", () => {
  const s = cranSignal(CRANDB, CRANLOGS, "tidyverse/dplyr")!;
  assert.equal(s.weight, 7);
  assert.equal(s.label, "CRAN dplyr — 1.8M downloads/mo");
  assert.equal(s.url, "https://cran.r-project.org/package=dplyr");
  assert.equal(s.date, "2026-04-03T06:30:08+00:00");
  assert.ok(cranSignal({ ...CRANDB, URL: "https://dplyr.tidyverse.org" }, CRANLOGS, "tidyverse/dplyr")); // BugReports alone is enough
  assert.equal(cranSignal(CRANDB, CRANLOGS, "tidyverse/dplyr2"), null);
  assert.equal(cranSignal(CRANDB, [{ downloads: 0, package: "dplyr" }], "tidyverse/dplyr"), null);
  assert.equal(cranSignal({ error: "not_found", reason: "document not found" }, CRANLOGS, "tidyverse/dplyr"), null);
});

test("dockerSignal: namespace must equal the GitHub owner; lifetime pulls, weight ≤5", () => {
  const s = dockerSignal(DOCKER, { owner: "Ollama", name: "ollama" })!;
  assert.equal(s.weight, 5);
  assert.equal(s.label, "Docker Hub ollama/ollama — 191.4M pulls");
  assert.equal(s.url, "https://hub.docker.com/r/ollama/ollama");
  assert.equal(s.date, "2026-10-24T17:51:09.802678Z");
  assert.equal(dockerSignal(DOCKER, { owner: "someone", name: "ollama" }), null);
  assert.equal(dockerSignal({ ...DOCKER, pull_count: 45000 }, { owner: "ollama", name: "ollama" })!.weight, 5);
  assert.equal(dockerSignal({ ...DOCKER, pull_count: 120 }, { owner: "ollama", name: "ollama" })!.weight, 2);
  assert.equal(dockerSignal({ ...DOCKER, pull_count: 1 }, { owner: "ollama", name: "ollama" }), null);
  assert.equal(dockerSignal({ message: "object not found", errinfo: {} }, { owner: "ollama", name: "ollama" }), null);
});

test("packages.enrich routes crates.io / CRAN / Docker probes and keeps total ≤ 15 (stubbed fetch)", async () => {
  const orig = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (u: string | URL) => {
    const url = String(u);
    seen.push(url);
    const ok = (j: unknown) => new Response(JSON.stringify(j), { status: 200 });
    if (url === "https://crates.io/api/v1/crates/tokenizers") return ok(CRATE);
    if (url === "https://crandb.r-pkg.org/dplyr") return ok(CRANDB);
    if (url === "https://cranlogs.r-pkg.org/downloads/total/last-month/dplyr") return ok(CRANLOGS);
    if (url === "https://hub.docker.com/v2/repositories/ollama/ollama/") return ok(DOCKER);
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  try {
    const c = cand({ signals: [gh("huggingface/tokenizers", "huggingface/tokenizers — 10.6k★, 1100 forks, Rust"), gh("tidyverse/dplyr", "tidyverse/dplyr — 4.9k★, 2.1k forks, R"),
      gh("ollama/ollama", "ollama/ollama — 160k★, 14k forks, Go"), gh("u/four", "u/four — 1★, 0 forks, Rust")] });
    const s = await packages.enrich(c, ctx);
    assert.deepEqual(s.map((x) => x.label.split(" — ")[0]), ["crates.io tokenizers", "CRAN dplyr"]); // 7 + 7; Docker (5) would exceed 15
    assert.ok(total(s) <= 15);
    assert.ok(seen.includes("https://hub.docker.com/v2/repositories/ollama/ollama/"));
    assert.ok(!seen.some((u) => u.includes("hub.docker.com/v2/repositories/u/four")));     // Docker only for the top 3
    assert.ok(seen.includes("https://crates.io/api/v1/crates/four"));                         // Rust repo -> crates.io
    assert.ok(!seen.some((u) => u.includes("crates.io/api/v1/crates/dplyr") || u.includes("crandb.r-pkg.org/tokenizers")));
  } finally { globalThis.fetch = orig; }
});

test("releases.enrich builds release_cadence signals from the API (stubbed fetch, auth header sent)", async () => {
  const orig = globalThis.fetch, tok = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "test-token";
  let auth = "";
  const fresh = OLLAMA.map((r, i) => ({ ...r, published_at: new Date(Date.now() - (i + 1) * 864e5).toISOString() }));
  globalThis.fetch = (async (u: string | URL, init?: RequestInit) => {
    auth = String((init?.headers as Record<string, string>)?.authorization ?? "");
    return String(u) === "https://api.github.com/repos/ollama/ollama/releases?per_page=30" ? new Response(JSON.stringify(fresh), { status: 200 }) : new Response("[]", { status: 200 });
  }) as typeof fetch;
  try {
    const s = await releases.enrich(cand({ signals: [gh("ollama/ollama"), gh("u/none")] }), ctx);
    assert.equal(s.length, 1);
    assert.equal(s[0].source, "releases");
    assert.equal(s[0].weight, 3);
    assert.equal(auth, "Bearer test-token");
  } finally {
    globalThis.fetch = orig;
    if (tok === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = tok;
  }
});

// ---- enrich never throws
const withRepos = cand({ signals: [gh("huggingface/tokenizers", "huggingface/tokenizers — 10.6k★, 1100 forks, Rust"), gh("tidyverse/dplyr", "tidyverse/dplyr — 4.9k★, 2.1k forks, R"), gh("ollama/ollama")] });
for (const mod of [releases, packages]) {
  test(`${mod.id}.enrich returns [] when fetch rejects`, async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("network down"); }) as typeof fetch;
    try { assert.deepEqual(await mod.enrich(withRepos, ctx), []); } finally { globalThis.fetch = orig; }
  });
  test(`${mod.id}.enrich returns [] on 429`, async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response("{}", { status: 429 })) as typeof fetch;
    try { assert.deepEqual(await mod.enrich(withRepos, ctx), []); } finally { globalThis.fetch = orig; }
  });
  test(`${mod.id}.enrich returns [] on bad JSON`, async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response("<html>oops", { status: 200 })) as typeof fetch;
    try { assert.deepEqual(await mod.enrich(withRepos, ctx), []); } finally { globalThis.fetch = orig; }
  });
  test(`${mod.id}.enrich returns [] with no repo signals`, async () => {
    assert.deepEqual(await mod.enrich(cand(), ctx), []);
  });
}
