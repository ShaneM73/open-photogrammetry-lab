// Image matching for height measurement.
// Method: the vertical line locus. For a ground position (X, Y), try many
// heights Z. For each, resample a small patch around (X, Y, Z) from both
// photos; where the ground really is, the two patches look alike. The
// normalised cross-correlation coefficient r measures how alike (1 = equal
// up to brightness and contrast). This works for vertical and oblique
// photos alike, because the search runs along the vertical in object space.
import { makeGrid, cellX, cellY, heightAt, fillGaps } from './raster.js';
import { sampleBilinear } from './camera.js';
import { template, search } from './aatm.js';
import { leastSquares } from './linalg.js';

// Fill `out` with a patch of (2 half + 1)^2 grey values around ground point
// (X, Y, Z). Over a small patch the projection is practically affine, so only
// three points are projected exactly and the rest is interpolated.
function patch(photo, X, Y, Z, half, spacing, out) {
  const c = photo.project(X, Y, Z), ex = photo.project(X + spacing, Y, Z), ey = photo.project(X, Y + spacing, Z);
  if (!c || !ex || !ey) return false;
  const du = [ex[0] - c[0], ex[1] - c[1]], dv = [ey[0] - c[0], ey[1] - c[1]];
  let k = 0;
  for (let j = -half; j <= half; j++) for (let i = -half; i <= half; i++) {
    const u = c[0] + i * du[0] + j * dv[0] - 0.5, v = c[1] + i * du[1] + j * dv[1] - 0.5;
    const g = sampleBilinear(photo.grey, u, v);
    if (g < 0) return false;
    out[k++] = g;
  }
  return true;
}

export function ncc(a, b, n) {
  let ma = 0, mb = 0;
  for (let t = 0; t < n; t++) { ma += a[t]; mb += b[t]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let t = 0; t < n; t++) { const p = a[t] - ma, q = b[t] - mb; sab += p * q; saa += p * p; sbb += q * q; }
  if (saa < 1e-6 * n || sbb < 1e-6 * n) return -2; // flat patch: no texture to match
  return sab / Math.sqrt(saa * sbb);
}

