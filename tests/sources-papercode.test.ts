import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candidate } from "../lib/types.ts";
import type { Signal } from "../lib/sources/types.ts";
import { paperQueries, isListRepo, ghLogin, knownRepos, maturityOf, shortName, analyzeRepo, repoSignal, citedBySignal, capSignals, source as papercode, type GhSearchRepo } from "../lib/sources/papercode.ts";

const W = { id: "W1", title: "Cambrian-1: A Fully Open, Vision-Centric Exploration of Multimodal LLMs", year: 2024, doi: "https://doi.org/10.48550/arxiv.2406.16860", url: null, venue: null, citedBy: 500, position: "middle" as const, isCorresponding: false };
function cand(over: Partial<Candidate> = {}): Candidate {
  return {
    authorId: "https://openalex.org/A1", name: "Ellis Brown", orcid: null, institutions: ["NYU"], works: [W],
    worksCount: 10, citedByCount: 100, firstPubYear: 2020, recentWorksCount: 3, reasons: [], mentions: [], education: [],
    isCurrentStudent: true, score: 0, brief: null, signals: [], fit: [], ...over,
  };
}
// Trimmed from the real api.github.com/search/repositories response for "2406.16860" in:readme (2026-10-24).
const CAMBRIAN: GhSearchRepo = { full_name: "cambrian-mllm/cambrian", html_url: "https://github.com/cambrian-mllm/cambrian", description: "Cambrian-1 is a family of multimodal LLMs with a vision-centric design.",
  stargazers_count: 2011, forks_count: 150, pushed_at: "2025-11-07T03:26:25Z", language: "Python", fork: false, archived: false, owner: { login: "cambrian-mllm" } };
const README_OFFICIAL = `# Cambrian-1: A Fully Open, Vision-Centric Exploration of Multimodal LLMs\n\n[Shengbang Tong*](https://x), [Ellis Brown*](https://y), Penghao Wu, ... Saining Xie\n\n[arXiv](https://arxiv.org/abs/2406.16860)\n\n## Release\n...`;
const README_DOWNSTREAM = `# PhyWorld\n\nA benchmark for physics understanding. We evaluate many VLMs.\n\n## Setup\n${"x ".repeat(1500)}\n## Citation\n@article{tong2024cambrian, title={Cambrian-1: A Fully Open, Vision-Centric Exploration of Multimodal LLMs}, author={Tong, Shengbang and Brown, Ellis}, journal={arXiv:2406.16860}}`;
const PATHS = [".gitignore", "CITATION.cff", "LICENSE", "README.md", "cambrian", "inference.py", "pyproject.toml", "scripts"];
const NOW = Date.parse("2026-10-24T00:00:00Z");
const total = (s: Signal[]) => s.reduce((a, x) => a + x.weight, 0);

