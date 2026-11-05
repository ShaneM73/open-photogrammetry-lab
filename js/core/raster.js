// Height grids (DTMs) and the things done with them: sampling, filling gaps,
// filtering, differences, volumes, shading, colour and contour lines.
// A grid: { rows, cols, xmin, ymax, pixel, z: Float32Array (NaN = no height) }.
// Row 0 is the northern edge; cell (r, c) is centred at
// X = xmin + (c + 0.5) pixel, Y = ymax - (r + 0.5) pixel.

export function makeGrid(xmin, xmax, ymin, ymax, pixel, fill = NaN) {
  const cols = Math.max(1, Math.round((xmax - xmin) / pixel)), rows = Math.max(1, Math.round((ymax - ymin) / pixel));
  return { rows, cols, xmin, ymax, xmax: xmin + cols * pixel, ymin: ymax - rows * pixel, pixel, z: new Float32Array(rows * cols).fill(fill) };
}

export const cellX = (g, c) => g.xmin + (c + 0.5) * g.pixel;
export const cellY = (g, r) => g.ymax - (r + 0.5) * g.pixel;

// From the JSON written by tools/convert_lisa.py (integers / divisor, null = no data).
export function gridFromJSON(j) {
  const z = new Float32Array(j.rows * j.cols);
  const vals = j.values || j.heights_dm;
  const div = j.divisor || 10;
  for (let i = 0; i < z.length; i++) z[i] = vals[i] == null ? NaN : vals[i] / div;
  return { rows: j.rows, cols: j.cols, xmin: j.xmin, ymax: j.ymax, xmax: j.xmin + j.cols * j.pixel, ymin: j.ymax - j.rows * j.pixel, pixel: j.pixel, z };
}

export function heightAt(g, X, Y) {
  const c = (X - g.xmin) / g.pixel - 0.5, r = (g.ymax - Y) / g.pixel - 0.5;
  if (c < 0 || r < 0 || c > g.cols - 1 || r > g.rows - 1) return NaN;
  const c0 = Math.floor(c), r0 = Math.floor(r), c1 = Math.min(c0 + 1, g.cols - 1), r1 = Math.min(r0 + 1, g.rows - 1);
  const fc = c - c0, fr = r - r0, z = g.z, C = g.cols;
  const a = z[r0 * C + c0], b = z[r0 * C + c1], d = z[r1 * C + c0], e = z[r1 * C + c1];
  if ([a, b, d, e].some(Number.isNaN)) { // fall back to the nearest valid corner
    const near = [[a, fc + fr], [b, 1 - fc + fr], [d, fc + 1 - fr], [e, 2 - fc - fr]].filter(q => !Number.isNaN(q[0])).sort((p, q) => p[1] - q[1]);
    return near.length ? near[0][0] : NaN;
  }
  return (a * (1 - fc) + b * fc) * (1 - fr) + (d * (1 - fc) + e * fc) * fr;
}

// Fill holes (NaN) by repeatedly averaging valid neighbours; cells outside
// `mask` (optional function r,c -> bool) stay empty.
export function fillGaps(g, mask = null, maxPasses = 200) {
  const z = g.z, R = g.rows, C = g.cols;
  for (let pass = 0; pass < maxPasses; pass++) {
    const upd = [];
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const i = r * C + c;
      if (!Number.isNaN(z[i]) || (mask && !mask(r, c))) continue;
      let s = 0, n = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= R || cc >= C) continue;
        const v = z[rr * C + cc];
        if (!Number.isNaN(v)) { s += v; n++; }
      }
      if (n >= 2 || (n === 1 && pass > 3)) upd.push([i, s / n]);
    }
    if (!upd.length) break;
    for (const [i, v] of upd) z[i] = v;
  }
  return g;
}

// Median filter over a (2 radius + 1)^2 window: removes isolated spikes and
// pits left by mismatches (radius 1 = 3 x 3, radius 2 = 5 x 5).
export function medianFilter(g, radius = 1) {
  const z = g.z, R = g.rows, C = g.cols, out = new Float32Array(z.length), win = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    win.length = 0;
    for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && cc >= 0 && rr < R && cc < C && !Number.isNaN(z[rr * C + cc])) win.push(z[rr * C + cc]);
    }
    const i = r * C + c;
    if (Number.isNaN(z[i]) || !win.length) { out[i] = z[i]; continue; }
    win.sort((p, q) => p - q);
    out[i] = win[win.length >> 1];
  }
  return { ...g, z: out };
}

// b - a, sampled on the cells of a.
export function difference(a, b) {
  const out = { ...a, z: new Float32Array(a.z.length) };
  for (let r = 0; r < a.rows; r++) for (let c = 0; c < a.cols; c++) {
    const i = r * a.cols + c;
    out.z[i] = heightAt(b, cellX(a, c), cellY(a, r)) - a.z[i];
  }
  return out;
}

export function stats(g) {
  let n = 0, s = 0, ss = 0, mn = Infinity, mx = -Infinity;
  for (const v of g.z) if (!Number.isNaN(v)) { n++; s += v; ss += v * v; if (v < mn) mn = v; if (v > mx) mx = v; }
  const mean = s / n;
  return { n, mean, rms: Math.sqrt(ss / n), std: Math.sqrt(Math.max(0, ss / n - mean * mean)), min: mn, max: mx };
}

