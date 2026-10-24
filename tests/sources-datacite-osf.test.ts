import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candidate } from "../lib/types.ts";
import type { Signal } from "../lib/sources/types.ts";
import { dataciteQuery, dataciteUrl, dataciteMatches, dataciteToSignals, source as datacite } from "../lib/sources/datacite.ts";
import { osfUsersUrl, parseOsfUsers, parseOsfPreprints, osfProfileCorroborated, osfPreprintsShareWork, nameMatchedUsers,
  osfToSignals, source as osf } from "../lib/sources/osf.ts";

function cand(over: Partial<Candidate> = {}): Candidate {
  return {
    authorId: "https://openalex.org/A1", name: "Hannah Byrne", orcid: null, institutions: ["Columbia"],
    works: [{ id: "W1", title: "Some unrelated paper about ocean heat uptake", year: 2024, doi: null,
      url: null, venue: null, citedBy: 5, position: "first", isCorresponding: false }],
    worksCount: 10, citedByCount: 100, firstPubYear: 2020, recentWorksCount: 3, reasons: [], mentions: [], education: [],
    isCurrentStudent: true, score: 0, brief: null, signals: [], fit: [], ...over,
  };
}
const ctx = { query: "climate", keywords: "climate models" };
const NOW = Date.parse("2026-10-24T00:00:00Z");
const total = (s: Signal[]) => s.reduce((a, x) => a + x.weight, 0);

// ---- DataCite (fixture trimmed from a real api.datacite.org/dois?query=creators.name:"Byrne, Hannah" response)
const DC = [
  { id: "10.5281/zenodo.22965407", attributes: { doi: "10.5281/zenodo.22965407", titles: [{ title: "Constraining Palaeogeography and Palaeotides for the Cambrian using cnidarian medusae" }],
    types: { resourceTypeGeneral: "Dataset" }, creators: [{ nameType: "Personal", givenName: "Hannah", familyName: "Byrne", name: "Byrne, Hannah",
      nameIdentifiers: [{ nameIdentifierScheme: "ORCID", nameIdentifier: "0000-0001-6928-488X" }], affiliation: [] }],
    publisher: "Zenodo", publicationYear: 2026, url: "https://zenodo.org/doi/10.5281/zenodo.22965407", downloadCount: 0, viewCount: 0, citationCount: 0, published: null, created: "2026-09-25T20:17:42Z" } },
  { id: "10.5061/dryad.tc0184k", attributes: { doi: "10.5061/dryad.tc0184k", titles: [{ title: "Data from: Thermal sensitivity of gypsy moth (Lepidoptera: Erebidae) during larval and pupal development" }],
    types: { resourceTypeGeneral: "Dataset" }, creators: [{ nameType: "Personal", affiliation: ["Virginia Commonwealth University"], givenName: "Hannah M.", familyName: "Byrne", name: "Byrne, Hannah M.", nameIdentifiers: [] }],
    publisher: "Dryad", publicationYear: 2018, url: "https://datadryad.org/dataset/doi:10.5061/dryad.tc0184k", downloadCount: 30, viewCount: 232, citationCount: 1, published: null, created: "2018-09-24T14:30:09Z" } },
  { id: "10.7916/h7sg-0190", attributes: { doi: "10.7916/h7sg-0190", titles: [{ title: " CMIP6 models cannot capture long-term forced changes in the tropical Paci c sea surface temperature gradient" }],
    types: { resourceTypeGeneral: "Text" }, creators: [{ name: "Byrne, Hannah", affiliation: [], nameIdentifiers: [] }],
    publisher: "Columbia University", publicationYear: 2025, url: "https://academiccommons.columbia.edu/doi/10.7916/h7sg-0190", downloadCount: 0, viewCount: 0, citationCount: 0, published: null, created: "2026-01-12T16:50:40Z" } },
  { id: "10.24433/co.3708170.v1", attributes: { doi: "10.24433/co.3708170.v1", titles: [{ lang: "en-US", title: "CMIP6 models fail to capture long-term forced changes in the tropical Pacific zonal SST gradient" }],
    types: { resourceTypeGeneral: "Software" }, creators: [{ nameType: "Personal", affiliation: ["Columbia University"], givenName: "Hannah", familyName: "Byrne", name: "Byrne, Hannah", nameIdentifiers: [] }],
    publisher: "Code Ocean", publicationYear: 2025, url: "https://codeocean.com/capsule/3429315/tree/v1", downloadCount: 0, viewCount: 0, citationCount: 0, published: null, created: "2025-11-04T16:41:34Z" } },
  // downloadCount/viewCount bumped from the live 0/0 so the dedupe-by-title test can tell the versions apart
  { id: "10.24433/co.2657931.v1", attributes: { doi: "10.24433/co.2657931.v1", titles: [{ lang: "en-US", title: "CMIP6 models fail to capture long-term forced changes in the tropical Pacific zonal SST gradient" }],
    types: { resourceTypeGeneral: "Software" }, creators: [{ nameType: "Personal", affiliation: ["Columbia University"], givenName: "Hannah", familyName: "Byrne", name: "Byrne, Hannah", nameIdentifiers: [] }],
    publisher: "Code Ocean", publicationYear: 2025, url: "https://codeocean.com/capsule/3657246/tree/v1", downloadCount: 3, viewCount: 20, citationCount: 0, published: null, created: "2025-10-24T17:18:22Z" } },
  { id: "10.15151/esrf-es-2065584297", attributes: { doi: "10.15151/esrf-es-2065584297", titles: [{ title: "Sharks' answer to bone: how calcified cartilage evolved and its relation to feeding." }],
    types: { resourceTypeGeneral: "Dataset" }, creators: [{ nameType: "Personal", affiliation: ["Naturalis Biodiversity Center, Evolutionary Ecology, Darwinweg 2, 2333 CR, Leiden, NL"], givenName: "Hannah", familyName: "Byrne", name: "Byrne, Hannah",
      nameIdentifiers: [{ nameIdentifierScheme: "ORCID", schemeUri: "https://orcid.org", nameIdentifier: "https://orcid.org/0000-0001-6928-488X" }] }],
    publisher: "European Synchrotron Radiation Facility", publicationYear: 2028, url: "https://doi.esrf.fr/10.15151/ESRF-ES-2065584297", downloadCount: 0, viewCount: 0, citationCount: 0, published: null, created: "2025-04-29T08:10:58Z" } },
];

