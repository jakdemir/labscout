/* Labscout shell: top bar with 3 tabs, footer, icons, helpers. Include with <script src="/assets/shell.js"></script>
   at the end of <body>, after a <div id="ls-top"></div> placeholder and before page scripts. Exposes window.LS. */
(function () {
  var P = { "stroke-width": "1.5", fill: "none", stroke: "currentColor", "stroke-linecap": "round", "stroke-linejoin": "round" };
  var ICONS = {
    chat: '<path d="M4 5.5h16v10H9l-5 4v-14Z"/>',
    plug: '<path d="M9 3v5M15 3v5M6.5 8h11v3a5.5 5.5 0 0 1-11 0V8ZM12 16.5V21"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
    send: '<path d="M4 12h15M13 6l6 6-6 6"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    paper: '<path d="M7 3h7l5 5v13H7V3Z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
    code: '<path d="m9 8-5 4 5 4M15 8l5 4-5 4"/>',
    award: '<circle cx="12" cy="9" r="5"/><path d="m8.5 13-1.5 8 5-3 5 3-1.5-8"/>',
    news: '<path d="M4 5h13v14H6a2 2 0 0 1-2-2V5Z"/><path d="M17 9h3v8a2 2 0 0 1-2 2M8 9h5M8 13h5"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    github: '<path d="M9 19c-4 1.3-4-2-6-2.5M15 21v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
    clip: '<path d="m20 11.5-8.2 8.2a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    school: '<path d="m3 9 9-5 9 5-9 5-9-5Z"/><path d="M7 11.5V16c0 1.5 2.2 3 5 3s5-1.5 5-3v-4.5M21 9v6"/>',
  };
  function icon(name, size) {
    var a = Object.keys(P).map(function (k) { return k + '="' + P[k] + '"'; }).join(" ");
    var s = size || 16;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" ' + a + ' aria-hidden="true">' + (ICONS[name] || "") + "</svg>";
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return typeof u === "string" && /^https?:\/\//i.test(u) ? u : null; }
  function slug(q) { return String(q || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60); }

  var path = location.pathname.replace(/\.html$/, "").replace(/\/+$/, "") || "/";
  var TABS = [
    { href: "/", label: "Scout", icon: "chat", match: ["/", "/index"] },
    { href: "/hackathon", label: "Hackathon", icon: "award", match: ["/hackathon"] },
    { href: "/sponsors", label: "Sponsors", icon: "plug", match: ["/sponsors"] },
    { href: "/docs", label: "Architecture", icon: "layers", match: ["/docs"] },
  ];
  var top = document.getElementById("ls-top");
  if (top) {
    top.outerHTML =
      '<header class="ls-top"><div class="ls-top-in">' +
        '<a class="ls-brand" href="/" aria-label="Labscout home"><i></i>Labscout<small>Student founder watchlist</small></a>' +
        '<nav class="ls-tabs" aria-label="Sections">' +
          TABS.map(function (t) {
            var cur = t.match.indexOf(path) >= 0 ? ' aria-current="page"' : "";
            return '<a class="ls-tab" href="' + t.href + '"' + cur + ">" + icon(t.icon) + "<span>" + t.label + "</span></a>";
          }).join("") +
        "</nav>" +
        '<div class="ls-top-right">' +
          '<span class="ls-live" id="ls-live" title="Sponsor status"><b></b><span>Checking sponsors</span></span>' +
          '<a class="ls-gh" href="https://github.com/jakdemir/labscout" aria-label="Source on GitHub">' + icon("github", 18) + "</a>" +
        "</div>" +
      "</div></header>";
  }
  var foot = document.getElementById("ls-foot");
  if (foot) {
    foot.outerHTML =
      '<footer class="ls-foot"><div class="wrap">' +
        "<span>Team 9 · Deal Flow NYC VC Hackathon · Track 1 Sourcing</span>" +
        '<span class="sp"><a href="/sponsors">Nicrron</a><a href="/sponsors">PRISM</a><a href="/sponsors">akta.pro</a><a href="/sponsors">Roundtable</a></span>' +
      "</div></footer>";
  }

  // Shared /api/status fetch (cached per page load). Updates the top-bar live dot.
  var statusP = null;
  function status(fresh) {
    if (!statusP || fresh) {
      statusP = fetch("/api/status" + (fresh ? "?fresh=1" : "")).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
      statusP.then(function (d) {
        var el = document.getElementById("ls-live"); if (!el) return;
        var list = checksOf(d);
        var up = list.filter(function (c) { return c.ok; }).length;
        el.classList.toggle("on", list.length > 0 && up === list.length);
        el.querySelector("span").textContent = list.length ? up + "/" + list.length + " sponsors live" : "Status unavailable";
      });
    }
    return statusP;
  }
  function checksOf(d) {
    if (!d) return [];
    if (Array.isArray(d)) return d;
    if (Array.isArray(d.checks)) return d.checks;
    if (Array.isArray(d.sponsors)) return d.sponsors;
    for (var k in d) if (Array.isArray(d[k])) return d[k];
    return [];
  }
  function copyPre() {
    document.querySelectorAll("pre[data-copy]").forEach(function (pre) {
      var b = document.createElement("button"); b.className = "copy-btn"; b.type = "button"; b.textContent = "Copy";
      b.onclick = function () {
        var t = pre.getAttribute("data-copy") || pre.innerText.replace(/\nCopy$/, "");
        (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).catch(function () {}).then(function () { b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy"; }, 1200); });
      };
      pre.appendChild(b);
    });
  }
  if (!/mock=1/.test(location.search)) status(false);
  window.LS = { icon: icon, esc: esc, safeUrl: safeUrl, slug: slug, status: status, checksOf: checksOf, copyPre: copyPre };
})();