// Volume between a difference grid and zero: gain (positive), loss (negative), net.
export function volume(diff, mask = null) {
  let gain = 0, loss = 0, n = 0;
  const a = diff.pixel * diff.pixel;
  for (let r = 0; r < diff.rows; r++) for (let c = 0; c < diff.cols; c++) {
    const v = diff.z[r * diff.cols + c];
    if (Number.isNaN(v) || (mask && !mask(r, c))) continue;
    n++; if (v > 0) gain += v * a; else loss += v * a;
  }
  return { gain, loss, net: gain + loss, area: n * a, meanChange: (gain + loss) / (n * a) };
}

// Shaded relief (0..1) from a light in the north-west.
export function hillshade(g, exag = 1) {
  const R = g.rows, C = g.cols, z = g.z, out = new Float32Array(R * C);
  const L = [-0.5, 0.5, 0.707];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const at = (rr, cc) => { rr = Math.max(0, Math.min(R - 1, rr)); cc = Math.max(0, Math.min(C - 1, cc)); const v = z[rr * C + cc]; return Number.isNaN(v) ? z[r * C + c] : v; };
    const dzdx = (at(r, c + 1) - at(r, c - 1)) / (2 * g.pixel) * exag;
    const dzdy = (at(r - 1, c) - at(r + 1, c)) / (2 * g.pixel) * exag;
    const n = [-dzdx, -dzdy, 1], len = Math.hypot(...n);
    out[r * C + c] = Math.max(0, (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / len);
  }
  return out;
}

// Contour lines by marching squares: returns segments [[x1,y1,x2,y2], ...] in cell coordinates.
export function contours(g, interval) {
  const segs = [], R = g.rows, C = g.cols, z = g.z;
  let mn = Infinity, mx = -Infinity;
  for (const v of z) if (!Number.isNaN(v)) { if (v < mn) mn = v; if (v > mx) mx = v; }
  for (let lev = Math.ceil(mn / interval) * interval; lev <= mx; lev += interval) {
    for (let r = 0; r < R - 1; r++) for (let c = 0; c < C - 1; c++) {
      const v = [z[r * C + c], z[r * C + c + 1], z[(r + 1) * C + c + 1], z[(r + 1) * C + c]];
      if (v.some(Number.isNaN)) continue;
      const p = [[c, r], [c + 1, r], [c + 1, r + 1], [c, r + 1]];
      const cross = [];
      for (let k = 0; k < 4; k++) {
        const a = v[k], b = v[(k + 1) % 4];
        if ((a < lev) !== (b < lev)) {
          const t = (lev - a) / (b - a), A = p[k], B = p[(k + 1) % 4];
          cross.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]);
        }
      }
      if (cross.length === 2) segs.push([...cross[0], ...cross[1], lev]);
      else if (cross.length === 4) segs.push([...cross[0], ...cross[1], lev], [...cross[2], ...cross[3], lev]);
    }
  }
  return segs;
}

// Colour ramps for heights and differences.
const ramp = (stops, t) => {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) {
    const [t0, a] = stops[i - 1], [t1, b] = stops[i], f = (t - t0) / (t1 - t0);
    return a.map((x, k) => x + (b[k] - x) * f);
  }
  return stops[stops.length - 1][1];
};
export const HYPSO = [[0, [45, 106, 79]], [0.35, [140, 170, 95]], [0.6, [214, 196, 128]], [0.82, [176, 128, 86]], [1, [245, 240, 232]]];
export const DIVERGING = [[0, [33, 102, 172]], [0.5, [247, 247, 247]], [1, [178, 24, 43]]];
export const CORR = [[0, [120, 30, 30]], [0.6, [200, 120, 40]], [0.8, [230, 210, 90]], [1, [40, 150, 90]]];

// Draw a grid into a canvas: colour by value (range lo..hi), optional shading and contours.
export function drawGrid(canvas, g, { values = g.z, lo, hi, colors = HYPSO, shade = null, contourSegs = null, contourEvery = null } = {}) {
  const W = canvas.width, H = canvas.height, ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H), d = img.data;
  const sx = g.cols / W, sy = g.rows / H;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = Math.min(g.cols - 1, Math.floor(x * sx)), r = Math.min(g.rows - 1, Math.floor(y * sy)), i = r * g.cols + c, k = 4 * (y * W + x);
    const v = values[i];
    if (Number.isNaN(v)) { d[k] = d[k + 1] = d[k + 2] = 28; d[k + 3] = 255; continue; }
    const col = ramp(colors, (v - lo) / (hi - lo));
    const s = shade ? 0.45 + 0.75 * shade[i] : 1;
    d[k] = Math.min(255, col[0] * s); d[k + 1] = Math.min(255, col[1] * s); d[k + 2] = Math.min(255, col[2] * s); d[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  if (contourSegs) {
    ctx.lineWidth = 1;
    for (const [x1, y1, x2, y2, lev] of contourSegs) {
      const major = contourEvery && Math.abs(lev / contourEvery - Math.round(lev / contourEvery)) < 1e-6;
      ctx.strokeStyle = major ? 'rgba(20,20,20,0.85)' : 'rgba(20,20,20,0.4)';
      ctx.beginPath();
      ctx.moveTo((x1 + 0.5) / sx, (y1 + 0.5) / sy);
      ctx.lineTo((x2 + 0.5) / sx, (y2 + 0.5) / sy);
      ctx.stroke();
    }
  }
}

export function rgbOf(colors, t) { return ramp(colors, t); }