test("dataciteQuery: ORCID in both URL and bare form plus both name orders; name only without ORCID", () => {
  assert.equal(dataciteQuery("Hannah Byrne"), '(creators.name:"Byrne, Hannah" OR creators.name:"Hannah Byrne")');
  assert.equal(dataciteQuery("Alisia Fadini", "https://orcid.org/0000-0001-5246-9124"),
    '(creators.nameIdentifiers.nameIdentifier:"https://orcid.org/0000-0001-5246-9124" OR creators.nameIdentifiers.nameIdentifier:"0000-0001-5246-9124" OR creators.name:"Fadini, Alisia" OR creators.name:"Alisia Fadini")');
  assert.equal(dataciteQuery("Madonna"), "");
  assert.match(dataciteUrl("Hannah Byrne"), /^https:\/\/api\.datacite\.org\/dois\?query=.+&resource-type-id=dataset,software,model,computational-notebook,workflow&page%5Bsize%5D=25$/);
});

test("dataciteMatches: name AND (orcid | affiliation | shared work); namesake without evidence rejected", () => {
  const c = cand();
  assert.ok(dataciteMatches(c, DC[3]));                                   // Columbia affiliation
  assert.ok(!dataciteMatches(c, DC[1]));                                  // VCU namesake
  assert.ok(!dataciteMatches(c, DC[5]));                                  // Leiden, no ORCID on candidate
  assert.ok(dataciteMatches(cand({ orcid: "https://orcid.org/0000-0001-6928-488X", institutions: ["NYU"] }), DC[5])); // ORCID URL form
  assert.ok(dataciteMatches(cand({ orcid: "https://orcid.org/0000-0001-6928-488X", institutions: ["NYU"] }), DC[0])); // bare ORCID form
  assert.ok(dataciteMatches(cand({ institutions: ["NYU"], works: [{ ...cand().works[0], doi: "https://doi.org/10.5061/DRYAD.TC0184K" }] }), DC[1])); // shared DOI
  assert.ok(!dataciteMatches(cand({ name: "H. Byrne" }), DC[3]));          // bare initial never matches
});

test("dataciteToSignals: skips Zenodo DOIs and Text, dedupes versions by title, weights and labels", () => {
  const s = dataciteToSignals(cand({ orcid: "https://orcid.org/0000-0001-6928-488X" }), DC);
  assert.equal(s.length, 2);                                              // Code Ocean (deduped) + ESRF; Zenodo + Text + VCU namesake dropped
  assert.ok(!s.some((x) => x.url!.includes("10.5281/zenodo")));
  assert.deepEqual(s[0], { source: "datacite", stage: 2, kind: "software", weight: 2, url: "https://doi.org/10.24433/co.2657931.v1", date: "2025-10-24",
    label: "DataCite software: CMIP6 models fail to capture long-term forced changes in the tropical Pacific zonal SST gradient (Code Ocean, 2025) — 3 downloads" });
  assert.equal(s[1].kind, "dataset");
  assert.equal(s[1].weight, 1);
  const vcu = dataciteToSignals(cand({ institutions: ["Virginia Commonwealth University"] }), DC);
  assert.equal(vcu.length, 1);
  assert.equal(vcu[0].weight, 4);                                         // 1 + round(log10(263)) = 3, +1 cited
  assert.equal(vcu[0].label, "DataCite dataset: Data from: Thermal sensitivity of gypsy moth (Lepidoptera: Erebidae) during larval and pupal development (Dryad, 2018) — 30 downloads, 1 citation");
});

