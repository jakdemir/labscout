// DataCite — builder signal (stage 2): software, datasets, models, notebooks and workflows with DataCite DOIs
// (Dryad, Harvard Dataverse, Code Ocean, figshare, institutional repositories, ...).
// Endpoint (verified 200, no key): https://api.datacite.org/dois?query=<lucene>&resource-type-id=<types>&page[size]=25
// Query: creators.nameIdentifiers.nameIdentifier:"https://orcid.org/<id>" OR ...:"<id>" (when the candidate has an ORCID)
//   OR creators.name:"Last, First" OR creators.name:"First Last".
// Real fields: data[].{id, attributes:{doi, titles:[{title}], types:{resourceTypeGeneral}, publisher (string; object only
//   with ?publisher=true), publicationYear (number), url, downloadCount, viewCount, citationCount, created (ISO),
//   published (often null), creators:[{name, givenName?, familyName?, nameType?, affiliation:[string], nameIdentifiers:[{nameIdentifier, nameIdentifierScheme}]}]}}
// Quirks found live: ORCID nameIdentifier is stored BOTH as full URL (most clients) and bare id (Zenodo), so the ORCID
//   query ORs both forms; the name is OR'd in too because many records carry no ORCID at all. Affiliation is an array of
//   strings by default (objects {name} with ?affiliation=true). Each version (Code Ocean ".v1/.v2", Zenodo per-version DOIs)
//   is its own record — dedupe by normalized title. publicationYear can be in the future (embargoes).
// DOIs with prefix 10.5281/zenodo are SKIPPED: Zenodo records are already scored by zenodo.ts (double counting otherwise).
import type { Candidate } from "../types.ts";
import type { Signal, SourceModule, SourceContext } from "./types.ts";
import { mentionsInstitution, namesMatch, normalizeTitle, sharesWork } from "./match.ts";
import { UA, capTotal } from "./entity.ts";

export type DataciteCreator = { name?: string; givenName?: string; familyName?: string; nameType?: string;
  affiliation?: (string | { name?: string })[]; nameIdentifiers?: { nameIdentifier?: string; nameIdentifierScheme?: string }[] };
export type DataciteRecord = { id?: string; attributes?: { doi?: string; titles?: { title?: string }[];
  types?: { resourceTypeGeneral?: string }; creators?: DataciteCreator[]; publisher?: string | { name?: string };
  publicationYear?: number | string; url?: string; downloadCount?: number; viewCount?: number; citationCount?: number;
  created?: string; published?: string | null } };

const COUNTED: Record<string, { kind: "software" | "dataset"; label: string }> = {
  Software: { kind: "software", label: "software" },
  Dataset: { kind: "dataset", label: "dataset" },
  Model: { kind: "software", label: "model" },
  ComputationalNotebook: { kind: "software", label: "notebook" },
  Workflow: { kind: "software", label: "workflow" },
};
const RESOURCE_TYPE_IDS = "dataset,software,model,computational-notebook,workflow";

const bareOrcid = (s?: string | null) => String(s ?? "").match(/\d{4}-\d{4}-\d{4}-\d{3}[\dX]/i)?.[0].toUpperCase() ?? "";
const flip = (n: string) => (n.includes(",") ? n.split(",").map((s) => s.trim()).reverse().join(" ") : n).trim();
const affText = (a: DataciteCreator["affiliation"]) => (a ?? []).map((x) => (typeof x === "string" ? x : x?.name ?? "")).join("; ");

