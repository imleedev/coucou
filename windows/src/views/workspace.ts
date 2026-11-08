import { h, clear, svg } from "./dom";
import { ICONS } from "./icons";
import { Bridge, IS_TAURI } from "../core/bridge";
import { t, tl } from "../i18n/i18n";
import type { ViewHost } from "./views";

const musicVinyl = new URL("../assets/music-vinyl.png", import.meta.url).href;

type Media = {
  player: string; title: string; artist: string; album: string; art: string | null;
  status: "Playing" | "Paused" | "Stopped" | "Unknown"; position: number; duration: number;
  shuffle: boolean; repeat: boolean; canSeek: boolean;
};
const noMedia: Media = { player: "", title: "", artist: "", album: "", art: null, status: "Stopped", position: 0, duration: 0, shuffle: false, repeat: false, canSeek: false };

function musicIcon(name: "previous" | "play" | "pause" | "next" | "shuffle" | "repeat", size: number) {
  const paths = {
    previous: "M6 5h2v14H6zM19.2 6.1c.5-.4 1.3 0 1.3.7v11.4c0 .7-.8 1.1-1.3.7L10 13.2a1.4 1.4 0 0 1 0-2.4z",
    play: ICONS.play,
    pause: ICONS.pause,
    next: "M16 5h2v14h-2zM4.8 6.1c-.5-.4-1.3 0-1.3.7v11.4c0 .7.8 1.1 1.3.7L14 13.2a1.4 1.4 0 0 0 0-2.4z",
    shuffle: ICONS.shuffle,
    repeat: ICONS.repeat,
  } as const;
  return svg(paths[name], size, name === "shuffle" || name === "repeat" ? { stroke: 1.9 } : undefined);
}

