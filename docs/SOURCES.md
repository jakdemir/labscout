# Founder-signal sources

Catalog of every data source named in the team's "Early Founder Signals" framework, mapped to Labscout's
six stages: **1** research quality · **2** builder signal · **3** commercial pull · **4** spinout intent (strongest) ·
**5** early traction · **6** track record.

Status: **live** = implemented and verified against the real API without a key · **needs key** = implemented, enabled only
when the env var is set · **blocked** = implemented, but the upstream API is currently down · **roadmap** = not implemented ·
**excluded** = we will not use it.

Every search response carries `sources`: one row per registered source (`hit` = evidence for ≥1 shortlisted student, `none` = queried, no verified match, `off` = not queried + reason). The result view shows it as the **Sources** strip and per student on the card, and each stage lists the APIs it checked when nothing was found.

Source modules live in `lib/sources/*.ts` (contract: `lib/sources/types.ts`, registry: `lib/sources/index.ts`). Sources run in two
waves: wave 1 in parallel (14 s budget), then wave 2 (`wave: 2`, 9 s budget) which reads wave-1 signals — GitHub/HF handles,
repo names, company names from NY/SEC/ORCID — to build its queries. Every `enrich()` uses a ≤12 s
`AbortSignal.timeout`, never throws, and returns `[]` on any failure (incl. HTTP 429). A source's total weight is capped at 15.
Disambiguation (`lib/sources/match.ts`): a record counts only if the **name matches** (exact normalized, or same first+last
with middle names omitted; bare initials rejected) **and** there is institution evidence (Columbia / NYU / New York University /
Cornell / Cornell Tech / Weill Cornell) **or** a shared paper (title or DOI) with the candidate's OpenAlex works.

## Stage 1 — Research quality / velocity

