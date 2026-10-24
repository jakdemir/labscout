// Registry of all founder-signal sources. Wiring into the search pipeline lives in lib/search.ts.
// Wave-1 sources run in parallel first; wave-2 sources (wave: 2) run after and read wave-1 signals.
import type { SourceModule } from "./types.ts";
import { source as github } from "./github.ts";
import { source as arxiv } from "./arxiv.ts";
import { source as semanticscholar } from "./semanticscholar.ts";
import { source as nsf } from "./nsf.ts";
import { source as patentsview } from "./patentsview.ts";
import { source as sbir } from "./sbir.ts";
// builder
import { source as huggingface } from "./huggingface.ts";
import { source as packages } from "./packages.ts";
import { source as zenodo } from "./zenodo.ts";
import { source as papercode } from "./papercode.ts";
// academic / identity
import { source as crossref } from "./crossref.ts";
import { source as orcid } from "./orcid.ts";
import { source as europepmc } from "./europepmc.ts";
import { source as cordis } from "./cordis.ts";
import { source as wikidata } from "./wikidata.ts";
import { source as dissertations } from "./dissertations.ts";
import { source as nih } from "./nih.ts";
// entity formation / money
import { source as nycorp } from "./nycorp.ts";
import { source as edgar } from "./edgar.ts";
import { source as usaspending } from "./usaspending.ts";
import { source as clinicaltrials } from "./clinicaltrials.ts";
import { source as yc } from "./yc.ts";
// social / launch
import { source as bluesky } from "./bluesky.ts";
import { source as hackernews } from "./hackernews.ts";

export const SOURCES: SourceModule[] = [
  github, arxiv, semanticscholar, nsf, patentsview, sbir,
  huggingface, packages, zenodo, papercode,
  crossref, orcid, europepmc, cordis, wikidata, dissertations, nih,
  nycorp, edgar, usaspending, clinicaltrials, yc,
  bluesky, hackernews,
];
export type { Signal, SourceModule, SourceContext, SourceId } from "./types.ts";