async function api<T>(path: string, method = "GET", data?: unknown): Promise<T> {
  const response = await fetch(path, {
    method, cache: "no-store",
    headers: data ? { "Content-Type": "application/json" } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}

class MediaSource {
  state: Media = { ...noMedia };
  private pending = false;
  private lastRequest = 0;
  private publishPlayback() {
    window.dispatchEvent(new CustomEvent("ax-music-playback", { detail: this.state.status === "Playing" }));
  }
  async refresh(force = false) {
    if (IS_TAURI) {
      const s = await Bridge.spotifyRefresh();
      if (!s) return;
      this.state = {
        player: s.running ? "Spotify" : "", title: s.track?.title ?? "", artist: s.track?.artist ?? "",
        album: s.track?.album ?? "", art: s.track?.artUrl ?? null, status: s.playing ? "Playing" : s.track ? "Paused" : "Stopped",
        position: s.position, duration: s.track?.duration ?? 0,
        shuffle: s.shuffle, repeat: s.repeat, canSeek: Boolean(s.track?.duration),
      };
      this.publishPlayback();
      return;
    }
    const now = Date.now();
    if (this.pending || (!force && now - this.lastRequest < 1000)) return;
    this.pending = true; this.lastRequest = now;
    try {
      const current = (await api<{ media: Media }>("/api/media")).media;
      this.state = current?.player?.toLowerCase() === "spotify" ? current : { ...noMedia };
    }
    catch { this.state = { ...noMedia }; }
    finally { this.pending = false; }
    this.publishPlayback();
  }
  async control(action: "play-pause" | "previous" | "next") {
    if (IS_TAURI) {
      await Bridge.spotifyControl(action === "play-pause" ? "playPause" : action);
      await this.refresh(true); return;
    }
    try { await api("/api/media/control", "POST", { action, player: this.state.player }); } finally { await this.refresh(true); }
  }
  async setting(action: "shuffle" | "repeat", enabled: boolean) {
    if (IS_TAURI) {
      await Bridge.spotifyControl(action, enabled ? 1 : 0);
      await this.refresh(true); return;
    }
    await api("/api/media/control", "POST", { action, player: this.state.player, value: enabled });
    await this.refresh(true);
  }
  async seek(position: number) {
    const target = Math.max(0, Math.min(this.state.duration, position));
    if (IS_TAURI) await Bridge.spotifyControl("seek", target);
    else await api("/api/media/control", "POST", { action: "seek", player: this.state.player, value: target });
    this.state.position = target;
    await this.refresh(true);
  }
}
const media = new MediaSource();

function time(seconds: number) {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

export type LyricLine = { time: number; text: string };
export function parseTimedLyrics(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const timestamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const text = raw.replace(/\[[^\]]*\]/g, "").trim();
    if (!timestamps.length || !text) continue;
    for (const [, minutes, seconds, fraction = "0"] of timestamps) {
      const sub = fraction.length === 3 ? Number(fraction) / 1000 : Number(fraction) / 100;
      lines.push({ time: Number(minutes) * 60 + Number(seconds) + sub, text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

/** A small, dependency-free color quantizer for album art. */
export function dominantColors(pixels: ArrayLike<number>, limit = 5): string[] {
  const buckets = new Map<number, { r: number; g: number; b: number; count: number }>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const lightness = (r + g + b) / 3;
    if (lightness < 16 || lightness > 242) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0 };
    bucket.r += r; bucket.g += g; bucket.b += b; bucket.count++;
    buckets.set(key, bucket);
  }
  const ranked = [...buckets.values()].sort((a, b) => b.count - a.count);
  const selected: string[] = [];
  for (const bucket of ranked) {
    const rgb = [Math.round(bucket.r / bucket.count), Math.round(bucket.g / bucket.count), Math.round(bucket.b / bucket.count)];
    if (selected.some((hex) => {
      const other = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
      return Math.hypot(rgb[0] - other[0], rgb[1] - other[1], rgb[2] - other[2]) < 34;
    })) continue;
    selected.push(`#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`);
    if (selected.length === Math.max(1, limit)) break;
  }
  return selected;
}

/** Stable per-track variation for the reference's 6×6 dominant-color field. */
export function arrangeMusicPalette(colors: string[], seed: string): string[] {
  const palette = colors.length ? colors : ["#27313d", "#3a3044", "#55403b", "#29423d", "#30364a"];
  let random = 2166136261;
  for (const char of seed) random = Math.imul(random ^ char.charCodeAt(0), 16777619) >>> 0;
  return Array.from({ length: 36 }, () => {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    return palette[random % palette.length];
  });
}

const FALLBACK_MUSIC_COLORS = ["#27313d", "#3a3044", "#55403b", "#29423d", "#30364a"];

function parseLyricsResult(value: { syncedLyrics?: string; plainLyrics?: string; instrumental?: boolean }) {
  const synced = parseTimedLyrics(value.syncedLyrics ?? "");
  if (synced.length) return { lines: synced, synced: true, instrumental: false };
  const plain = (value.plainLyrics ?? "").split(/\r?\n/).map((text) => text.trim()).filter(Boolean).map((text) => ({ time: -1, text }));
  return { lines: plain, synced: false, instrumental: Boolean(value.instrumental) };
}

function makeMusicDisplay(compact: boolean) {
  if (!compact) return makeImmersiveMusicDisplay();
  const art = h("img", { class: "music-art", alt: "Album cover" }) as HTMLImageElement;
  const title = h("strong", { class: "music-title", text: "No media playing" });
  const artist = h("span", { class: "music-artist", text: "Start playback in any MPRIS player" });
  const fill = h("i");
  const progress = h("div", { class: "music-progress" }, fill);
  const elapsed = h("span", { text: "0:00" });
  const duration = h("span", { text: "0:00" });
  const times = h("div", { class: "music-times" }, elapsed, duration);
  const controls = h("div", { class: "music-controls" });
  const prev = h("button", { title: tl("Previous track"), onclick: () => void media.control("previous").then(render) }, svg(ICONS.backward, 11));
  const toggle = h("button", { title: t("Play"), onclick: () => void media.control("play-pause").then(render) }, svg(ICONS.play, 11));
  const next = h("button", { title: tl("Next track"), onclick: () => void media.control("next").then(render) }, svg(ICONS.forward, 11));
  controls.append(prev, toggle, next);
  const meta = h("div", { class: "music-meta" }, title, artist, progress, times);
  const el = h("div", { class: `music-widget${compact ? " compact" : ""}` }, art, meta, controls);
  let lastArt = "";
  function render() {
    const s = media.state;
    title.textContent = s.title || (s.player ? "Nothing playing" : "No media player found");
    artist.textContent = s.player ? [s.artist, s.player].filter(Boolean).join(" · ") : "Start playback in any MPRIS player";
    if (s.art && s.art !== lastArt) { lastArt = s.art; art.src = s.art; }
    art.hidden = !s.art;
    const fraction = s.duration > 0 ? Math.max(0, Math.min(1, s.position / s.duration)) : 0;
    fill.style.width = `${fraction * 100}%`;
    elapsed.textContent = time(s.position); duration.textContent = time(s.duration);
    progress.hidden = !s.duration; times.hidden = !s.duration;
    toggle.replaceChildren(svg(s.status === "Playing" ? ICONS.pause : ICONS.play, 11));
    toggle.title = s.status === "Playing" ? t("Pause") : t("Play");
    for (const button of [prev, toggle, next]) button.disabled = !s.player;
  }
  let refreshTimer: number | null = null;
  function start() {
    if (refreshTimer != null) return;
    void media.refresh(true).then(render); render();
    refreshTimer = window.setInterval(() => void media.refresh(true).then(render), 1500);
  }
  function stop() { if (refreshTimer != null) window.clearInterval(refreshTimer); refreshTimer = null; }
  return { el, sync: start, start, stop };
}

type LyricsData = { lines: LyricLine[]; synced: boolean; instrumental: boolean };
const lyricsCache = new Map<string, LyricsData>();

function makeImmersiveMusicDisplay(): ViewHost & { start(): void; stop(): void } {
  type Mode = "player" | "art" | "lyrics" | "split";
  let mode: Mode = "player";
  let lyricState: "idle" | "loading" | "ready" | "none" | "error" = "idle";
  let lyrics: LyricsData = { lines: [], synced: false, instrumental: false };
  let trackKey = "";
  let lyricsRequest = 0;
  let renderedLyricsKey = "";
  let lyricLineElements: HTMLElement[] = [];
  let paletteTrackKey = "";
  let paletteArt = "";
  let paletteColors = FALLBACK_MUSIC_COLORS;

  const backdrop = h("img", { class: "music-experience-backdrop", alt: "" }) as HTMLImageElement;
  const colorGrid = h("div", { class: "music-color-grid", "aria-hidden": "true" });
  const colorTiles = Array.from({ length: 36 }, () => h("span", { class: "music-color-tile" }));
  colorGrid.append(...colorTiles);
  const waveA = h("div", { class: "music-color-wave music-wave-a", "aria-hidden": "true" });
  const waveB = h("div", { class: "music-color-wave music-wave-b", "aria-hidden": "true" });
  const softener = h("div", { class: "music-color-softener", "aria-hidden": "true" });
  const tint = h("div", { class: "music-experience-tint" });
  const provider = h("span", { class: "music-provider" });
  const modeButtons = new Map<Mode, HTMLButtonElement>();
  const modes = h("div", { class: "music-modes" });
  for (const [value, label, glyph] of [["player", "Player", "♫"], ["art", "Artwork", "▣"], ["lyrics", "Lyrics", "≋"], ["split", "Split", "◫"]] as const) {
    const button = h("button", { class: "music-mode", title: label, "aria-label": label, onclick: () => { mode = value; render(); if (value === "lyrics" || value === "split") void loadLyrics(); } }, h("span", { text: glyph }), h("span", { class: "music-mode-label", text: label })) as HTMLButtonElement;
    modeButtons.set(value, button); modes.append(button);
  }
  const header = h("div", { class: "music-experience-header" }, h("div", { class: "music-source-group" }, provider), modes);
  const cover = h("img", { class: "music-experience-cover", alt: "Album cover" }) as HTMLImageElement;
  const coverPlaceholder = h("div", { class: "music-cover-placeholder", text: "♫" });
  const vinyl = h("img", { class: "music-artwork-vinyl", src: musicVinyl, alt: "" }) as HTMLImageElement;
  const artworkHint = h("span", { class: "music-artwork-play-hint", "aria-hidden": "true" }, musicIcon("play", 13));
  const coverFrame = h("button", {
    class: "music-cover-frame music-artwork-card",
    type: "button",
    title: "Play or pause",
    "aria-label": "Play or pause current track",
    onclick: () => void media.control("play-pause").then(render),
  }, vinyl, cover, coverPlaceholder, artworkHint) as HTMLButtonElement;
  const title = h("h1", { class: "music-experience-title", text: "No media playing" });
  const artist = h("div", { class: "music-experience-artist", text: "Play music in Spotify" });
  const album = h("div", { class: "music-experience-album" });
  const shuffle = h("button", { class: "music-small-control", title: "Shuffle", "aria-label": "Shuffle", onclick: () => void media.setting("shuffle", !media.state.shuffle).then(render) }, musicIcon("shuffle", 15));
  const previous = h("button", { class: "music-transport", title: tl("Previous track"), "aria-label": tl("Previous track"), onclick: () => void media.control("previous").then(render) }, musicIcon("previous", 18));
  const play = h("button", { class: "music-play-control", title: t("Play"), "aria-label": t("Play"), onclick: () => void media.control("play-pause").then(render) }, musicIcon("play", 17));
  const next = h("button", { class: "music-transport", title: tl("Next track"), "aria-label": tl("Next track"), onclick: () => void media.control("next").then(render) }, musicIcon("next", 18));
  const repeat = h("button", { class: "music-small-control", title: "Repeat", "aria-label": "Repeat", onclick: () => void media.setting("repeat", !media.state.repeat).then(render) }, musicIcon("repeat", 15));
  const controls = h("div", { class: "music-experience-controls" }, shuffle, previous, play, next, repeat);
  const elapsed = h("span", { text: "0:00" });
  const remaining = h("span", { text: "−0:00" });
  const progressFill = h("i");
  const progressKnob = h("b");
  const progressTrack = h("div", { class: "music-experience-progress", role: "slider", "aria-label": "Track position" }, h("i", { class: "music-progress-track" }), progressFill, progressKnob);
  const times = h("div", { class: "music-experience-times" }, elapsed, remaining);
  const lyricsHeading = h("div", { class: "music-lyrics-heading", text: "Lyrics" });
  const lyricsMessage = h("div", { class: "music-lyrics-message", text: "Choose Lyrics to find the words for this song." });
  const lyricsLinesEl = h("div", { class: "music-lyrics-lines" });
  const lyricsPanel = h("div", { class: "music-lyrics-panel" }, lyricsHeading, lyricsMessage, lyricsLinesEl);
  const info = h("div", { class: "music-experience-info" }, title, artist, album, h("div", { class: "music-experience-scrubber" }, times, progressTrack), controls);
  const stage = h("div", { class: "music-experience-stage mode-player" }, coverFrame, info, lyricsPanel);
  const footer = h("div", { class: "music-experience-footer" }, h("span", { text: "MPRIS · Linux" }), h("span", { text: "Synced lyrics when available" }));
  const el = h("div", { class: "music-widget music-experience" }, colorGrid, backdrop, waveA, waveB, softener, tint, h("div", { class: "music-experience-content" }, header, stage, footer));

  const paletteProbe = document.createElement("img");
  paletteProbe.crossOrigin = "anonymous";
  function paintPalette(colors: string[], seed: string) {
    const arranged = arrangeMusicPalette(colors, seed);
    for (let i = 0; i < colorTiles.length; i++) colorTiles[i].style.backgroundColor = arranged[i];
    waveA.style.backgroundColor = colors[0] ?? FALLBACK_MUSIC_COLORS[0];
    waveB.style.backgroundColor = colors[Math.min(2, colors.length - 1)] ?? FALLBACK_MUSIC_COLORS[2];
  }
  paletteProbe.addEventListener("load", () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 32; canvas.height = 32;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas unavailable");
      context.drawImage(paletteProbe, 0, 0, 32, 32);
      const colors = dominantColors(context.getImageData(0, 0, 32, 32).data);
      if (!colors.length) return;
      paletteColors = colors;
      paintPalette(paletteColors, paletteTrackKey);
    } catch {
      paintPalette(paletteColors, paletteTrackKey);
    }
  });
  paletteProbe.addEventListener("error", () => {
    if (!paletteArt) return;
    paletteColors = FALLBACK_MUSIC_COLORS;
    paintPalette(paletteColors, paletteTrackKey);
  });
  function updatePalette(art: string | null, seed: string) {
    if (paletteTrackKey !== seed) {
      paletteTrackKey = seed;
      paintPalette(paletteColors, paletteTrackKey);
    }
    const nextArt = art ?? "";
    if (nextArt === paletteArt) return;
    paletteArt = nextArt;
    if (!nextArt) {
      paletteColors = FALLBACK_MUSIC_COLORS;
      paintPalette(paletteColors, seed);
      return;
    }
    paletteProbe.src = nextArt;
  }

  progressTrack.addEventListener("click", (event) => {
    const state = media.state;
    if (!state.player || !state.canSeek || !state.duration) return;
    const rect = progressTrack.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, ((event as MouseEvent).clientX - rect.left) / rect.width));
    void media.seek(state.duration * fraction).then(render);
  });

  async function loadLyrics(force = false) {
    const state = media.state;
    if (!state.title || !state.artist) { lyricState = "none"; render(); return; }
    const key = [state.artist, state.title, state.album, Math.round(state.duration)].join("\u0000");
    if (!force && lyricsCache.has(key)) { lyrics = lyricsCache.get(key)!; lyricState = lyrics.lines.length || lyrics.instrumental ? "ready" : "none"; render(); return; }
    if (lyricState === "loading" && key === trackKey) return;
    trackKey = key;
    const request = ++lyricsRequest;
    lyricState = "loading"; lyrics = { lines: [], synced: false, instrumental: false }; renderedLyricsKey = ""; render();
    try {
      const params = new URLSearchParams({ title: state.title, artist: state.artist, album: state.album, duration: String(state.duration) });
      const result = await api<{ lyrics: { syncedLyrics?: string; plainLyrics?: string; instrumental?: boolean } }>(`/api/media/lyrics?${params.toString()}`);
      if (request !== lyricsRequest || key !== [media.state.artist, media.state.title, media.state.album, Math.round(media.state.duration)].join("\u0000")) return;
      lyrics = parseLyricsResult(result.lyrics ?? {});
      lyricsCache.set(key, lyrics);
      while (lyricsCache.size > 32) lyricsCache.delete(lyricsCache.keys().next().value!);
      lyricState = lyrics.lines.length || lyrics.instrumental ? "ready" : "none";
    } catch {
      if (request !== lyricsRequest) return;
      lyricState = "error";
    }
    render();
  }

  function currentLyricIndex(position: number) {
    if (!lyrics.synced) return -1;
    let index = -1;
    for (let i = 0; i < lyrics.lines.length; i++) {
      if (lyrics.lines[i].time > position) break;
      index = i;
    }
    return index;
  }

  function render() {
    const state = media.state;
    const key = [state.artist, state.title, state.album, Math.round(state.duration)].join("\u0000");
    if (key !== trackKey) {
      trackKey = key; lyricsRequest++; lyrics = { lines: [], synced: false, instrumental: false }; lyricState = "idle"; renderedLyricsKey = "";
      if (mode === "lyrics" || mode === "split") void loadLyrics();
    }
    title.textContent = state.title || (state.player ? "Nothing playing" : "No Spotify playback");
    artist.textContent = state.artist || (state.player ? state.player : "Start playback in Spotify");
    album.textContent = state.album;
    album.hidden = !state.album;
    provider.textContent = state.player || "SPOTIFY";
    updatePalette(state.art, key);
    if (state.art && cover.src !== new URL(state.art, window.location.href).href) {
      cover.src = state.art; backdrop.src = state.art;
    }
    cover.hidden = !state.art; backdrop.hidden = !state.art; coverPlaceholder.hidden = Boolean(state.art);
    cover.alt = state.title ? `Artwork for ${state.title}${state.artist ? ` by ${state.artist}` : ""}` : "Album artwork";
    coverFrame.classList.toggle("is-playing", state.status === "Playing");
    coverFrame.disabled = !state.player;
    coverFrame.setAttribute("aria-label", state.status === "Playing"
      ? `Pause ${state.title || "current track"}${state.artist ? ` by ${state.artist}` : ""}`
      : `Play ${state.title || "current track"}${state.artist ? ` by ${state.artist}` : ""}`);
    artworkHint.replaceChildren(musicIcon(state.status === "Playing" ? "pause" : "play", 13));
    play.replaceChildren(musicIcon(state.status === "Playing" ? "pause" : "play", 17));
    play.title = state.status === "Playing" ? t("Pause") : t("Play");
    for (const button of [previous, play, next, shuffle, repeat]) button.disabled = !state.player;
    shuffle.classList.toggle("active", state.shuffle); repeat.classList.toggle("active", state.repeat);
    const fraction = state.duration > 0 ? Math.max(0, Math.min(1, state.position / state.duration)) : 0;
    progressFill.style.width = `${fraction * 100}%`; progressKnob.style.left = `${fraction * 100}%`;
    elapsed.textContent = time(state.position); remaining.textContent = state.duration ? `−${time(Math.max(0, state.duration - state.position))}` : "−0:00";
    progressTrack.classList.toggle("disabled", !state.canSeek || !state.duration);
    progressTrack.setAttribute("aria-valuenow", String(Math.round(fraction * 100)));
    for (const [name, button] of modeButtons) button.classList.toggle("active", mode === name);
    stage.className = `music-experience-stage mode-${mode}`;
    lyricsPanel.hidden = !(mode === "lyrics" || mode === "split");
    lyricsHeading.textContent = lyricState === "ready" && lyrics.synced ? "Synchronized lyrics" : "Lyrics";
    lyricsMessage.hidden = lyrics.lines.length > 0;
    lyricsLinesEl.hidden = lyrics.lines.length === 0;
    if (lyrics.lines.length) {
      const index = currentLyricIndex(state.position);
      const start = lyrics.synced ? Math.max(0, index - 2) : 0;
      const visibleLines = lyrics.lines.slice(start, start + (lyrics.synced ? 6 : 80));
      const windowKey = `${trackKey}:${start}:${lyrics.synced}:${state.canSeek}`;
      if (windowKey !== renderedLyricsKey) {
        clear(lyricsLinesEl);
        lyricLineElements = [];
        const seekable = lyrics.synced && state.canSeek;
        for (let i = 0; i < visibleLines.length; i++) {
          const lineIndex = start + i;
          const current = lyrics.synced && lineIndex === index;
          const line = h("div", {
            class: `music-lyric-line${current ? " current" : ""}${seekable ? " seekable" : ""}`,
            text: visibleLines[i].text,
            ...(seekable ? { role: "button", tabindex: "0", "aria-label": `Seek to ${time(visibleLines[i].time)}: ${visibleLines[i].text}` } : {}),
          });
          if (seekable) {
            const seekToLine = () => void media.seek(visibleLines[i].time).then(render);
            line.addEventListener("click", seekToLine);
            line.addEventListener("keydown", (event) => {
              const key = (event as KeyboardEvent).key;
              if (key === "Enter" || key === " ") { event.preventDefault(); seekToLine(); }
            });
          }
          lyricLineElements.push(line);
          lyricsLinesEl.append(line);
        }
        renderedLyricsKey = windowKey;
      }
      for (let i = 0; i < lyricLineElements.length; i++) lyricLineElements[i].classList.toggle("current", lyrics.synced && start + i === index);
    }
    lyricsMessage.textContent = lyricState === "loading" ? "Searching for lyrics…"
      : lyricState === "error" ? "Lyrics could not be loaded. Select Lyrics to try again."
      : lyrics.instrumental ? "Instrumental track"
      : lyricState === "none" ? "No lyrics found for this track."
      : mode === "lyrics" || mode === "split" ? "Lyrics will appear here when available."
      : "Choose Lyrics to find the words for this song.";
  }

  let refreshTimer: number | null = null;
  function start() {
    if (refreshTimer != null) return;
    void media.refresh(true).then(render); render();
    refreshTimer = window.setInterval(() => void media.refresh(true).then(() => {
      if ((mode === "lyrics" || mode === "split") && lyricState === "idle") void loadLyrics();
      render();
    }), mode === "lyrics" || mode === "split" ? 300 : 1200);
  }
  function stop() { if (refreshTimer != null) window.clearInterval(refreshTimer); refreshTimer = null; }
  return { el, sync: start, start, stop };
}

