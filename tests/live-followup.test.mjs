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
  assert.match(app, /state\.running \|\| state\.remoteRunning/);
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
});

test("new chat works during a run and leaves it running in background", () => {
  const block = app.slice(app.indexOf("function newSession()"), app.indexOf("let assistantSegmentEpoch"));
  assert.doesNotMatch(block, /if \(state\.running\) return/);
  assert.match(block, /detachRun\(\)/);
  assert.doesNotMatch(app.slice(app.indexOf("function detachRun()"), app.indexOf("function newSession()")), /runAbort\?\.abort/);
  assert.match(app, /if \(s\.liveActive\)/);
});

test("background active session appends only unrendered persisted messages", () => {
  assert.match(app, /renderedCounts: new Map\(\)/);
  assert.match(app, /const renderedCount = state\.renderedCounts\.get\(id\)/);
  assert.match(app, /r\?\.messages && r\.messages\.length > renderedCount/);
  assert.match(app, /state\.renderedCounts\.set\(id, r\.messages\.length\)/);
  assert.match(app, /setTimeout\(poll, 1500\)/);
});

test("new chat is independent from the current conversation session", () => {
  const block = app.slice(app.indexOf("function newSession()"), app.indexOf("let assistantSegmentEpoch"));
  assert.match(block, /state\.current = null/);
  assert.match(block, /state\.remoteRunning = false/);
  assert.match(block, /state\.resumeInterrupted = false/);
  assert.match(block, /state\.editReplayIndex = null/);
  assert.doesNotMatch(block, /claudeSessionId/);
});

test("send preflights liveActive and converts run races into follow-up for the captured session", () => {
  assert.match(app, /const targetSessionId = state\.current/);
  assert.match(app, /request\("\/api\/sessions\/" \+ targetSessionId\)/);
  assert.match(app, /response\.status === 409 && targetSessionId/);
  assert.match(app, /sessionId: targetSessionId/);
});

test("switching conversations isolates rendering by session while preserving the live stream", () => {
  assert.match(app, /const ownsView = \(\) => Boolean\(streamSessionId && state\.current === streamSessionId\)/);
  assert.match(app, /if \(!ownsView\(\)\) continue/);
  assert.match(app, /recordLiveRunEvent\(streamSessionId/);
  assert.match(app, /restoreLiveProgress\(id\)/);
  assert.doesNotMatch(app, /const runViewEpoch = viewEpoch/);
});

test("native chrome command is not rewritten to third-party browser MCP", () => {
  assert.match(server, /return "\/chrome"/);
  assert.doesNotMatch(server, /Use a integra.*superpowers-chrome/);
  assert.match(server, /extraArgs: \{ chrome: null \}/);
});

test("switching/opening a chat never auto-resumes an inFlight run", () => {
  const block = app.slice(app.indexOf("async function loadSession"), app.indexOf("function updateCost"));
  assert.doesNotMatch(block, /await resumeInterruptedRun\(s\)/);
  assert.match(block, /Execução interrompida — pronta para retomar/);
  assert.match(block, /syntheticResume/);
});

test("conversation switching preserves the same live stream and elapsed progress", () => {
  assert.match(app, /liveRuns: new Map\(\)/);
  assert.match(app, /function ensureLiveRunMeta\(sessionId\)/);
  assert.match(app, /function restoreLiveProgress\(sessionId\)/);
  assert.match(app, /const ownsView = \(\) => Boolean\(streamSessionId && state\.current === streamSessionId\)/);
  assert.match(app, /!assistant \|\| !assistant\.isConnected/);
  assert.match(app, /recordLiveRunEvent\(streamSessionId/);
  assert.doesNotMatch(app, /const ownsView = \(\) => viewEpoch === runViewEpoch/);
});

test("brand-new chats attach live metadata after receiving their session id", () => {
  assert.match(app, /if \(!state\.liveRuns\.has\(streamSessionId\)\)/);
  assert.match(app, /startedAt: progressStarted \|\| Date\.now\(\)/);
});

test("follow-up text always starts a new assistant bubble after the user message", () => {
  assert.match(app, /const segmentChanged = assistantSegmentSeen !== assistantSegmentEpoch/);
  assert.match(app, /const existing = segmentChanged \? null :/);
  assert.match(app, /assistant = existing || message("assistant", "")/);
});
