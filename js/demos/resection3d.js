// Demo: space resection of photo 157, solved step by step.
// The camera starts from rough approximate values and moves with each
// Gauss-Newton iteration; the photo panel shows measured image points
// (yellow) against the points projected from the current camera (cyan).
import { createViewer, toThree, line, label, cssVar } from './three-util.js';
import { loadSample, terrainMesh } from './terrain.js';
import { rotationMatrix, groundToImage } from '../core/orientation.js';
import { resection } from '../core/models.js';

export async function mount(root) {
  root.innerHTML = `
  <div class="demo-head"><h3>Space resection of photo 157</h3><span class="hint">Step through the iterations · drag to orbit</span></div>
  <div class="demo-body wide-side">
    <div class="stage" id="rs-stage" style="min-height:540px"><span class="stage-label" id="rs-lbl">Loading…</span></div>
    <div class="side">
      <div class="seg"><button class="btn primary" id="rs-step">Next iteration</button><button class="btn" id="rs-run">Run to the end</button><button class="btn" id="rs-reset">Start again</button></div>
      <div class="ctrl"><label for="rs-dx">Start position off by <output id="rs-dxo">0 m</output></label><input type="range" id="rs-dx" min="0" max="1500" step="50" value="0"></div>
      <div class="ctrl"><label for="rs-dk">Start κ off by <output id="rs-dko">0°</output></label><input type="range" id="rs-dk" min="0" max="60" step="5" value="0"></div>
      <div class="ctrl"><label>Control points used</label><div class="seg" id="rs-pts"></div></div>
      <canvas class="mini" id="rs-photo" width="520" height="520" aria-label="Photo 157: measured and projected control points"></canvas>
      <div class="readout" id="rs-read"></div>
    </div>
  </div>
  <p class="caption">Yellow: control points as measured in photo 157. Cyan: where the current camera estimate projects them; the lines between are the residuals, drawn 20 times longer when they are small. Each iteration solves a linearised version of the collinearity equations and moves the camera.</p>`;

  const $ = s => root.querySelector(s);
  const s = await loadSample();
  const ref = s.abs[157];
  const v = createViewer($('#rs-stage'), { near: 10, far: 60000 });
  const origin = s.origin;
  const P = (X, Y, Z) => toThree(X, Y, Z, origin);
  const crop = { xmin: ref.X0 - 2600, xmax: ref.X0 + 2600, ymin: ref.Y0 - 2600, ymax: ref.Y0 + 2600 };
  v.scene.add(await terrainMesh(s, origin, crop));
  const yellow = '#ffd166', cyan = cssVar('--right');
  const used = new Set(ref.points.map(p => p.id));
  $('#rs-pts').innerHTML = ref.points.map(p => `<button class="btn" data-id="${p.id}" aria-pressed="true">${p.id}</button>`).join('');

  for (const p of ref.points) {
    const t = label(String(p.id), '#ffffff', 50);
    t.position.copy(P(p.X, p.Y, p.Z)).add(new THREE.Vector3(0, 80, 0));
    v.scene.add(t);
  }
  const dyn = new THREE.Group();
  v.scene.add(dyn);
  const photo = $('#rs-photo'), ctx = photo.getContext('2d');
  let sol = null, step = 0, timer = 0;

  function solve() {
    const pts = ref.points.filter(p => used.has(p.id));
    const dx = Number($('#rs-dx').value), dk = Number($('#rs-dk').value) * Math.PI / 180;
    $('#rs-dxo').textContent = dx + ' m'; $('#rs-dko').textContent = $('#rs-dk').value + '°';
    try {
      // Run the normal resection, but from a deliberately disturbed start.
      sol = resection(pts, ref.focal);
      if (dx || dk) {
        const start = sol.initial.slice();
        start[0] += dx * 0.8; start[1] -= dx * 0.6; start[5] += dk;
        sol = resection(pts, ref.focal, start);
      }
    } catch (e) { sol = { error: e.message }; }
    step = 0;
    draw();
  }

  function cameraAt(i) {
    const p = sol.history[Math.min(i, sol.history.length - 1)].p;
    return { focal: ref.focal, X0: p[0], Y0: p[1], Z0: p[2], omega: p[3], phi: p[4], kappa: p[5], R: rotationMatrix(p[3], p[4], p[5]) };
  }

  function draw() {
    dyn.children.forEach(o => { o.geometry?.dispose(); o.material?.dispose(); });
    dyn.clear();
    if (!sol || sol.error) {
      $('#rs-read').textContent = sol?.error || '';
      ctx.fillStyle = '#0f1720'; ctx.fillRect(0, 0, photo.width, photo.height);
      return;
    }
    const cam = cameraAt(step), last = step >= sol.history.length - 1;
    const O = P(cam.X0, cam.Y0, cam.Z0);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(45, 16, 12), new THREE.MeshBasicMaterial({ color: last ? cyan : 0xffffff }));
    ball.position.copy(O); dyn.add(ball);
    // ghost of the reference camera
    const g = new THREE.Mesh(new THREE.SphereGeometry(30, 12, 8), new THREE.MeshBasicMaterial({ color: yellow, wireframe: true }));
    g.position.copy(P(ref.X0, ref.Y0, ref.Z0)); dyn.add(g);
    // camera axis and footprint frame
    const k = 500 / ref.focal;
    const toW = (x, y) => { const d = [0, 1, 2].map(i => cam.R[i][0] * x * k + cam.R[i][1] * y * k - cam.R[i][2] * ref.focal * k); return P(cam.X0 + d[0], cam.Y0 + d[1], cam.Z0 + d[2]); };
    const fr = [[-115, -115], [115, -115], [115, 115], [-115, 115]].map(([x, y]) => toW(x, y));
    dyn.add(line([...fr, fr[0]], cyan));
    fr.forEach(q => dyn.add(line([O, q], cyan, { opacity: 0.4 })));
    // rays from the control points to the camera
    for (const p of ref.points) {
      if (!used.has(p.id)) continue;
      dyn.add(line([P(p.X, p.Y, p.Z), O], yellow, { opacity: 0.7 }));
    }
    $('#rs-lbl').textContent = `iteration ${step} of ${sol.history.length - 1}`;
    // photo panel
    const W = photo.width, sc = W / 250, C = (x, y) => [W / 2 + x * sc, W / 2 - y * sc];
    ctx.fillStyle = '#0f1720'; ctx.fillRect(0, 0, W, W);
    ctx.strokeStyle = 'rgba(200,210,220,.35)'; ctx.strokeRect(...C(-115, 115), 230 * sc, 230 * sc);
    let ss = 0, n = 0;
    for (const p of ref.points) {
      if (!used.has(p.id)) continue;
      const q = groundToImage(cam, p.X, p.Y, p.Z);
      const vx = q.x - p.x, vy = q.y - p.y; ss += vx * vx + vy * vy; n++;
      const big = Math.hypot(vx, vy) < 2 ? 20 : 1;
      const [ax, ay] = C(p.x, p.y), [bx, by] = C(p.x + vx * big, p.y + vy * big);
      ctx.strokeStyle = '#ef6f5c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.fillStyle = yellow; ctx.beginPath(); ctx.arc(ax, ay, 5, 0, 7); ctx.fill();
      ctx.strokeStyle = cyan; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(bx, by, 7, 0, 7); ctx.stroke();
      ctx.fillStyle = '#d6dde3'; ctx.font = '12px JetBrains Mono, monospace'; ctx.fillText(String(p.id), ax + 8, ay - 8);
    }
    const rms = Math.sqrt(ss / Math.max(1, n));
    const deg = r => (r * 180 / Math.PI).toFixed(4);
    $('#rs-read').innerHTML =
      `Iteration <b>${step}</b> / ${sol.history.length - 1}<br>` +
      `X₀ ${cam.X0.toFixed(2)}<br>Y₀ ${cam.Y0.toFixed(2)}<br>Z₀ ${cam.Z0.toFixed(2)}<br>` +
      `ω ${deg(cam.omega)}°  φ ${deg(cam.phi)}°<br>κ ${deg(cam.kappa)}°<br>` +
      `RMS residual <b>${rms >= 1 ? rms.toFixed(1) + ' mm' : (rms * 1000).toFixed(0) + ' µm'}</b>` +
      (last ? `<br>Redundancy ${sol.dof}${sol.dof > 0 ? `, σ₀ ${(sol.sigma0 * 1000).toFixed(0)} µm` : ''}<br>Distance to reference camera ${Math.hypot(cam.X0 - ref.X0, cam.Y0 - ref.Y0, cam.Z0 - ref.Z0).toFixed(2)} m` : '');
  }

  $('#rs-step').addEventListener('click', () => { if (sol && !sol.error && step < sol.history.length - 1) { step++; draw(); } });
  $('#rs-run').addEventListener('click', () => {
    clearInterval(timer);
    timer = setInterval(() => { if (!sol || sol.error || step >= sol.history.length - 1) return clearInterval(timer); step++; draw(); }, 700);
  });
  $('#rs-reset').addEventListener('click', () => { clearInterval(timer); step = 0; draw(); });
  $('#rs-dx').addEventListener('input', solve);
  $('#rs-dk').addEventListener('input', solve);
  $('#rs-pts').querySelectorAll('.btn').forEach(b => b.addEventListener('click', () => {
    const id = Number(b.dataset.id);
    used.has(id) ? used.delete(id) : used.add(id);
    b.setAttribute('aria-pressed', String(used.has(id)));
    solve();
  }));
  v.camera.position.copy(P(ref.X0 - 4200, ref.Y0 - 3600, ref.Z0 + 900));
  v.controls.target.copy(P(ref.X0, ref.Y0, 1700));
  solve();
  return () => { clearInterval(timer); v.dispose(); };
}

