// Shared contract for founder-signal sources (see "Early Founder Signals" framework doc).
// Stages: 1 research quality, 2 builder signal, 3 commercial pull, 4 spinout intent, 5 early traction, 6 track record.
import type { Candidate } from "../types.ts";

export type SourceId =
  | "github" | "arxiv" | "semanticscholar" | "nsf" | "patentsview" | "sbir"
  // builder
  | "huggingface" | "packages" | "zenodo" | "papercode" | "releases" | "datacite"
  // academic / identity
  | "crossref" | "orcid" | "europepmc" | "cordis" | "wikidata" | "dissertations" | "nih" | "osf"
  // entity formation / money
  | "nycorp" | "edgar" | "usaspending" | "clinicaltrials" | "yc" | "openfda"
  // standards / social / launch
  | "ietf" | "bluesky" | "hackernews";

export type Signal = {
  source: SourceId;
  stage: 1 | 2 | 3 | 4 | 5 | 6;
  kind: string;          // e.g. "repo", "preprint", "citation_velocity", "icorps", "sbir_award", "patent"
  label: string;         // one human-readable line shown on the card, e.g. "repo foo/bar — 1.2k stars, 34 forks"
  url: string | null;    // evidence link (required whenever one exists)
  date: string | null;   // ISO date of the evidence
  weight: number;        // score points this signal adds (keep each source's total <= 15)
};

export type SourceContext = { query: string; keywords: string };

export type SourceModule = {
  id: SourceId;
  /** Wave 1 (default) runs all sources in parallel. Wave 2 runs after wave 1 completes and may read
   *  `c.signals` already collected (e.g. GitHub login / repo names, Hugging Face username) to derive queries. */
  wave?: 1 | 2;
  enabled(): boolean;                                   // false when a required key is missing
  enrich(c: Candidate, ctx: SourceContext): Promise<Signal[]>; // must never throw; return [] on any failure; 15 s budget
};
