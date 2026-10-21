// No external colour library: a <canvas> sample + small k-means is ~80 lines for a one-off per upload.

export type ExtractedPalette = {
  // Up to 3 hex colours, most visually prominent first. Empty if the image could not be sampled.
  colors: string[];
};

const SAMPLE_SIZE = 64;

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
    return { colors: [] };
  }

  const points: [number, number, number][] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3];
    if (alpha < 128) continue;
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max > 245 && min > 235) continue;
    if (max < 20) continue;
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

// Centers seeded from evenly-spaced input points (not random) so the result is deterministic.
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
