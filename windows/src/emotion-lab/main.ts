import { BotEngine } from "../mochi/engine";
import type { BotEmoteName, BotStateName } from "../core/layout";
import "./style.css";

const emotions: { id: BotEmoteName | null; label: string; glyph: string }[] = [
  { id: null, label: "Neutro", glyph: "·" },
  { id: "happy", label: "Feliz", glyph: ":)" },
  { id: "excited", label: "Empolgado", glyph: "✦" },
  { id: "love", label: "Carinhoso", glyph: "♥" },
  { id: "proud", label: "Orgulhoso", glyph: "★" },
  { id: "surprised", label: "Surpreso", glyph: "!" },
  { id: "curious", label: "Curioso", glyph: "?" },
  { id: "confused", label: "Confuso", glyph: "↝" },
  { id: "sad", label: "Triste", glyph: "⌒" },
  { id: "scared", label: "Assustado", glyph: "◉" },
  { id: "angry", label: "Com raiva", glyph: "⌁" },
  { id: "annoyed", label: "Irritado", glyph: "—" },
  { id: "thinking", label: "Pensativo", glyph: "…" },
  { id: "sleepy", label: "Sonolento", glyph: "z" },
  { id: "yawn", label: "Bocejando", glyph: "◡" },
  { id: "wink", label: "Piscadela", glyph: ";)" },
];

const states: { id: BotStateName; label: string }[] = [
  { id: "idle", label: "Ocioso" },
  { id: "working", label: "Trabalhando" },
  { id: "thinking", label: "Pensando" },
  { id: "searching", label: "Pesquisando" },
  { id: "approval", label: "Aprovação" },
  { id: "question", label: "Pergunta" },
  { id: "error", label: "Erro" },
  { id: "finished", label: "Concluído" },
  { id: "ratelimit", label: "Limite" },
  { id: "sleeping", label: "Dormindo" },
  { id: "dizzy", label: "Tonto" },
];

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Emotion lab root element missing");

root.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div class="brand"><span class="brand-mark">k</span><span>KIBO<span class="muted">.LAB</span></span></div>
      <div class="crumb"><span class="online-dot"></span> MOCHI / EMOTION TESTER</div>
      <div class="top-meta"><span>LOCAL</span><span class="divider">/</span><span>NO KIBO LINK</span></div>
    </header>
    <section class="workspace">
      <div class="intro">
        <div><p class="eyebrow">FERRAMENTA DE DESENVOLVIMENTO · 01</p><h1>Mochi <span>Emotion Lab</span></h1>
          <p class="subhead">Teste expressões e estados no motor real do Mochi, sem iniciar o Kibo.</p></div>
        <div class="live-tag"><i></i> RENDER AO VIVO <b>60 FPS</b></div>
      </div>
      <div class="main-grid">
        <section class="preview-card">
          <div class="card-head"><span><i class="tiny-dot"></i> PREVIEW / MOCHI.PRIMARY</span><span class="mono" id="preview-code">EMOTE: NEUTRO</span></div>
          <div class="stage" id="stage">
            <div class="stage-grid"></div>
            <div class="orb orb-a"></div><div class="orb orb-b"></div>
            <canvas id="mochi" aria-label="Preview animado do Mochi"></canvas>
            <div class="stage-caption"><span class="mood-icon">✦</span><span id="mood-name">Neutro</span><span class="caption-divider">·</span><span id="state-name">Ocioso</span></div>
            <div class="scanline"></div>
          </div>
          <div class="preview-footer"><span><b class="key">ENGINE</b> BotEngine / Coucou</span><span><b class="key">MODE</b> EXPRESSÃO PERSISTENTE</span></div>
        </section>
        <aside class="side-card">
          <div class="card-head"><span><i class="tiny-dot green"></i> CONTROLES</span><span class="mono">01 — 16</span></div>
          <div class="section-label"><span>EXPRESSÕES</span><span>CLIQUE PARA FIXAR</span></div>
          <div class="emotion-grid" id="emotion-grid"></div>
          <div class="reaction-control">
            <div class="reaction-title"><span>REAÇÃO CURTA</span><span id="duration-label">1.8s</span></div>
            <div class="reaction-row"><input id="duration" type="range" min="0.4" max="5" step="0.2" value="1.8"><button id="trigger" class="trigger-button" disabled>DISPARAR ↗</button></div>
          </div>
          <div class="auto-row"><div><strong>CICLO AUTOMÁTICO</strong><small>Alterna as expressões sozinho</small></div><button id="auto-toggle" class="toggle" aria-pressed="false"><span></span></button></div>
        </aside>
      </div>
      <section class="states-card">
        <div class="states-heading"><div><i class="tiny-dot purple"></i> ESTADOS DO MOCHI</div><span>CAMADA DE STATUS · COMPARTILHADA COM OS AGENTES</span></div>
        <div class="state-list" id="state-list"></div>
      </section>
      <footer class="footer"><span><span class="footer-dot"></span> MOTOR PRONTO</span><span id="event-log">SELECIONE UMA EXPRESSÃO PARA COMEÇAR</span><span>KIBO LAB <b>v1.0</b></span></footer>
    </section>
  </main>
