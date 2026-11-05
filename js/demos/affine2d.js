// Demo: what the six affine parameters of interior orientation do.
// The camera frame (fiducials, principal point, axes) is drawn into the
// scanner's pixel grid; sliders change scale, shear, rotation and shift.
import { cssVar } from './three-util.js';

export function mount(root) {
  root.innerHTML = `
  <div class="demo-head"><h3>The affine transformation, one parameter at a time</h3><span class="hint">Move the sliders</span></div>
  <div class="demo-body">
    <div class="stage" style="min-height:380px"><canvas id="af-c" aria-label="Camera frame drawn over the pixel grid"></canvas></div>
    <div class="side">
      ${[
        ['af-px', 'Pixel size x (µm)', 40, 120, 0.1, 85],
        ['af-py', 'Pixel size y (µm)', 40, 120, 0.1, 85],
        ['af-rot', 'Rotation (°)', -10, 10, 0.01, 0],
        ['af-sh', 'Shear (°)', -10, 10, 0.01, 0],
        ['af-tx', 'Shift a₀ (px)', 1000, 1800, 1, 1400],
        ['af-ty', 'Shift b₀ (px)', 1000, 1800, 1, 1400],
      ].map(([id, l, mi, ma, st, va]) => `<div class="ctrl"><label for="${id}">${l} <output id="${id}-o"></output></label><input type="range" id="${id}" min="${mi}" max="${ma}" step="${st}" value="${va}"></div>`).join('')}
      <button class="btn" id="af-book">Use image 157's values</button>
      <div class="readout" id="af-read"></div>
    </div>
  </div>
  <p class="caption">Grey lines: the scanner's pixel grid (every 200 pixels), with the origin at the bottom-left corner of the scan, columns to the right and rows upward. Coloured: the camera's own coordinate frame defined by the four fiducial marks. The coefficients show how a point (x, y) in millimetres becomes a pixel position (col, row).</p>`;

  const c = root.querySelector('#af-c');
  const ctx = c.getContext('2d');
  const ids = ['af-px', 'af-py', 'af-rot', 'af-sh', 'af-tx', 'af-ty'];
  const val = id => Number(root.querySelector('#' + id).value);
  const fids = [[113, 0], [0, -113], [-113, 0], [0, 113]];

  function coef() {
    const sx = 1000 / val('af-px'), sy = 1000 / val('af-py');
    const r = val('af-rot') * Math.PI / 180, sh = val('af-sh') * Math.PI / 180;
    // x axis: rotated by r. y axis: rotated by r and tilted further by the shear angle.
    return {
      a0: val('af-tx'), a1: sx * Math.cos(r), a2: -sy * Math.sin(r + sh),
      b0: val('af-ty'), b1: sx * Math.sin(r), b2: sy * Math.cos(r + sh),
    };
  }

  function draw() {
    const k = coef();
    const w = c.clientWidth, h = c.clientHeight, dpr = Math.min(devicePixelRatio, 2);
    c.width = w * dpr; c.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = cssVar('--canvas'); ctx.fillRect(0, 0, w, h);
    const S = Math.min(w, h) / 3200, ox = (w - 2848 * S) / 2, oy = (h - 2834 * S) / 2;
    const P = (col, row) => [ox + col * S, oy + (2834 - row) * S]; // row counts up from the bottom
    ctx.strokeStyle = 'rgba(200,210,220,0.18)'; ctx.lineWidth = 1;
    for (let i = 0; i <= 2848; i += 200) { ctx.beginPath(); ctx.moveTo(...P(i, 0)); ctx.lineTo(...P(i, 2834)); ctx.stroke(); }
    for (let i = 0; i <= 2834; i += 200) { ctx.beginPath(); ctx.moveTo(...P(0, i)); ctx.lineTo(...P(2848, i)); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(200,210,220,0.5)'; ctx.strokeRect(...P(0, 0), 2848 * S, 2834 * S);
    const T = (x, y) => P(k.a0 + k.a1 * x + k.a2 * y, k.b0 + k.b1 * x + k.b2 * y);
    // camera format outline
    ctx.strokeStyle = cssVar('--right'); ctx.lineWidth = 2; ctx.beginPath();
    [[-115, -115], [115, -115], [115, 115], [-115, 115], [-115, -115]].forEach(([x, y], i) => (i ? ctx.lineTo(...T(x, y)) : ctx.moveTo(...T(x, y))));
    ctx.stroke();
    // axes
    const arrow = (x, y, col, txt) => {
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(...T(0, 0)); ctx.lineTo(...T(x, y)); ctx.stroke();
      const [px, py] = T(x * 1.12, y * 1.12); ctx.font = '600 13px JetBrains Mono, monospace'; ctx.fillText(txt, px - 4, py + 4);
    };
    arrow(90, 0, cssVar('--left'), 'x'); arrow(0, 90, cssVar('--left'), 'y');
    fids.forEach(([x, y], i) => {
      const [px, py] = T(x, y);
      ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(px, py, 5, 0, 7); ctx.fill();
      ctx.font = '12px JetBrains Mono, monospace'; ctx.fillText(String(i + 1), px + 8, py - 8);
    });
    ids.forEach(id => root.querySelector(`#${id}-o`).textContent = val(id));
    root.querySelector('#af-read').innerHTML =
      `col = <b>${k.a0.toFixed(1)}</b> + <b>${k.a1.toFixed(3)}</b>·x + <b>${k.a2.toFixed(3)}</b>·y<br>` +
      `row = <b>${k.b0.toFixed(1)}</b> + <b>${k.b1.toFixed(3)}</b>·x + <b>${k.b2.toFixed(3)}</b>·y`;
  }

  root.querySelector('#af-book').addEventListener('click', () => {
    // From the interior orientation of image 157 (file 157.INN), rounded.
    const set = { 'af-px': 84.6, 'af-py': 84.9, 'af-rot': 0.22, 'af-sh': 0.02, 'af-tx': 1395, 'af-ty': 1375 };
    Object.entries(set).forEach(([id, v]) => (root.querySelector('#' + id).value = v));
    draw();
  });
  ids.forEach(id => root.querySelector('#' + id).addEventListener('input', draw));
  const ro = new ResizeObserver(draw); ro.observe(c);
  return () => ro.disconnect();
}
