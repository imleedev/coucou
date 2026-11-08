import assert from "node:assert/strict";
import { test } from "node:test";
import { BotEngine } from "../src/mochi/engine.ts";

const emotions = [
  "happy", "excited", "love", "proud", "surprised", "curious", "confused", "sad",
  "scared", "angry", "annoyed", "thinking", "sleepy", "yawn", "wink", "listening",
];

test("every catalog emotion triggers its face and at least one existing visual reaction", () => {
  for (const emotion of emotions) {
    const engine = new BotEngine();
    engine.setPermanentEmote(emotion);
    engine.triggerEmote(emotion);
    assert.equal(engine.permanentEmote, emotion, `${emotion}: persistent face`);
    assert.ok(engine.eyeOverride, `${emotion}: face override`);
    assert.ok(engine.tweens.size > 0 || engine.particles.length > 0, `${emotion}: visual reaction`);
  }
});

test("Mochi's body path uses smooth cubic vector segments through the original contour samples", () => {
  const previousPath2D = globalThis.Path2D;
  class RecordedPath {
    commands = [];
    moveTo(...point) { this.commands.push(["move", ...point]); }
    bezierCurveTo(...points) { this.commands.push(["cubic", ...points]); }
    lineTo(...point) { this.commands.push(["line", ...point]); }
    closePath() { this.commands.push(["close"]); }
  }
  globalThis.Path2D = RecordedPath;
  try {
    const engine = new BotEngine();
    const path = engine.bodyPath(40, 30, 40);
    assert.equal(path.commands.filter(([kind]) => kind === "cubic").length, 120);
    assert.equal(path.commands.filter(([kind]) => kind === "line").length, 0);
    assert.deepEqual(path.commands[0], ["move", 40, 0]);
    assert.deepEqual(path.commands.at(-1), ["close"]);
  } finally {
    globalThis.Path2D = previousPath2D;
  }
});
