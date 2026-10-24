// OSF — research quality (stage 1) + identity: PsyArXiv / SocArXiv / EdArXiv / OSF Preprints and the OSF profile's GitHub link.
// Endpoints (verified 200, no key):
//   users:     https://api.osf.io/v2/users/?filter[full_name]=<First Last>&page[size]=25
//   preprints: https://api.osf.io/v2/users/<id>/preprints/?page[size]=50
// Real user fields: data[].{id, links:{html}, attributes:{full_name, given_name, family_name, social:{github, scholar,
//   researcherId, profileWebsites[], ...} (empty strings when unset), employment:[{institution, title, department, ongoing}],
//   education:[{institution, degree}], external_identity:{ORCID:{id, status:"VERIFIED"}}}}
// Real preprint fields: data[].{id ("9rxaq_v1"), links:{html, preprint_doi}, relationships.provider.data.id ("psyarxiv"),
//   attributes:{title, date_published, date_created, doi (journal-version DOI or null), is_published, public, date_withdrawn}}
// Quirks found live: ORCID lives in attributes.external_identity.ORCID.id (NOT social.orcid); filter[full_name] is a
//   case-insensitive substring match ("John Smith" also returns "John Smithgall"; a middle initial in the query returns 0),
//   so we query "First Last" and re-check with namesMatch; ids carry a version suffix (_vN) and only the latest version is listed.
// Disambiguation: name match AND (verified ORCID equal | employment/education mentions a candidate institution |
//   one of the user's preprints shares a DOI/title with the candidate's works). Uncorroborated => [].
import type { Candidate } from "../types.ts";
import type { Signal, SourceModule, SourceContext } from "./types.ts";
import { mentionsInstitution, namesMatch, sharesWork } from "./match.ts";
import { UA, YEAR_MS, capTotal } from "./entity.ts";

export type OsfUser = { id: string; name: string; github: string | null; orcid: string | null; institutions: string[]; url: string };
export type OsfPreprint = { id: string; title: string; date: string | null; doi: string | null; provider: string | null; url: string | null };

const bareOrcid = (s?: string | null) => String(s ?? "").match(/\d{4}-\d{4}-\d{4}-\d{3}[\dX]/i)?.[0].toUpperCase() ?? "";
const PROVIDERS: Record<string, string> = { psyarxiv: "PsyArXiv", socarxiv: "SocArXiv", edarxiv: "EdArXiv", osf: "OSF Preprints",
  engrxiv: "engrXiv", metaarxiv: "MetaArXiv", lawarxiv: "LawArXiv", sportrxiv: "SportRxiv", mindrxiv: "MindRxiv", africarxiv: "AfricArXiv" };

