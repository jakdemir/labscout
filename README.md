# Labscout

**PitchBook for students.** Describe your investment thesis in plain English; get a ranked list of current Columbia, NYU, Cornell and Cornell Tech students already publishing on it — each with a 3-line "why this student" brief and source links.

Live: https://labscout-nyc.vercel.app

Built at **Deal Flow — NYC's first VC hackathon** (Betaworks, October 24, 2026), Track 1: Sourcing.

## How it works

- **Thesis → keywords:** Claude (via Nicrron) turns the plain-English thesis into search keywords.
- **Search:** OpenAlex works search, one query per campus (Columbia / NYU / Cornell / Cornell Tech, publication years 2024–26), merged — so a school that dominates a topic cannot fill the whole pool. The enrichment shortlist (20) keeps ≥5 seats per campus family (Cornell + Cornell Tech count as one); the final 10 are ranked purely by score.
- **Enrich:** per-author aggregation of matching papers + OpenAlex author stats (one batched call) + ORCID education check (an open education entry started ≤8 years ago = current student, unless the publication record is faculty-scale). Works points are capped and a last/corresponding-author PI proxy applies, so established PIs don't out-rank their students.
- **Rank & brief:** deterministic score, then a 3-line brief per student with links to every source paper.
- **Thesis fit:** upload your fund's thesis (PDF/TXT/MD). Labscout pulls up to 4 criteria from it and checks every student against each: yes / partial / no, with the evidence line. Fit points show in the score breakdown.
- **Since last run:** every shortlist is versioned in Roundtable; re-running a thesis shows who is new and who dropped.
- **Partner memo:** one click turns the current shortlist into a printable one-page memo with source links.

## Data sources

- [OpenAlex](https://api.openalex.org) — works and author metadata
- [ORCID public API](https://pub.orcid.org) — education / enrollment status
- [Nicrron](https://api.nicrron.ai) — Claude access for keyword extraction and briefs
- 24 founder-signal sources (GitHub, paper→code repos, arXiv, Semantic Scholar, NSF, NIH, Hugging Face, PyPI/npm, Zenodo, Crossref, ORCID, Europe PMC, CORDIS, Wikidata, dissertation repositories, NY corporations, SEC Form D, USAspending, ClinicalTrials.gov, Y Combinator, Bluesky, Hacker News, …) — see [docs/SOURCES.md](docs/SOURCES.md)

## Run locally

1. Create `.env.local` with `NICRRON_API_KEY`, `OPENALEX_MAILTO` and `OPENALEX_API_KEY` (free key, own $1/day budget — without it OpenAlex's per-IP daily budget is shared with everyone on the same network and runs out: `POST https://api.openalex.org/api-keys {"email"}`, click the activation mail).
2. `node scripts/dev.ts` → http://localhost:3000
3. Tests: `node --test tests/`
4. Hackathon tab data: `node scripts/hackathon.ts` re-pulls the attendee sheet, runs every attendee through the signal sources (resumable cache in `.cache/`) and writes `public/data/hackathon.json`. Flags: `--fresh`, `--briefs N`, `--openalex`, `--limit N`.

Offline demo of the UI: open `/index.html?mock=1` (uses a built-in sample response, no API calls).

Demo mode: `/?demo=1` replays real production responses recorded by `node scripts/snapshot.ts`. A failed live search falls back to the snapshot, labeled "snapshot HH:MM".

## Stack

Zero dependencies. Node 26 native TypeScript. Vercel serverless function (`api/search.ts`) + static `public/`.

## Team 9 — Labscout

- Jak Akdemir — Protocogni Labs
- Yi Liu — Columbia Business School
- Mirah Xu — GreenerIntelligence

All code written on build day, October 24, 2026.
