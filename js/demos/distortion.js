// Demo: radial lens distortion. A regular grid on the sensor is displaced
// radially by  dr = k1 r^3 + k2 r^5  (r from the principal point). Barrel
// distortion (k1 < 0) pulls the corners in; pincushion (k1 > 0) pushes them out.
import { cssVar } from './three-util.js';

export function mount(root) {
  root.innerHTML = `
  <div class="demo-head"><h3>Radial lens distortion</h3><span class="hint">Sensor of the soil-erosion camera: 18.3 × 27.5 mm, 9 µm pixels</span></div>
  <div class="demo-body">
    <div class="stage" style="min-height:420px"><canvas id="ds-c" aria-label="Distorted grid on the sensor"></canvas></div>
    <div class="side">
      <div class="ctrl"><label for="ds-k1">k₁ <output id="ds-k1o"></output></label><input type="range" id="ds-k1" min="-4" max="4" step="0.1" value="-1.5"></div>
      <div class="ctrl"><label for="ds-k2">k₂ <output id="ds-k2o"></output></label><input type="range" id="ds-k2" min="-2" max="2" step="0.1" value="0"></div>
      <div class="seg"><button class="btn" data-k="-1.5,0">Barrel</button><button class="btn" data-k="1.5,0">Pincushion</button><button class="btn" data-k="-2.5,1.5">Moustache</button><button class="btn" data-k="0,0">None</button></div>
      <div class="readout" id="ds-r"></div>
    </div>
  </div>
  <p class="caption">Grey: the ideal grid. Coloured: where the lens actually puts it, displacements enlarged 20 times. k₁ and k₂ are given in units of 10⁻⁴ mm⁻² and 10⁻⁷ mm⁻⁴. Calibrated metric cameras have distortions of a few micrometres; simple digital cameras often tens of micrometres, several pixels at the edges.</p>`;
  const $ = s => root.querySelector(s);
  const c = $('#ds-c'), W2 = 9.16, H2 = 13.77, PIX = 0.009, ENL = 20;

  function draw() {
    const k1 = Number($('#ds-k1').value) * 1e-4, k2 = Number($('#ds-k2').value) * 1e-7;
    $('#ds-k1o').textContent = $('#ds-k1').value; $('#ds-k2o').textContent = $('#ds-k2').value;
    const w = c.clientWidth, h = c.clientHeight, dpr = Math.min(devicePixelRatio, 2);
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = cssVar('--canvas'); ctx.fillRect(0, 0, w, h);
    // sensor is portrait: x across (18.3 mm), y up (27.5 mm); draw it rotated to landscape to fit
    const s = Math.min(w / (2 * H2 + 4), h / (2 * W2 + 4));
    const P = (x, y) => [w / 2 + y * s, h / 2 - x * s];
    const dist = (x, y) => { const r2 = x * x + y * y, d = k1 * r2 + k2 * r2 * r2; return [x + ENL * x * d, y + ENL * y * d]; };
    const lines = [];
    for (let x = -W2; x <= W2 + 1e-9; x += W2 / 4) lines.push(Array.from({ length: 41 }, (_, i) => [x, -H2 + (2 * H2 * i) / 40]));
    for (let y = -H2; y <= H2 + 1e-9; y += H2 / 6) lines.push(Array.from({ length: 41 }, (_, i) => [-W2 + (2 * W2 * i) / 40, y]));
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(200,210,220,0.3)';
    for (const L of lines) { ctx.beginPath(); L.forEach(([x, y], i) => (i ? ctx.lineTo(...P(x, y)) : ctx.moveTo(...P(x, y)))); ctx.stroke(); }
    ctx.lineWidth = 1.6; ctx.strokeStyle = cssVar('--right');
    for (const L of lines) { ctx.beginPath(); L.forEach(([x, y], i) => { const q = dist(x, y); i ? ctx.lineTo(...P(...q)) : ctx.moveTo(...P(...q)); }); ctx.stroke(); }
    const rc = Math.hypot(W2, H2), dc = Math.abs(k1 * rc ** 3 + k2 * rc ** 5), re = H2, de = Math.abs(k1 * re ** 3 + k2 * re ** 5);
    $('#ds-r').innerHTML = `At the corner (r = ${rc.toFixed(1)} mm): <b>${(dc * 1000).toFixed(1)} µm</b> = ${(dc / PIX).toFixed(1)} pixels<br>At the edge (r = ${re.toFixed(1)} mm): ${(de * 1000).toFixed(1)} µm = ${(de / PIX).toFixed(1)} pixels`;
  }
  ['#ds-k1', '#ds-k2'].forEach(id => $(id).addEventListener('input', draw));
  root.querySelectorAll('[data-k]').forEach(b => b.addEventListener('click', () => { const [a, bb] = b.dataset.k.split(','); $('#ds-k1').value = a; $('#ds-k2').value = bb; draw(); }));
  const ro = new ResizeObserver(draw); ro.observe(c);
  return () => ro.disconnect();
}
