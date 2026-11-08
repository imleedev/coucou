import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calls } from "./tauri.mjs";
import { installFakeDom } from "./fakedom.mjs";

installFakeDom();
const { buildHeader, buildViews } = await import("../src/views/views.ts");
const { arrangeMusicPalette, buildMusicView, dominantColors, parseTimedLyrics } = await import("../src/views/workspace.ts");
const { botPosition } = await import("../src/core/layout.ts");
const { State, DEFAULT_SETTINGS } = await import("../src/core/state.ts");
State.settings = { ...DEFAULT_SETTINGS };

const selected = [];
const actions = new Proxy({}, {
  get(_target, key) {
    if (key === "setView") return (view) => selected.push(view);
    if (key === "blip") return () => {};
    return () => {};
  },
});

test("new top-level tabs are registered in the existing navigation", () => {
  const header = buildHeader(actions);
  const tabs = header.el.querySelector(".tabs").find("button");
  assert.equal(tabs.length, 9);
  for (const tab of tabs) tab.fire("click");
  assert.deepEqual(selected, ["overview", "prompt", "upload", "wallpapers", "music", "calendar", "shelf", "system", "camera"]);
});

test("widget arrows switch the overview panel independently of page navigation", () => {
  const views = buildViews(actions, () => {});
  for (const name of ["music", "calendar", "shelf", "system", "camera"]) assert.ok(views.has(name), `${name} tab is registered`);
  const overview = views.get("overview");
  const arrows = overview.el.find(".widget-arrow");
  const agents = overview.el.querySelector(".pills");
  const music = overview.el.querySelector(".overview-music-widget");
  assert.equal(agents.hidden, false);
  assert.equal(music.hidden, true);
  arrows[1].fire("click");
  assert.equal(agents.hidden, true);
  assert.equal(music.hidden, false);
  arrows[0].fire("click");
  assert.equal(agents.hidden, false);
  assert.equal(music.hidden, true);
  globalThis.dispatchEvent({ type: "ax-island-view", detail: "music" });
});

test("timed lyrics parse centiseconds, repeated timestamps and stay ordered", () => {
  assert.deepEqual(parseTimedLyrics("[00:03.20]second\n[00:01.05][00:02.50]first\nplain line"), [
    { time: 1.05, text: "first" },
    { time: 2.5, text: "first" },
    { time: 3.2, text: "second" },
  ]);
});

test("album art colors form a stable six-by-six palette field", () => {
  const pixels = new Uint8ClampedArray([
    220, 40, 50, 255, 218, 42, 52, 255, 220, 42, 48, 255,
    30, 90, 210, 255, 32, 92, 208, 255, 245, 245, 245, 255,
  ]);
  const colors = dominantColors(pixels, 5);
  assert.equal(colors.length, 2, "near-white pixels are excluded and close shades are grouped");
  assert.equal(colors[0], "#db2932");
  const grid = arrangeMusicPalette(colors, "track-a");
  assert.equal(grid.length, 36);
  assert.deepEqual(grid, arrangeMusicPalette(colors, "track-a"), "same track keeps a stable color layout");
  assert.notDeepEqual(grid, arrangeMusicPalette(colors, "track-b"), "different tracks can vary the grid arrangement");
});

test("the Music tab exposes player, artwork, lyrics and split presentations", () => {
  const music = buildMusicView();
  const modes = music.el.find(".music-mode");
  assert.equal(modes.length, 4);
  assert.equal(music.el.find(".music-color-wave").length, 2, "two independently animated color waves sit behind the content");
  assert.equal(music.el.find(".music-color-softener").length, 1, "a softening layer sits over the palette field");
  assert.equal(music.el.find(".music-artwork-card").length, 1, "the current MPRIS artwork is the interactive cover");
  assert.equal(music.el.find(".music-artwork-vinyl").length, 1, "the supplied vinyl artwork sits behind the cover");
  const grid = music.el.querySelector(".music-color-grid");
  const softener = music.el.querySelector(".music-color-softener");
  assert.equal(grid.parentNode, music.el.querySelector(".music-experience"), "the moving grid stays clipped inside the rounded Music panel");
  assert.ok(grid.parentNode.children.indexOf(grid) < grid.parentNode.children.indexOf(softener), "the grid sits underneath the rounded panel's glass layer");
  modes[2].fire("click");
  assert.ok(music.el.querySelector(".music-experience-stage").classList.contains("mode-lyrics"));
  modes[3].fire("click");
  assert.ok(music.el.querySelector(".music-experience-stage").classList.contains("mode-split"));
  globalThis.dispatchEvent({ type: "ax-island-view", detail: "overview" });
});