// Search heights zFrom..zTo at (X, Y) between two photos (see camera.js makePhoto).
// half: patch half-size in samples, spacing: ground distance between samples.
export function matchHeightAt(left, right, X, Y, zFrom, zTo, step, half, spacing) {
  const n = (2 * half + 1) ** 2;
  const a = new Float64Array(n), b = new Float64Array(n);
  const scores = [];
  let best = { z: NaN, r: -2, idx: -1 };
  for (let Z = zFrom, idx = 0; Z <= zTo + 1e-9; Z += step, idx++) {
    const ok = patch(left, X, Y, Z, half, spacing, a) && patch(right, X, Y, Z, half, spacing, b);
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
//         approx: (X,Y) -> Z and range: search only approx +- range already on the first level
//         (for repetitive surfaces such as waves, where a full search finds false peaks),
//         onProgress: (fraction, message) -> void }
// Returns { grid (heights, gaps filled), r (correlation per cell), matched, total }.
export async function matchDTM(left, right, opts) {
  const { area, pixel, zMin, zMax, half = 6, spacing, rMin = 0.7, levels = 3, inside = null, start = null, approx: approxFn = null, range: range0 = null, onProgress = () => {} } = opts;
  let approx = null; // grid of approximate heights from the coarser level
  let result = null;
  const totalWork = Array.from({ length: levels }, (_, k) => 4 ** k).reduce((s, x) => s + x, 0);
  let done = 0;
  for (let lev = levels - 1; lev >= 0; lev--) {
    const f = 2 ** lev, px = pixel * f, sp = spacing * f;
    const g = makeGrid(area.xmin, area.xmax, area.ymin, area.ymax, px);
    const r = new Float32Array(g.z.length).fill(NaN);
    let range = lev === levels - 1 ? null : Math.max(4 * sp, (zMax - zMin) / 2 ** (levels - lev + 1));
    if (approxFn && range0) range = lev === levels - 1 ? range0 : Math.min(range, range0);
    const step = range === null ? Math.max(sp / 2, (zMax - zMin) / 120) : Math.max(spacing / 4, range / 30);
    let t0 = performance.now();
    for (let row = 0; row < g.rows; row++) {
      for (let col = 0; col < g.cols; col++) {
        const X = cellX(g, col), Y = cellY(g, row);
        if (inside && !inside(X, Y)) continue;
        let a = zMin, b = zMax;
        if (approx || approxFn) {
          const z0 = approx ? heightAt(approx, X, Y) : approxFn(X, Y);
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

// y-parallax correction. Cameras without a calibration (lens distortion,
// a sensor that moves in its mount) leave points slightly off the epipolar
// line in the second photo. At seed points with approximately known ground
// coordinates, find the point by 2D matching, measure its offset across the
// epipolar line, and fit a polynomial to these offsets. The correction then
// shifts the second photo's projections across the epipolar direction.
// Returns { correction, before, after, n, points } (offsets in pixels).
// With alongEpipolar = true, the offsets along the epipolar line (x-parallax)
// are fitted too. That is only right when the seed points have trustworthy
// heights, for example from a previous adjustment: it then ties the model
// to those heights.
export function fitParallaxCorrection(left, right, seeds, { degree = 2, h = 10, R = 14, rMin = 0.8, alongEpipolar = false } = {}) {
  const saved = right.correction;
  right.correction = null;
  const meas = [];
  for (const p of seeds) {
    const pl = left.project(p.X, p.Y, p.Z), pr = right.project(p.X, p.Y, p.Z);
    if (!pl || !pr) continue;
    const tpl = template(left.grey, pl[0], pl[1], h);
    if (!tpl) continue;
    const m = search(right.grey, tpl, pr[0] + (tpl.u - pl[0]), pr[1] + (tpl.v - pl[1]), R);
    if (!m || m.r < rMin || m.edge) continue;
    // epipolar direction: a second point on the left ray, projected into the right photo
    const e = left.eo, d = [p.X - e.X0, p.Y - e.Y0, p.Z - e.Z0];
    const q = right.project(p.X + 0.05 * d[0], p.Y + 0.05 * d[1], p.Z + 0.05 * d[2]);
    if (!q) continue;
    let ex = q[0] - pr[0], ey = q[1] - pr[1];
    const len = Math.hypot(ex, ey); ex /= len; ey /= len;
    const n = [-ey, ex];
    const off = [m.u - (tpl.u - pl[0]) - pr[0], m.v - (tpl.v - pl[1]) - pr[1]];
    meas.push({ u: pr[0], v: pr[1], n, e: [ex, ey], py: off[0] * n[0] + off[1] * n[1], px: off[0] * ex + off[1] * ey, r: m.r });
  }
  right.correction = saved;
  if (meas.length < 8) return { correction: null, n: meas.length, points: meas, before: NaN, after: NaN };
  const W = right.grey.w, H = right.grey.h;
  const terms = (u, v) => { const a = 2 * u / W - 1, b = 2 * v / H - 1; return degree === 1 ? [1, a, b] : [1, a, b, a * a, a * b, b * b]; };
  const nMean = [0, 1].map(k => meas.reduce((s2, m) => s2 + m.n[k], 0) / meas.length);
  const nl = Math.hypot(...nMean); nMean[0] /= nl; nMean[1] /= nl;
  let use = meas, coef = null;
  for (let pass = 0; pass < 3; pass++) {
    const fit = leastSquares(use.map(m => terms(m.u, m.v)), use.map(m => m.py));
    coef = fit.x;
    const sd = Math.sqrt(fit.v.reduce((s2, x) => s2 + x * x, 0) / fit.v.length);
    const next = meas.filter(m => Math.abs(terms(m.u, m.v).reduce((s2, t, i) => s2 + t * coef[i], 0) - m.py) < 3 * sd + 0.3);
    if (next.length === use.length) break;
    use = next;
  }
  const py = (u, v) => terms(u, v).reduce((s2, t, i) => s2 + t * coef[i], 0);
  const rms = arr => Math.sqrt(arr.reduce((s2, x) => s2 + x * x, 0) / arr.length);
  let px = () => 0, pxBefore = NaN, pxAfter = NaN;
  if (alongEpipolar) {
    const fx = leastSquares(use.map(m => terms(m.u, m.v)), use.map(m => m.px)).x;
    px = (u, v) => terms(u, v).reduce((s2, t, i) => s2 + t * fx[i], 0);
    pxBefore = rms(use.map(m => m.px)); pxAfter = rms(use.map(m => m.px - px(m.u, m.v)));
  }
  const eMean = [nMean[1], -nMean[0]];
  return {
    correction: (u, v) => { const k = py(u, v), j = px(u, v); return [k * nMean[0] + j * eMean[0], k * nMean[1] + j * eMean[1]]; },
    coefficients: coef, direction: nMean, n: use.length, points: meas,
    before: rms(use.map(m => m.py)), after: rms(use.map(m => m.py - py(m.u, m.v))), pxBefore, pxAfter,
  };
}
