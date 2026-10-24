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
