function formatList(names) {
  if (names.length <= 1) return names[0] || "";
  if (names.length === 2) return names[0] + " and " + names[1];
  if (names.length === 3) return names[0] + ", " + names[1] + ", and " + names[2];
  return names.slice(0, 3).join(", ") + ", and " + (names.length - 3) + " more";
}

function applyLook(state, look) {
  if (!look || look.type === "phase") {
    if (!look) return state;
    return {
      phase: look.label,
      phaseId: look.id,
      phaseIndex: look.index,
      phaseTotal: look.total,
      looking: state.looking.slice(),
    };
  }
  if (look.type !== "source") return state;
  var looking = state.looking.filter(function (label) { return label !== look.label; });
  if (look.state === "looking") looking = [look.label].concat(looking);
  return {
    phase: state.phase,
    phaseId: state.phaseId,
    phaseIndex: state.phaseIndex,
    phaseTotal: state.phaseTotal,
    looking: looking,
  };
}

function watchHeading(state) {
  var signal = state.phaseId === "signals" || state.phaseId === "follow";
  if (signal && state.looking.length) return "Checking " + formatList(state.looking);
  return state.phase;
}

function watchDetail(state) {
  var signal = state.phaseId === "signals" || state.phaseId === "follow";
  if (signal || !state.looking.length) return "";
  return "Also looking at " + formatList(state.looking);
}

var api = { applyLook: applyLook, watchHeading: watchHeading, watchDetail: watchDetail };
if (typeof module === "object" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.SearchWatch = api;
