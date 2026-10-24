import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMoves } from "../lib/hackathon-extra.ts";

test("applyMoves: leavers lose their team, joiners take the new team's theme", () => {
  const p = (name: string, team: number | null, teamName: string, theme: string) => ({ name, team, teamName, theme });
  const out = applyMoves([p("Jak Akdemir", 9, "Labscout", "Technical-founder scouting"), p("Vince", 9, "Labscout", "Technical-founder scouting"), p("Negar Maleki", 101, "General VC Build", "VC build")]);
  assert.deepEqual(out[0], p("Jak Akdemir", 9, "Labscout", "Technical-founder scouting"));
  assert.equal(out[1].team, null);
  assert.equal(out[1].theme, "");
  assert.deepEqual(out[2], p("Negar Maleki", 9, "Labscout", "Technical-founder scouting"));
});