test("dataciteToSignals: at most 4 artifacts and total <= 15", () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ ...DC[3], id: `10.24433/co.${i}`, attributes: { ...DC[3].attributes,
    doi: `10.24433/co.${i}`, titles: [{ title: `Distinct capsule number ${i} for climate code` }], downloadCount: 100000, citationCount: 3 } }));
  const s = dataciteToSignals(cand(), many);
  assert.ok(s.length <= 4);
  assert.ok(total(s) <= 15);
  assert.equal(total(s), 15);
});

// ---- OSF (fixtures trimmed from real api.osf.io/v2/users/?filter[full_name]=Matti Vuorre and /users/tdyix/preprints/)
const USERS = { data: [{ id: "tdyix", type: "users", links: { html: "https://osf.io/tdyix/" }, attributes: {
  full_name: "Matti Vuorre", given_name: "Matti", family_name: "Vuorre",
  social: { ssrn: "", github: "mvuorre", scholar: "I4DSy", twitter: "", researcherId: "K-1028-2014", profileWebsites: ["https://vuorre.com"] },
  employment: [{ title: "Assistant Professor", ongoing: true, startYear: "2023", department: "", institution: "Tilburg University" },
    { title: "Postdoctoral Research Scientist", endYear: "2020", ongoing: false, startYear: "2018", department: "", institution: "Columbia University" }],
  education: [{ degree: "Ph.D", endYear: "2018", startYear: "2013", department: "Psychology", institution: "Columbia University" }],
  external_identity: { ORCID: { id: "0000-0001-5052-066X", status: "VERIFIED" } } } },
  { id: "zzzzz", type: "users", links: { html: "https://osf.io/zzzzz/" }, attributes: { full_name: "Matti Vuorrela", social: { github: "" }, employment: [], education: [], external_identity: {} } }] };
const pp = (id: string, title: string, date: string, doi: string | null = null) => ({ id, type: "preprints",
  links: { html: `https://osf.io/preprints/psyarxiv/${id}/`, preprint_doi: `https://doi.org/10.31234/osf.io/${id}` },
  relationships: { provider: { data: { id: "psyarxiv", type: "preprint-providers" } } },
  attributes: { title, date_published: date, date_created: date, doi, is_published: true, public: true, date_withdrawn: null } });
const PREPRINTS = { data: [
  pp("pjnw6_v1", "Why one commentary by Sigaud and colleagues should not be used to assess our work on the psychology of digital technology", "2026-10-20T16:52:16.324036"),
  pp("9rxaq_v1", "A Revolution in Search of an Estimand: On the Idionomic Proposal of Hayes et al. (2026)", "2026-09-28T13:50:37.525437"),
  pp("wqr6u_v4", "All BANG, little buck: Basic psychological needs are weakly linked with video gaming behavior", "2026-09-17T21:21:40.512935"),
  pp("kvqdy_v1", "Psychological Wellbeing, Sleep, and Video Gaming: Analyses of Comprehensive Digital Traces", "2025-11-07T19:34:42.140059"),
  pp("z3ejx_v1", "Affective Uplift During Video Game Play: A Naturalistic Case Study", "2023-10-27T12:40:17.545479", "10.1145/3659464"),
  { ...pp("gone1_v1", "Withdrawn preprint", "2026-05-01T00:00:00"), attributes: { ...pp("gone1_v1", "Withdrawn preprint", "2026-05-01T00:00:00").attributes, date_withdrawn: "2026-06-01T00:00:00" } },
] };
const matti = (over: Partial<Candidate> = {}) => cand({ name: "Matti Vuorre", institutions: ["NYU"], works: [], ...over });

test("osfUsersUrl queries First Last only (full_name filter is a substring match)", () => {
  assert.equal(osfUsersUrl("Matti J. Vuorre"), "https://api.osf.io/v2/users/?filter%5Bfull_name%5D=Matti%20Vuorre&page%5Bsize%5D=25");
  assert.equal(osfUsersUrl("Madonna"), "");
  assert.equal(osfUsersUrl("J. Smith"), "");
});

test("parseOsfUsers / parseOsfPreprints read the real field shapes", () => {
  const [u, other] = parseOsfUsers(USERS);
  assert.deepEqual({ id: u.id, github: u.github, orcid: u.orcid, url: u.url }, { id: "tdyix", github: "mvuorre", orcid: "0000-0001-5052-066X", url: "https://osf.io/tdyix/" });
  assert.ok(u.institutions.some((i) => /Columbia/.test(i)));
  assert.equal(other.github, null);
  const pre = parseOsfPreprints(PREPRINTS);
  assert.equal(pre.length, 5);                                            // withdrawn dropped
  assert.equal(pre[4].doi, "10.1145/3659464");
  assert.equal(parseOsfUsers({ errors: [] }).length, 0);
});

