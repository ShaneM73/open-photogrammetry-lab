// Demo: building the stereo model 157/158 in two steps.
// Step 1, relative orientation: the left camera is fixed; five parameters
// of the right camera are adjusted until each pair of rays intersects.
// Step 2, absolute orientation: the finished model is scaled, rotated and
// shifted onto the ground control (7-parameter similarity).
import { createViewer, toThree, line, label, cssVar } from './three-util.js';
import { loadSample, terrainMesh } from './terrain.js';
import { rotationMatrix } from '../core/orientation.js';
import { relativeOrientation, similarity3D, gaussNewton } from '../core/models.js';

const DISPLAY = 13; // model millimetres -> display metres (about the model scale)

export async function mount(root) {
  root.innerHTML = `
  <div class="demo-head"><h3>Building the stereo model 157 / 158</h3><span class="hint">Move the sliders, then let the computer solve</span></div>
  <div class="demo-body wide-side">
    <div class="stage" id="sm-stage" style="min-height:560px"><span class="stage-label" id="sm-lbl">Loading…</span></div>
    <div class="side">
      <div class="seg" id="sm-steps"><button class="btn" data-s="1" aria-pressed="true">1 · Relative</button><button class="btn" data-s="2" aria-pressed="false">2 · Absolute</button></div>
      <div id="sm-rel">
        ${[['by', 'b<sub>y</sub> (mm)', -4, 4, 0.05], ['bz', 'b<sub>z</sub> (mm)', -4, 4, 0.05], ['om', 'ω (°)', -3, 3, 0.02], ['ph', 'φ (°)', -3, 3, 0.02], ['ka', 'κ (°)', -3, 3, 0.02]]
          .map(([id, l, a, b, st]) => `<div class="ctrl"><label for="sm-${id}"><span>${l}</span> <output id="sm-${id}o"></output></label><input type="range" id="sm-${id}" min="${a}" max="${b}" step="${st}" value="0"></div>`).join('')}
        <div class="seg" style="margin-top:8px"><button class="btn primary" id="sm-solve">Solve</button><button class="btn" id="sm-zero">Reset</button></div>
      </div>
      <div id="sm-abs" hidden>
        <div class="ctrl"><label for="sm-t">Model → ground <output id="sm-to">0 %</output></label><input type="range" id="sm-t" min="0" max="1" step="0.01" value="0"></div>
        <button class="btn primary" id="sm-play">Fit to the control points</button>
      </div>
      <div class="readout" id="sm-read"></div>
    </div>
  </div>
  <p class="caption">The six points are control points 15701–15803 as measured in both photos. In step 1, red bars show how far each pair of rays misses (drawn 20 times longer); the list gives the y-parallax in the photo. In step 2, yellow pins are the surveyed ground coordinates.</p>`;

  const $ = s => root.querySelector(s);
  const s = await loadSample();
  const [L, Rr] = [s.abs[157], s.abs[158]];
  const f = L.focal;
  const pairs = L.points.filter(p => Rr.points.some(q => q.id === p.id)).map(p => {
    const q = Rr.points.find(r => r.id === p.id);
    return { id: p.id, x1: p.x, y1: p.y, x2: q.x, y2: q.y };
  });
  const bx = pairs.reduce((t, q) => t + q.x1 - q.x2, 0) / pairs.length;
  const solved = relativeOrientation(pairs, f, bx);
  const aoFinal = similarity3D(solved.model.map(m => ({ id: m.id, model: m, ground: s.control.find(c => c.id === m.id) })));

  const v = createViewer($('#sm-stage'), { near: 5, far: 60000 });
  const origin = s.origin;
  const crop = { xmin: L.X0 - 2400, xmax: L.X0 + 2400, ymin: L.Y0 - 2000, ymax: Rr.Y0 + 2000 };
  const terrain = await terrainMesh(s, origin, crop);
  terrain.material.transparent = true;
  v.scene.add(terrain);
  const pins = new THREE.Group();
  v.scene.add(pins);
  for (const pr of pairs) {
    const c = s.control.find(q => q.id === pr.id);
    const pin = new THREE.Mesh(new THREE.ConeGeometry(22, 70, 10), new THREE.MeshBasicMaterial({ color: 0xffd166 }));
    pin.rotation.x = Math.PI; pin.position.copy(toThree(c.X, c.Y, c.Z, origin)).add(new THREE.Vector3(0, 35, 0));
    pins.add(pin);
    const t = label(String(c.id), '#ffffff', 45); t.position.copy(pin.position).add(new THREE.Vector3(0, 70, 0)); pins.add(t);
  }

  // The model group is drawn in raw model coordinates; its matrix places it.
  const model = new THREE.Group();
  model.matrixAutoUpdate = false;
  v.scene.add(model);
  const left = cssVar('--left'), right = cssVar('--right');
  const axis = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1); // (X,Y,Z) -> three (X, Z, -Y)

  // Display pose of the free model (step 1): enlarged, floating above the terrain centre.
  const centre = toThree(L.X0, (L.Y0 + Rr.Y0) / 2, 1200, origin);
  const mDisplay = new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().makeTranslation(centre.x - bx * DISPLAY / 2, 2900, centre.z), axis).multiply(new THREE.Matrix4().makeScale(DISPLAY, DISPLAY, DISPLAY));

  function groundMatrix(ao) {
    const R = ao.R, sc = ao.s;
    const M = new THREE.Matrix4().set(
      sc * R[0][0], sc * R[0][1], sc * R[0][2], ao.T[0] - origin.X,
      sc * R[1][0], sc * R[1][1], sc * R[1][2], ao.T[1] - origin.Y,
      sc * R[2][0], sc * R[2][1], sc * R[2][2], ao.T[2] - origin.Z,
      0, 0, 0, 1);
    return new THREE.Matrix4().multiplyMatrices(axis, M);
  }
  const mGround = groundMatrix(aoFinal);

  const state = { step: 1, p: [0, 0, 0, 0, 0], t: 0 };
  let anim = 0;

  function evaluate(p) {
    const R = rotationMatrix(p[2], p[3], p[4]);
    const b = [bx, p[0], p[1]];
    return pairs.map(q => {
      const d1 = [q.x1, q.y1, -f];
      const d2 = [0, 1, 2].map(i => R[i][0] * q.x2 + R[i][1] * q.y2 - R[i][2] * f);
      const dot = (u, w) => u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
      const w = b.map(x => -x);
      const a = dot(d1, d1), bb = dot(d1, d2), c = dot(d2, d2), d = dot(d1, w), e = dot(d2, w);
      const den = a * c - bb * bb, sp = (bb * e - c * d) / den, tp = (a * e - bb * d) / den;
      const P1 = d1.map(x => x * sp), P2 = b.map((x, i) => x + tp * d2[i]);
      const gap = Math.hypot(P1[0] - P2[0], P1[1] - P2[1], P1[2] - P2[2]);
      // y-parallax: separation of the two rays, scaled back to the photo
      const py = (P2[1] - P1[1]) * f / -P1[2];
      return { id: q.id, P1, P2, b, gap, py };
    });
  }

  function draw() {
    model.children.forEach(o => { o.geometry?.dispose(); o.material?.dispose(); });
    model.clear();
    const p = state.step === 1 ? state.p : solved && [solved.by, solved.bz, solved.omega, solved.phi, solved.kappa];
    const res = evaluate(p);
    const V = a => new THREE.Vector3(a[0], a[1], a[2]);
    const cam = (pos, color) => { const m = new THREE.Mesh(new THREE.SphereGeometry(3, 14, 10), new THREE.MeshBasicMaterial({ color })); m.position.copy(V(pos)); model.add(m); };
    cam([0, 0, 0], left); cam(res[0].b, right);
    model.add(line([V([0, 0, 0]), V(res[0].b)], 0xffffff));
    for (const r of res) {
      model.add(line([V([0, 0, 0]), V(r.P1)], left, { opacity: 0.85 }));
      model.add(line([V(r.b), V(r.P2)], right, { opacity: 0.85 }));
      const mid = r.P1.map((x, i) => (x + r.P2[i]) / 2);
      const dir = r.P2.map((x, i) => (x - r.P1[i]) * 10);
      if (r.gap > 1e-4) {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 1, 8), new THREE.MeshBasicMaterial({ color: 0xff4d4d }));
        const a = V(mid.map((x, i) => x - dir[i])), b = V(mid.map((x, i) => x + dir[i]));
        bar.position.copy(a.clone().add(b).multiplyScalar(0.5));
        bar.scale.set(1, a.distanceTo(b) || 0.01, 1);
        bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        model.add(bar);
      }
      const dot = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      dot.position.copy(V(mid)); model.add(dot);
    }
    // place the model
    const m = new THREE.Matrix4();
    if (state.step === 1) m.copy(mDisplay);
    else {
      const p0 = new THREE.Vector3(), q0 = new THREE.Quaternion(), s0 = new THREE.Vector3();
      const p1 = new THREE.Vector3(), q1 = new THREE.Quaternion(), s1 = new THREE.Vector3();
      mDisplay.decompose(p0, q0, s0); mGround.decompose(p1, q1, s1);
      const t = state.t;
      m.compose(p0.lerp(p1, t), q0.slerp(q1, t), s0.lerp(s1, t));
    }
    model.matrix.copy(m); model.matrixWorldNeedsUpdate = true;
    terrain.material.opacity = state.step === 1 ? 0.35 : 0.35 + 0.65 * state.t;
    pins.visible = state.step === 2;

    if (state.step === 1) {
      const rms = Math.sqrt(res.reduce((t, r) => t + r.py * r.py, 0) / res.length);
      $('#sm-read').innerHTML = `y-parallax in the photo (µm)<br>` +
        res.map(r => `${r.id}  <b>${(r.py * 1000).toFixed(0).padStart(6)}</b>`).join('<br>') +
        `<br>RMS <b>${(rms * 1000).toFixed(0)} µm</b>${rms < 0.05 ? ' <span class="pill good">rays intersect</span>' : ''}`;
      ['by', 'bz'].forEach((k, i) => $(`#sm-${k}o`).textContent = state.p[i].toFixed(2));
      ['om', 'ph', 'ka'].forEach((k, i) => $(`#sm-${k}o`).textContent = (state.p[i + 2] * 180 / Math.PI).toFixed(2));
      $('#sm-lbl').textContent = 'model space (free scale and position)';
    } else {
      $('#sm-to').textContent = Math.round(state.t * 100) + ' %';
      $('#sm-read').innerHTML = `Scale <b>${aoFinal.s.toFixed(3)}</b> m per model mm<br>` +
        `Rotation ω ${(aoFinal.angles.omega * 180 / Math.PI).toFixed(3)}° φ ${(aoFinal.angles.phi * 180 / Math.PI).toFixed(3)}° κ ${(aoFinal.angles.kappa * 180 / Math.PI).toFixed(2)}°<br>` +
        `Residuals at control (m)<br>` + aoFinal.residuals.map(r => `${r.id} ${r.vX.toFixed(2).padStart(6)} ${r.vY.toFixed(2).padStart(6)} ${r.vZ.toFixed(2).padStart(6)}`).join('<br>') +
        `<br>σ₀ <b>${aoFinal.sigma0.toFixed(2)} m</b>`;
      $('#sm-lbl').textContent = state.t < 1 ? 'moving the model onto the control' : 'model in the ground system';
    }
  }

  const sliders = ['by', 'bz', 'om', 'ph', 'ka'];
  const readSliders = () => {
    state.p = sliders.map((k, i) => Number($(`#sm-${k}`).value) * (i < 2 ? 1 : Math.PI / 180));
    draw();
  };
  const writeSliders = p => sliders.forEach((k, i) => ($(`#sm-${k}`).value = i < 2 ? p[i] : p[i] * 180 / Math.PI));
  sliders.forEach(k => $(`#sm-${k}`).addEventListener('input', readSliders));

  $('#sm-solve').addEventListener('click', () => {
    clearInterval(anim);
    // Gauss-Newton from the current slider position, shown one iteration at a time
    const cop = p => evaluate(p).map(r => r.py);
    const g = gaussNewton(cop, state.p, [1e-6, 1e-6, 1e-8, 1e-8, 1e-8]);
    let i = 0;
    anim = setInterval(() => {
      i++;
      if (i >= g.history.length) return clearInterval(anim);
      state.p = g.history[i].p; writeSliders(state.p); draw();
    }, 600);
  });
  $('#sm-zero').addEventListener('click', () => { clearInterval(anim); state.p = [0, 0, 0, 0, 0]; writeSliders(state.p); draw(); });
  $('#sm-t').addEventListener('input', e => { state.t = Number(e.target.value); draw(); });
  $('#sm-play').addEventListener('click', () => {
    clearInterval(anim);
    const t0 = performance.now(), from = state.t >= 1 ? 0 : state.t;
    anim = setInterval(() => {
      state.t = Math.min(1, from + (performance.now() - t0) / 2500);
      $('#sm-t').value = state.t; draw();
      if (state.t >= 1) clearInterval(anim);
    }, 30);
  });
  root.querySelectorAll('#sm-steps .btn').forEach(b => b.addEventListener('click', () => {
    clearInterval(anim);
    state.step = Number(b.dataset.s);
    root.querySelectorAll('#sm-steps .btn').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    $('#sm-rel').hidden = state.step !== 1; $('#sm-abs').hidden = state.step !== 2;
    draw();
  }));

  v.camera.position.set(centre.x - 3800, 4200, centre.z + 3600);
  v.controls.target.set(centre.x, 1600, centre.z);
  // start a little off so the rays visibly miss
  state.p = [0.6, -0.8, 0.8 * Math.PI / 180, -0.6 * Math.PI / 180, 0.9 * Math.PI / 180];
  writeSliders(state.p);
  draw();
  return () => { clearInterval(anim); v.dispose(); };
}
