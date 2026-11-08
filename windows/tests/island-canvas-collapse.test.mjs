// A Wallpaper → compact transition animates the existing Mochi canvas down.
// Reallocating its backing bitmap for every intermediate size makes WebKit
// retain stale large frames and show a second, oversized Mochi.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom } from "./fakedom.mjs";

installFakeDom();
const { sizeBotCanvas } = await import("../src/island/bot-canvas.ts");

test("Wallpaper → compact does not reallocate Mochi's backing store during shrink frames", () => {
  const writes = { width: 0, height: 0 };
  const context = {
    setTransform() {}, clearRect() {}, save() {}, restore() {},
  };
  const canvas = { style: {}, getContext: () => context };
  for (const key of ["width", "height"]) {
    let value = 0;
    Object.defineProperty(canvas, key, {
      get: () => value,
      set: (next) => { writes[key]++; value = next; },
    });
  }

  const cache = { canvasPx: 0, canvasDpr: 0 };
  const expanded = 50 / 0.684 + 48;
  const compact = 24 / 0.684 + 48;
  let drawingInset = 0;
  for (let frame = 0; frame <= 60; frame++) {
    const drawWidth = expanded + (compact - expanded) * (frame / 60) - 48;
    drawingInset = sizeBotCanvas(canvas, Math.round(drawWidth), 4, cache, 24, 40, 96).drawingInset;
  }

  assert.equal(writes.width, 1, "the canvas bitmap must not be reallocated during resize frames");
  assert.equal(writes.height, 1, "the canvas bitmap must not be reallocated during resize frames");
  assert.equal(canvas.width, 576, "the fixed backing bitmap is supersampled at 4×");
  assert.equal(canvas.height, 544, "the fixed backing bitmap is supersampled at 4×");
  assert.equal(drawingInset, (96 - Math.round(24 / 0.684)) / 2, "the compact drawing stays centered in the fixed bitmap");
  assert.equal(canvas.style.transform, "none", "Mochi is rasterized at its displayed size without a CSS rescale");
});
