// Automatic aerial triangulation measurement (AATM): finding the same
// point in several photos by image matching. All positions here are raster
// coordinates (u right, v down, pixel centres at i + 0.5) of the loaded images.
import { ncc } from './matching.js';

// Cut a (2h+1)^2 template centred at (u, v); null if too close to the edge.
export function template(img, u, v, h) {
  const cu = Math.round(u - 0.5), cv = Math.round(v - 0.5);
  if (cu - h < 0 || cv - h < 0 || cu + h >= img.w || cv + h >= img.h) return null;
  const t = new Float64Array((2 * h + 1) ** 2);
  let k = 0;
  for (let j = -h; j <= h; j++) for (let i = -h; i <= h; i++) t[k++] = img.g[(cv + j) * img.w + cu + i];
  return { t, h, u: cu + 0.5, v: cv + 0.5 };
}

// Search a template in img around (u, v) within +-R pixels. Returns the best
// position (sub-pixel, by fitting a parabola through the peak) and its r.
export function search(img, tpl, u, v, R) {
  const h = tpl.h, n = tpl.t.length, w = new Float64Array(n);
  const cu = Math.round(u - 0.5), cv = Math.round(v - 0.5);
  const size = 2 * R + 1, score = new Float64Array(size * size).fill(-2);
  let best = { r: -2, du: 0, dv: 0 };
  for (let dv = -R; dv <= R; dv++) for (let du = -R; du <= R; du++) {
    const x = cu + du, y = cv + dv;
    if (x - h < 0 || y - h < 0 || x + h >= img.w || y + h >= img.h) continue;
    let k = 0;
    for (let j = -h; j <= h; j++) { const row = (y + j) * img.w + x; for (let i = -h; i <= h; i++) w[k++] = img.g[row + i]; }
    const r = ncc(tpl.t, w, n);
    score[(dv + R) * size + du + R] = r;
    if (r > best.r) best = { r, du, dv };
  }
  if (best.r < -1) return null;
  const at = (a, b) => score[(best.dv + R + b) * size + best.du + R + a];
  const sub = (m, z, p) => { const den = m - 2 * z + p; return den < 0 && m > -2 && p > -2 ? 0.5 * (m - p) / den : 0; };
  const su = Math.abs(best.du) < R ? sub(at(-1, 0), best.r, at(1, 0)) : 0;
  const sv = Math.abs(best.dv) < R ? sub(at(0, -1), best.r, at(0, 1)) : 0;
  return { u: cu + 0.5 + best.du + su, v: cv + 0.5 + best.dv + sv, r: best.r, edge: Math.abs(best.du) === R || Math.abs(best.dv) === R };
}

// An interest operator: within +-R of (u, v), the pixel whose surroundings
// change most in every direction (smallest eigenvalue of the gradient
// structure tensor). Corners and small spots score high; edges and flat
// areas low, because they cannot be located in both directions.
export function interestPoint(img, u, v, R = 10, w = 3) {
  const cu = Math.round(u - 0.5), cv = Math.round(v - 0.5);
  let best = null;
  for (let y = cv - R; y <= cv + R; y += 2) for (let x = cu - R; x <= cu + R; x += 2) {
    if (x - w - 1 < 0 || y - w - 1 < 0 || x + w + 1 >= img.w || y + w + 1 >= img.h) continue;
    let gxx = 0, gyy = 0, gxy = 0;
    for (let j = -w; j <= w; j++) for (let i = -w; i <= w; i++) {
      const p = (y + j) * img.w + x + i;
      const gx = img.g[p + 1] - img.g[p - 1], gy = img.g[p + img.w] - img.g[p - img.w];
      gxx += gx * gx; gyy += gy * gy; gxy += gx * gy;
    }
    const tr = gxx + gyy, det = gxx * gyy - gxy * gxy;
    const lmin = tr / 2 - Math.sqrt(Math.max(0, tr * tr / 4 - det));
    if (!best || lmin > best.s) best = { u: x + 0.5, v: y + 0.5, s: lmin };
  }
  return best;
}

// Shrink a full-resolution grey chip by an integer factor (block average).
export function shrink(chip, f) {
  if (f === 1) return chip;
  const w = Math.floor(chip.w / f), h = Math.floor(chip.h / f), g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) s += chip.g[(y * f + j) * chip.w + x * f + i];
    g[y * w + x] = s / (f * f);
  }
  return { w, h, g };
}
