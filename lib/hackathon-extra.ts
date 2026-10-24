// People who are not in the Deal Flow registration sheet but belong in the Hackathon roster
// (judges, mentors and residency staff from the event page). Merged in by scripts/hackathon.ts.
// No emails: keys are derived from the name, and matching uses only name + org.
import type { Attendee } from "./hackathon.ts";

const GROUP = "Judges & mentors";

const person = (name: string, type: string, org: string, title: string, theme = ""): Attendee => ({
  key: "x-" + name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
  name, team: null, teamName: GROUP, theme, type, org, title, skills: [], linkedin: null, email: "",
});

export const EXTRA_ATTENDEES: Attendee[] = [
  person("Abeera Saeed", "Investor", "Plug and Play", "Ventures Principal", "Enterprise & AI B2B SaaS, pre-seed to Series A"),
  person("Michael Barone", "Investor", "Everywhere Ventures", "Associate", "Global pre-seed venture capital"),
  person("D. J. Patel", "Investor", "", "VC, 3x exited founder"),
  person("Radhika Khandelwal", "Operator", "Wand AI", "Product leader, AI agents", "Former VC; looks for slick code and a real business"),
  person("Bettina Sosa", "Founder", "Yaven", "Co-founder & CEO", "Local-first AI workforce for independent businesses"),
  person("Arjun Padmajan", "Founder", "Roundtable", "CEO", "Roundtable: where AI agents connect and work together"),
  person("Erzsébet Ábrám", "Operator", "", "Community Architect at the residency"),
  person("Akhil A.", "Engineer", "Collectors", "Staff Security Engineer", "Security through AI adoption, M&A and IPO compliance"),
];

/** Roster changes the registration sheet doesn't reflect yet (by exact name). team: null = left their team. */
export const TEAM_MOVES: { name: string; team: number | null; teamName: string; theme?: string }[] = [
  { name: "Vince", team: null, teamName: "Left team 9 (Labscout)" },
  { name: "Siva Koneru", team: null, teamName: "Left team 9 (Labscout)" },
  { name: "Negar Maleki", team: 9, teamName: "Labscout" },
  { name: "Jayprakash M", team: 9, teamName: "Labscout" },
];

export function applyMoves<T extends Pick<Attendee, "name" | "team" | "teamName" | "theme">>(people: T[]): T[] {
  const themeOf = new Map<number, string>();
  for (const p of people) if (p.team !== null && p.theme && !themeOf.has(p.team)) themeOf.set(p.team, p.theme);
  return people.map((p) => {
    const m = TEAM_MOVES.find((x) => x.name.toLowerCase() === p.name.trim().toLowerCase());
    if (!m) return p;
    return { ...p, team: m.team, teamName: m.teamName, theme: m.team === null ? "" : m.theme ?? themeOf.get(m.team) ?? p.theme };
  });
}