test("paperQueries: arXiv id > DOI > exact title; first-author works first; max 2; in:readme always", () => {
  const q = paperQueries(cand());
  assert.equal(q.length, 1);
  assert.equal(q[0].q, '"2406.16860" in:readme');
  assert.equal(q[0].key, "arxiv");
  const doi = { ...W, id: "W2", title: "Accurate structure prediction of biomolecular interactions with AlphaFold 3", doi: "https://doi.org/10.1038/s41586-024-07487-w", position: "first" as const, citedBy: 1 };
  const title = { ...W, id: "W3", title: "A Long Enough Title Without Any Identifier At All", doi: null, citedBy: 9999 };
  const short = { ...W, id: "W4", title: "Short", doi: null, citedBy: 9999 };
  const q2 = paperQueries(cand({ works: [title, short, W, doi] }));
  assert.deepEqual(q2.map((x) => x.key), ["doi", "title"]);           // first-author DOI first, then most-cited title; arXiv work is 3rd -> cut
  assert.equal(q2[0].q, '"10.1038/s41586-024-07487-w" in:readme');
  assert.equal(q2[1].q, '"A Long Enough Title Without Any Identifier At All" in:readme,description');
  assert.equal(paperQueries(cand({ works: [short] })).length, 0);
});
test("isListRepo: awesome-lists, paper feeds and surveys are never the paper's code", () => {
  assert.ok(isListRepo({ full_name: "vulab-AI/Awesome-Spatial-VLMs", description: null }));
  assert.ok(isListRepo({ full_name: "theneao/CV-SAR-Seg-arxiv-daily", description: "每日arxiv文章更新" }));
  assert.ok(isListRepo({ full_name: "x/y", description: "A survey of multimodal LLMs" }));
  assert.ok(!isListRepo(CAMBRIAN));
});
test("ghLogin / knownRepos read wave-1 github signals", () => {
  const c = cand({ signals: [
    { source: "github", stage: 2, kind: "profile", label: "GitHub @ellisbrown", url: "https://github.com/ellisbrown", date: null, weight: 2 },
    { source: "github", stage: 2, kind: "repo", label: "ellisbrown/x — 5★", url: "https://github.com/ellisbrown/X", date: null, weight: 3 }] });
  assert.equal(ghLogin(c), "ellisbrown");
  assert.deepEqual([...knownRepos(c)], ["ellisbrown/x"]);
  assert.equal(ghLogin(cand()), null);
});
test("maturityOf and shortName", () => {
  assert.equal(maturityOf(PATHS), "packaged");
  assert.equal(maturityOf(["demo.ipynb", "README.md"]), "notebooks");
  assert.equal(maturityOf(["train.py"]), "scripts");
  assert.equal(maturityOf(["README.md", "LICENSE"]), "docs only");
  assert.equal(shortName("Mamba: Linear-Time Sequence Modeling with Selective State Spaces"), "mamba");
  assert.equal(shortName("Cambrian-1: A Fully Open …"), "cambrian1");
  assert.equal(shortName("Accurate structure prediction of biomolecular interactions"), null);
  assert.equal(shortName("A Fully Open Exploration: of things"), null);   // 4-token prefix is not a short name
});
test("analyzeRepo: official = paper ref in README head + ownership evidence", () => {
  const q = paperQueries(cand())[0];
  const a = analyzeRepo(cand(), q, CAMBRIAN, { readme: README_OFFICIAL, paths: PATHS }, null);
  assert.ok(a?.official);
  assert.equal(a?.maturity, "packaged");
  assert.equal(a?.evidence[0], "candidate named in README");
  assert.ok(a?.evidence.includes("CITATION.cff"));
  // downstream repo: cites the paper only in a BibTeX block at the bottom -> referenced, but not official
  const d = analyzeRepo(cand(), q, { ...CAMBRIAN, full_name: "phyworld/phyworld", description: null, owner: { login: "phyworld" } }, { readme: README_DOWNSTREAM, paths: ["eval.py"] }, null);
  assert.ok(d && !d.official);
  // no reference at all -> null
  assert.equal(analyzeRepo(cand(), q, CAMBRIAN, { readme: "# Something else entirely", paths: [] }, null), null);
  // the candidate's own GitHub account owns it -> official even without the head reference
  const own = analyzeRepo(cand(), q, { ...CAMBRIAN, full_name: "ellisbrown/cambrian-eval", owner: { login: "ellisbrown" } }, { readme: README_DOWNSTREAM, paths: [] }, "ellisbrown");
  assert.ok(own?.official);
  assert.match(own!.evidence[0], /@ellisbrown/);
  // "unofficial reimplementation" with the title up top and the author list copied -> not official
  const re = analyzeRepo(cand(), q, { ...CAMBRIAN, full_name: "someone/cambrian-minimal", owner: { login: "someone" } }, { readme: "# Unofficial reimplementation of Cambrian-1 (arXiv 2406.16860) by Shengbang Tong, Ellis Brown", paths: ["model.py"] }, null);
  assert.ok(re && !re.official);
  // short-name fallback: repo literally named after the paper
  const mambaW = { ...W, title: "Mamba: Linear-Time Sequence Modeling with Selective State Spaces", doi: "https://doi.org/10.48550/arxiv.2312.00752" };
  const mq = paperQueries(cand({ works: [mambaW] }))[0];
  const m = analyzeRepo(cand(), mq, { ...CAMBRIAN, full_name: "state-spaces/mamba", description: null, owner: { login: "state-spaces" } }, { readme: "# Mamba\n\nPaper: https://arxiv.org/abs/2312.00752", paths: ["setup.py"] }, null);
  assert.equal(m?.evidence[0], "repo is named after the paper (mamba)");
  const mm = analyzeRepo(cand(), mq, { ...CAMBRIAN, full_name: "x/mamba-minimal", description: null, owner: { login: "x" } }, { readme: "# Mamba minimal\n\nPaper: https://arxiv.org/abs/2312.00752", paths: ["model.py"] }, null);
  assert.ok(mm && !mm.official);
});
test("repoSignal / citedBySignal: weights, labels, urls", () => {
  const q = paperQueries(cand())[0];
  const a = analyzeRepo(cand(), q, CAMBRIAN, { readme: README_OFFICIAL, paths: PATHS }, null)!;
  const s = repoSignal(q, CAMBRIAN, a, NOW);
  assert.equal(s.source, "papercode"); assert.equal(s.stage, 2); assert.equal(s.kind, "paper_code");
  assert.equal(s.weight, 3 + 4 + 1 + 0);                                  // 2k★ -> +4 (capped), packaged +1, pushed 11 months ago -> no recency
  assert.equal(s.label, 'Code for "Cambrian-1: A Fully Open, Vision-Centric Exploration of Multimodal LLMs": cambrian-mllm/cambrian — 2k★, Python, packaged (candidate named in README)');
  assert.equal(s.url, "https://github.com/cambrian-mllm/cambrian");
  assert.equal(repoSignal(q, { ...CAMBRIAN, stargazers_count: 0, pushed_at: "2026-10-01T00:00:00Z" }, { ...a, maturity: "scripts" }, NOW).weight, 4);
  assert.equal(citedBySignal(q, 2), null);
  assert.equal(citedBySignal(q, 7)?.weight, 1);
  assert.equal(citedBySignal(q, 88)?.weight, 3);
  assert.match(citedBySignal(q, 88)!.label, /^88 GitHub repos cite "Cambrian-1/);
  assert.equal(citedBySignal({ ...q, key: "title" }, 88), null);          // title searches are too loose to count
});
test("capSignals: max 2 repos + 2 counts, total <= 15", () => {
  const q = paperQueries(cand())[0];
  const a = { official: true, maturity: "packaged" as const, evidence: ["x"] };
  const repos = [1, 2, 3].map((i) => repoSignal(q, { ...CAMBRIAN, full_name: `o/r${i}`, stargazers_count: 20000 }, a, NOW));
  const s = capSignals(repos, [citedBySignal(q, 100)!, citedBySignal(q, 50)!, citedBySignal(q, 40)!]);
  assert.equal(s.length, 2);                                              // 8 + 7 (capped from 8) = 15, nothing left for the counts
  assert.equal(total(s), 15);
  const s2 = capSignals(repos.slice(0, 1), [citedBySignal(q, 100)!, citedBySignal(q, 50)!, citedBySignal(q, 40)!]);
  assert.equal(s2.length, 3);                                             // 1 repo + 2 counts (3rd count dropped)
  assert.equal(total(s2), 8 + 3 + 3);
});
test("source: wave 2, needs GITHUB_TOKEN, no works -> [], never throws", async () => {
  assert.equal(papercode.wave, 2);
  const saved = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  assert.equal(papercode.enabled(), false);
  process.env.GITHUB_TOKEN = "x";
  assert.equal(papercode.enabled(), true);
  assert.deepEqual(await papercode.enrich(cand({ works: [] }), { query: "", keywords: "" }), []);
  if (saved === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = saved;
});
