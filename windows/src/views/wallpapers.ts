import { h, svg } from "./dom";
import { ICONS } from "./icons";
import { tl } from "../i18n/i18n";
import type { ViewActions, ViewHost } from "./views";

interface WallpaperItem {
  name: string;
  url: string;
  thumbnail?: string;
}

interface WallpaperList {
  wallpapers: WallpaperItem[];
  current: string | null;
}

const API = "/api/wallpapers";

export function buildWallpapers(actions: ViewActions): ViewHost {
  const title = h("div", { class: "title", text: tl("Wallpapers") });
  const current = h("span", { class: "wallpapers-current", text: "Carregando biblioteca…" });
  const status = h("span", { class: "wallpapers-status", text: "" });
  const gallery = h("div", { class: "wallpapers-gallery" });
  const add = h(
    "button",
    { class: "btn secondary wallpapers-add", title: "Abrir pasta no Nautilus", "aria-label": "Adicionar wallpaper", onclick: () => void openFolder() },
    svg(ICONS.folder, 12),
    "Adicionar",
  );
  const refresh = h(
    "button",
    { class: "btn secondary", title: "Atualizar lista", "aria-label": "Atualizar lista", onclick: () => void load() },
    svg(ICONS.arrowClockwise, 11, { stroke: 1.8 }),
  );
  const previous = h("button", { class: "btn secondary", title: "Wallpaper anterior", onclick: () => step(-1) }, "‹");
  const random = h("button", { class: "btn secondary", title: "Escolher wallpaper aleatório", onclick: () => chooseRandom() }, "Aleatório");
  const next = h("button", { class: "btn secondary", title: "Próximo wallpaper", onclick: () => step(1) }, "›");
  const el = h(
    "div",
    { id: "wallpapers-view", class: "view wallpapers" },
    h("div", { class: "card" },
      h("div", { class: "wallpapers-panel" },
        h("div", { class: "wallpapers-head" }, title, current, add, refresh),
        gallery,
        h("div", { class: "wallpapers-actions" }, status, previous, random, next),
      ),
    ),
  );

  let items: WallpaperItem[] = [];
  let currentName: string | null = null;
  let loaded = false;
  let loading = false;
  let applying = false;

  function updateCurrentLabel() {
    current.textContent = currentName ? `Ativo: ${currentName}` : "Nenhum wallpaper da biblioteca ativo";
  }

  function renderItems() {
    // Keep image elements attached during state changes so WebKit does not
    // needlessly decode and repaint the gallery after each apply operation.
    const existing = new Map(
      Array.from(gallery.children)
        .filter((child) => child.classList.contains("wallpaper-thumb"))
        .map((child) => [child.getAttribute("data-wallpaper") ?? "", child]),
    );
    for (const [index, item] of items.entries()) {
      let button = existing.get(item.name) as HTMLButtonElement | undefined;
      if (button) existing.delete(item.name);
      else {
        const thumbnail = item.thumbnail || item.url;
        button = h("button", {
          class: "wallpaper-thumb",
          "data-wallpaper": item.name,
          title: `Aplicar ${item.name}`,
          "aria-label": `Aplicar ${item.name}`,
          onclick: () => void apply(item),
        },
          h("img", { src: thumbnail, alt: "", loading: "lazy", decoding: "async", fetchpriority: "low" }),
          h("span", { class: "wallpaper-name", text: item.name }),
        );
      }
      const image = button.querySelector("img");
      const thumbnail = item.thumbnail || item.url;
      if (image && image.getAttribute("src") !== thumbnail) image.setAttribute("src", thumbnail);
      const atPosition = gallery.children[index];
      if (atPosition !== button) gallery.insertBefore(button, atPosition || null);
    }
    for (const button of existing.values()) button.remove();
    const empty = gallery.querySelector(".wallpapers-empty");
    if (!items.length && loaded) {
      if (!empty) gallery.append(h("span", { class: "wallpapers-empty", text: "Use Adicionar para abrir a pasta no Nautilus." }));
    } else empty?.remove();
    gallery.classList.toggle("empty", items.length === 0 && loaded);
  }

  function renderState() {
    for (const button of Array.from(gallery.children)) {
      if (!button.classList.contains("wallpaper-thumb")) continue;
      button.classList.toggle("on", button.getAttribute("data-wallpaper") === currentName);
      (button as HTMLButtonElement).disabled = applying || loading;
    }
    gallery.classList.toggle("empty", items.length === 0 && loaded);
    updateCurrentLabel();
    const busy = applying || loading;
    previous.disabled = busy || items.length < 2;
    random.disabled = busy || items.length < 1;
    next.disabled = busy || items.length < 2;
    refresh.disabled = busy;
    add.disabled = busy;
  }

  async function load() {
    if (loading) return;
    loading = true;
    status.classList.remove("error");
    status.textContent = "Lendo biblioteca…";
    renderState();
    try {
      const response = await fetch(API, { cache: "no-store" });
      const result = await response.json() as WallpaperList & { error?: string };
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      items = result.wallpapers;
      currentName = result.current;
      loaded = true;
      status.textContent = `${items.length} ${items.length === 1 ? "imagem" : "imagens"} · awww`;
    } catch (error) {
      loaded = true;
      items = [];
      status.classList.add("error");
      status.textContent = error instanceof Error ? error.message : "Não foi possível ler os wallpapers.";
    } finally {
      loading = false;
      renderItems();
      renderState();
    }
  }

  async function apply(item: WallpaperItem) {
    if (applying) return;
    applying = true;
    actions.blip();
    status.classList.remove("error");
    status.textContent = `Aplicando ${item.name}…`;
    renderState();
    try {
      const response = await fetch(`${API}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: item.name }),
      });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || `awww retornou HTTP ${response.status}`);
      currentName = item.name;
      status.textContent = `Aplicado pelo awww · ${item.name}`;
    } catch (error) {
      status.classList.add("error");
      status.textContent = error instanceof Error ? error.message : "Falha ao aplicar wallpaper.";
    } finally {
      applying = false;
      renderState();
    }
  }

  function step(direction: -1 | 1) {
    if (items.length < 2 || applying) return;
    const index = items.findIndex((item) => item.name === currentName);
    const nextIndex = index < 0
      ? (direction > 0 ? 0 : items.length - 1)
      : (index + direction + items.length) % items.length;
    void apply(items[nextIndex]);
  }

  function chooseRandom() {
    if (!items.length || applying) return;
    const choices = items.length > 1 ? items.filter((item) => item.name !== currentName) : items;
    void apply(choices[Math.floor(Math.random() * choices.length)]);
  }

  async function openFolder() {
    if (applying || loading) return;
    status.classList.remove("error");
    status.textContent = "Abrindo a pasta de wallpapers no Nautilus…";
    try {
      const response = await fetch(`${API}/open-folder`, { method: "POST" });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
      status.textContent = "Nautilus aberto. Copie a imagem para essa pasta e atualize a lista.";
    } catch (error) {
      status.classList.add("error");
      status.textContent = error instanceof Error ? error.message : "Não foi possível abrir o Nautilus.";
    }
  }

  return {
    el,
    sync() {
      if (!loaded && !loading) void load();
    },
  };
}
