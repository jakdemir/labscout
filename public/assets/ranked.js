(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof root !== "undefined") root.Ranked = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  var MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  var LETTER = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  var STAGES = [
    { id: "01", stage: 1, title: "01 RESEARCH", tag: "IS THE WORK STRONG?" },
    { id: "02", stage: 2, title: "02 BUILDER", tag: "DID THEY BUILD IT?" },
    { id: "03", stage: 3, title: "03 INDUSTRY PULL", tag: "DOES INDUSTRY CARE?" },
    { id: "04", stage: 4, title: "04 SPINOUT INTENT", tag: "HEAVIEST WEIGHT", hot: true },
    { id: "05", stage: 5, title: "05 TRACTION", tag: "CONFIRM ONLY" },
    { id: "06", stage: 6, title: "06 TRACK RECORD", tag: "BONUS" },
  ];
  var SOURCES = {
    github: "GITHUB", arxiv: "ARXIV", semanticscholar: "SEMANTIC SCHOLAR", nsf: "NSF AWARDS", nih: "NIH",
    patentsview: "USPTO PATENTSVIEW", sbir: "SBIR", huggingface: "HUGGING FACE", papercode: "PAPER CODE", packages: "PACKAGES",
    zenodo: "ZENODO", crossref: "CROSSREF", orcid: "ORCID", europepmc: "EUROPE PMC", cordis: "CORDIS",
    wikidata: "WIKIDATA", dissertations: "THESIS", nycorp: "NY DOS", edgar: "SEC", usaspending: "USASPENDING",
    clinicaltrials: "CLINICALTRIALS", yc: "YC", bluesky: "BLUESKY", hackernews: "HACKER NEWS",
  };
  var TRAITS = [
    { name: "Speed of learning", key: "t1" },
    { name: "Customer obsession", key: "t2" },
    { name: "Ability to recruit", key: "t3" },
    { name: "Communication", key: "t4" },
    { name: "Resilience", key: "t5" },
  ];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function day(value) {
    var m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  }
  function dateLabel(value) {
    var m = String(value || "").match(/^(\d{4})-(\d{2})/);
    return m ? MON[+m[2] - 1] + " " + m[1].slice(2) : "";
  }
  function blocksFor(points) {
    var n = Math.max(0, Math.min(5, Math.round((+points || 0) / 3)));
    return n;
  }
  function verdictFor(score) {
    if (score >= 75) return { label: "REACH OUT", accent: "#F2E94E" };
    if (score >= 45) return { label: "KEEP TABS", accent: "#9FD3F5" };
    return { label: "ON PAUSE", accent: "#F5B38A" };
  }
  function evidenceOf(c) {
    var rows = [];
    (c.signals || []).forEach(function (s) {
      rows.push({ stage: +s.stage || 0, time: day(s.date), date: dateLabel(s.date), text: s.label, source: SOURCES[s.source] || String(s.source || "").toUpperCase(), url: s.url, weight: +s.weight || 0 });
    });
    (c.works || []).forEach(function (w) {
      rows.push({ stage: 1, time: w.year ? Date.UTC(+w.year, 0, 1) : null, date: w.year ? String(w.year) : "", text: w.title, source: "PAPER", url: w.url, weight: 1, paper: true });
    });
    (c.mentions || []).forEach(function (n) {
      rows.push({ stage: 3, time: day(n.publishedDate), date: dateLabel(n.publishedDate), text: n.title, source: "AKTA", url: n.url, weight: 3 });
    });
    return rows;
  }
  function model(c, opts) {
    var now = opts.now || Date.now();
    var evidence = evidenceOf(c);
    var rows = STAGES.map(function (def) {
      var items = evidence.filter(function (item) { return item.paper ? def.stage === 1 : item.stage === def.stage; });
      var points = items.reduce(function (sum, item) { return sum + item.weight; }, 0);
      var n = blocksFor(points);
      var lead = items[0];
      return {
        id: def.id,
        title: def.title,
        tag: def.tag,
        hot: !!def.hot,
        muted: def.stage === 5 && n === 0,
        n: n,
        saw: lead ? lead.text : "Nothing on the record",
        evidence: items.map(function (item) { return { date: item.date, text: item.text, source: item.source, url: item.url }; }),
      };
    });
    var start = new Date(now);
    start = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    var months = [];
    for (var i = 11; i >= 0; i--) {
      var cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - i, 1));
      var count = evidence.filter(function (item) {
        if (!item.time || item.paper) return false;
        var d = new Date(item.time);
        return d.getUTCFullYear() === cursor.getUTCFullYear() && d.getUTCMonth() === cursor.getUTCMonth();
      }).length;
      months.push({ label: LETTER[cursor.getUTCMonth()], count: count, recent: i < 6 });
    }
    var cut = now - 90 * 86400000;
    var recent = evidence.filter(function (item) { return item.time && !item.paper && item.time >= cut; }).length;
    var brief = String(c.brief || "").replace(/\s+/g, " ").trim();
    return {
      score: opts.score,
      name: c.name || "Unnamed",
      summary: brief || "No brief yet. The scorecard is what the sources returned.",
      verdict: verdictFor(opts.score),
      file: ("00" + ((opts.rank || 0) + 1)).slice(-3),
      refreshed: stamp(opts.refreshed || now),
      recent: recent ? "+" + recent + " signal" + (recent === 1 ? "" : "s") + " in 90 days" : "No new signals in 90 days",
      rows: rows,
      months: months,
    };
  }
  function stamp(ms) {
    var d = new Date(ms);
    return d.getDate() + " " + MON[d.getMonth()] + " " + d.getFullYear() + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  function link(url, text) {
    var href = typeof url === "string" && /^https?:\/\//i.test(url) ? url : "";
    return href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(text) + "</a>" : esc(text);
  }
  function blocks(n, fg) {
    var html = "";
    for (var i = 0; i < 5; i++) html += '<i style="background:' + (i < n ? fg : "transparent") + '"></i>';
    return html;
  }
  function hero(view, asButton) {
    var name = asButton ? '<span class="rk-name">' + esc(view.name) + "</span>" : "<h2>" + esc(view.name) + "</h2>";
    return '<div class="rk-hero"><div class="rk-score"><span>Spinout score</span><div><b>' + esc(view.score) + '</b><small>/100</small></div><em>' + esc(view.recent) + '</em></div>' +
      '<div class="rk-who">' + name + "<p>" + esc(view.summary) + "</p></div>" +
      '<div class="rk-call"><div class="rk-chip" style="background:' + view.verdict.accent + '">' + esc(view.verdict.label) + '</div><span>Intent × momentum + track record</span></div></div>';
  }
  function spotlight(c, opts) {
    var view = model(c, opts);
    return '<button type="button" class="rk-spot" data-act="pull" aria-label="Pull up the scorecard for ' + esc(view.name) + '">' + hero(view, true) + '<span class="rk-pull">Pull up the scorecard</span></button>';
  }
  function levels(key, current) {
    return ["LOW", "MID", "HIGH"].map(function (level) {
      return '<button type="button" data-act="trait" data-key="' + key + '" data-level="' + level + '" aria-pressed="' + (current === level) + '">' + level + "</button>";
    }).join("");
  }
  function scorecard(c, opts) {
    var view = model(c, opts);
    var open = opts.open || { "04": true };
    var partner = opts.partner || { traits: {}, call: "" };
    var rows = view.rows.map(function (row, index) {
      var isOpen = !!open[row.id];
      var fg = row.hot ? "#F4F4F1" : (row.muted ? "#55554F" : "#111111");
      var evidence = row.evidence.map(function (item) {
        return '<div class="rk-ev"><span>' + esc(item.date) + "</span><span>" + link(item.url, item.text) + '</span><b>' + esc(item.source) + "</b></div>";
      }).join("");
      return '<div class="rk-row' + (row.hot ? " hot" : "") + (row.muted ? " muted" : "") + '"' + (index ? "" : ' style="border-top:0"') + ">" +
        '<button type="button" data-act="stage" data-stage="' + row.id + '" aria-expanded="' + isOpen + '">' +
        '<span class="rk-stage"><b>' + esc(row.title) + "</b><small>" + esc(row.tag) + "</small></span>" +
        '<span class="rk-meter">' + blocks(row.n, fg) + "<strong>" + row.n + "/5</strong></span>" +
        '<span class="rk-saw">' + esc(row.saw) + '</span><span class="rk-sign" aria-hidden="true">' + (isOpen ? "−" : "+") + "</span></button>" +
        (isOpen && evidence ? '<div class="rk-drop">' + evidence + "</div>" : "") + "</div>";
    }).join("");
    var months = view.months.map(function (month) {
      var cells = "";
      for (var i = 0; i < month.count; i++) cells += '<i class="' + (month.recent ? "on" : "") + '"></i>';
      return '<div class="rk-month">' + cells + "<span>" + esc(month.label) + "</span></div>";
    }).join("");
    var traits = TRAITS.map(function (trait) {
      return '<fieldset><legend>' + esc(trait.name) + "</legend><div>" + levels(trait.key, (partner.traits || {})[trait.key] || "") + "</div></fieldset>";
    }).join("");
    var calls = ["Meet", "Watch", "Pass"].map(function (label) {
      var id = label.toLowerCase();
      return '<button type="button" data-act="call" data-call="' + id + '" aria-pressed="' + (partner.call === id) + '">' + label + "</button>";
    }).join("");
    return '<section class="rk"><div class="rk-top"><button type="button" data-act="drawer">← Back to drawer</button><span>Scorecard · File ' + esc(view.file) + " · Refreshed " + esc(view.refreshed) + "</span></div>" +
      hero(view) + '<div class="rk-rows">' + rows + '</div><div class="rk-split"><div class="rk-velocity"><div class="rk-label"><span>Signal velocity · last 12 months</span><span>1 square = 1 new signal</span></div><div class="rk-months">' + months + "</div></div>" +
      '<div class="rk-partner"><div class="rk-label"><span>Partner read</span><span>the tool can\'t see these</span></div>' + traits + '<div class="rk-calls">' + calls + "</div></div></div>" +
      (opts.mail ? '<div class="mail"><pre>' + opts.mail + "</pre></div>" : "") + "</section>";
  }

  return { model: model, verdictFor: verdictFor, blocksFor: blocksFor, spotlight: spotlight, scorecard: scorecard };
});
