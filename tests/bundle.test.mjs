// Bundle block adjustment on a simulated block with known answers:
// 3 strips x 5 photos, tie points on a grid, 6 control points, image noise.
// Run:  node tests/bundle.test.mjs
import { rotationMatrix, groundToImage } from '../js/core/orientation.js';
import { block2D, bundleAdjust } from '../js/core/bundle.js';

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); if (!ok) failures++; };
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

const f = 152.91, H = 2000;
const truth = {};
for (let s = 0; s < 3; s++) for (let i = 0; i < 5; i++) {
  const id = `${s}${i}`;
  const e = { focal: f, X0: i * 1100, Y0: s * 2200, Z0: H + 30 * gauss(), omega: 0.01 * gauss(), phi: 0.01 * gauss(), kappa: Math.PI / 2 + 0.01 * gauss() };
  truth[id] = { ...e, R: rotationMatrix(e.omega, e.phi, e.kappa) };
}
const ground = [];
for (let x = -1200; x <= 5600; x += 400) for (let y = -1200; y <= 5600; y += 400) ground.push({ id: `p${ground.length}`, X: x + 50 * gauss(), Y: y + 50 * gauss(), Z: 150 * rand() });
const control = new Map();
for (const [x, y] of [[-800, -800], [5200, -800], [-800, 5200], [5200, 5200], [2200, -800], [2200, 5200]]) {
  const g = ground.reduce((b, p) => (Math.hypot(p.X - x, p.Y - y) < Math.hypot(b.X - x, b.Y - y) ? p : b));
  control.set(g.id, g);
}
const obs = [];
for (const [id, e] of Object.entries(truth)) for (const p of ground) {
  const q = groundToImage(e, p.X, p.Y, p.Z);
  if (Math.abs(q.x) < 110 && Math.abs(q.y) < 110) obs.push({ photo: id, point: p.id, x: q.x + 0.005 * gauss(), y: q.y + 0.005 * gauss() });
}
check('simulation: every photo sees enough points', Object.keys(truth).every(id => obs.filter(o => o.photo === id).length >= 20), `${obs.length} observations`);

const b2 = block2D(Object.keys(truth), obs, control, f);
const maxPos = eos => Math.max(...Object.keys(truth).map(id => Math.hypot(eos[id].X0 - truth[id].X0, eos[id].Y0 - truth[id].Y0, eos[id].Z0 - truth[id].Z0)));
check('2D block gives usable approximations', maxPos(b2.eo) < 150, `largest position error ${maxPos(b2.eo).toFixed(1)} m`);

const t0 = Date.now();
const r = bundleAdjust({ photos: b2.eo, points: b2.points, control, obs, focal: f }, { maxIter: 10 });
check('bundle converges to the image noise', Math.abs(r.sigma0 - 0.005) < 0.0015, `σ0 ${(r.sigma0 * 1000).toFixed(2)} µm (noise 5 µm), ${r.history.length - 1} iterations, ${Date.now() - t0} ms`);
check('bundle recovers the camera positions', maxPos(r.photos) < 1.0, `largest error ${maxPos(r.photos).toFixed(3)} m`);
const pe = Math.max(...ground.filter(p => r.points[p.id]).map(p => Math.hypot(r.points[p.id].X - p.X, r.points[p.id].Y - p.Y, r.points[p.id].Z - p.Z)));
check('bundle recovers the tie points', pe < 1.5, `largest error ${pe.toFixed(3)} m`);

// a blunder must show up as the largest residual
const bad = obs.slice();
bad[100] = { ...bad[100], x: bad[100].x + 0.3 };
const rb = bundleAdjust({ photos: b2.eo, points: b2.points, control, obs: bad, focal: f }, { maxIter: 10 });
const worst = rb.residuals.reduce((m, o) => (Math.hypot(o.vx, o.vy) > Math.hypot(m.vx, m.vy) ? o : m));
check('a 0.3 mm blunder has the largest residual', worst.photo === bad[100].photo && worst.point === bad[100].point, `|v| ${(Math.hypot(worst.vx, worst.vy) * 1000).toFixed(0)} µm`);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
