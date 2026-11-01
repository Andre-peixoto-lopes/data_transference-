import type { PatternImage } from "./pattern-codec.js";

/** Grid columns for `codes` tiles: side by side for 2 (landscape screens), near-square beyond. */
export function gridColumns(codes: number): number {
  return codes <= 2 ? codes : Math.ceil(Math.sqrt(codes));
}

/** Tiles same-size pattern images row-major into one image (white where the last row is short). */
export function composeGrid(tiles: readonly PatternImage[], columns: number): PatternImage {
  const { width, height } = tiles[0];
  const rows = Math.ceil(tiles.length / columns);
  const outWidth = width * columns;
  const rgba = new Uint8ClampedArray(outWidth * height * rows * 4).fill(255);
  tiles.forEach((tile, index) => {
    if (tile.width !== width || tile.height !== height) {
      throw new Error("tiles must share one size (pin the QR version)");
    }
    const x0 = (index % columns) * width;
    const y0 = Math.floor(index / columns) * height;
    for (let y = 0; y < height; y++) {
      rgba.set(tile.rgba.subarray(y * width * 4, (y + 1) * width * 4), ((y0 + y) * outWidth + x0) * 4);
    }
  });
  return { width: outWidth, height: height * rows, rgba };
}
