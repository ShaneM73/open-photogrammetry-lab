// Image matching for height measurement.
// Method: the vertical line locus. For a ground position (X, Y), try many
// heights Z. For each, resample a small patch around (X, Y, Z) from both
// photos; where the ground really is, the two patches look alike. The
// normalised cross-correlation coefficient r measures how alike (1 = equal
// up to brightness and contrast). This works for vertical and oblique
// photos alike, because the search runs along the vertical in object space.
import { makeGrid, cellX, cellY, heightAt, fillGaps } from './raster.js';

export function ncc(a, b, n) {
  let ma = 0, mb = 0;
  for (let t = 0; t < n; t++) { ma += a[t]; mb += b[t]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let t = 0; t < n; t++) { const p = a[t] - ma, q = b[t] - mb; sab += p * q; saa += p * p; sbb += q * q; }
  if (saa < 1e-6 * n || sbb < 1e-6 * n) return -2; // flat patch: no texture to match
  return sab / Math.sqrt(saa * sbb);
}

// Search heights zFrom..zTo at (X, Y). sample: (photoIndex, X, Y, Z) -> grey or -1.
// half: patch half-size in samples, spacing: ground distance between samples.
export function matchHeightAt(left, right, X, Y, zFrom, zTo, step, half, spacing) {
  const n = (2 * half + 1) ** 2;
  const a = new Float64Array(n), b = new Float64Array(n);
  const scores = [];
  let best = { z: NaN, r: -2, idx: -1 };
  for (let Z = zFrom, idx = 0; Z <= zTo + 1e-9; Z += step, idx++) {
    let k = 0, ok = true;
    for (let j = -half; j <= half && ok; j++) for (let i = -half; i <= half; i++) {
      const Xg = X + i * spacing, Yg = Y + j * spacing;
      const l = left.sampleGround(Xg, Yg, Z), r = right.sampleGround(Xg, Yg, Z);
      if (l < 0 || r < 0) { ok = false; break; }
      a[k] = l; b[k] = r; k++;
    }
    const r = ok ? ncc(a, b, n) : NaN;
    scores.push(r);
    if (r > best.r) best = { z: Z, r, idx };
  }
  const i = best.idx;
  if (i > 0 && i < scores.length - 1 && Number.isFinite(scores[i - 1]) && Number.isFinite(scores[i + 1])) {
    const y0 = scores[i - 1], y1 = scores[i], y2 = scores[i + 1], den = y0 - 2 * y1 + y2;
    if (den < 0) best.z += step * 0.5 * (y0 - y2) / den;
  }
  return { ...best, scores, zFrom, step };
}

// A terrain model by matching, coarse to fine (an image pyramid in object space).
// opts: { area: {xmin,xmax,ymin,ymax}, pixel (final grid spacing), zMin, zMax,
//         half (patch half-size), spacing (sample distance on the ground),
//         rMin (accept threshold), levels (number of pyramid levels),
//         inside: (X,Y) -> bool (optional area polygon), start: [{X,Y,Z}] (optional seed points),
//         onProgress: (fraction, message) -> void }
// Returns { grid (heights, gaps filled), r (correlation per cell), matched, total }.
export async function matchDTM(left, right, opts) {
  const { area, pixel, zMin, zMax, half = 6, spacing, rMin = 0.7, levels = 3, inside = null, start = null, onProgress = () => {} } = opts;
  let approx = null; // grid of approximate heights from the coarser level
  let result = null;
  const totalWork = Array.from({ length: levels }, (_, k) => 4 ** k).reduce((s, x) => s + x, 0);
  let done = 0;
  for (let lev = levels - 1; lev >= 0; lev--) {
    const f = 2 ** lev, px = pixel * f, sp = spacing * f;
    const g = makeGrid(area.xmin, area.xmax, area.ymin, area.ymax, px);
    const r = new Float32Array(g.z.length).fill(NaN);
    const range = lev === levels - 1 ? null : Math.max(4 * sp, (zMax - zMin) / 2 ** (levels - lev + 1));
    const step = lev === levels - 1 ? Math.max(sp / 2, (zMax - zMin) / 120) : Math.max(spacing / 4, range / 30);
    let t0 = performance.now();
    for (let row = 0; row < g.rows; row++) {
      for (let col = 0; col < g.cols; col++) {
        const X = cellX(g, col), Y = cellY(g, row);
        if (inside && !inside(X, Y)) continue;
        let a = zMin, b = zMax;
        if (approx) {
          const z0 = heightAt(approx, X, Y);
          if (Number.isNaN(z0)) continue;
          a = Math.max(zMin, z0 - range); b = Math.min(zMax, z0 + range);
        }
        const m = matchHeightAt(left, right, X, Y, a, b, step, half, sp);
        if (m.r >= rMin) { g.z[row * g.cols + col] = m.z; r[row * g.cols + col] = m.r; }
        else r[row * g.cols + col] = m.r;
      }
      if (performance.now() - t0 > 40) {
        onProgress((done + (4 ** (levels - 1 - lev)) * (row + 1) / g.rows) / totalWork, `level ${levels - lev} of ${levels}: row ${row + 1} of ${g.rows}`);
        await new Promise(res => setTimeout(res, 0));
        t0 = performance.now();
      }
    }
    done += 4 ** (levels - 1 - lev);
    // seed points (known heights) override the matching at their cells
    if (start) for (const p of start) {
      const c = Math.floor((p.X - g.xmin) / g.pixel), rr = Math.floor((g.ymax - p.Y) / g.pixel);
      if (c >= 0 && rr >= 0 && c < g.cols && rr < g.rows) g.z[rr * g.cols + c] = p.Z;
    }
    const matched = g.z.reduce((s, v) => s + (Number.isNaN(v) ? 0 : 1), 0);
    const total = inside ? g.z.reduce((s, _, i) => s + (inside(cellX(g, i % g.cols), cellY(g, Math.floor(i / g.cols))) ? 1 : 0), 0) : g.z.length;
    const raw = { ...g, z: g.z.slice() };
    fillGaps(g, inside ? (rr, cc) => inside(cellX(g, cc), cellY(g, rr)) : null);
    result = { grid: g, raw, r, matched, total };
    approx = g;
  }
  onProgress(1, 'done');
  return result;
}