export function buildMusicWidget() { return makeMusicDisplay(true); }

export function buildMusicView(): ViewHost {
  const display = makeMusicDisplay(false);
  window.addEventListener("ax-island-view", (event) => { if ((event as CustomEvent).detail !== "music") display.stop(); });
  const content = h("div", { class: "workspace-content music-page-content" }, display.el);
  const el = h("div", { class: "view" }, h("div", { class: "card" },
    h("div", { class: "workspace-panel music-workspace-panel" }, content)));
  return { el, sync: display.sync };
}

type EventItem = { id: string; date: string; title: string };
const EVENTS_KEY = "coucou.calendar.events.v1";
function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function readEvents(): EventItem[] {
  try { const value = JSON.parse(localStorage.getItem(EVENTS_KEY) || "[]"); return Array.isArray(value) ? value.filter((x) => x && typeof x.id === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && typeof x.title === "string") : []; }
  catch { return []; }
}
function writeEvents(events: EventItem[]) { try { localStorage.setItem(EVENTS_KEY, JSON.stringify(events)); } catch { /* private mode/quota: keep this session usable */ } }
function parseIcs(text: string): EventItem[] {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  return [...unfolded.matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/g)].flatMap(([, block]) => {
    const date = block.match(/^DTSTART(?:;[^:]*)?:(\d{4})(\d{2})(\d{2})/m);
    const title = block.match(/^SUMMARY(?:;[^:]*)?:(.*)$/m);
    if (!date || !title) return [];
    return [{ id: crypto.randomUUID(), date: `${date[1]}-${date[2]}-${date[3]}`, title: title[1].replace(/\\n/g, " ").replace(/\\,/g, ",").trim() }];
  });
}

