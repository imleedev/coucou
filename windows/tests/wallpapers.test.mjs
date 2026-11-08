// Wallpaper cards use cached thumbnails and keep their image nodes mounted
// while apply requests update the controls.

import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom } from "./fakedom.mjs";

installFakeDom();
const { buildWallpapers } = await import("../src/views/wallpapers.ts");

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
let view;
let requests;
let finishApply;

beforeEach(() => {
  requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push([url, options]);
    if (url === "/api/wallpapers") {
      return {
        ok: true,
        json: async () => ({
          wallpapers: [
            { name: "a.jpg", url: "/api/wallpapers/file/a.jpg", thumbnail: "/api/wallpapers/thumbnail/a.jpg" },
            { name: "b.jpg", url: "/api/wallpapers/file/b.jpg", thumbnail: "/api/wallpapers/thumbnail/b.jpg" },
          ],
          current: "a.jpg",
        }),
      };
    }
    return new Promise((resolve) => { finishApply = resolve; });
  };
  view = buildWallpapers({ blip() {} });
  view.sync();
});

test("gallery uses preview URLs and retains image nodes while applying", async () => {
  await flush();
  const gallery = view.el.querySelector(".wallpapers-gallery");
  const first = gallery.children[0];
  const image = first.find("img")[0];
  assert.equal(image.getAttribute("src"), "/api/wallpapers/thumbnail/a.jpg");
  assert.equal(image.getAttribute("decoding"), "async");

  first.fire("click");
  await flush();
  assert.equal(gallery.children[0], first, "apply state does not replace the card");
  assert.equal(gallery.children[0].find("img")[0], image, "apply state does not recreate the image");
  assert.equal(image.getAttribute("src"), "/api/wallpapers/thumbnail/a.jpg");
  assert.equal(requests.at(-1)[0], "/api/wallpapers/apply");

  finishApply({ ok: true, json: async () => ({ ok: true }) });
  await flush();
  assert.equal(gallery.children[0].find("img")[0], image, "completion keeps the preview mounted");
});
