// Demo: interior orientation without a calibration certificate.
// From four fiducials measured in one scan and the scan resolution, build
// a "pseudo" camera definition, assuming the fiducials sit symmetrically on
// two perpendicular axes. Compare it with the calibrated values.
import { DATA } from './three-util.js';
import { parseCMR, parseINN } from '../core/formats.js';
import { fitInterior } from '../core/orientation.js';

export async function mount(root) {
  root.innerHTML = `
  <div class="demo-head"><h3>A camera definition from the photo itself</h3><span class="hint">Photo 157, fiducials as measured in Chapter 2</span></div>
  <div class="demo-body">
    <div style="padding:14px 16px;min-width:0"><div class="table-wrap"><table class="data" id="pc-t"></table></div><div class="readout" id="pc-r" style="margin-top:12px"></div></div>
    <div class="side">
      <div class="ctrl"><label for="pc-dpi">Scan resolution <output id="pc-dpio"></output></label><input type="range" id="pc-dpi" min="290" max="310" step="0.5" value="300"></div>
      <p style="margin:0;font-size:13px;color:var(--ink-2)">The pseudo camera puts the centre midway between opposite fiducials and the axes through them, at right angles. Distances follow from the scan resolution: at 300 dpi one pixel is 25.4 / 300 = 0.0847 mm.</p>
    </div>
  </div>
  <p class="caption">Calibrated: the values from the camera's calibration certificate. Pseudo: derived from this one scan. The last columns show how far apart the two definitions put each fiducial.</p>`;
  const $ = s => root.querySelector(s);
  const [cam, inn] = await Promise.all([fetch(DATA + 'RMK_1523.CMR').then(r => r.text()).then(parseCMR), fetch(DATA + '157.INN').then(r => r.text()).then(parseINN)]);
  const P = Object.fromEntries(inn.measured.map(m => [m.id, [m.col, m.row]]));

  function draw() {
    const dpi = Number($('#pc-dpi').value), p = 25.4 / dpi;
    $('#pc-dpio').textContent = `${dpi} dpi`;
    const c = [0, 1].map(k => (P[1][k] + P[2][k] + P[3][k] + P[4][k]) / 4);
    // x axis through fiducials 3 -> 1, y axis through 2 -> 4, made perpendicular
    let ux = [P[1][0] - P[3][0], P[1][1] - P[3][1]], uy = [P[4][0] - P[2][0], P[4][1] - P[2][1]];
    const nx = Math.hypot(...ux), ny = Math.hypot(...uy);
    ux = ux.map(v => v / nx); uy = uy.map(v => v / ny);
    const ax = Math.atan2(ux[1], ux[0]), ay = Math.atan2(uy[1], uy[0]) - Math.PI / 2, a = (ax + ay) / 2;
    const ex = [Math.cos(a), Math.sin(a)], ey = [-Math.sin(a), Math.cos(a)];
    const pseudo = cam.fiducials.map(f => {
      const d = [P[f.id][0] - c[0], P[f.id][1] - c[1]];
      return { id: f.id, x: (d[0] * ex[0] + d[1] * ex[1]) * p, y: (d[0] * ey[0] + d[1] * ey[1]) * p, cx: f.x, cy: f.y };
    });
    $('#pc-t').innerHTML = `<thead><tr><th>Fiducial</th><th>Calibrated x</th><th>y</th><th>Pseudo x</th><th>y</th><th>Δ µm</th></tr></thead><tbody>` +
      pseudo.map(q => `<tr><td>${q.id}</td><td>${q.cx.toFixed(3)}</td><td>${q.cy.toFixed(3)}</td><td>${q.x.toFixed(3)}</td><td>${q.y.toFixed(3)}</td><td>${(1000 * Math.hypot(q.x - q.cx, q.y - q.cy)).toFixed(0)}</td></tr>`).join('') + '</tbody>';
    // interior orientation with the pseudo camera: perfect fit by construction for the symmetric
    // part; what matters is the scale error it brings in
    const io = fitInterior(pseudo.map(q => ({ id: q.id, x: q.x, y: q.y, col: P[q.id][0], row: P[q.id][1] })), 'affine');
    const scaleErr = (pseudo[0].x - pseudo[2].x) / (cam.fiducials[0].x - cam.fiducials[2].x) - 1;
    $('#pc-r').innerHTML = `Interior orientation with the pseudo camera: σ₀ ${io.dof ? (io.sigma0).toFixed(2) + ' px' : '–'}<br>` +
      `Scale of the pseudo camera relative to the calibration: <b>${(scaleErr * 1e6).toFixed(0)} ppm</b> (${(scaleErr * 100).toFixed(3)} %)<br>` +
      `At 115 mm from the centre that is <b>${(Math.abs(scaleErr) * 115 * 1000).toFixed(0)} µm</b>, or ${(Math.abs(scaleErr) * 115 / 0.0847).toFixed(1)} scan pixels. With the calibrated focal length, a scale error like this acts like a wrong focal length: heights come out too large or too small by the same proportion.`;
  }
  $('#pc-dpi').addEventListener('input', draw);
  draw();
}