export function buildCalendarView(): ViewHost {
  let shownMonth = new Date();
  const monthTitle = h("strong", { text: "" });
  const grid = h("div", { class: "workspace-grid" });
  const eventList = h("div", { class: "workspace-content calendar-events" });
  const dateInput = h("input", { type: "date", value: localDate(new Date()), "aria-label": "Event date" }) as HTMLInputElement;
  const titleInput = h("input", { type: "text", placeholder: "Add an appointment", maxlength: "120" }) as HTMLInputElement;
  const add = h("button", { text: tl("Add"), onclick: () => {
    const title = titleInput.value.trim(); if (!title) return;
    const events = readEvents(); events.push({ id: crypto.randomUUID(), date: dateInput.value, title }); writeEvents(events); titleInput.value = ""; render();
  } });
  const importInput = h("input", { type: "file", accept: ".ics,text/calendar", hidden: "" }) as HTMLInputElement;
  importInput.addEventListener("change", () => {
    const file = importInput.files?.[0]; if (!file) return;
    void file.text().then((text) => { writeEvents([...readEvents(), ...parseIcs(text)]); render(); importInput.value = ""; });
  });
  const exportButton = h("button", { text: "Export .ics", onclick: () => {
    const body = readEvents().map((e) => `BEGIN:VEVENT\r\nUID:${e.id}\r\nDTSTART;VALUE=DATE:${e.date.replaceAll("-", "")}\r\nSUMMARY:${e.title.replace(/\n/g, " ")}\r\nEND:VEVENT`).join("\r\n");
    const url = URL.createObjectURL(new Blob([`BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`], { type: "text/calendar" }));
    const a = h("a", { href: url, download: "coucou-calendar.ics" }); a.click(); URL.revokeObjectURL(url);
  } });
  function render() {
    const year = shownMonth.getFullYear(), month = shownMonth.getMonth();
    monthTitle.textContent = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(shownMonth);
    clear(grid);
    const events = readEvents(); const eventDates = new Set(events.map((e) => e.date));
    const mondayOffset = (new Date(year, month, 1).getDay() + 6) % 7;
    const total = new Date(year, month + 1, 0).getDate();
    for (const day of ["M", "T", "W", "T", "F", "S", "S"]) grid.append(h("span", { class: "workspace-day", text: day }));
    for (let i = 0; i < mondayOffset; i++) grid.append(h("span", { class: "workspace-day" }));
    for (let d = 1; d <= total; d++) {
      const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const cell = h("button", { class: `workspace-day${date === localDate(new Date()) ? " today" : ""}${eventDates.has(date) ? " has-event" : ""}`, text: String(d), title: events.filter((e) => e.date === date).map((e) => e.title).join(" · "), onclick: () => { dateInput.value = date; } }); grid.append(cell);
    }
    clear(eventList);
    const upcoming = events.filter((e) => e.date >= localDate(new Date())).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
    if (!upcoming.length) eventList.append(h("div", { class: "workspace-empty", text: "No upcoming appointments. Add one or import an .ics calendar." }));
    else for (const event of upcoming) eventList.append(h("div", { class: "workspace-row" }, h("span", { text: event.date }), h("span", { text: event.title }), h("span", { style: "flex:1" }), h("button", { text: "×", title: "Delete event", onclick: () => { writeEvents(readEvents().filter((item) => item.id !== event.id)); render(); } })));
  }
  render();
  const previousMonth = h("button", { text: "‹", title: "Previous month", onclick: () => { shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() - 1, 1); render(); } });
  const nextMonth = h("button", { text: "›", title: "Next month", onclick: () => { shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() + 1, 1); render(); } });
  const actions = h("div", { class: "workspace-actions" }, dateInput, titleInput, add,
    h("button", { text: "Import .ics", onclick: () => importInput.click() }), exportButton, importInput);
  const el = h("div", { class: "view" }, h("div", { class: "card" }, h("div", { class: "workspace-panel" },
    h("div", { class: "workspace-head" }, svg(ICONS.calendar, 12), previousMonth, monthTitle, nextMonth), grid, eventList, actions)));
  return { el, sync: render };
}