export function dataciteQuery(name: string, orcid?: string | null): string {
  const parts = String(name ?? "").replace(/["\\,:()[\]{}^~*?!&|+]/g, " ").trim().split(/\s+/).filter(Boolean);
  const o = bareOrcid(orcid);
  const q: string[] = [];
  if (o) q.push(`creators.nameIdentifiers.nameIdentifier:"https://orcid.org/${o}"`, `creators.nameIdentifiers.nameIdentifier:"${o}"`);
  if (parts.length >= 2) {
    const first = parts[0], last = parts[parts.length - 1];
    q.push(`creators.name:"${last}, ${first}"`, `creators.name:"${first} ${last}"`);
  }
  return q.length ? `(${q.join(" OR ")})` : "";
}

export function dataciteUrl(name: string, orcid?: string | null): string {
  const q = dataciteQuery(name, orcid);
  return q ? `https://api.datacite.org/dois?query=${encodeURIComponent(q)}&resource-type-id=${RESOURCE_TYPE_IDS}&page%5Bsize%5D=25` : "";
}

/** A creator namesMatch the candidate AND (same ORCID | institution in affiliation | shared work DOI/title). */
export function dataciteMatches(c: Candidate, r: DataciteRecord): boolean {
  const a = r?.attributes;
  const title = a?.titles?.[0]?.title;
  if (!a || !title) return false;
  const co = bareOrcid(c.orcid);
  return (a.creators ?? []).some((cr) => {
    if (cr?.nameType === "Organizational") return false;
    const n = cr?.givenName && cr?.familyName ? `${cr.givenName} ${cr.familyName}` : flip(cr?.name ?? "");
    if (!namesMatch(n, c.name) && !namesMatch(flip(cr?.name ?? ""), c.name)) return false;
    const ids = (cr.nameIdentifiers ?? []).map((x) => bareOrcid(x?.nameIdentifier)).filter(Boolean);
    return (!!co && ids.includes(co)) || mentionsInstitution(affText(cr.affiliation), c.institutions) || sharesWork(c, title, a.doi);
  });
}

const usage = (r: DataciteRecord) => (r.attributes?.downloadCount ?? 0) + (r.attributes?.viewCount ?? 0);

export function dataciteToSignals(c: Candidate, records: DataciteRecord[]): Signal[] {
  const best = new Map<string, DataciteRecord>(); // one per normalized title (versions), most downloads+views wins
  for (const r of records ?? []) {
    const a = r?.attributes;
    const doi = String(a?.doi ?? r?.id ?? "").toLowerCase();
    if (!a || !COUNTED[a.types?.resourceTypeGeneral ?? ""]) continue;
    if (doi.startsWith("10.5281/zenodo")) continue; // covered by zenodo.ts
    if (!dataciteMatches(c, r)) continue;
    const k = normalizeTitle(a.titles![0].title!);
    const prev = best.get(k);
    if (!prev || usage(r) > usage(prev)) best.set(k, r);
  }
  const scored = [...best.values()].map((r) => {
    const a = r.attributes!;
    const weight = Math.min(5, 1 + Math.round(Math.log10(usage(r) + 1))) + ((a.citationCount ?? 0) > 0 ? 1 : 0);
    return { r, weight };
  }).sort((x, y) => y.weight - x.weight || usage(y.r) - usage(x.r));
  const out: Signal[] = scored.slice(0, 4).map(({ r, weight }) => {
    const a = r.attributes!, t = COUNTED[a.types!.resourceTypeGeneral!];
    const doi = String(a.doi ?? r.id).toLowerCase();
    const pub = typeof a.publisher === "string" ? a.publisher : a.publisher?.name ?? "";
    const dl = a.downloadCount ?? 0, cit = a.citationCount ?? 0;
    const meta = [pub, a.publicationYear].filter((x) => x !== undefined && x !== null && x !== "").join(", ");
    const title = a.titles![0].title!.replace(/\s+/g, " ").trim().slice(0, 120);
    return { source: "datacite", stage: 2, kind: t.kind,
      label: `DataCite ${t.label}: ${title}${meta ? ` (${meta})` : ""} — ${dl} download${dl === 1 ? "" : "s"}${cit ? `, ${cit} citation${cit === 1 ? "" : "s"}` : ""}`,
      url: `https://doi.org/${doi}`, date: (a.published || a.created || (a.publicationYear ? `${a.publicationYear}-01-01` : null))?.slice(0, 10) ?? null, weight } as Signal;
  });
  return capTotal(out, 15);
}

export const source: SourceModule = {
  id: "datacite",
  enabled: () => true,
  async enrich(c: Candidate, _ctx: SourceContext): Promise<Signal[]> {
    try {
      const url = dataciteUrl(c?.name ?? "", c?.orcid);
      if (!url) return [];
      const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/vnd.api+json" }, signal: AbortSignal.timeout(12000) });
      if (!r.ok) return [];
      const j: any = await r.json();
      return dataciteToSignals(c, Array.isArray(j?.data) ? j.data : []);
    } catch {
      return [];
    }
  },
};
