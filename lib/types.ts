import type { Signal } from "./sources/types.ts";

export type Work = {
  id: string;
  title: string;
  year: number;
  doi: string | null;
  url: string | null;
  venue: string | null;
  citedBy: number;
  position: "first" | "middle" | "last";
  isCorresponding: boolean;
};

export type Education = {
  institution: string;
  degree: string | null;
  startYear: number | null;
  endYear: number | null;
};

export type Candidate = {
  authorId: string;
  name: string;
  orcid: string | null;
  institutions: string[];
  works: Work[];
  worksCount: number | null;
  citedByCount: number | null;
  firstPubYear: number | null;
  recentWorksCount: number | null; // works in the last 2 years (OpenAlex counts_by_year)
  reasons: string[];               // human-readable score breakdown
  mentions: NewsSignal[];          // akta.pro press mentions (top candidates only)
  education: Education[];
  isCurrentStudent: boolean | null;
  score: number;
  brief: string | null;
  signals: Signal[];               // founder signals from lib/sources/* (GitHub, arXiv, NSF, ...)
  fit: Fit[];                      // thesis-fit verdicts per investor criterion ([] when the search has no criteria)
};

export type NewsSignal = {
  title: string;
  url: string;
  publisher: string | null;
  publishedDate: string | null;
  sentiment: string | null;
  summary: string | null;
  companies: string[];
};

export type SearchResponse = {
  query: string;
  keywords: string;
  criteria: string[];                                    // investor criteria from an uploaded thesis (may be [])
  totalWorks: number;
  candidates: Candidate[];
  market: NewsSignal[];                                  // akta.pro news signals for the thesis
  roundtable: { path: string; version: string | null; bank: string | null } | null; // saved shortlist
  changes: Changes | null;                               // diff vs the previous saved shortlist for this thesis
  tookMs?: number;
  sources?: SourceCoverage[];                            // every registered signal source and what it returned this run
  integrations: { nicrron: boolean; prism: boolean; akta: boolean; roundtable: boolean };
};

/** One row per registered source: "hit" = evidence for ≥1 candidate, "none" = queried, no verified match, "off" = not queried. */
export type SourceCoverage = {
  id: string; wave: 1 | 2; status: "hit" | "none" | "off"; reason?: string;
  candidates: number; signals: number; timeouts: number; ms: number;
};

export type Fit = { criterion: string; verdict: "yes" | "partial" | "no"; evidence: string };

export type Changes = { prevAt: string | null; added: string[]; dropped: string[]; kept: number };
