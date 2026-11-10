import { h, svg } from "./dom";
import type { ViewHost } from "./views";

type App = { id: string; name: string; comment?: string };
type DeviceState = { bluetooth: { available: boolean; enabled: boolean; devices: { name: string; address: string; connected: boolean; paired: boolean }[] }; wifi: { available: boolean; enabled: boolean; ssid?: string } };

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, { method, cache: "no-store", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function frame(title: string, content: HTMLElement, panelClass = "") {
  return h("div", { class: "view" }, h("div", { class: "card" }, h("div", { class: `workspace-panel ${panelClass}`.trim() },
    h("div", { class: "workspace-head" }, h("strong", { text: title }), h("span", { text: "AX-SHELL" })), content)));
}

export function buildAppsView(): ViewHost {
  const search = h("input", { class: "ax-search", placeholder: "Buscar aplicativos…", type: "search" }) as HTMLInputElement;
  const list = h("div", { class: "workspace-content ax-list" });
  const message = h("div", { class: "ax-status", text: "Carregando aplicativos…" });
  let apps: App[] = [];
  let loaded = false, pending = false;
  const render = () => {
    list.replaceChildren();
    const term = search.value.trim().toLocaleLowerCase();
    const shown = apps.filter(app => `${app.name} ${app.comment ?? ""}`.toLocaleLowerCase().includes(term)).slice(0, 100);
    for (const app of shown) list.append(h("button", { class: "workspace-row ax-row", onclick: () => void request("/api/apps/launch", "POST", { id: app.id }).then(() => { message.textContent = `Abrindo ${app.name}`; }).catch(e => { message.textContent = e.message; }) }, h("strong", { text: app.name }), h("span", { text: app.comment ?? "" })));
    message.textContent = apps.length ? `${shown.length} aplicativos` : "Nenhum aplicativo encontrado.";
  };
  search.addEventListener("input", render);
  window.addEventListener("ax-shell-search", event => { search.value += String((event as CustomEvent).detail ?? ""); render(); search.focus(); search.setSelectionRange(search.value.length, search.value.length); });
  const refresh = async () => { if (loaded || pending) return; pending = true; try { apps = (await request<{ apps: App[] }>("/api/apps")).apps; loaded = true; render(); } catch (e) { message.textContent = e instanceof Error ? e.message : "Falha ao listar aplicativos"; } finally { pending = false; } };
  const content = h("div", { class: "ax-apps" }, search, message, list);
  return { el: frame("Aplicativos", content), sync() { void refresh(); } };
}

export function buildDevicesView(): ViewHost {
  const rows = h("div", { class: "workspace-content ax-list" });
  const status = h("div", { class: "ax-status", text: "Consultando dispositivos…" });
  let refreshing = false, lastRefresh = 0;
  const refresh = async (force = false) => {
    if (refreshing || (!force && Date.now() - lastRefresh < 1800)) return;
    refreshing = true; lastRefresh = Date.now();
    try {
      const state = (await request<{ devices: DeviceState }>("/api/devices")).devices;
      rows.replaceChildren();
      const toggle = (label: string, key: string, enabled: boolean, available: boolean) => rows.append(h("div", { class: "workspace-row ax-row" }, h("strong", { text: label }), h("span", { text: available ? enabled ? "Ativo" : "Desativado" : "Indisponível" }), h("button", { disabled: !available, text: enabled ? "Desativar" : "Ativar", onclick: () => void request("/api/devices/control", "POST", { action: key === "wifi" ? "wifi-toggle" : "bluetooth-toggle" }).then(() => refresh(true)).catch(e => status.textContent = e.message) })));
      toggle("Bluetooth", "bluetooth", state.bluetooth.enabled, state.bluetooth.available);
      for (const device of state.bluetooth.devices) rows.append(h("div", { class: "workspace-row ax-row" }, h("strong", { text: device.name }), h("span", { text: device.connected ? "Conectado" : device.paired ? "Pareado" : device.address }), h("button", { text: device.connected ? "Desconectar" : "Conectar", onclick: () => void request("/api/devices/control", "POST", { action: "bluetooth-connect", address: device.address, connect: !device.connected }).then(() => refresh(true)).catch(e => status.textContent = e.message) })));
      toggle("Wi-Fi", "wifi", state.wifi.enabled, state.wifi.available);
      rows.append(h("div", { class: "workspace-row ax-row" }, h("strong", { text: "Rede atual" }), h("span", { text: state.wifi.ssid || "Sem conexão" }), h("button", { text: "Procurar redes", onclick: () => void request("/api/devices/control", "POST", { action: "wifi-scan" }).then(() => refresh(true)).catch(e => status.textContent = e.message) })));
      status.textContent = "Controles do sistema pelo Ax-Shell";
    } catch (e) { status.textContent = e instanceof Error ? e.message : "Falha ao consultar dispositivos"; }
    finally { refreshing = false; }
  };
  return { el: frame("Dispositivos", h("div", { class: "ax-apps" }, status, rows)), sync() { void refresh(); } };
}

export function buildToolsView(): ViewHost {
  const status = h("div", { class: "ax-status", text: "Ferramentas e ações do Ax-Shell" });
  const actions: [string, string, string][] = [
    ["Captura de tela", "screenshot-full", "M4 4h16v16H4zM8 15l3-3 2 2 2-2 3 3"],
    ["Captura de região", "screenshot-region", "M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3"],
    ["Captura de janela", "screenshot-window", "M4 5h16v14H4zM4 9h16"],
    ["Gravar tela", "screen-record", "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 9v6m-3-3h6"],
    ["OCR da tela", "ocr", "M4 7V5a1 1 0 0 1 1-1h2m10 0h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2m-10 0H5a1 1 0 0 1-1-1v-2M8 15l2-6h4l2 6m-7-2h6"],
    ["Modo jogo", "game-mode", "M6 8h12a4 4 0 0 1 3.8 5.2l-1 3a2 2 0 0 1-3.3.9L15 15H9l-2.5 2.1a2 2 0 0 1-3.3-.9l-1-3A4 4 0 0 1 6 8Zm2 2v4m-2-2h4m5-1h.01M17 13h.01"],
    ["Pomodoro", "pomodoro", "M12 8v4l3 2m5-2a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM9 2h6"],
  ];
  const grid = h("div", { class: "workspace-content ax-actions" });
  for (const [label, action, icon] of actions) grid.append(h("button", { class: "ax-action ax-icon-action", title: label, "aria-label": label, onclick: () => void request("/api/ax-shell/action", "POST", { action }).then(() => status.textContent = `${label} iniciado`).catch(e => status.textContent = e.message) }, svg(icon, 17, { stroke: 1.7 })));
  const power = h("div", { class: "ax-power-controls" });
  const powerActions: [string, string, boolean, string][] = [
    ["Bloquear", "lock", false, "M7 10V7a5 5 0 0 1 10 0v3M6 10h12v11H6z"],
    ["Suspender", "suspend", true, "M20.5 14.2A8 8 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"],
    ["Reiniciar", "reboot", true, "M20 7v5h-5m5 0a8 8 0 1 1-2.34-5.66L20 9"],
    ["Desligar", "poweroff", true, "M12 2v10m6.36-6.36a9 9 0 1 1-12.72 0"],
  ];
  for (const [label, action, confirm, icon] of powerActions) power.append(h("button", { class: "ax-power-button", title: label, "aria-label": label, onclick: () => { if (confirm && !window.confirm(`${label}?`)) return; void request("/api/ax-shell/action", "POST", { action }).then(() => status.textContent = `${label} iniciado`).catch(e => status.textContent = e.message); } }, svg(icon, 14, { stroke: 1.7 })));
  return { el: frame("Ferramentas e energia", h("div", { class: "ax-apps" }, h("div", { class: "ax-tools-top" }, status, power), h("div", { class: "ax-tools-scroll" }, grid)), "ax-tools-panel"), sync() {} };
}

export function buildWorkspaceView(): ViewHost {
  type Section = "pins" | "kanban" | "tmux" | "cliphist";
  const status = h("div", { class: "ax-status", text: "Dados e ações do Ax-Shell" });
  const tabs = h("div", { class: "ax-subtabs" });
  const body = h("div", { class: "workspace-content ax-workspace-content" });
  let section: Section = "pins";
  let loadedSection: Section | null = null, loading = false;
  const operations = (operation: string, values: Record<string, unknown> = {}) => request("/api/ax-shell/workspace", "POST", { operation, ...values }).then(() => load(true)).catch(e => { status.textContent = e instanceof Error ? e.message : "Ação falhou"; });
  const makeTab = (name: string, value: Section) => h("button", { class: "ax-subtab", text: name, onclick: () => { section = value; void load(true); } });
  const tabButtons = [makeTab("Pins", "pins"), makeTab("Kanban", "kanban"), makeTab("Tmux", "tmux"), makeTab("Clipboard", "cliphist")];
  tabs.append(...tabButtons);
  const load = async (force = false) => {
    if (loading || (!force && loadedSection === section)) return;
    loading = true;
    tabButtons.forEach((button, i) => button.classList.toggle("on", ["pins", "kanban", "tmux", "cliphist"][i] === section));
    body.replaceChildren();
    try {
      const data = await request<Record<string, unknown>>(`/api/ax-shell/workspace?section=${section}`);
      loadedSection = section;
      if (section === "pins") {
        const items = data.items as { content?: string | null; content_type?: string | null }[];
        const add = h("form", { class: "ax-inline", onsubmit: (event: Event) => { event.preventDefault(); const value = input.value.trim(); if (value) void operations("pin-add", { content: value }); } });
        const input = h("input", { class: "ax-search", placeholder: "Adicionar texto ou link…" }) as HTMLInputElement;
        add.append(input, h("button", { class: "ax-action", text: "Fixar", type: "submit" })); body.append(add);
        items.forEach((item, index) => { if (item.content) body.append(h("div", { class: "workspace-row ax-row" }, h("strong", { text: item.content }), h("button", { text: "Abrir", onclick: () => void operations("pin-open", { index }) }), h("button", { text: "Remover", onclick: () => void operations("pin-remove", { index }) }))); });
        status.textContent = `${items.filter(item => item.content).length} itens fixados · salvo no arquivo ~/.pins.json`;
      } else if (section === "kanban") {
        const columns = data.columns as { title: string; notes: string[] }[];
        const add = h("form", { class: "ax-inline", onsubmit: (event: Event) => { event.preventDefault(); if (task.value.trim()) void operations("kanban-add", { text: task.value.trim(), column: Number(column.value) }); } });
        const task = h("input", { class: "ax-search", placeholder: "Nova tarefa…" }) as HTMLInputElement;
        const column = h("select", { class: "ax-select" }) as HTMLSelectElement;
        columns.forEach((item, i) => column.append(h("option", { value: i, text: item.title })));
        add.append(task, column, h("button", { class: "ax-action", text: "Adicionar", type: "submit" })); body.append(add);
        const board = h("div", { class: "ax-kanban" });
        columns.forEach((item, col) => { const colEl = h("div", { class: "ax-kanban-column" }, h("strong", { text: item.title })); item.notes.forEach((note, index) => colEl.append(h("div", { class: "ax-task" }, h("span", { text: note }), h("button", { text: "‹", title: "Mover para a coluna anterior", disabled: col === 0, onclick: () => void operations("kanban-move", { column: col, index, destination: col - 1 }) }), h("button", { text: "›", title: "Mover para a próxima coluna", disabled: col === 2, onclick: () => void operations("kanban-move", { column: col, index, destination: col + 1 }) }), h("button", { text: "×", title: "Remover", onclick: () => void operations("kanban-remove", { column: col, index }) })))); board.append(colEl); }); body.append(board);
        status.textContent = "Kanban sincronizado com ~/.kanban.json";
      } else if (section === "tmux") {
        const sessions = data.sessions as string[];
        const add = h("form", { class: "ax-inline", onsubmit: (event: Event) => { event.preventDefault(); if (name.value.trim()) void operations("tmux-create", { name: name.value.trim() }); } });
        const name = h("input", { class: "ax-search", placeholder: "Nome da nova sessão…" }) as HTMLInputElement;
        add.append(name, h("button", { class: "ax-action", text: "Criar sessão", type: "submit" })); body.append(add);
        sessions.forEach(session => body.append(h("div", { class: "workspace-row ax-row" }, h("strong", { text: session }), h("button", { text: "Abrir terminal", onclick: () => void operations("tmux-attach", { name: session }) }))));
        status.textContent = `${sessions.length} sessões tmux`;
      } else {
        const items = data.items as { id: string; label: string }[];
        const wipe = h("button", { class: "ax-action", text: "Limpar histórico", onclick: () => void operations("clipboard-wipe") }); body.append(wipe);
        items.forEach(item => body.append(h("button", { class: "workspace-row ax-row", title: "Restaurar para a área de transferência", onclick: () => void operations("clipboard-copy", { id: item.id }) }, h("strong", { text: item.label }), h("span", { text: `#${item.id}` }))));
        status.textContent = `${items.length} itens no histórico cliphist`;
      }
    } catch (e) { status.textContent = e instanceof Error ? e.message : "Não foi possível carregar a área"; }
    finally { loading = false; }
  };
  window.addEventListener("ax-shell-route", event => { const value = (event as CustomEvent).detail; if (["pins", "kanban", "tmux", "cliphist"].includes(value)) { section = value as Section; void load(true); } });
  return { el: frame("Espaço de trabalho", h("div", { class: "ax-apps" }, tabs, status, body)), sync() { void load(); } };
}
