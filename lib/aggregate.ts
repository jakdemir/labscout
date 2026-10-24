import { NYC_INSTITUTIONS, familyOf } from "./institutions.ts";
import type { Candidate, Work } from "./types.ts";

export function aggregate(works: any[]): Candidate[] {
  const byAuthor = new Map<string, Candidate>();
  for (const w of works) {
    const work: Omit<Work, "position" | "isCorresponding"> = {
      id: w.id,
      title: w.title ?? "(untitled)",
      year: w.publication_year ?? 0,
      doi: w.doi ?? null,
      url: w.primary_location?.landing_page_url ?? w.doi ?? null,
      venue: w.primary_location?.source?.display_name ?? null,
      citedBy: w.cited_by_count ?? 0,
    };
    for (const a of w.authorships ?? []) {
      const nyc = (a.institutions ?? []).map((i: any) => NYC_INSTITUTIONS[i.id]).filter(Boolean) as string[];
      if (nyc.length === 0) continue;
      const id = a.author?.id;
      if (!id) continue;
      const existing = byAuthor.get(id) ?? {
        authorId: id, name: a.author.display_name ?? "Unknown", orcid: a.author.orcid ?? null,
        institutions: [], works: [], worksCount: null, citedByCount: null, firstPubYear: null, recentWorksCount: null, reasons: [], mentions: [],
        education: [], isCurrentStudent: null, score: 0, brief: null, signals: [], fit: [],
      };
      for (const n of nyc) if (!existing.institutions.includes(n)) existing.institutions.push(n);
      existing.works.push({ ...work, position: a.author_position, isCorresponding: !!a.is_corresponding });
      byAuthor.set(id, existing);
    }
  }
  return [...byAuthor.values()];
}

/** Enrichment shortlist: the top `n` by pre-score, but every campus family that has candidates keeps at least
 *  `minPer` seats (lowest-ranked overall are displaced). Cornell + Cornell Tech count as one family. Guards the
 *  pool, not the final order: the final top 10 is still sorted purely by score. Input must be sorted. */
export function shortlist(sorted: Candidate[], n = 15, minPer = 3): Candidate[] {
  if (sorted.length <= n) return sorted.slice();
  const picked = sorted.slice(0, n);
  const fams = (c: Candidate) => [...new Set(c.institutions.map(familyOf))];
  const count = (list: Candidate[], fam: string) => list.filter((c) => fams(c).includes(fam)).length;
  const families = [...new Set(sorted.flatMap(fams))];
  for (const fam of families) {
    const pool = sorted.filter((c) => fams(c).includes(fam) && !picked.includes(c));
    while (count(picked, fam) < minPer && pool.length) {
      // displace the lowest-ranked pick whose families all stay above their minimum without it
      const victim = [...picked].reverse().find((c) => !fams(c).includes(fam) && fams(c).every((f) => count(picked, f) > minPer));
      if (!victim) break;
      picked.splice(picked.indexOf(victim), 1);
      picked.push(pool.shift()!);
    }
  }
  return picked.sort((a, b) => b.score - a.score);
}