export function osfUsersUrl(name: string): string {
  const parts = String(name ?? "").replace(/[^\p{L}\p{N}'\s.-]/gu, " ").trim().split(/\s+/).filter((p) => p.replace(/\./g, "").length > 0);
  if (parts.length < 2 || parts[0].replace(/\./g, "").length < 2) return "";
  return `https://api.osf.io/v2/users/?filter%5Bfull_name%5D=${encodeURIComponent(`${parts[0]} ${parts[parts.length - 1]}`)}&page%5Bsize%5D=25`;
}

export function parseOsfUsers(j: any): OsfUser[] {
  return (Array.isArray(j?.data) ? j.data : []).filter((u: any) => u?.id && u?.attributes?.full_name).map((u: any) => {
    const a = u.attributes;
    const gh = String(a.social?.github ?? "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/[/\s].*$/, "");
    const orcid = a.external_identity?.ORCID?.id ?? a.social?.orcid ?? null;
    const inst = [...(Array.isArray(a.employment) ? a.employment : []), ...(Array.isArray(a.education) ? a.education : [])]
      .map((e: any) => [e?.institution, e?.department].filter(Boolean).join(", ")).filter(Boolean);
    return { id: String(u.id), name: String(a.full_name).trim(), github: gh || null, orcid: bareOrcid(orcid) || null,
      institutions: inst, url: u.links?.html ?? `https://osf.io/${u.id}/` };
  });
}

export function parseOsfPreprints(j: any): OsfPreprint[] {
  const seen = new Set<string>();
  const out: OsfPreprint[] = [];
  for (const p of Array.isArray(j?.data) ? j.data : []) {
    const a = p?.attributes;
    if (!p?.id || !a?.title || a.date_withdrawn || a.is_published === false || a.public === false) continue;
    const base = String(p.id).replace(/_v\d+$/, "");
    if (seen.has(base)) continue;
    seen.add(base);
    out.push({ id: String(p.id), title: String(a.title).replace(/\s+/g, " ").trim(), date: a.date_published ?? a.date_created ?? null,
      doi: a.doi ?? null, provider: p.relationships?.provider?.data?.id ?? null, url: p.links?.html ?? null });
  }
  return out;
}

/** Profile-level corroboration (no extra request): verified ORCID equal, or employment/education mentions a candidate institution. */
export function osfProfileCorroborated(c: Candidate, u: OsfUser): boolean {
  const co = bareOrcid(c.orcid);
  return (!!co && u.orcid === co) || u.institutions.some((i) => mentionsInstitution(i, c.institutions));
}

export function osfPreprintsShareWork(c: Candidate, pre: OsfPreprint[]): boolean {
  return pre.some((p) => sharesWork(c, p.title, p.doi));
}

export function nameMatchedUsers(c: Candidate, users: OsfUser[]): OsfUser[] {
  return users.filter((u) => namesMatch(u.name, c.name));
}

export function osfToSignals(u: OsfUser, pre: OsfPreprint[], now = Date.now()): Signal[] {
  const recent = pre.filter((p) => { const t = Date.parse(p.date ?? ""); return Number.isFinite(t) && t >= now - YEAR_MS && t <= now + 86400000; })
    .sort((a, b) => Date.parse(b.date!) - Date.parse(a.date!));
  const out: Signal[] = recent.slice(0, 3).map((p) => ({ source: "osf", stage: 1, kind: "preprint", weight: 2,
    label: `OSF preprint (${PROVIDERS[p.provider ?? ""] ?? p.provider ?? "OSF"}): ${p.title.slice(0, 120)}`,
    url: p.url ?? u.url, date: p.date ? p.date.slice(0, 10) : null }));
  if (recent.length >= 3) out.push({ source: "osf", stage: 1, kind: "velocity", weight: 3,
    label: `OSF: ${recent.length} preprints in the last 12 months`, url: u.url, date: recent[0].date!.slice(0, 10) });
  if (u.github) out.push({ source: "osf", stage: 1, kind: "identity", weight: 0, date: null, url: u.url,
    label: `OSF profile: github=${u.github}${u.orcid ? `, orcid=${u.orcid}` : ""}` });
  return capTotal(out, 15);
}

async function getJson(url: string): Promise<any | null> {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/vnd.api+json" }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) return null;
  return await r.json();
}

const preprintsUrl = (id: string) => `https://api.osf.io/v2/users/${encodeURIComponent(id)}/preprints/?page%5Bsize%5D=50`;

export const source: SourceModule = {
  id: "osf",
  enabled: () => true,
  async enrich(c: Candidate, _ctx: SourceContext): Promise<Signal[]> {
    try {
      const url = osfUsersUrl(c?.name ?? "");
      if (!url) return [];
      const j = await getJson(url);
      if (!j) return [];
      const matched = nameMatchedUsers(c, parseOsfUsers(j));
      if (!matched.length) return [];
      const co = bareOrcid(c.orcid);
      const profileOk = matched.filter((u) => osfProfileCorroborated(c, u))
        .sort((a, b) => Number(!!co && b.orcid === co) - Number(!!co && a.orcid === co));
      if (profileOk.length) {
        const pj = await getJson(preprintsUrl(profileOk[0].id));
        return osfToSignals(profileOk[0], pj ? parseOsfPreprints(pj) : []);
      }
      // No profile evidence: accept a name-matched user only if one of their preprints is one of the candidate's works.
      const lists = await Promise.all(matched.slice(0, 3).map((u) => getJson(preprintsUrl(u.id)).catch(() => null)));
      for (let i = 0; i < lists.length; i++) {
        const pre = lists[i] ? parseOsfPreprints(lists[i]) : [];
        if (osfPreprintsShareWork(c, pre)) return osfToSignals(matched[i], pre);
      }
      return [];
    } catch {
      return [];
    }
  },
};