`;

const canvas = document.querySelector<HTMLCanvasElement>("#mochi")!;
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("Canvas 2D is unavailable");
const engine = new BotEngine();
engine.isMini = false;
engine.setState("idle", true);

let selectedEmotion: BotEmoteName | null = null;
let selectedLabel = "Neutro";
let previousFrame = performance.now();
let autoTimer = 0;
let autoIndex = 0;

const previewCode = document.querySelector<HTMLElement>("#preview-code")!;
const moodName = document.querySelector<HTMLElement>("#mood-name")!;
const stateName = document.querySelector<HTMLElement>("#state-name")!;
const eventLog = document.querySelector<HTMLElement>("#event-log")!;
const trigger = document.querySelector<HTMLButtonElement>("#trigger")!;
const emotionGrid = document.querySelector<HTMLElement>("#emotion-grid")!;
const stateList = document.querySelector<HTMLElement>("#state-list")!;

const log = (message: string) => {
  const time = new Date().toLocaleTimeString("pt-BR", { hour12: false });
  eventLog.textContent = `${time}  ›  ${message.toLocaleUpperCase("pt-BR")}`;
};

const setEmotion = (emotion: typeof emotions[number], source = "expressão fixa") => {
  selectedEmotion = emotion.id;
  selectedLabel = emotion.label;
  engine.setPermanentEmote(emotion.id);
  document.querySelectorAll<HTMLButtonElement>(".emotion-button").forEach((button) => {
    button.classList.toggle("selected", button.dataset.emotion === (emotion.id ?? "neutral"));
  });
  previewCode.textContent = `EMOTE: ${(emotion.id ?? "NEUTRO").toLocaleUpperCase("pt-BR")}`;
  moodName.textContent = emotion.label;
  trigger.disabled = emotion.id === null;
  log(`${emotion.label} / ${source}`);
};

emotionGrid.innerHTML = emotions.map((emotion) => `
  <button class="emotion-button${emotion.id === null ? " selected" : ""}" data-emotion="${emotion.id ?? "neutral"}" title="Fixar expressão ${emotion.label}">
    <span class="emotion-glyph">${emotion.glyph}</span><span>${emotion.label}</span>
  </button>
`).join("");
emotionGrid.querySelectorAll<HTMLButtonElement>(".emotion-button").forEach((button) => {
  button.addEventListener("click", () => {
    const emotion = emotions.find((item) => (item.id ?? "neutral") === button.dataset.emotion);
    if (emotion) setEmotion(emotion);
  });
});

stateList.innerHTML = states.map((state) => `
  <button class="state-button${state.id === "idle" ? " selected" : ""}" data-state="${state.id}">${state.label}</button>
`).join("");
stateList.querySelectorAll<HTMLButtonElement>(".state-button").forEach((button) => {
  button.addEventListener("click", () => {
    const state = states.find((item) => item.id === button.dataset.state);
    if (!state) return;
    engine.setState(state.id, true);
    stateName.textContent = state.label;
    stateList.querySelectorAll(".state-button").forEach((item) => item.classList.toggle("selected", item === button));
    log(`estado ${state.label}`);
  });
});

const duration = document.querySelector<HTMLInputElement>("#duration")!;
const durationLabel = document.querySelector<HTMLElement>("#duration-label")!;
duration.addEventListener("input", () => { durationLabel.textContent = `${Number(duration.value).toFixed(1)}s`; });
trigger.addEventListener("click", () => {
  if (!selectedEmotion) return;
  engine.triggerEmote(selectedEmotion, Number(duration.value));
  log(`reação ${selectedLabel} / ${Number(duration.value).toFixed(1)}s`);
});

const autoToggle = document.querySelector<HTMLButtonElement>("#auto-toggle")!;
autoToggle.addEventListener("click", () => {
  const active = autoToggle.getAttribute("aria-pressed") !== "true";
  autoToggle.setAttribute("aria-pressed", String(active));
  autoToggle.classList.toggle("active", active);
  if (autoTimer) window.clearInterval(autoTimer);
  autoTimer = 0;
  if (active) {
    autoTimer = window.setInterval(() => {
      autoIndex = (autoIndex + 1) % emotions.length;
      setEmotion(emotions[autoIndex], "ciclo automático");
    }, 2200);
    log("ciclo automático iniciado");
  } else log("ciclo automático pausado");
});

const resize = () => {
  // Match the notch's 4× backing scale so the same vector paths stay crisp in
  // the larger Emotion Lab preview without changing its CSS size or layout.
  const dpr = Math.max(window.devicePixelRatio || 1, 4);
  const bounds = canvas.getBoundingClientRect();
  canvas.width = Math.round(bounds.width * dpr);
  canvas.height = Math.round(bounds.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
};
new ResizeObserver(resize).observe(canvas);
resize();

const frame = (time: number) => {
  const dt = Math.min(0.05, Math.max(0, (time - previousFrame) / 1000));
  previousFrame = time;
  const bounds = canvas.getBoundingClientRect();
  engine.update(dt);
  ctx.clearRect(0, 0, bounds.width, bounds.height);
  engine.draw(ctx, bounds.width, bounds.height);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
