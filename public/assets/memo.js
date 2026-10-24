// Partner memo: one printable page for the current shortlist. Pure function (tests/memo.test.ts);
// the Scout page opens it in a new tab with document.write. Relative font URLs resolve against the opener.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const a = (u, t) => (/^https?:\/\//i.test(String(u || "")) ? `<a href="${esc(u)}">${esc(t)}</a>` : esc(t));
const VERD = { yes: "Yes", partial: "Partial", no: "No" };
const CSS = `@font-face{font-family:"Inter Tight";font-weight:400;src:url(/fonts/inter-tight-400-normal.woff2) format("woff2")}
@font-face{font-family:"Inter Tight";font-weight:700;src:url(/fonts/inter-tight-700-normal.woff2) format("woff2")}
@font-face{font-family:"JetBrains Mono";font-weight:400;src:url(/fonts/jetbrains-mono-400-normal.woff2) format("woff2")}
body{max-width:760px;margin:40px auto;padding:0 24px;font:15px/1.5 "Inter Tight",system-ui,sans-serif;color:#111;background:#F4F4EF}
h1{font-weight:700;font-size:32px;letter-spacing:-.04em;line-height:1.1;margin:6px 0}
h2{font-size:19px;letter-spacing:-.02em;margin:0 0 6px}
h3{font:400 11px/1 "JetBrains Mono",monospace;text-transform:uppercase;letter-spacing:.12em;margin:12px 0 4px}
.m{font:400 12px/1.4 "JetBrains Mono",monospace;color:#5E5E58}
header{padding-bottom:12px}section{border-top:1.5px solid #111;padding:16px 0;break-inside:avoid}
ul{margin:0;padding-left:18px}a{color:#111}footer{border-top:1.5px solid #111;padding-top:12px}
.p{position:fixed;top:16px;right:16px;font:400 12px "JetBrains Mono",monospace;background:#F2E96B;border:1.5px solid #111;border-radius:6px;padding:8px 12px;cursor:pointer}
@media print{.p{display:none}body{background:#fff;margin:0 auto}a{text-decoration:none}}`;

export function memoHtml(d, list, criteria, now = new Date()) {
  const rows = list.map((c, i) => {
    const status = c.isCurrentStudent === true ? "current student (ORCID)" : c.isCurrentStudent === false ? "not enrolled" : "enrollment unverified";
    const works = (c.works || []).slice(0, 3).map((w) => `<li>${a(w.url, w.title)} <span class="m">${esc([w.position && w.position + " author", w.year, w.venue].filter(Boolean).join(" · "))}</span></li>`).join("");
    const sigs = (c.signals || []).slice(0, 4).map((s) => `<li>${a(s.url, s.label)} <span class="m">${esc(s.source)}</span></li>`).join("");
    const fit = (c.fit || []).map((f) => `<li><b>${esc(VERD[f.verdict] || f.verdict)}</b> — ${esc(f.criterion)}: ${esc(f.evidence)}</li>`).join("");
    return `<section><h2>${i + 1}. ${esc(c.name)}</h2><p class="m">${esc((c.institutions || []).join(", "))} · ${esc(status)} · score ${esc(c.score)}</p>` +
      (c.brief ? `<p>${esc(c.brief).replace(/\n/g, "<br>")}</p>` : "") +
      (fit ? `<h3>Thesis fit</h3><ul>${fit}</ul>` : "") +
      (works ? `<h3>Papers</h3><ul>${works}</ul>` : "") +
      (sigs ? `<h3>Signals</h3><ul>${sigs}</ul>` : "") + "</section>";
  }).join("");
  const crit = criteria.length ? `<p class="m">Criteria: ${criteria.map(esc).join(" · ")}</p>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Labscout memo — ${esc(d.query)}</title><style>${CSS}</style></head><body>` +
    `<button class="p" onclick="print()">Print / Save PDF</button>` +
    `<header><p class="m">LABSCOUT · STUDENT SHORTLIST · ${now.toISOString().slice(0, 10)}</p><h1>${esc(d.query)}</h1>` +
    `<p class="m">${esc(d.totalWorks ?? 0)} papers → ${list.length} students · keywords “${esc(d.keywords)}”</p>${crit}</header>${rows}` +
    `<footer class="m">Every line links to its source: OpenAlex, ORCID and 24 founder-signal sources. Briefs and fit checks by Claude via Nicrron. labscout-nyc.vercel.app</footer></body></html>`;
}