| Source | Signal | Stage | Status | Endpoint | Notes |
|---|---|---|---|---|---|
| OpenAlex | works, citations, authorship position, recent-works count | 1 | live (keyed: `OPENALEX_API_KEY`, 10k credits/day; keyless tier is a per-IP budget shared across Vercel egress IPs and 429s mid-day) | `https://api.openalex.org/works` (one query per campus id, merged), `/authors?filter=ids.openalex:A\|B\|…` (one batched call) | Core search pipeline (`lib/search.ts`, `lib/openalex.ts`). |
| ORCID | education / current-student status | 1 | live | `https://pub.orcid.org/v3.0/<orcid>/educations` | Core pipeline. |
| arXiv (`arxiv.ts`) | `preprint` (+2 each, max 3) for on-topic preprints in last 12 mo; `velocity` (+3) if ≥3 | 1 | live (verified HTTP 200) | `http://export.arxiv.org/api/query?search_query=au:"First Last"&sortBy=submittedDate&sortOrder=descending&max_results=10` | Atom XML parsed with regexes. Requires name in author list + title/abstract overlap with c.works or thesis keywords. 1 request/candidate; arXiv asks for ≤1 req/3 s, not enforceable across parallel candidates. Count saturates at 10. |
| Semantic Scholar (`semanticscholar.ts`) | `citation_velocity`: citations to papers from the last 2 years, + h-index; weight `min(8, round(log2(1+N)))` | 1 | live (verified HTTP 200, no key) | `https://api.semanticscholar.org/graph/v1/author/search?query=<name>&fields=name,affiliations,paperCount,citationCount,hIndex,url,papers.title,papers.year,papers.citationCount,papers.externalIds&limit=5` | Optional `S2_API_KEY` (header `x-api-key`) — unauthenticated shares a global rate-limit pool; 429 → `[]`. S2 `affiliations` is usually empty, so matching mostly relies on shared DOI/title. Key: https://www.semanticscholar.org/product/api#api-key-form |
| Europe PMC (`europepmc.ts`) | `preprint` +2 (max 3), `velocity` +3 (≥3 in 12 mo) — bioRxiv/medRxiv/Research Square | 1 | live (verified 200; Harris Wang bioRxiv) | `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=AUTH:"First Last" AND SRC:PPR AND FIRST_PDATE:[…]&resultType=core&format=json` | Life-science counterpart of arXiv. `AUTHORID:"<orcid>"` when known; `AUTHOR_FULL` returns 0. Preprints carry no affiliations → name + (ORCID / shared DOI / topic). Grist grants API is broken (HTTP/2 reset) — skipped. |
| OSF (`osf.ts`) | `preprint` +2 (≤12 mo, max 3), `velocity` +3 (≥3 in 12 mo), `identity` 0 (GitHub login from the profile, for wave 2) | 1 | live (verified 200; Matti Vuorre → github mvuorre) | `https://api.osf.io/v2/users/?filter[full_name]=<First Last>`, `/v2/users/<id>/preprints/` | PsyArXiv / SocArXiv / EdArXiv / OSF Preprints. ORCID lives in `external_identity.ORCID` (not `social`). `filter[full_name]` is a substring match → re-checked with namesMatch. Name + (verified ORCID / employment-education institution / shared preprint). |
| University dissertation repositories (`dissertations.ts`) | `dissertation` +6 (stage 4, deposited ≤24 mo), `thesis_topic_match` +2; cap 8 | 4 / 1 | live for Columbia + Cornell; NYU blocked | Columbia Academic Commons `https://academiccommons.columbia.edu/api/v1/search?search_type=keyword&q=<name>&type[]=Theses`; Cornell eCommons `https://ecommons.cornell.edu/server/api/discover/search/objects?query=<name>&f.itemtype=dissertation or thesis,equals` | Timing signal: a deposited PhD = graduating now (spinout window). Repo picked by `c.institutions`. archive.nyu.edu is DSpace 5.4 with no usable API (404/500/400); NYU PhD theses live in ProQuest (closed). |
| NSF GRFP fellowship | credential (planned +3) | 1 | not detectable | NSF Awards API | GRFP awards are made to the institution with the campus coordinator as PI; fellows are not named in the Awards API. Would need the GRFP awardee list (https://www.research.gov/grfp/AwardeeList.do) — roadmap. |
| Google Scholar | citations / h-index | 1 | excluded (roadmap only via licensed proxy) | — | ToS forbids scraping; no official API. S2 + OpenAlex cover the same signal. |
| Conference sites (accepted papers, orals, awards) | top-venue acceptances, best-paper awards | 1 | roadmap (OpenReview blocked) | `https://api2.openreview.net/notes` | OpenReview now answers 403 `ChallengeRequiredError` / login required even for public notes — needs an account token. DBLP is behind an Anubis bot wall (HTTP 202). CVF/ACL have static lists. |
| Paper abstracts → LLM "applied focus" classification | applied vs. theoretical orientation | 1→3 | roadmap | OpenAlex `abstract_inverted_index` + LLM | Cheap: abstracts already fetched by OpenAlex. |

## Stage 2 — Builder signal

| Source | Signal | Stage | Status | Endpoint | Notes |
|---|---|---|---|---|---|
| GitHub (`github.ts`) | repos, stars, forks, outside adoption | 2 | live (owned by another agent) | `https://api.github.com` | Optional `GITHUB_TOKEN` for rate limits. |
| GitHub releases (`releases.ts`) | `release_cadence` per repo with ≥2 releases in 12 mo: min(5, 1 + ⌊n/3⌋) +1 if asset downloads ≥1k; max 3 repos; cap 15 | 2 (wave 2) | needs key (`GITHUB_TOKEN`); verified 200 | `https://api.github.com/repos/<o>/<r>/releases?per_page=30` | Repos from wave-1 GitHub repo signals (≤6, highest weight first). Drafts skipped, prereleases count. One page only → "30+" label. |
| Hugging Face (`huggingface.ts`) | `profile` +2; `model`/`dataset`/`space` per artifact (downloads≥100, likes≥5 or modified <12 mo) `min(6,round(log10(dl+1)*2))` +1 if likes≥20 (spaces weighted by likes); `paper` +2 (≥5 upvotes, max 2); cap 15 | 2 | live (verified: @ellisbrown, NYU → 4 signals) | `https://huggingface.co/api/papers/search?q=<work title>`, `/api/users/<u>/overview`, `/api/{models,datasets,spaces}?author=<u>&expand[]=…` | HF username is discovered only from an HF paper matching one of the candidate's works whose name-matched author links an HF account. List endpoints omit `lastModified` unless requested via `expand[]`. |
| Papers with Code | code linked to papers | 2 | superseded | — | Folded into Hugging Face Papers in 2025 — covered by `huggingface.ts`; `paperswithcode.com` API is dead. |
| Paper code (`papercode.ts`) | `paper_code` 3 + min(4, round(log10(stars+1)·1.5)) + packaged 1 + pushed ≤6 mo 1 (max 9, ≤2 repos); `cited_by_repos` +1/+2/+3 at ≥3/≥10/≥30 citing repos (≤2); cap 15 | 2 (wave 2) | needs key (`GITHUB_TOKEN`); verified 200 (Cambrian-1 → cambrian-mllm/cambrian 2k★; AlphaFold 3 → google-deepmind/alphafold3 8.7k★) | `https://api.github.com/search/repositories?q="<arXiv id \| DOI \| title>" in:readme&per_page=5` → `/repos/<o>/<r>/readme` (Accept `vnd.github.raw+json`), `/repos/<o>/<r>/contents` | Ported from [spinout-intelligence](https://github.com/negarmaleki96/spinout-intelligence) (paper→repo search + README/root-path analysis). Finds code through the *paper*, so lab-org repos and unmatched handles are covered (github.ts finds them through the *account*). GitHub ignores README text without `in:readme`; arXiv id > DOI > exact title (≤2 works, first-author first — REST search is 30 req/min). Official only when the paper reference is in the README head AND the repo is owned by the candidate's wave-1 GitHub login, or the head names the candidate / says "official code for our paper" / description is the title / `CITATION.cff` / repo named after the paper's short name; "unofficial / reimplementation" heads rejected; awesome-lists, surveys and arXiv feeds skipped. Repos already credited by github.ts are not re-counted. Other citing repos only feed the count. Maturity from root paths: packaged (pyproject/setup/requirements/package.json/Cargo/Dockerfile…) > notebooks > scripts > docs only. |
| Packages (`packages.ts`): PyPI, npm, crates.io, CRAN, Docker Hub | `package` `min(7,round(log10(monthly+1)*1.75))` (Docker: min(5, round(log10(lifetime pulls+1)))); cap 15 | 2 (wave 2) | live (verified: PyPI transformers 96.3M/mo, npm zod 1.3B/mo) | `pypi.org/pypi/<n>/json` + `pypistats.org/api/packages/<n>/recent`; `registry.npmjs.org/<n>/latest` + `api.npmjs.org/downloads/point/last-month/<n>`; `crates.io/api/v1/crates/<n>` (UA required; 90-day downloads ÷ 3); `crandb.r-pkg.org/<Name>` + `cranlogs.r-pkg.org/downloads/total/last-month/<Name>`; `hub.docker.com/v2/repositories/<ns>/<repo>/` | Names come from wave-1 GitHub repos and HF artifacts (max 6). A package counts only if its registry metadata links that exact `github.com/owner/repo`; Docker Hub has no repo link, so the namespace must equal the GitHub login. crates.io only for Rust repos, CRAN only for R repos, Docker for ≤3 repos (wave-2 budget). |
| DataCite (`datacite.ts`) | `software` / `dataset` per artifact min(5, 1 + round(log10(downloads+views+1))) +1 if cited; max 4; cap 15 | 2 | live (verified 200; Alisia Fadini, Columbia → AlphaFold-prior tutorial data) | `https://api.datacite.org/dois?query=creators.nameIdentifiers.nameIdentifier:"<orcid>" OR creators.name:"Last, First"&page[size]=25` | Dryad, Dataverse, Code Ocean, figshare, institutional repos. ORCID stored both as URL and bare id → query ORs both. `10.5281/zenodo` DOIs skipped (zenodo.ts covers them). Versions deduped by title. Name + (ORCID / affiliation / shared work). |
| Zenodo (`zenodo.ts`) | `software` / `dataset` `min(5,1+round(log10(dl+1)))`, max 4; cap 15 | 2 | live (verified: Matti Vuorre, Columbia) | `https://zenodo.org/api/records?q=(creators.name:"Last, First" OR creators.name:"First Last") AND (resource_type.type:software OR resource_type.type:dataset)&size=20&sort=mostrecent` | Name + (ORCID / affiliation / shared work) — topic overlap alone is rejected (namesakes). Versions deduped by `conceptrecid`. |

## Stage 3 — Commercial pull

| Source | Signal | Stage | Status | Endpoint | Notes |
|---|---|---|---|---|---|
| Crossref funders / corporate co-authors (`crossref.ts`) | `industry_funder` +3 (max 3), `company_coauthor` +2 (max 2); cap 15 | 3 | live (verified 200; Eugene Wu → Google/Amazon/Adobe funders) | `https://api.crossref.org/works/<doi>?mailto=…` | Up to 5 non-arXiv DOIs (10.48550 is not in Crossref). Company = corporate allowlist / legal suffix / "Labs", judged by name — Crossref funder IDs are sometimes wrong. Acknowledgment full text still roadmap. |
| ORCID employments + fundings (`orcid.ts`) | `founder_role` +10 (stage 4, current founder/CEO/CTO/chief), `industry_role` +3 (max 2, incl. internships), `fellowship` +3 (stage 1), `grant` +2 (stage 6, max 2); cap 15 | 3 / 4 / 1 / 6 | live (verified 200; "CEO / Founder at MY OVU") | `https://pub.orcid.org/v3.0/<id>/employments`, `/fundings` | Only when the candidate has an ORCID (OpenAlex gives a URL → `bareOrcid()`); identity is the ORCID itself. Student records are often empty. |
| ClinicalTrials.gov (`clinicaltrials.ts`) | `trial_industry` +6 (stage 5, company-side official of an industry trial with topic overlap), `trial` +2 (stage 3); max 2 each | 3 / 5 | live (verified 200) | `https://clinicaltrials.gov/api/v2/studies?query.term=<name>&fields=…` | Fields nest under `protocolSection`; ", MD" suffixes stripped. University site PIs on industry trials only get `trial`. Trials older than 5 y ignored. `trial_industry` only exercised on fixtures so far. |
| Google Patents / Lens.org | patent citations of their papers, industry patents | 3/4 | roadmap | Lens: `https://api.lens.org/patent/search` (key) | Google Patents has no official API. Lens requires a free scholarly/patent token. |
| SAM.gov | federal contracts / registrations of a new entity | 3/5 | roadmap | `https://api.sam.gov/entity-information/v3/entities` (key) | Free key at api.data.gov. |
| Standards bodies (IETF, W3C, IEEE, 3GPP) | participation in standards drafts | 3 | roadmap | e.g. IETF Datatracker `https://datatracker.ietf.org/api/v1/` | Niche; relevant to infra/networking theses. |
| Conference agendas / YouTube talks / blogs | industry-facing talks, invited demos | 3 | roadmap | YouTube Data API (key) | |

## Stage 4 — Spinout intent (strongest)

| Source | Signal | Stage | Status | Endpoint | Notes |
|---|---|---|---|---|---|
| NSF Awards API (`nsf.ts`) | `sbir_award` (+10) NSF SBIR/STTR; `icorps` (+8) I-Corps team; `grant` (+3, max 2, stage 6) PI/co-PI awards at their institution | 4, 6 | live (verified HTTP 200, no key) | `https://api.nsf.gov/services/v1/awards.json?pdPIName=<First Last>&printFields=…&rpp=25` and `?coPDPI=<First Last>` | Real fields: `id, title, awardeeName, piFirstName, piLastName, pdPIName, coPDPI ["Name email"], startDate MM/DD/YYYY, fundsObligatedAmt, fundProgramName` ("SBIR Phase I", "I-Corps", …). `printFields` is not honored (full records returned). I-Corps entrepreneurial leads are often students but are typically not listed as PI. Evidence: `https://www.nsf.gov/awardsearch/showAward?AWD_ID=<id>`. |
| SBIR.gov (`sbir.ts`) | `sbir_award` (+10): firm, agency, phase, year, amount | 4 | blocked (HTTP 403 `{"message":"Forbidden"}`; SBIR.gov: "APIs are currently undergoing maintenance") | `https://api.www.sbir.gov/public/api/awards?keyword=<thesis keywords>&rows=100` | No person search (params: firm, agency, year, keyword, rows, start); matches `pi_name`. Enabled only with `SBIR_API_ENABLED=1`. Fallback: bulk CSV `https://data.www.sbir.gov/awarddatapublic/award_data.csv` (290 MB; contains PI names) — could be pre-indexed. NSF SBIRs are already covered by nsf.ts. |
| USPTO PatentsView (`patentsview.ts`) | `patent` (+4) university-assigned; `ip_movement` (+8) assigned to a company or the inventor | 4 | needs key + blocked (`search.patentsview.org` is NXDOMAIN since the 2026-03-20 move to the USPTO Open Data Portal; no relaunch date) | `https://search.patentsview.org/api/v1/patent/?q={"_and":[{"inventors.inventor_name_first":…},{"inventors.inventor_name_last":…}]}&f=[…]` header `X-Api-Key` | Enabled only with `PATENTSVIEW_API_KEY`; `PATENTSVIEW_API_URL` overrides the base URL. Old PatentsView keys will not work on ODP; ODP key: https://data.uspto.gov/apis/getting-started. Disambiguation: assignee is our institution or inventor is NY-based. Evidence: `https://patents.google.com/patent/US<id>`. |
| ARPA-E | ARPA-E awards / fellows | 4 | roadmap | no public API (project list on arpa-e.energy.gov) | |
| Cross-source entity matching / team formation | same 2–3 names co-appearing across papers, repos, awards, filings | 4 | roadmap | built on top of all sources | Strong co-founder signal; reuse `match.ts`. |
| Lab pages | "spun out", "on leave to found" | 4 | roadmap | scrape faculty/lab sites | Fragile; low coverage. |
| NY State corporations (`nycorp.ts`) | `ny_entity` +8 (max 2) | 4 | live, no key (optional `NY_SOCRATA_APP_TOKEN`); verified 200 | `https://data.ny.gov/resource/n9v6-gdp6.json?$q=<name>&$where=initial_dos_filing_date > '<5y>'` | Real columns: `chairman_name`, `dos_process_name`, `registered_agent_name` (no `ceo_name`). `$q` full-text ≈0.5 s vs `like` ≈5 s. Either name order. Needs NYC-area/Tompkins county or NYC city, topic overlap, or a paper-title word in the entity name. Non-profit/professional corps excluded. Delaware has no free officer search. |
| SEC EDGAR Form D (`edgar.ts`) | `form_d` +10, +3 per extra filing (max 2 companies); cap 15 | 4 / 5 | live, no key (UA with contact required); verified 200 | `https://efts.sec.gov/LATEST/search-index?q="<name>"&forms=D` → `https://www.sec.gov/Archives/edgar/data/<cik>/<adsh>/primary_doc.xml` | Person must be listed as a related person in the filing XML; issuer incorporated ≤5 y; pooled funds skipped; NY address or topic overlap. Verified: Clasp, Inc. ($13.2M) names Zach Zhang. |
| LinkedIn | title changes ("Founder", "Stealth") | 4 | excluded | — | ToS forbids scraping; no partner API. |

## Stage 5 — Early traction

| Source | Signal | Stage | Status | Endpoint | Notes |
|---|---|---|---|---|---|
| News / press (akta.pro) | press mentions of the person / thesis market | 5 | live (via akta.pro integration) | akta.pro API | Key in server env; see `lib/` akta integration. |
| Job boards | startup hiring under their name | 5 | roadmap | akta.pro job-posts API is the likely path | |
| Crunchbase | funding rounds, founders | 5/6 | roadmap (licensed) | `https://api.crunchbase.com/api/v4/` | Paid license required. |
| Y Combinator (`yc.ts`) | `yc_company` +12 | 5 (wave 2) | live, no key; verified 200 | `https://yc-oss.github.io/api/companies/all.json` (~10 MB, cached 6 h) + `https://www.ycombinator.com/companies/<slug>` | The yc-oss mirror has no founders: a company name must come from earlier signals (NY entity / Form D / ORCID / GitHub bio), batch ≤5 y, and a founder on the YC page must name-match. |
| USAspending (`usaspending.ts`) | `federal_award` +5 (max 3) | 5 / 6 (wave 2) | live, no key; verified 200 | `POST https://api.usaspending.gov/api/v2/search/spending_by_award/` | No person search: recipient names come from wave-1 entity signals; no request without them. Grants and contracts need separate requests (mixed award-type groups → 422). Covers DoD/DOE/NIH SBIR — workaround for the SBIR.gov 403. |
| Hacker News (`hackernews.ts`) | `show_hn` +6; `hn_story` +min(5, 1+round(log2(1+points)/2)); max 3; cap 15 | 5 (wave 2) | live (200, no key; "GPU Puzzles — 356 points") | `https://hn.algolia.com/api/v1/search?query=<q>&tags=story&hitsPerPage=20` | Queries only from GitHub repo URLs, HF profile and ≤3 quoted paper titles — never a bare name. Hits re-checked by exact URL / arXiv id / title (Algolia is loose). |
| Bluesky (`bluesky.ts`) | `profile` +1; `launch_post` +6 (stage 4, max 1); `hiring_post` +4 (not academic, max 1); `traction_post` +2 (≥50 likes, on-topic, max 2); posts ≤18 mo; cap 15 | 3 / 4 / 5 (wave 2) | live (200, no key; @cvondrick, @harriswang matched) | `https://public.api.bsky.app/xrpc/app.bsky.actor.searchActors`, `getProfile`, `app.bsky.feed.getAuthorFeed?filter=posts_no_replies` | Display name + (institution / GitHub login / ORCID / ≥2 keywords in bio); ties rejected; reposts filtered. `searchPosts` is 403 without auth. X/Twitter excluded (paid API). |
| FDA / FCC filings | 510(k), device authorizations, FCC IDs | 5 | roadmap | openFDA `https://api.fda.gov/device/510k.json`; FCC ID search | Relevant to hardware/medtech theses. |

## Stage 6 — Track record

| Source | Signal | Stage | Status | Endpoint | Notes |
|---|---|---|---|---|---|
| NSF Awards API (`nsf.ts`) | repeat PI/co-PI grants | 6 | live | see stage 4 | +3 each, max 2. |
| NIH RePORTER (`nih.ts`) | `sbir_award` +10 (stage 4, R41–R44/SB1/U43–U44), `fellowship` +4 (stage 1, F*/K99/T32), `grant` +3 (max 2); cap 15 | 6 / 1 / 4 | live (verified 200, no key; Madison Rex F30 at Weill Cornell) | `POST https://api.reporter.nih.gov/v2/projects/search` | F-fellowships name students directly (unlike NSF GRFP). Fuzzy name search re-checked on PI names; institution required except SBIR; deduped by core project number. |
| DOE awards | DOE grants / SBIR | 6 | covered | via `usaspending.ts` | USAspending covers all federal assistance awards once a company name is known. |
| CORDIS (`cordis.ts`) | `eu_grant` +3 (max 2, one per project) | 6 | live (verified 200; Philipp Brandt → ERC ReWORCS) | `https://cordis.europa.eu/api/search/results?q='<name>'&format=json&num=25` | No people search: matches the name in EU-project publication author lists + shared work / institution / topic. Project text alone never counts. |
| Wikidata (`wikidata.ts`) | `notable` +3 (Wikipedia sitelink), `award` +2 (max 3), `identity` 0 (github/twitter/scholar/orcid/website for wave 2) | 6 | live (verified 200; Harris Wang PECASE) | `https://www.wikidata.org/w/api.php?action=wbsearchentities` → `wbgetentities&props=claims\|sitelinks` → `props=labels` | Human + (ORCID equal or P108/P69 in our institution QIDs: Columbia Q49088, NYU Q49210, Cornell Q49115, Cornell Tech Q5171546, Weill Cornell Q3567094 + sub-schools). |

## Keys to request

| Env var | Needed for | Get it |
|---|---|---|
| `S2_API_KEY` (optional) | Semantic Scholar higher rate limits | https://www.semanticscholar.org/product/api#api-key-form |
| `PATENTSVIEW_API_KEY` (+ `PATENTSVIEW_API_URL` when ODP relaunches the API) | PatentsView | https://data.uspto.gov/apis/getting-started (legacy PatentsView key requests are closed) |
| `SBIR_API_ENABLED=1` | SBIR.gov once its API stops returning 403 | no key needed |
| `NY_SOCRATA_APP_TOKEN` (optional) | NY Open Data higher rate limits | https://data.ny.gov/profile/edit/developer_settings |

## Probed and rejected (2026-10-24)

| Source | Result |
|---|---|
| OpenReview | 403 `ChallengeRequiredError` / login required |
| DBLP | Anubis bot wall (HTTP 202) |
| Devpost | no public API (404) |
| Lens.org, USPTO ODP, EPO OPS | key required (401/401/403) |
| Europe PMC Grist (grants) | HTTP/2 stream reset |
| NYU Faculty Digital Archive | DSpace 5.4, no usable REST API |
