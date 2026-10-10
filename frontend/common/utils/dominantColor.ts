/* Client-side dominant-colour extraction for a freshly uploaded tenant logo —
 * powers the superadmin console's "suggest a palette from this logo" step
 * (multi-tenant theming: most businesses only need one picked colour, but a
 * minority want 2-3 coordinated colours pulled straight from their mark).
 *
 * Deliberately no external library: this project has no colour/image
 * dependency today (see common/config/theme.ts's own header), and a plain
 * <canvas> pixel sample plus a tiny k-means pass is ~80 lines, versus adding
 * a dependency for something run once per logo upload. The result is always
 * a SUGGESTION the operator can freely overwrite — see profile.go's
 * SetTheme, which never auto-applies anything the console did not submit.
 */

export type ExtractedPalette = {
  /** Up to 3 hex colours, most visually prominent first. Empty if the image
   * could not be sampled (e.g. a fully-transparent logo). */
  colors: string[];
};

const SAMPLE_SIZE = 64; // px — a small canvas is plenty for a colour histogram and keeps this instant

/** Reads a File (already known to be PNG/JPEG/WebP — see SetLogo's own
 * validation) into up to 3 dominant colours via a naive k-means clustering
 * over a downsampled canvas. Runs entirely client-side; the raw bytes are
 * never sent anywhere just to pick a colour. */
export async function extractPaletteFromImage(file: File): Promise<ExtractedPalette> {
  const bitmap = await loadBitmap(file);
  if (!bitmap) return { colors: [] };

  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { colors: [] };
  ctx.drawImage(bitmap, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

  let pixels: Uint8ClampedArray;
  try {
    pixels = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
  } catch {
    // A canvas can refuse to be read back (tainted by a cross-origin draw);
    // this only ever draws a same-origin object URL, but degrade quietly
    // rather than throw out of an upload handler either way.
    return { colors: [] };
  }

  const points: [number, number, number][] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3];
    if (alpha < 128) continue; // skip transparent/near-transparent pixels
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    // Skip near-white/near-black: almost always the logo's background or
    // linework rather than a "brand colour" a business would pick by hand.
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max > 245 && min > 235) continue; // near-white
    if (max < 20) continue; // near-black
    points.push([r, g, b]);
  }
  if (points.length === 0) return { colors: [] };

  const centers = kMeans(points, 3);
  return { colors: centers.map(([r, g, b]) => rgbToHex(r, g, b)) };
}

function loadBitmap(file: File): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

/** A small, fixed-iteration k-means over RGB points — good enough for "3
 * clusters from a few thousand logo pixels", not a general-purpose
 * implementation. Centers are seeded from evenly-spaced points in the input
 * (not random) so the result is deterministic for the same logo. */
function kMeans(points: [number, number, number][], k: number): [number, number, number][] {
  const n = points.length;
  const clusterCount = Math.min(k, n);
  let centers: [number, number, number][] = Array.from(
    { length: clusterCount },
    (_, i) => points[Math.floor((i * n) / clusterCount)]
  );

  for (let iter = 0; iter < 8; iter++) {
    const sums = centers.map(() => [0, 0, 0, 0]); // r,g,b,count
    for (const p of points) {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = dist2(p, centers[c]);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      sums[best][0] += p[0];
      sums[best][1] += p[1];
      sums[best][2] += p[2];
      sums[best][3] += 1;
    }
    centers = sums.map((s, i) => (s[3] > 0 ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : centers[i]));
  }

  // Sort by cluster population (most prominent colour first) by re-counting
  // membership once more against the converged centers.
  const counts = centers.map(() => 0);
  for (const p of points) {
    let best = 0;
    let bestDist = Infinity;
    for (let c = 0; c < centers.length; c++) {
      const d = dist2(p, centers[c]);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    counts[best]++;
  }
  return centers
    .map((c, i) => ({ c, count: counts[i] }))
    .sort((a, b) => b.count - a.count)
    .map((x) => x.c.map(Math.round) as [number, number, number]);
}

function dist2(a: [number, number, number], b: [number, number, number]): number {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v: number) => clamp(v).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
