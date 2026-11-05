// Block adjustment.
// 1. A 2D block adjustment (each photo a similarity transformation onto the
//    ground plan) gives approximate positions and rotations for all photos.
// 2. The bundle adjustment then fits all rays of all photos at once: every
//    image measurement is one collinearity observation, unknowns are the six
//    orientation parameters of each photo and X, Y, Z of each tie point;
//    control points are fixed. The point unknowns are eliminated from the
//    normal equations (Schur complement), which leaves a small system of
//    6 x (number of photos) camera unknowns.
import { leastSquares, solve } from './linalg.js';
import { rotationMatrix } from './orientation.js';

/* ---------- 2D block adjustment (approximate values) ---------- */

// obs: [{ photo, point, x, y }] (mm); control: Map point -> {X,Y,Z}; focal.
// Each photo: X = a + c x - d y, Y = b + d x + c y. Unknown tie points get X, Y.
export function block2D(photoIds, obs, control, focal) {
  const pIdx = new Map(photoIds.map((id, i) => [id, i]));
  const ties = [...new Set(obs.filter(o => !control.has(o.point)).map(o => o.point))];
  const tIdx = new Map(ties.map((id, i) => [id, i]));
  const nU = 4 * photoIds.length + 2 * ties.length;
  const A = [], l = [];
  for (const o of obs) {
    const j = pIdx.get(o.photo);
    if (j === undefined) continue;
    const rx = new Array(nU).fill(0), ry = new Array(nU).fill(0);
    rx[4 * j] = 1; rx[4 * j + 2] = o.x; rx[4 * j + 3] = -o.y;
    ry[4 * j + 1] = 1; ry[4 * j + 2] = o.y; ry[4 * j + 3] = o.x;
    const c = control.get(o.point);
    if (c) { l.push(c.X, c.Y); }
    else { const k = 4 * photoIds.length + 2 * tIdx.get(o.point); rx[k] = -1; ry[k + 1] = -1; l.push(0, 0); }
    A.push(rx, ry);
  }
  const r = leastSquares(A, l);
  const meanZ = [...control.values()].reduce((s, p) => s + p.Z, 0) / control.size;
  const eo = {};
  photoIds.forEach((id, j) => {
    const [a, b, c, d] = r.x.slice(4 * j, 4 * j + 4);
    const s = Math.hypot(c, d);
    eo[id] = { focal, X0: a, Y0: b, Z0: meanZ + s * focal, omega: 0, phi: 0, kappa: Math.atan2(d, c), scale: s };
  });
  const points = {};
  ties.forEach((id, i) => { points[id] = { X: r.x[4 * photoIds.length + 2 * i], Y: r.x[4 * photoIds.length + 2 * i + 1], Z: meanZ }; });
  return { eo, points, sigma0: r.sigma0, residuals: r.v };
}

/* ---------- bundle adjustment ---------- */

function project(p, X, Y, Z, focal) {
  const R = rotationMatrix(p[3], p[4], p[5]);
  const dx = X - p[0], dy = Y - p[1], dz = Z - p[2];
  const u0 = R[0][0] * dx + R[1][0] * dy + R[2][0] * dz;
  const u1 = R[0][1] * dx + R[1][1] * dy + R[2][1] * dz;
  const u2 = R[0][2] * dx + R[1][2] * dy + R[2][2] * dz;
  return [-focal * u0 / u2, -focal * u1 / u2];
}

const inv3 = m => {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-18) return null;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
};

