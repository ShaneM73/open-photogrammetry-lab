// Demo: central projection of a small landscape into an aerial camera.
// Left: the 3D situation. Right: the photograph computed with the
// collinearity equations, so students can see scale and relief displacement.
import { createViewer, toThree, line, cssVar } from './three-util.js';
import { rotationMatrix, groundToImage, imageToGround } from '../core/orientation.js';

const HALF = 115; // half the 230 mm film format
const FOCALS = [{ f: 88, name: 'Super wide 88 mm' }, { f: 153, name: 'Wide 153 mm' }, { f: 210, name: 'Normal-angle 210 mm' }, { f: 305, name: 'Narrow 305 mm' }];

// The landscape: flat ground at Z = 0 with a few objects (metres).
const BUILDINGS = [
  { x: -420, y: 260, w: 120, d: 70, h: 18 },
  { x: -180, y: -320, w: 90, d: 90, h: 30 },
  { x: 330, y: 330, w: 160, d: 60, h: 12 },
  { x: 520, y: -180, w: 70, d: 140, h: 24 },
];
const TOWER = { x: 620, y: 520, h: 120 }; // a tall mast near the image corner

export function mount(root) {
  root.innerHTML = `
  <div class="demo-head"><h3>Central projection</h3><span class="hint">Drag to orbit · scroll to zoom</span></div>
  <div class="demo-body wide-side">
    <div class="stage" id="p3-stage"><span class="stage-label" id="p3-lbl"></span></div>
    <div class="side">
      <div class="ctrl"><label for="p3-f">Camera (focal length)</label>
        <div class="seg" id="p3-f">${FOCALS.map((c, i) => `<button class="btn" data-i="${i}" aria-pressed="${i === 1}">${c.f} mm</button>`).join('')}</div></div>
      <div class="ctrl"><label for="p3-h">Flying height above ground <output id="p3-ho"></output></label><input type="range" id="p3-h" min="400" max="4000" step="50" value="1500"></div>
      <div class="ctrl"><label for="p3-om">Tilt ω (roll) <output id="p3-omo"></output></label><input type="range" id="p3-om" min="-12" max="12" step="0.5" value="0"></div>
      <div class="ctrl"><label for="p3-ph">Tilt φ (pitch) <output id="p3-pho"></output></label><input type="range" id="p3-ph" min="-12" max="12" step="0.5" value="0"></div>
      <label class="check"><input type="checkbox" id="p3-rays" checked> Show rays</label>
      <canvas class="mini" id="p3-photo" width="560" height="560" aria-label="The photograph as the camera records it"></canvas>
      <div class="readout" id="p3-read"></div>
    </div>
  </div>
  <p class="caption">The image plane is drawn enlarged by the factor shown in the 3D view, at the same enlarged distance from the projection centre, so every ray still passes through it exactly. The small panel on the right is the positive photograph, computed point by point with the collinearity equations.</p>`;

  const stage = root.querySelector('#p3-stage');
  const v = createViewer(stage, { near: 5, far: 40000 });
  v.camera.position.set(2600, 2200, 2600);
  v.controls.target.set(0, 500, 0);

  const state = { fi: 1, H: 1500, om: 0, ph: 0, rays: true };
  const left = cssVar('--left'), right = cssVar('--right'), accent = cssVar('--accent');

  // Static landscape
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshLambertMaterial({ color: 0x5d6b52 }));
  ground.rotation.x = -Math.PI / 2;
  v.scene.add(ground);
  const grid = new THREE.GridHelper(4000, 40, 0x93a184, 0x7a8870);
  grid.position.y = 0.5;
  v.scene.add(grid);
  for (const b of BUILDINGS) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), new THREE.MeshLambertMaterial({ color: 0xd9d2c3 }));
    m.position.copy(toThree(b.x, b.y, b.h / 2));
    v.scene.add(m);
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(4, 6, TOWER.h, 12), new THREE.MeshLambertMaterial({ color: new THREE.Color(left) }));
  mast.position.copy(toThree(TOWER.x, TOWER.y, TOWER.h / 2));
  v.scene.add(mast);

  const dyn = new THREE.Group();
  v.scene.add(dyn);

  const photo = root.querySelector('#p3-photo');
  const pctx = photo.getContext('2d');

  function eo() {
    const f = FOCALS[state.fi].f;
    const om = state.om * Math.PI / 180, ph = state.ph * Math.PI / 180;
    return { focal: f, X0: 0, Y0: 0, Z0: state.H, omega: om, phi: ph, kappa: 0, R: rotationMatrix(om, ph, 0) };
  }

  function rebuild() {
    dyn.children.forEach(o => { o.geometry?.dispose(); o.material?.dispose(); });
    dyn.clear();
    const e = eo();
    const O = toThree(0, 0, e.Z0);
    // Enlargement so the image plane is visible but stays well above the ground.
    const k = Math.min(1000, (0.45 * state.H) / (e.focal / 1000)) / 1000; // metres per mm
    const toWorld = (x, y) => { // image point (mm) on the enlarged positive plane
      const R = e.R, vcam = [x * k, y * k, -e.focal * k];
      const d = [0, 1, 2].map(i => R[i][0] * vcam[0] + R[i][1] * vcam[1] + R[i][2] * vcam[2]);
      return toThree(e.X0 + d[0], e.Y0 + d[1], e.Z0 + d[2]);
    };
    const corners = [[-HALF, -HALF], [HALF, -HALF], [HALF, HALF], [-HALF, HALF]];
    // camera body
    const body = new THREE.Mesh(new THREE.SphereGeometry(Math.max(12, state.H / 90), 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    body.position.copy(O);
    dyn.add(body);
    // image plane
    const plane = corners.map(([x, y]) => toWorld(x, y));
    const pg = new THREE.BufferGeometry().setFromPoints([plane[0], plane[1], plane[2], plane[0], plane[2], plane[3]]);
    dyn.add(new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color: new THREE.Color(right), transparent: true, opacity: 0.25, side: THREE.DoubleSide })));
    dyn.add(line([...plane, plane[0]], right));
    // footprint on the ground and the bundle edges
    const foot = corners.map(([x, y]) => { const g = imageToGround(e, x, y, 0); return toThree(g.X, g.Y, 1); });
    dyn.add(line([...foot, foot[0]], 0xffd166));
    foot.forEach(p => dyn.add(line([O, p], 0xffd166, { opacity: 0.35 })));
    // rays to the mast and building roofs
    if (state.rays) {
      const pts = [[TOWER.x, TOWER.y, TOWER.h], [TOWER.x, TOWER.y, 0], ...BUILDINGS.map(b => [b.x, b.y, b.h])];
      pts.forEach(([X, Y, Z], i) => {
        const P = toThree(X, Y, Z);
        const img = groundToImage(e, X, Y, Z);
        dyn.add(line([P, O], i < 2 ? left : accent, { opacity: 0.9 }));
        const dot = new THREE.Mesh(new THREE.SphereGeometry(Math.max(4, state.H / 250), 10, 8), new THREE.MeshBasicMaterial({ color: i < 2 ? left : 0xffffff }));
        dot.position.copy(toWorld(img.x, img.y));
        dyn.add(dot);
      });
    }
    root.querySelector('#p3-lbl').textContent = `image plane drawn ×${Math.round(k * 1000)}`;
    drawPhoto(e);
    readout(e, foot);
  }

  function drawPhoto(e) {
    const W = photo.width, s = W / (2 * HALF + 20);
    const P = (x, y) => [W / 2 + x * s, W / 2 - y * s];
    pctx.fillStyle = '#5d6b52';
    pctx.fillRect(0, 0, W, W);
    // ground grid (100 m)
    pctx.strokeStyle = 'rgba(200,215,185,0.35)';
    pctx.lineWidth = 1;
    for (let g = -2000; g <= 2000; g += 100) {
      for (const horiz of [true, false]) {
        pctx.beginPath();
        for (let t = -2000; t <= 2000; t += 50) {
          const q = horiz ? groundToImage(e, t, g, 0) : groundToImage(e, g, t, 0);
          const [px, py] = P(q.x, q.y);
          t === -2000 ? pctx.moveTo(px, py) : pctx.lineTo(px, py);
        }
        pctx.stroke();
      }
    }
    // buildings: base, roof, vertical edges
    for (const b of BUILDINGS) {
      const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => [b.x + sx * b.w / 2, b.y + sy * b.d / 2]);
      const base = c.map(([X, Y]) => P(...Object.values(groundToImage(e, X, Y, 0))));
      const roof = c.map(([X, Y]) => P(...Object.values(groundToImage(e, X, Y, b.h))));
      pctx.fillStyle = '#b9b3a6';
      pctx.beginPath(); base.forEach(([x, y], i) => (i ? pctx.lineTo(x, y) : pctx.moveTo(x, y))); pctx.closePath(); pctx.fill();
      pctx.strokeStyle = '#efe9dc';
      base.forEach((p, i) => { pctx.beginPath(); pctx.moveTo(...p); pctx.lineTo(...roof[i]); pctx.stroke(); });
      pctx.fillStyle = '#e4ddcf';
      pctx.beginPath(); roof.forEach(([x, y], i) => (i ? pctx.lineTo(x, y) : pctx.moveTo(x, y))); pctx.closePath(); pctx.fill();
    }
    // mast: foot to top shows relief displacement
    const t0 = groundToImage(e, TOWER.x, TOWER.y, 0), t1 = groundToImage(e, TOWER.x, TOWER.y, TOWER.h);
    pctx.strokeStyle = left; pctx.lineWidth = 3;
    pctx.beginPath(); pctx.moveTo(...P(t0.x, t0.y)); pctx.lineTo(...P(t1.x, t1.y)); pctx.stroke();
    // principal point and format edge
    pctx.strokeStyle = '#fff'; pctx.lineWidth = 1;
    const [cx, cy] = P(0, 0);
    pctx.beginPath(); pctx.moveTo(cx - 8, cy); pctx.lineTo(cx + 8, cy); pctx.moveTo(cx, cy - 8); pctx.lineTo(cx, cy + 8); pctx.stroke();
    const [ax, ay] = P(-HALF, HALF);
    pctx.fillStyle = '#0f1720';
    pctx.fillRect(0, 0, W, ay); pctx.fillRect(0, W - ay, W, ay); pctx.fillRect(0, 0, ax, W); pctx.fillRect(W - ax, 0, ax, W);
    pctx.strokeRect(ax, ay, 2 * HALF * s, 2 * HALF * s);
  }

  function readout(e, foot) {
    const mb = state.H / (e.focal / 1000);
    const t0 = groundToImage(e, TOWER.x, TOWER.y, 0), t1 = groundToImage(e, TOWER.x, TOWER.y, TOWER.h);
    const d = Math.hypot(t1.x - t0.x, t1.y - t0.y);
    const r = Math.hypot(t1.x, t1.y);
    const side = foot[0].distanceTo(foot[1]) / 1000;
    const inside = Math.abs(t0.x) < HALF && Math.abs(t0.y) < HALF;
    root.querySelector('#p3-read').innerHTML =
      `Image scale  <b>1 : ${Math.round(mb).toLocaleString('en-US')}</b><br>` +
      `Ground cover ≈ <b>${side.toFixed(2)} km</b> per side<br>` +
      `1 mm in photo = <b>${(mb / 1000).toFixed(1)} m</b> on ground<br>` +
      (inside ? `Mast (120 m) leans <b>${d.toFixed(2)} mm</b><br>  r·h/H = ${(r * TOWER.h / state.H).toFixed(2)} mm` : `Mast is outside the photo`);
    root.querySelector('#p3-ho').textContent = `${state.H} m`;
    root.querySelector('#p3-omo').textContent = `${state.om}°`;
    root.querySelector('#p3-pho').textContent = `${state.ph}°`;
  }

  root.querySelectorAll('#p3-f .btn').forEach(b => b.addEventListener('click', () => {
    state.fi = Number(b.dataset.i);
    root.querySelectorAll('#p3-f .btn').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    rebuild();
  }));
  const bind = (id, key) => root.querySelector(id).addEventListener('input', ev => { state[key] = Number(ev.target.value); rebuild(); });
  bind('#p3-h', 'H'); bind('#p3-om', 'om'); bind('#p3-ph', 'ph');
  root.querySelector('#p3-rays').addEventListener('change', ev => { state.rays = ev.target.checked; rebuild(); });
  rebuild();
  return () => v.dispose();
}
