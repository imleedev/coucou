export interface BotCanvasCache {
  canvasPx: number;
  canvasDpr: number;
}

/** Keep one maximum-size backing bitmap while Mochi is drawn at its real size. */
export function sizeBotCanvas(
  canvas: HTMLCanvasElement,
  drawWidth: number,
  dpr: number,
  cache: BotCanvasCache,
  sideOverhang: number,
  verticalOverhang: number,
  maxDrawWidth: number,
) {
  const height = maxDrawWidth + verticalOverhang;
  const width = maxDrawWidth + sideOverhang * 2;
  if (cache.canvasPx !== width || cache.canvasDpr !== dpr) {
    cache.canvasPx = width;
    cache.canvasDpr = dpr;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.transform = "none";
  }
  return { width, height, drawingInset: (maxDrawWidth - drawWidth) / 2 };
}
