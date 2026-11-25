import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDIO_STATES, AudioStateMachine } from "../../src/sim/audio/AudioStates.ts";

test("the table has the seven states, three with a music file", () => {
  assert.deepEqual(AUDIO_STATES.map((s) => s.id), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(AUDIO_STATES.filter((s) => s.file).map((s) => s.id), [1, 5, 6]);
  assert.equal(AUDIO_STATES[2].player, "radio");
  assert.equal(AUDIO_STATES[4].player, "frontEnd");
});

test("starting a game: the radio is set first, loading goes over it and removing loading brings the radio back", () => {
  const a = new AudioStateMachine();
  const game = "game";
  const loader = "loader";
  // Game_ConstructSystems: Audio_SetState(2, game), then Audio_SetState(1, this)
  assert.deepEqual(a.setState(2, game), [{ kind: "suspend", state: 0 }, { kind: "start", state: 2 }, { kind: "resume", state: 2 }]);
  assert.deepEqual(a.setState(1, loader), [{ kind: "suspend", state: 2 }, { kind: "start", state: 1 }, { kind: "resume", state: 1 }]);
  assert.equal(a.current, 1);
  assert.deepEqual(a.removeState(1, loader), [{ kind: "stop", state: 1 }, { kind: "resume", state: 2 }]);
  assert.equal(a.current, 2);
});

test("asking for the current state changes nothing and records nothing", () => {
  const a = new AudioStateMachine();
  assert.deepEqual(a.setState(0, "x"), []);
  assert.deepEqual(a.entries(), []);
  a.setState(5, "screen");
  assert.deepEqual(a.setState(5, "other"), []);
  assert.deepEqual(a.entries(), [{ state: 5, owner: "screen" }]);
});

test("removing a state that is not current lets it go and leaves the current one alone", () => {
  const a = new AudioStateMachine();
  a.setState(4, "menu");
  a.setState(5, "release");
  assert.deepEqual(a.removeState(4, "menu"), [{ kind: "stop", state: 4 }]);
  assert.equal(a.current, 5);
});

test("removing the last state falls back to 0; removing an unknown pair does nothing", () => {
  const a = new AudioStateMachine();
  a.setState(6, "splash");
  assert.deepEqual(a.removeState(6, "nobody"), []);
  assert.deepEqual(a.removeState(6, "splash"), [{ kind: "stop", state: 6 }]);
  assert.equal(a.current, 0);
});

test("the radio is neither started nor resumed while it is suppressed", () => {
  const a = new AudioStateMachine();
  a.radioSuppressed = true;
  assert.deepEqual(a.setState(2, "game"), [{ kind: "suspend", state: 0 }]);
  a.setState(5, "release");
  assert.deepEqual(a.removeState(5, "release"), [{ kind: "stop", state: 5 }]);
});
