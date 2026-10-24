// Batch-runs every Deal Flow hackathon attendee through the Labscout signal pipeline and writes the ranked
// list to public/data/hackathon.json (served by the Hackathon tab). Resumable: per-attendee results are cached
// in .cache/hackathon.json, so a rerun only processes people new to the sheet (--fresh redoes everyone).
//   node scripts/hackathon.ts [--csv path] [--concurrency 8] [--briefs 25] [--openalex] [--limit N] [--fresh] [--rebrief]
// OpenAlex author matching is opt-in (--openalex): its free tier is a shared per-IP daily budget the live Scout tab needs.
import { readFile, writeFile, mkdir } from "node:fs/promises";

try {
  const env = await readFile(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {}

const { SHEET_CSV, parseCsv, toAttendees, candidateFor, contextFor, strictSignals, orcidNameCount, githubByEmail, githubByHandle, COMMON_NAME, pickAuthor, rankAttendees, rankTeams } = await import("../lib/hackathon.ts");
const { collectSignals } = await import("../lib/search.ts");
const { writeAttendeeBrief } = await import("../lib/llm.ts");
const { SOURCES } = await import("../lib/sources/index.ts");

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CONC = Number(arg("--concurrency", "8"));
const BRIEFS = Number(arg("--briefs", "25"));
const CACHE = new URL("../.cache/hackathon.json", import.meta.url);
const OUT = new URL("../public/data/hackathon.json", import.meta.url);
const OA = "https://api.openalex.org";
const mailto = process.env.OPENALEX_MAILTO ? `&mailto=${process.env.OPENALEX_MAILTO}` : "";

type Entry = { signals: any[]; works: any[]; openalex: any; nameCount: number | null; brief?: string | null; at: string };
const USE_OPENALEX = process.argv.includes("--openalex");
let cache: Record<string, Entry> = {};
if (!process.argv.includes("--fresh")) try { cache = JSON.parse(await readFile(CACHE, "utf8")); } catch {}
if (process.argv.includes("--rebrief")) for (const e of Object.values(cache)) delete e.brief;
await mkdir(new URL("../.cache/", import.meta.url), { recursive: true });
await mkdir(new URL("../public/data/", import.meta.url), { recursive: true });
let saving = Promise.resolve();
const save = () => (saving = saving.then(() => writeFile(CACHE, JSON.stringify(cache))));

const csvPath = arg("--csv", "");
const csv = csvPath ? await readFile(csvPath, "utf8") : await (await fetch(SHEET_CSV)).text();
const { EXTRA_ATTENDEES } = await import("../lib/hackathon-extra.ts");
const sheet = toAttendees(parseCsv(csv));
const sheetKeys = new Set(sheet.map((a) => a.key));
const people = [...sheet, ...EXTRA_ATTENDEES.filter((a) => !sheetKeys.has(a.key))].slice(0, Number(arg("--limit", "100000")));
const enabled = SOURCES.filter((s) => { try { return s.enabled(); } catch { return false; } }).map((s) => s.id);
console.log(`${people.length} attendees · ${enabled.length}/${SOURCES.length} sources enabled · concurrency ${CONC}`);

async function openalexFor(c: any): Promise<{ openalex: any; works: any[] }> {
  if (!c.institutions.length) return { openalex: null, works: [] };
  try {
    const r = await fetch(`${OA}/authors?search=${encodeURIComponent(c.name)}&per-page=10&select=id,display_name,works_count,cited_by_count,last_known_institutions,affiliations${mailto}`, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return { openalex: null, works: [] };
    const au = pickAuthor(c, (await r.json()).results ?? []);
    if (!au) return { openalex: null, works: [] };
    const id = String(au.id).replace("https://openalex.org/", "");
    const w = await fetch(`${OA}/works?filter=author.id:${id}&sort=publication_date:desc&per-page=10&select=id,title,publication_year,authorships,primary_location,cited_by_count,doi${mailto}`, { signal: AbortSignal.timeout(12000) });
    const works = w.ok ? ((await w.json()).results ?? []).map((x: any) => {
      const me = (x.authorships ?? []).find((a: any) => String(a.author?.id).endsWith(id));
      return { id: x.id, title: x.title ?? "", year: x.publication_year, doi: x.doi ?? null, url: x.doi ?? x.primary_location?.landing_page_url ?? x.id,
        venue: x.primary_location?.source?.display_name ?? null, citedBy: x.cited_by_count ?? 0, position: me?.author_position ?? "middle", isCorresponding: !!me?.is_corresponding };
    }) : [];
    return { openalex: { id: au.id, works: au.works_count ?? 0, citations: au.cited_by_count ?? 0 }, works };
  } catch { return { openalex: null, works: [] }; }
}

const todo = people.filter((a) => !cache[a.key]);
let done = 0;
const t0 = Date.now();
async function worker() {
  for (let a = todo.shift(); a; a = todo.shift()) {
    const c = candidateFor(a);
    const [nameCount, ghEmail0] = await Promise.all([orcidNameCount(a.name), githubByEmail(a.email)]);
    const ghEmail = ghEmail0.length ? ghEmail0 : await githubByHandle(a.name, a.linkedin);
    // Papers only for distinctive names: a common name + "Columbia" still picks a stranger's publication record.
    const { openalex, works } = USE_OPENALEX && nameCount !== null && nameCount < COMMON_NAME ? await openalexFor(c) : { openalex: null, works: [] };
    c.works = works;
    // A GitHub account found by registration email or LinkedIn handle replaces the name-search GitHub source;
    // (packages, Hacker News, Bluesky, YC) then build on that verified login.
    c.signals = ghEmail;
    await collectSignals([c], contextFor(a), ghEmail.length ? SOURCES.filter((s) => s.id !== "github") : SOURCES);
    cache[a.key] = { signals: c.signals, works, openalex, nameCount, at: new Date().toISOString() };
    void save();
    if (++done % 10 === 0) console.log(`  ${done} processed · ${Math.round((Date.now() - t0) / 1000)} s`);
  }
}
console.log(`${people.length - todo.length} cached, ${todo.length} to run`);
await Promise.all(Array.from({ length: CONC }, worker));
await saving;

function build() {
  return rankAttendees(people.map((a) => {
    const e = cache[a.key];
    const c = candidateFor(a);
    c.works = e?.works ?? [];
    const nameCount = e?.nameCount ?? null;
    c.signals = strictSignals(a, e?.signals ?? [], nameCount);
    return { a, c, brief: e?.brief ?? null, commonName: nameCount === null || nameCount >= COMMON_NAME,
      openalex: e?.openalex ? { ...e.openalex, papers: c.works.slice(0, 3) } : null };
  }));
}

// Briefs for the top N with evidence (cached; skipped when the LLM key is missing).
if (process.env.NICRRON_API_KEY && BRIEFS > 0) {
  const top = build().filter((p) => p.signals.length > 0).slice(0, BRIEFS);
  const byKey = new Map(people.map((a) => [a.key, a]));
  await Promise.all(top.filter((p) => !cache[p.key]?.brief).map(async (p) => {
    try { cache[p.key].brief = await writeAttendeeBrief(byKey.get(p.key)!, p.signals); } catch {}
  }));
  await save(); await saving;
}

const ranked = build();
const payload = {
  event: "Deal Flow — NYC VC Hackathon 2026", generatedAt: new Date().toISOString(),
  sheet: SHEET_CSV.replace(/\/export\?.*$/, "/edit"), sources: enabled,
  count: ranked.length, withSignals: ranked.filter((p) => p.signals.length > 0).length,
  teams: rankTeams(ranked), attendees: ranked,
};
await writeFile(OUT, JSON.stringify(payload));
console.log(`wrote public/data/hackathon.json · ${payload.count} attendees · ${payload.withSignals} with signals · ${payload.teams.length} teams`);
console.log("top 10:", ranked.slice(0, 10).map((p) => `${p.rank}. ${p.name} (${p.score})`).join(" · "));
