// Demo: how image matching finds a height. Pick a spot on the map; for a
// trial height Z both photos are resampled around that spot. The patches
// match only at the right height, where the correlation coefficient peaks.
import { loadPair, drawOrthoArea } from '../lab/pair.js';
import { matchHeightAt } from '../core/matching.js';
import { heightAt } from '../core/raster.js';
import { sampleBilinear } from '../core/camera.js';
import { cssVar } from './three-util.js';

const SPACING = 1.1; // m on the ground, about one scan pixel

export async function mount(root) {
  root.innerHTML = `
  <div class="demo-head"><h3>Searching along the vertical</h3><span class="hint">Click the map to pick a spot, then move the height</span></div>
  <div class="demo-body wide-side">
    <div class="stage" style="min-height:460px"><canvas id="md-map" aria-label="Map of the stereo overlap"></canvas><span class="stage-label">Reference orthophoto of the overlap · click to choose</span></div>
    <div class="side">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <figure style="margin:0"><canvas id="md-l" width="150" height="150" class="mini" aria-label="Patch from photo 157"></canvas><figcaption class="mono" style="font-size:12px;color:var(--left)">photo 157</figcaption></figure>
        <figure style="margin:0"><canvas id="md-r" width="150" height="150" class="mini" aria-label="Patch from photo 158"></canvas><figcaption class="mono" style="font-size:12px;color:var(--right)">photo 158</figcaption></figure>
      </div>
      <div class="ctrl"><label for="md-z">Trial height Z <output id="md-zo"></output></label><input type="range" id="md-z" min="1000" max="1500" step="0.5" value="1200"></div>
      <div class="ctrl"><label>Patch size</label><div class="seg" id="md-w">
        <button class="btn" data-h="3" aria-pressed="false">7 × 7</button><button class="btn" data-h="6" aria-pressed="true">13 × 13</button><button class="btn" data-h="12" aria-pressed="false">25 × 25</button></div></div>
      <canvas id="md-curve" width="600" height="240" style="width:100%;background:var(--paper);border:1px solid var(--rule);border-radius:6px" aria-label="Correlation against height"></canvas>
      <button class="btn primary" id="md-best">Go to the best height</button>
      <div class="readout" id="md-read"></div>
    </div>
  </div>
  <p class="caption">For each trial height, the patches are cut from the photos exactly where the collinearity equations put a small square of ground at that height. The curve shows the correlation coefficient r for every height between 1000 and 1500 m; the dashed line marks the reference terrain model.</p>`;

  const $ = s => root.querySelector(s);
  const P = await loadPair();
  const [L, R] = P.photos, area = P.overlap;
  const map = $('#md-map'), mctx = map.getContext('2d');
  const state = { X: 1138600, Y: 971220, Z: 1200, half: 6, curve: null };

  function drawMap() {
    const W = map.clientWidth, H = map.clientHeight;
    if (map.width !== W || map.height !== H) { map.width = W; map.height = H; }
    // keep the aspect ratio of the area
    const s = Math.min(W / (area.xmax - area.xmin), H / (area.ymax - area.ymin));
    const w = (area.xmax - area.xmin) * s, h = (area.ymax - area.ymin) * s, ox = (W - w) / 2, oy = (H - h) / 2;
    mctx.fillStyle = cssVar('--canvas'); mctx.fillRect(0, 0, W, H);
    mctx.save(); mctx.translate(ox, oy);
    drawOrthoArea(mctx, P.orthoImg, P.s.orthoMeta, area, w, h);
    const x = (state.X - area.xmin) * s, y = (area.ymax - state.Y) * s;
    mctx.strokeStyle = '#ffd166'; mctx.lineWidth = 2;
    mctx.strokeRect(x - 10, y - 10, 20, 20);
    mctx.restore();
    map._t = { s, ox, oy };
  }

  function drawPatch(canvas, photo) {
    const ctx = canvas.getContext('2d'), n = 2 * state.half + 1, cell = canvas.width / n;
    const c = photo.project(state.X, state.Y, state.Z);
    const ex = photo.project(state.X + SPACING, state.Y, state.Z), ey = photo.project(state.X, state.Y + SPACING, state.Z);
    for (let j = -state.half; j <= state.half; j++) for (let i = -state.half; i <= state.half; i++) {
      // j runs north -> south on screen
      const u = c[0] + i * (ex[0] - c[0]) - j * (ey[0] - c[0]) - 0.5, v = c[1] + i * (ex[1] - c[1]) - j * (ey[1] - c[1]) - 0.5;
      const gval = Math.round(sampleBilinear(photo.grey, u, v));
      ctx.fillStyle = gval < 0 ? '#222' : `rgb(${gval},${gval},${gval})`;
      ctx.fillRect((i + state.half) * cell, (j + state.half) * cell, Math.ceil(cell), Math.ceil(cell));
    }
    ctx.strokeStyle = '#ffd166'; ctx.strokeRect(canvas.width / 2 - cell / 2, canvas.height / 2 - cell / 2, cell, cell);
  }

  function computeCurve() {
    state.curve = matchHeightAt(L, R, state.X, state.Y, 1000, 1500, 0.5, state.half, SPACING);
  }

  function drawCurve() {
    const cv = $('#md-curve'), ctx = cv.getContext('2d'), W = cv.width, H = cv.height, m = { l: 58, r: 16, t: 14, b: 40 };
    ctx.clearRect(0, 0, W, H);
    const ink = cssVar('--ink-2'), X = z => m.l + (z - 1000) / 500 * (W - m.l - m.r), Y = r => m.t + (1 - (r + 0.2) / 1.2) * (H - m.t - m.b);
    ctx.font = '22px JetBrains Mono, monospace'; ctx.fillStyle = ink; ctx.strokeStyle = cssVar('--rule'); ctx.lineWidth = 1;
    for (const r of [0, 0.5, 1]) { ctx.beginPath(); ctx.moveTo(m.l, Y(r)); ctx.lineTo(W - m.r, Y(r)); ctx.stroke(); ctx.fillText(r.toFixed(1), 6, Y(r) + 8); }
    for (const z of [1000, 1100, 1200, 1300, 1400, 1500]) ctx.fillText(String(z), X(z) - 26, H - 10);
    const ref = heightAt(P.ref, state.X, state.Y);
    if (Number.isFinite(ref)) { ctx.setLineDash([4, 4]); ctx.strokeStyle = ink; ctx.beginPath(); ctx.moveTo(X(ref), m.t); ctx.lineTo(X(ref), H - m.b); ctx.stroke(); ctx.setLineDash([]); }
    const c = state.curve;
    ctx.strokeStyle = cssVar('--accent'); ctx.lineWidth = 2; ctx.beginPath();
    let pen = false;
    c.scores.forEach((r, i) => { const z = c.zFrom + i * c.step; if (!Number.isFinite(r) || r < -0.2) { pen = false; return; } pen ? ctx.lineTo(X(z), Y(r)) : ctx.moveTo(X(z), Y(r)); pen = true; });
    ctx.stroke();
    ctx.fillStyle = cssVar('--left'); ctx.beginPath();
    const idx = Math.round((state.Z - 1000) / 0.5), rz = c.scores[idx];
    if (Number.isFinite(rz)) { ctx.arc(X(state.Z), Y(Math.max(-0.2, rz)), 5, 0, 7); ctx.fill(); }
    $('#md-read').innerHTML = `Spot X ${state.X.toFixed(0)}  Y ${state.Y.toFixed(0)}<br>At Z ${state.Z.toFixed(1)} m: r = <b>${Number.isFinite(rz) ? rz.toFixed(2) : '–'}</b><br>` +
      `Best: Z <b>${c.z.toFixed(1)} m</b>, r = ${c.r.toFixed(2)}<br>Reference terrain model: ${Number.isFinite(ref) ? ref.toFixed(1) + ' m' : '–'}`;
  }

  function redraw() {
    $('#md-zo').textContent = state.Z.toFixed(1) + ' m';
    drawPatch($('#md-l'), L); drawPatch($('#md-r'), R); drawCurve();
  }

  map.addEventListener('click', e => {
    const r = map.getBoundingClientRect(), t = map._t;
    const X = area.xmin + (e.clientX - r.left - t.ox) / t.s, Y = area.ymax - (e.clientY - r.top - t.oy) / t.s;
    if (X < area.xmin || X > area.xmax || Y < area.ymin || Y > area.ymax) return;
    state.X = X; state.Y = Y; computeCurve(); drawMap(); redraw();
  });
  $('#md-z').addEventListener('input', e => { state.Z = Number(e.target.value); redraw(); });
  $('#md-best').addEventListener('click', () => { state.Z = Math.round(state.curve.z * 2) / 2; $('#md-z').value = state.Z; redraw(); });
  root.querySelectorAll('#md-w .btn').forEach(b => b.addEventListener('click', () => {
    state.half = Number(b.dataset.h);
    root.querySelectorAll('#md-w .btn').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    computeCurve(); redraw();
  }));
  const ro = new ResizeObserver(drawMap); ro.observe(map);
  computeCurve(); drawMap(); redraw();
  return () => ro.disconnect();
}