type ShelfRecord = { id: string; name: string; type: string; size: number; blob: Blob };
  const DB_NAME = "coucou-shelf";
function shelfDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("shelfItems", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}

export function buildShelfView(): ViewHost {
  const list = h("div", { class: "shelf-list workspace-content" });
  const status = h("span", { class: "workspace-head" });
  let shelfUrls: string[] = [];
  async function render() {
    shelfUrls.forEach((url) => URL.revokeObjectURL(url)); shelfUrls = [];
    clear(list);
    if (typeof indexedDB === "undefined") { list.append(h("div", { class: "workspace-empty", text: "Persistent browser storage is unavailable." })); return; }
    try {
      const db = await shelfDb(); const tx = db.transaction("shelfItems", "readonly");
      const records = await new Promise<ShelfRecord[]>((resolve, reject) => { const req = tx.objectStore("shelfItems").getAll(); req.onsuccess = () => resolve(req.result as ShelfRecord[]); req.onerror = () => reject(req.error); });
      status.textContent = `${records.length} saved file${records.length === 1 ? "" : "s"}`;
      if (!records.length) list.append(h("div", { class: "workspace-empty", text: "Your Shelf is empty. Drop files here or use Add files." }));
      for (const record of records) {
        const url = URL.createObjectURL(record.blob);
        shelfUrls.push(url);
        const preview = record.type.startsWith("image/") ? h("img", { src: url, alt: "" }) : h("span", { text: record.type.startsWith("audio/") ? "♫" : record.type.startsWith("video/") ? "▶" : "▤" });
        const open = h("a", { href: url, target: "_blank", rel: "noopener", class: "shelf-item" }, preview, h("span", { text: record.name }));
        const remove = h("button", { text: "×", title: "Remove from Shelf", onclick: async (event: Event) => { event.preventDefault(); event.stopPropagation(); const db = await shelfDb(); db.transaction("shelfItems", "readwrite").objectStore("shelfItems").delete(record.id); void render(); } });
        open.append(remove); list.append(open);
      }
    } catch { list.append(h("div", { class: "workspace-empty", text: "Could not read the local Shelf." })); }
  }
  const input = h("input", { type: "file", multiple: "", hidden: "" }) as HTMLInputElement;
  input.addEventListener("change", () => {
    const files = [...(input.files ?? [])];
    void (async () => { try { const db = await shelfDb(); const tx = db.transaction("shelfItems", "readwrite"); for (const file of files) tx.objectStore("shelfItems").put({ id: crypto.randomUUID(), name: file.name, type: file.type, size: file.size, blob: file } satisfies ShelfRecord); await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); void render(); } catch { status.textContent = "Could not save files (storage full or unavailable)."; } input.value = ""; })();
  });
  const add = h("button", { text: "Add files", onclick: () => input.click() });
  const drop = h("div", { class: "workspace-content", text: "Drop files into this area to keep them in the local Shelf." });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); });
  drop.addEventListener("drop", (e) => { e.preventDefault(); const files = [...((e as DragEvent).dataTransfer?.files ?? [])]; if (!files.length) return; const transfer = new DataTransfer(); files.forEach((f) => transfer.items.add(f)); input.files = transfer.files; input.dispatchEvent(new Event("change")); });
  const el = h("div", { class: "view" }, h("div", { class: "card" }, h("div", { class: "workspace-panel" },
    h("div", { class: "workspace-head" }, svg(ICONS.folder, 12), h("strong", { text: tl("Shelf") }), status, h("span", { style: "flex:1" }), add, input), drop, list)));
  return { el, sync: () => void render() };
}