// input: { photos: { id: eo }, points: { id: {X,Y,Z} } (approximate tie points),
//          control: Map id -> {X,Y,Z} (fixed), obs: [{ photo, point, x, y }], focal }
// opts: { maxIter, onIteration(info) }
export function bundleAdjust(input, { maxIter = 10, tol = 1e-4, damping = 1e-6, onIteration = () => {} } = {}) {
  const { focal, control } = input;
  const photoIds = Object.keys(input.photos);
  const pIdx = new Map(photoIds.map((id, i) => [id, i]));
  const cam = photoIds.map(id => { const e = input.photos[id]; return [e.X0, e.Y0, e.Z0, e.omega, e.phi, e.kappa]; });
  // points observed in at least two photos (control points need only one)
  const count = new Map();
  for (const o of input.obs) count.set(o.point, (count.get(o.point) || 0) + 1);
  const obs = input.obs.filter(o => pIdx.has(o.photo) && (control.has(o.point) || count.get(o.point) >= 2));
  const tieIds = [...new Set(obs.filter(o => !control.has(o.point)).map(o => o.point))].filter(id => input.points[id]);
  const tIdx = new Map(tieIds.map((id, i) => [id, i]));
  const pts = tieIds.map(id => { const p = input.points[id]; return [p.X, p.Y, p.Z]; });
  const used = obs.filter(o => control.has(o.point) || tIdx.has(o.point));
  const nC = 6 * photoIds.length, nObs = 2 * used.length, nUnk = nC + 3 * tieIds.length;
  const history = [];
  const hC = [1e-3, 1e-3, 1e-3, 1e-7, 1e-7, 1e-7], hP = 1e-3;
  let sigma0 = NaN, v = null, Sinv = null;

  for (let it = 0; it <= maxIter; it++) {
    // residuals and Jacobians
    const Ncc = photoIds.map(() => new Float64Array(36)), bc = photoIds.map(() => new Float64Array(6));
    const Npp = tieIds.map(() => new Float64Array(9)), bp = tieIds.map(() => new Float64Array(3));
    const Ncp = new Map(); // key j*1e6+k -> 6x3
    v = new Float64Array(nObs);
    let vtv = 0;
    used.forEach((o, n) => {
      const j = pIdx.get(o.photo), k = tIdx.has(o.point) ? tIdx.get(o.point) : -1;
      const P = k >= 0 ? pts[k] : (c => [c.X, c.Y, c.Z])(control.get(o.point));
      const f0 = project(cam[j], P[0], P[1], P[2], focal);
      const vx = f0[0] - o.x, vy = f0[1] - o.y;
      v[2 * n] = vx; v[2 * n + 1] = vy; vtv += vx * vx + vy * vy;
      const Ac = [[], []], Ap = [[], []];
      for (let a = 0; a < 6; a++) {
        const q = cam[j].slice(); q[a] += hC[a];
        const f1 = project(q, P[0], P[1], P[2], focal);
        Ac[0][a] = (f1[0] - f0[0]) / hC[a]; Ac[1][a] = (f1[1] - f0[1]) / hC[a];
      }
      for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) Ncc[j][6 * a + b] += Ac[0][a] * Ac[0][b] + Ac[1][a] * Ac[1][b];
      for (let a = 0; a < 6; a++) bc[j][a] -= Ac[0][a] * vx + Ac[1][a] * vy;
      if (k >= 0) {
        for (let a = 0; a < 3; a++) {
          const Q = P.slice(); Q[a] += hP;
          const f1 = project(cam[j], Q[0], Q[1], Q[2], focal);
          Ap[0][a] = (f1[0] - f0[0]) / hP; Ap[1][a] = (f1[1] - f0[1]) / hP;
        }
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) Npp[k][3 * a + b] += Ap[0][a] * Ap[0][b] + Ap[1][a] * Ap[1][b];
        for (let a = 0; a < 3; a++) bp[k][a] -= Ap[0][a] * vx + Ap[1][a] * vy;
        const key = j * 1e6 + k;
        let m = Ncp.get(key);
        if (!m) { m = new Float64Array(18); Ncp.set(key, m); }
        for (let a = 0; a < 6; a++) for (let b = 0; b < 3; b++) m[3 * a + b] += Ac[0][a] * Ap[0][b] + Ac[1][a] * Ap[1][b];
      }
    });
    sigma0 = Math.sqrt(vtv / Math.max(1, nObs - nUnk));
    history.push({ iteration: it, sigma0, rms: Math.sqrt(vtv / nObs) });
    onIteration(history[history.length - 1]);
    if (it === maxIter) break;

    // reduced normal equations for the camera unknowns
    const S = Array.from({ length: nC }, () => new Float64Array(nC));
    const rhs = new Float64Array(nC);
    photoIds.forEach((_, j) => { for (let a = 0; a < 6; a++) { rhs[6 * j + a] = bc[j][a]; for (let b = 0; b < 6; b++) S[6 * j + a][6 * j + b] = Ncc[j][6 * a + b]; } });
    const byPoint = tieIds.map(() => []);
    for (const [key, m] of Ncp) byPoint[key % 1e6].push([Math.floor(key / 1e6), m]);
    const NppInv = Npp.map(inv3);
    byPoint.forEach((list, k) => {
      const Ni = NppInv[k];
      if (!Ni) return;
      // W_j = N_jk * Npp^-1 (6x3)
      const W = list.map(([j, m]) => {
        const w = new Float64Array(18);
        for (let a = 0; a < 6; a++) for (let b = 0; b < 3; b++) w[3 * a + b] = m[3 * a] * Ni[b] + m[3 * a + 1] * Ni[3 + b] + m[3 * a + 2] * Ni[6 + b];
        return [j, w, m];
      });
      for (const [j1, w1] of W) {
        for (let a = 0; a < 6; a++) rhs[6 * j1 + a] -= w1[3 * a] * bp[k][0] + w1[3 * a + 1] * bp[k][1] + w1[3 * a + 2] * bp[k][2];
        for (const [j2, , m2] of W) for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++)
          S[6 * j1 + a][6 * j2 + b] -= w1[3 * a] * m2[3 * b] + w1[3 * a + 1] * m2[3 * b + 1] + w1[3 * a + 2] * m2[3 * b + 2];
      }
    });
    // Scale every unknown to unit diagonal (metres and radians differ by
    // orders of magnitude) and add a little damping (Levenberg-Marquardt),
    // so weakly determined photos cannot make the system singular.
    const D = S.map((r, i) => 1 / Math.sqrt(Math.max(r[i], 1e-30)));
    const Ss = S.map((r, i) => Array.from(r, (x, k) => x * D[i] * D[k] + (i === k ? damping : 0)));
    const sol = solve(Ss, Array.from(rhs, (x, i) => x * D[i]));
    Sinv = sol.inv.map((r, i) => r.map((x, k) => x * D[i] * D[k]));
    const dc = sol.x.map((x, i) => x * D[i]);
    photoIds.forEach((_, j) => { for (let a = 0; a < 6; a++) cam[j][a] += dc[6 * j + a]; });
    // back-substitute the points: dp = Npp^-1 (bp - N_pc dc)
    byPoint.forEach((list, k) => {
      const Ni = NppInv[k];
      if (!Ni) return;
      const t = Array.from(bp[k]);
      for (const [j, m] of list) for (let b = 0; b < 3; b++) for (let a = 0; a < 6; a++) t[b] -= m[3 * a + b] * dc[6 * j + a];
      for (let a = 0; a < 3; a++) pts[k][a] += Ni[3 * a] * t[0] + Ni[3 * a + 1] * t[1] + Ni[3 * a + 2] * t[2];
    });
    const maxPos = Math.max(...dc.filter((_, i) => i % 6 < 3).map(Math.abs));
    if (it > 0 && maxPos < tol && history.length > 1 && Math.abs(history[history.length - 2].sigma0 - sigma0) < 1e-4 * sigma0) {
      // one more pass to report the final residuals
      maxIter = it + 1;
    }
  }

  const photos = {};
  photoIds.forEach((id, j) => {
    const [X0, Y0, Z0, omega, phi, kappa] = cam[j];
    const sd = Sinv ? [0, 1, 2, 3, 4, 5].map(a => sigma0 * Math.sqrt(Math.max(0, Sinv[6 * j + a][6 * j + a]))) : null;
    photos[id] = { focal, X0, Y0, Z0, omega, phi, kappa, R: rotationMatrix(omega, phi, kappa), std: sd };
  });
  const points = {};
  tieIds.forEach((id, k) => { points[id] = { X: pts[k][0], Y: pts[k][1], Z: pts[k][2] }; });
  const residuals = used.map((o, n) => ({ ...o, vx: v[2 * n], vy: v[2 * n + 1] }));
  return { photos, points, residuals, sigma0, history, nObs, nUnknowns: nUnk, redundancy: nObs - nUnk };
}