test("Music moves Mochi into the clear upper-right header space", () => {
  const p = botPosition("expanded", "music", 320);
  assert.deepEqual({ x: p.cx, y: p.cy, diameter: p.diameter }, { x: 502, y: 24, diameter: 38 });
});

test("Music lyrics stay inside a bounded, scrollable viewport and reclaim the Mochi gutter", () => {
  const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
  const source = readFileSync(new URL("../src/views/workspace.ts", import.meta.url), "utf8");
  assert.match(css, /--font:\s*"SF Pro Text"/);
  assert.match(css, /--display-font:\s*"SF Pro Display"/);
  assert.match(css, /\.music-color-grid[^}]*repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(css, /@keyframes music-color-field-drift/);
  assert.match(css, /@keyframes music-wave-a/);
  assert.match(css, /@keyframes music-wave-b/);
  assert.doesNotMatch(css, /\.music-color-grid\s*\{[^}]*filter:/, "the grid stays as discrete color tiles beneath the overlay");
  assert.match(css, /\.music-color-softener[^}]*backdrop-filter:blur\(76px\)/);
  assert.match(css, /animation:music-wave-a\s+8s/);
  assert.match(css, /animation:music-wave-b\s+11\.5s/);
  assert.match(css, /animation:music-color-field-drift\s+19s/);
  assert.match(css, /music-artwork-card:hover[^}]*music-artwork-vinyl/);
  assert.match(css, /\.music-artwork-vinyl\s*\{[^}]*left:-11%;[^}]*width:82%;[^}]*height:76%/);
  assert.match(css, /music-artwork-card\.is-playing \.music-artwork-vinyl[^}]*music-artwork-spin/);
  assert.match(css, /\.mode-player \.music-experience-title\s*\{[^}]*font-size:15px/);
  assert.match(css, /\.mode-player \.music-experience-info\s*\{[^}]*width:min\(100%,280px\)/);
  assert.match(css, /\.mode-player \.music-experience-controls \.music-play-control\s*\{[^}]*width:34px/);
  assert.match(css, /\.music-experience\s*\{[^}]*border-radius:16px/s);
  assert.doesNotMatch(css, /\.music-page-view/);
  assert.doesNotMatch(css, /\.mode-lyrics \.music-experience-controls/);
  assert.match(css, /prefers-reduced-motion:\s*reduce[^}]*animation:none/s);
  assert.doesNotMatch(source, /NOW PLAYING/);
  assert.match(css, /\.music-workspace-panel\s*\{[^}]*padding:\s*7px 12px 5px\s*;/s);
  assert.match(css, /\.mode-lyrics\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.music-lyrics-lines\s*\{[^}]*overflow-y:\s*auto/s);
});

test("synced lyrics are keyboard accessible and clicking a line seeks to its timestamp", async () => {
  const internals = globalThis.__TAURI_INTERNALS__;
  const oldInvoke = internals.invoke;
  const oldFetch = globalThis.fetch;
  const callsBefore = calls.length;
  const playbackStates = [];
  const onPlayback = (event) => playbackStates.push(event.detail);
  globalThis.addEventListener("ax-music-playback", onPlayback);
  let music;
  internals.invoke = async (command, args) => {
    if (command === "spotify_refresh") return {
      running: true, installed: true, playing: true,
      track: { id: "spotify:track:test", title: "Test", artist: "Artist", album: "Album", duration: 120, artUrl: null },
      position: 20, positionAt: Date.now(), shuffle: false, repeat: false, volume: 50,
    };
    if (command === "spotify_control") { calls.push([command, args]); return true; }
    return null;
  };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ lyrics: { syncedLyrics: "[00:12.50]jump here" } }) });
  try {
    music = buildMusicView();
    music.sync();
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(playbackStates.includes(true), "real playing state is published for Mochi's music animation");
    music.el.querySelector(".music-artwork-card").fire("click");
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(calls.slice(callsBefore).some(([command, args]) => command === "spotify_control" && args.action === "playPause"), "clicking the cover uses the real Spotify/MPRIS play-pause control");
    music.el.find(".music-mode")[2].fire("click");
    await new Promise((resolve) => setImmediate(resolve));
    const line = music.el.find(".music-lyric-line")[0];
    assert.equal(line.getAttribute("role"), "button");
    assert.equal(line.getAttribute("tabindex"), "0");
    line.fire("click");
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(calls.slice(callsBefore).some(([command, args]) => command === "spotify_control" && args.action === "seek" && args.value === 12.5));
  } finally {
    globalThis.dispatchEvent({ type: "ax-island-view", detail: "overview" });
    globalThis.removeEventListener("ax-music-playback", onPlayback);
    internals.invoke = oldInvoke;
    globalThis.fetch = oldFetch;
  }
});