test("OSF corroboration: ORCID | employment/education institution | shared preprint; name alone is not enough", () => {
  const users = parseOsfUsers(USERS);
  const m = nameMatchedUsers(matti(), users);
  assert.deepEqual(m.map((u) => u.id), ["tdyix"]);                        // "Matti Vuorrela" is not a name match
  assert.ok(!osfProfileCorroborated(matti(), m[0]));                      // NYU, no ORCID
  assert.ok(osfProfileCorroborated(matti({ institutions: ["Columbia"] }), m[0]));
  assert.ok(osfProfileCorroborated(matti({ orcid: "https://orcid.org/0000-0001-5052-066X" }), m[0]));
  const pre = parseOsfPreprints(PREPRINTS);
  assert.ok(!osfPreprintsShareWork(matti(), pre));
  assert.ok(osfPreprintsShareWork(matti({ works: [{ ...cand().works[0], doi: "https://doi.org/10.1145/3659464" }] }), pre));
});

test("osfToSignals: recent preprints +2 (max 3), velocity +3, weight-0 identity with github", () => {
  const s = osfToSignals(parseOsfUsers(USERS)[0], parseOsfPreprints(PREPRINTS), NOW);
  assert.deepEqual(s.map((x) => [x.kind, x.weight]), [["preprint", 2], ["preprint", 2], ["preprint", 2], ["velocity", 3], ["identity", 0]]);
  assert.equal(s[0].label, "OSF preprint (PsyArXiv): Why one commentary by Sigaud and colleagues should not be used to assess our work on the psychology of digital technolog");
  assert.equal(s[0].url, "https://osf.io/preprints/psyarxiv/pjnw6_v1/");
  assert.equal(s[0].date, "2026-10-20");
  assert.equal(s[3].label, "OSF: 4 preprints in the last 12 months");
  assert.equal(s[4].label, "OSF profile: github=mvuorre, orcid=0000-0001-5052-066X");
  assert.equal(s[4].url, "https://osf.io/tdyix/");
  assert.ok(total(s) <= 15);
  const old = osfToSignals(parseOsfUsers(USERS)[0], parseOsfPreprints(PREPRINTS), Date.parse("2030-01-01"));
  assert.deepEqual(old.map((x) => x.kind), ["identity"]);
});

function stubFetch(routes: (url: string) => Response) {
  const orig = globalThis.fetch;
  globalThis.fetch = (async (u: any) => routes(String(u))) as typeof fetch;
  return () => { globalThis.fetch = orig; };
}
const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/vnd.api+json" } });

test("osf.enrich: corroborated by institution -> signals; uncorroborated -> []", async () => {
  const restore = stubFetch((u) => (u.includes("/preprints/") ? json(PREPRINTS) : json(USERS)));
  try {
    const ok = await osf.enrich(matti({ institutions: ["Columbia"] }), ctx);
    assert.ok(ok.some((s) => s.kind === "identity" && s.label.includes("github=mvuorre")));
    assert.deepEqual(await osf.enrich(matti(), ctx), []);
    assert.deepEqual(await osf.enrich(cand({ name: "Someone Else" }), ctx), []);
  } finally { restore(); }
});

test("datacite.enrich: parses a stubbed live-shaped response", async () => {
  const restore = stubFetch(() => json({ data: DC, meta: { total: DC.length } }));
  try {
    const s = await datacite.enrich(cand(), ctx);
    assert.deepEqual(s.map((x) => x.url), ["https://doi.org/10.24433/co.2657931.v1"]);
  } finally { restore(); }
});

for (const mod of [datacite, osf]) {
  const c = matti({ institutions: ["Columbia"], orcid: "https://orcid.org/0000-0001-5052-066X" });
  test(`${mod.id}.enrich returns [] when fetch rejects`, async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("network down"); }) as typeof fetch;
    try { assert.deepEqual(await mod.enrich(c, ctx), []); } finally { globalThis.fetch = orig; }
  });
  test(`${mod.id}.enrich returns [] on HTTP 429`, async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response("{}", { status: 429 })) as typeof fetch;
    try { assert.deepEqual(await mod.enrich(c, ctx), []); } finally { globalThis.fetch = orig; }
  });
  test(`${mod.id}.enrich returns [] on bad JSON`, async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response("<html>oops</html>", { status: 200 })) as typeof fetch;
    try { assert.deepEqual(await mod.enrich(c, ctx), []); } finally { globalThis.fetch = orig; }
  });
  test(`${mod.id} is enabled without keys`, () => assert.equal(mod.enabled(), true));
}
