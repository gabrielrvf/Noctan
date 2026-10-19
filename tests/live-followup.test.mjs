import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("active Claude session accepts additive live steering", () => {
  assert.match(server, /path === "\/api\/follow-up"/);
  assert.match(server, /streamInput\(one\(\)\)/);
  assert.match(server, /priority: "now"/);
  assert.match(server, /origin: \{ kind: "human" \}/);
  assert.match(server, /steeringText/);
  assert.match(app, /if \(state\.running && state\.current\)/);
  assert.match(app, /request\("\/api\/follow-up"/);
});

test("live follow-up starts next assistant text in a new bubble", () => {
  assert.match(app, /assistantSegmentEpoch \+= 1/);
  assert.match(app, /assistantSegmentSeen !== assistantSegmentEpoch/);
  assert.match(server, /segmentBreakRequested: false/);
  assert.match(server, /running\.segmentBreakRequested = true/);
  assert.match(server, /liveRun\.segmentStart = finalText\.length/);
});

test("editing a user message branches and rebuilds context", () => {
  assert.match(server, /editSessionUserMessage/);
  assert.match(server, /session\.messages = session\.messages\.slice\(0, index \+ 1\)/);
  assert.match(server, /delete session\.claudeSessionId/);
  assert.match(server, /historyForRebuild/);
  assert.match(app, /editReplayIndex/);
});

test("unexpected exit is checkpointed and resumed without duplicating user prompt", () => {
  assert.match(server, /s\.inFlight = \{/);
  assert.match(server, /lastCheckpointAt/);
  assert.match(server, /if \(!replayingEdit && !resumeInterrupted\) s\.messages\.push/);
  assert.match(server, /opts\.resume = s\.claudeSessionId/);
  assert.match(server, /crashResumePrompt/);
  assert.match(server, /delete s\.inFlight/);
  assert.match(app, /resumeInterruptedRun/);
  assert.match(app, /session\?\.inFlight/);
  assert.match(app, /interrupted\?\.id \|\| latest\?\.id/);
  assert.match(app, /resumeInterrupted,/);
});

test("new chat works during a run and leaves it running in background", () => {
  const newSession = app.slice(app.indexOf("function newSession()"), app.indexOf("let assistantSegmentEpoch"));
  assert.doesNotMatch(newSession, /if \(state\.running\) return/);
  assert.match(newSession, /detachRun\(\)/);
  assert.match(app, /signal: ctrl\.signal/);
  assert.match(app, /if \(s\.liveActive\)/);
  assert.ok(app.indexOf("if (s.liveActive)") < app.indexOf("if (s.inFlight && !state.running)"), "background run must not be resumed as interrupted");
});

test("model changes create a persisted chat notice", () => {
  assert.match(server, /appendSessionNotice/);
  assert.match(app, /kind: "model-change"/);
});

test("speech recognizer is prewarmed before first dictation", () => {
  assert.match(app, /function prewarmStt/);
  assert.match(app, /takeWarmSttSocket/);
});
