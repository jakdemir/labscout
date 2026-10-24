// Demo snapshot key, shared by scripts/snapshot.ts (writer) and the Search page (reader via dynamic import).
export function snapKey(q, criteria) {
  const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const c = (criteria || []).map(norm).filter(Boolean);
  return norm(q) + (c.length ? " | " + c.join(" | ") : "");
}
