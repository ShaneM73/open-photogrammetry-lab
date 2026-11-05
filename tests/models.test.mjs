// Checks resection, intersection, relative and absolute orientation
// against the reference orientations of the sample pair.
// Run:  node tests/models.test.mjs [data_dir]   (default: data/sample)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseABS, parseControl } from '../js/core/formats.js';
import { rotationMatrix, groundToImage } from '../js/core/orientation.js';
import { resection, intersect, relativeOrientation, similarity3D, exteriorFromModel, anglesFromMatrix } from '../js/core/models.js';

const dir = process.argv[2] || 'data/sample';
const read = f => readFileSync(join(dir, f), 'utf8');
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); if (!ok) failures++; };
const deg = r => (r * 180) / Math.PI;

// rotation angles round trip
{
  const a = anglesFromMatrix(rotationMatrix(0.03, -0.02, 1.5));
  check('angles from rotation matrix round trip', Math.abs(a.omega - 0.03) + Math.abs(a.phi + 0.02) + Math.abs(a.kappa - 1.5) < 1e-12);
}

const ref = { 157: parseABS(read('157.ABS')), 158: parseABS(read('158.ABS')) };
const control = parseControl(read('CONTROL.DAT'));
const f = ref[157].focal;

// 1. space resection reproduces each .ABS
for (const id of ['157', '158']) {
  const r = resection(ref[id].points, f);
  const dPos = Math.hypot(r.X0 - ref[id].X0, r.Y0 - ref[id].Y0, r.Z0 - ref[id].Z0);
  const dAng = Math.max(Math.abs(r.omega - ref[id].omega), Math.abs(r.phi - ref[id].phi), Math.abs(r.kappa - ref[id].kappa));
  check(`${id}: resection matches .ABS`, dPos < 0.5 && dAng < 1e-4,
    `Δpos ${dPos.toFixed(3)} m, Δangle ${deg(dAng).toFixed(5)}°, σ0 ${(r.sigma0 * 1000).toFixed(0)} µm, ${r.iterations} iterations`);
}

// 2. intersection of the common control points with the reference orientations
const common = ref[157].points.filter(p => ref[158].points.some(q => q.id === p.id));
check('six control points are common to both photos', common.length === 6, common.map(p => p.id).join(' '));
const eo = { 157: { ...ref[157], R: rotationMatrix(ref[157].omega, ref[157].phi, ref[157].kappa) }, 158: { ...ref[158], R: rotationMatrix(ref[158].omega, ref[158].phi, ref[158].kappa) } };
{
  const errs = common.map(p => {
    const q = ref[158].points.find(r => r.id === p.id);
    const P = intersect([{ eo: eo[157], x: p.x, y: p.y }, { eo: eo[158], x: q.x, y: q.y }]);
    return Math.hypot(P.X - p.X, P.Y - p.Y, P.Z - p.Z);
  });
  // The reference image residuals reach ~0.12 mm. At 1:12 900 with B/H ~ 0.5, a parallax
  // error of that size moves heights by about 0.12 * 12.9 / 0.49 ~ 3 m, so allow 2-3 sigma.
  check('intersection recovers control points within the expected precision', Math.max(...errs) < 8, `max 3D error ${Math.max(...errs).toFixed(2)} m`);
}

// 3. a synthetic point projected into both photos is recovered exactly
{
  const G = { X: 1138600, Y: 970800, Z: 1180 };
  const a = groundToImage(eo[157], G.X, G.Y, G.Z), b = groundToImage(eo[158], G.X, G.Y, G.Z);
  const P = intersect([{ eo: eo[157], ...a }, { eo: eo[158], ...b }]);
  check('intersection of error-free rays is exact', Math.hypot(P.X - G.X, P.Y - G.Y, P.Z - G.Z) < 1e-4 && P.gap < 1e-4);
}

// 4. relative + absolute orientation from the six common points
{
  const pairs = common.map(p => { const q = ref[158].points.find(r => r.id === p.id); return { id: p.id, x1: p.x, y1: p.y, x2: q.x, y2: q.y }; });
  const ro = relativeOrientation(pairs, f);
  check('relative orientation converges', ro.iterations < 20, `σ0 (y-parallax) ${(ro.sigma0 * 1000).toFixed(1)} µm, ${ro.iterations} iterations`);
  const ao = similarity3D(ro.model.map(m => ({ id: m.id, model: m, ground: control.find(c => c.id === m.id) })));
  check('absolute orientation fits the control', ao.sigma0 < 2, `σ0 ${ao.sigma0.toFixed(2)} m, scale ${ao.s.toFixed(3)}`);
  const [e1, e2] = exteriorFromModel(ro, ao);
  const d = (e, r) => Math.hypot(e.X0 - r.X0, e.Y0 - r.Y0, e.Z0 - r.Z0);
  check('model-derived camera positions agree with .ABS', d(e1, ref[157]) < 10 && d(e2, ref[158]) < 10,
    `157: ${d(e1, ref[157]).toFixed(2)} m, 158: ${d(e2, ref[158]).toFixed(2)} m`);
  const dk = Math.max(Math.abs(e1.kappa - ref[157].kappa), Math.abs(e2.kappa - ref[158].kappa));
  check('model-derived kappa agrees with .ABS', dk < 0.002, `max Δκ ${deg(dk).toFixed(4)}°`);
}

// 5. similarity transform recovers a known transformation exactly
{
  const R = rotationMatrix(0.1, -0.2, 0.7), s = 2.5, T = [100, -50, 20];
  const pts = [[0, 0, 0], [10, 0, 1], [0, 12, -2], [5, 5, 8]].map(([X, Y, Z], i) => ({
    id: i, model: { X, Y, Z },
    ground: { X: s * (R[0][0] * X + R[0][1] * Y + R[0][2] * Z) + T[0], Y: s * (R[1][0] * X + R[1][1] * Y + R[1][2] * Z) + T[1], Z: s * (R[2][0] * X + R[2][1] * Y + R[2][2] * Z) + T[2] },
  }));
  const ao = similarity3D(pts);
  check('3D similarity recovers a known transformation', Math.abs(ao.s - s) < 1e-9 && Math.abs(ao.angles.kappa - 0.7) < 1e-9 && Math.abs(ao.T[0] - 100) < 1e-6);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
