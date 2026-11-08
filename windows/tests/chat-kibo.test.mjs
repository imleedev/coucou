// Ax-Shell exposes the real Kibo WebSocket bridge before the existing conversation view runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom } from "./fakedom.mjs";

installFakeDom();
delete globalThis.__TAURI_INTERNALS__;
const { buildPrompt } = await import("../src/views/chat.ts");
const { DEFAULT_SETTINGS, State } = await import("../src/core/state.ts");

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("Ax-Shell conversation sends to Kibo and renders the reply in its existing chat", async () => {
  State.settings = { ...DEFAULT_SETTINGS, chatModels: {} };
  State.chatHistory = [];
  State.stateOverride = null;
  State.view = "prompt";
  State.droppedFile = null;
  let received;
  window.__axKiboChatSend = async (text) => { received = text; return "Resposta do Kibo"; };

  const view = buildPrompt(() => {});
  view.sync();
  const model = view.el.querySelector(".model-name");
  const input = view.el.querySelector(".chat-input");
  const send = view.el.querySelector(".send-btn");
  assert.equal(model.textContent, "Kibo");
  input.value = "Oi, Kibo";
  send.fire("click");
  await flush();
  view.sync();
  await flush();
  view.sync();

  assert.equal(received, "Oi, Kibo");
  assert.deepEqual(State.chatHistory.map((message) => [message.role, message.content]), [
    ["user", "Oi, Kibo"], ["assistant", "Resposta do Kibo"],
  ]);
});
