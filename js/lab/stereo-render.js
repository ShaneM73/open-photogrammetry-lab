// Rendering a stereo pair for viewing: both photos are resampled onto a
// horizontal plane at the floating-mark height Z, in a frame whose x axis
// runs along the air base. Ground at height Z then appears at the same place
// in both images; higher ground is shifted apart along x, which is exactly
// the horizontal parallax the eyes need to see depth.

import { makePhoto, greyData } from '../core/camera.js';
export { greyData };

// A ground -> grey value function for one photo (exterior + interior orientation + pixels).
export function makeProjector(eo, inn, img, scale = 1) {
  const p = makePhoto({ inn, eo, fullRows: img.h * scale, scale, grey: img });
  return (X, Y, Z) => p.sampleGround(X, Y, Z);
}

// view: { X, Y (centre), gsd (m per screen pixel), ex: [east, north] unit base direction }
export function groundAt(view, i, j, W, H) {
  const a = (i - W / 2) * view.gsd, b = (j - H / 2) * view.gsd;
  // screen x along the base, screen y down = -(base rotated by +90 deg)
  return [view.X + a * view.ex[0] + b * view.ex[1], view.Y + a * view.ex[1] - b * view.ex[0]];
}

export function renderPair(ctx, W, H, view, Z, projL, projR, mode, phase = 0) {
  const out = ctx.createImageData(W, H), d = out.data;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const [X, Y] = groundAt(view, mode === 'side' ? (i < W / 2 ? i + W / 4 : i - W / 4) : i, j, W, H);
    const k = 4 * (j * W + i);
    let l = -1, r = -1;
    if (mode === 'anaglyph') { l = projL(X, Y, Z); r = projR(X, Y, Z); d[k] = l < 0 ? 20 : l; d[k + 1] = d[k + 2] = r < 0 ? 20 : r; }
    else if (mode === 'side') { const v = i < W / 2 ? projL(X, Y, Z) : projR(X, Y, Z); d[k] = d[k + 1] = d[k + 2] = v < 0 ? 20 : v; }
    else { const v = phase ? projR(X, Y, Z) : projL(X, Y, Z); d[k] = d[k + 1] = d[k + 2] = v < 0 ? 20 : v; }
    d[k + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
}

// Find the height where the two images agree best around (X, Y): normalised
// cross-correlation of small patches resampled on planes of different height.
export function matchHeight(view, X, Y, projL, projR, zFrom, zTo, step = 0.5, half = 10, spacing = 2) {
  const n = (2 * half + 1) ** 2;
  const a = new Float64Array(n), b = new Float64Array(n);
  let best = { z: NaN, r: -2 }, scores = [];
  for (let Z = zFrom; Z <= zTo; Z += step) {
    let k = 0, ok = true;
    for (let j = -half; j <= half && ok; j++) for (let i = -half; i <= half; i++) {
      const dx = i * spacing, dy = j * spacing;
      const Xg = X + dx * view.ex[0] - dy * view.ex[1], Yg = Y + dx * view.ex[1] + dy * view.ex[0];
      const l = projL(Xg, Yg, Z), r = projR(Xg, Yg, Z);
      if (l < 0 || r < 0) { ok = false; break; }
      a[k] = l; b[k] = r; k++;
    }
    if (!ok) { scores.push(NaN); continue; }
    let ma = 0, mb = 0;
    for (let t = 0; t < n; t++) { ma += a[t]; mb += b[t]; }
    ma /= n; mb /= n;
    let sab = 0, saa = 0, sbb = 0;
    for (let t = 0; t < n; t++) { const p = a[t] - ma, q = b[t] - mb; sab += p * q; saa += p * p; sbb += q * q; }
    const r = sab / Math.sqrt(saa * sbb || 1);
    scores.push(r);
    if (r > best.r) best = { z: Z, r, idx: scores.length - 1 };
  }
  // parabola through the peak and its neighbours for a sub-step estimate
  const i = best.idx;
  if (i > 0 && i < scores.length - 1 && Number.isFinite(scores[i - 1]) && Number.isFinite(scores[i + 1])) {
    const y0 = scores[i - 1], y1 = scores[i], y2 = scores[i + 1], den = y0 - 2 * y1 + y2;
    if (den < 0) best.z += step * 0.5 * (y0 - y2) / den;
  }
  return { ...best, scores, zFrom, step };
}