type SystemInfo = { cpu: number | null; memory: number | null; battery: number | null; volume: number | null; brightness: number | null };
export function buildSystemView(): ViewHost {
  const rows = h("div", { class: "workspace-content" });
  const status = h("span", { class: "workspace-head" });
  const volume = h("input", { type: "range", min: "0", max: "100", value: "50", "aria-label": "System volume", onchange: (e: Event) => void api("/api/system/control", "POST", { control: "volume", value: Number((e.target as HTMLInputElement).value) }) }) as HTMLInputElement;
  const brightness = h("input", { type: "range", min: "0", max: "100", value: "50", "aria-label": "Screen brightness", onchange: (e: Event) => void api("/api/system/control", "POST", { control: "brightness", value: Number((e.target as HTMLInputElement).value) }) }) as HTMLInputElement;
  let pending = false, last = 0;
  async function render() {
    if (IS_TAURI || pending || Date.now() - last < 1500) return;
    pending = true; last = Date.now();
    try {
      const data = await api<{ system: SystemInfo }>("/api/system"); const s = data.system;
      clear(rows);
      const row = (label: string, value: string) => rows.append(h("div", { class: "workspace-row" }, h("span", { text: label }), h("strong", { text: value }), h("span", { style: "flex:1" })));
      row("Load", s.cpu == null ? "Unavailable" : `${s.cpu}%`); row("Memory", s.memory == null ? "Unavailable" : `${s.memory}%`); row("Battery", s.battery == null ? "No battery detected" : `${s.battery}%`);
      volume.value = String(s.volume ?? 50); volume.disabled = s.volume == null;
      brightness.value = String(s.brightness ?? 50); brightness.disabled = s.brightness == null;
      status.textContent = "Live · Linux";
    } catch { status.textContent = "System service unavailable"; }
    finally { pending = false; }
  }
  const el = h("div", { class: "view" }, h("div", { class: "card" }, h("div", { class: "workspace-panel" },
    h("div", { class: "workspace-head" }, svg(ICONS.system, 12), h("strong", { text: tl("System") }), status), rows,
    h("div", { class: "workspace-row" }, h("span", { text: "Output volume" }), volume),
    h("div", { class: "workspace-row" }, h("span", { text: "Display brightness" }), brightness))));
  let refreshTimer: number | null = null;
  function start() {
    if (refreshTimer != null) return;
    void render(); refreshTimer = window.setInterval(() => { last = 0; void render(); }, 3000);
  }
  function stop() { if (refreshTimer != null) window.clearInterval(refreshTimer); refreshTimer = null; }
  window.addEventListener("ax-island-view", (event) => { if ((event as CustomEvent).detail !== "system") stop(); });
  return { el, sync: start };
}

export function buildCameraView(): ViewHost {
  const video = h("video", { class: "camera-preview", autoplay: "", playsinline: "" }) as HTMLVideoElement;
  const status = h("div", { class: "workspace-empty", text: "Camera preview is off." });
  let stream: MediaStream | null = null;
  const start = h("button", { text: "Start camera", onclick: async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access is not available in this WebKit context.");
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); video.srcObject = stream; await video.play(); status.textContent = "Camera is active. Stop it when finished.";
    } catch (error) { status.textContent = error instanceof Error ? error.message : "Could not access a camera."; }
  } });
  const stop = h("button", { text: "Stop camera", onclick: () => { stream?.getTracks().forEach((track) => track.stop()); stream = null; video.srcObject = null; status.textContent = "Camera preview is off."; } });
  window.addEventListener("ax-island-view", (event) => {
    if ((event as CustomEvent).detail === "camera" || !stream) return;
    stream.getTracks().forEach((track) => track.stop()); stream = null; video.srcObject = null; status.textContent = "Camera preview stopped when leaving this tab.";
  });
  const el = h("div", { class: "view" }, h("div", { class: "card" }, h("div", { class: "workspace-panel" },
    h("div", { class: "workspace-head" }, svg(ICONS.camera, 12), h("strong", { text: tl("Camera") }), h("span", { text: "Local device · starts only on request" })), video, status, h("div", { class: "workspace-actions" }, start, stop))));
  return { el, sync() {} };
}
