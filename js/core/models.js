// Multi-ray models: space resection, space intersection, relative orientation
// (dependent pair, coplanarity) and absolute orientation (3D similarity).
// Nonlinear problems use Gauss-Newton with numerically differentiated
// Jacobians: slower than analytic derivatives but short enough to read.
import { leastSquares } from './linalg.js';
import { rotationMatrix, groundToImage } from './orientation.js';

/* ---------- generic Gauss-Newton ---------- */

// residuals(p) -> array of residuals; p0 initial parameters; h step per parameter.
// Returns the solution plus a history of every iteration (for teaching demos).
export function gaussNewton(residuals, p0, h, { maxIter = 30, tol = 1e-10 } = {}) {
  let p = p0.slice();
  const history = [{ p: p.slice(), v: residuals(p) }];
  let r;
  for (let it = 0; it < maxIter; it++) {
    const v0 = residuals(p);
    const A = v0.map(() => new Array(p.length));
    for (let j = 0; j < p.length; j++) {
      const q = p.slice(); q[j] += h[j];
      const v1 = residuals(q);
      for (let i = 0; i < v0.length; i++) A[i][j] = (v1[i] - v0[i]) / h[j];
    }
    r = leastSquares(A, v0.map(x => -x));
    p = p.map((pi, j) => pi + r.x[j]);
    const v = residuals(p);
    history.push({ p: p.slice(), v });
    // stop when the corrections vanish or the sum of squares no longer changes
    const ss0 = v0.reduce((t, x) => t + x * x, 0), ss1 = v.reduce((t, x) => t + x * x, 0);
    if (r.x.every((dx, j) => Math.abs(dx) < tol * Math.max(1, Math.abs(p[j]))) || Math.abs(ss0 - ss1) <= 1e-9 * ss0) break;
  }
  const v = residuals(p);
  const dof = v.length - p.length;
  const sigma0 = dof > 0 ? Math.sqrt(v.reduce((s, x) => s + x * x, 0) / dof) : NaN;
  const std = r ? r.Qxx.map((row, j) => sigma0 * Math.sqrt(row[j])) : [];
  return { p, v, sigma0, dof, std, iterations: history.length - 1, history };
}

/* ---------- rotation matrix <-> angles ---------- */

export { anglesFromMatrix } from './orientation.js';
import { anglesFromMatrix } from './orientation.js';

/* ---------- space resection ---------- */

// points: [{ id, x, y (mm), X, Y, Z }], focal in mm. Returns the exterior orientation.
// start (optional): [X0, Y0, Z0, omega, phi, kappa] to iterate from instead of
// the automatic approximation (used by the demo to show convergence).
export function resection(points, focal, start = null) {
  if (points.length < 3) throw new Error('Space resection needs at least three control points.');
  // Approximate values from a 2D similarity image -> ground (vertical photo assumption).
  const A = [], l = [];
  for (const q of points) {
    A.push([1, 0, q.x, -q.y]); l.push(q.X);
    A.push([0, 1, q.y, q.x]); l.push(q.Y);
  }
  const [a, b, c, d] = leastSquares(A, l).x;
  const s = Math.hypot(c, d); // metres on the ground per mm in the image
  const meanZ = points.reduce((t, q) => t + q.Z, 0) / points.length;
  const approx = [a, b, meanZ + s * focal, 0, 0, Math.atan2(d, c)];
  const p0 = start || approx;
  const res = p => {
    const eo = { focal, X0: p[0], Y0: p[1], Z0: p[2], R: rotationMatrix(p[3], p[4], p[5]) };
    return points.flatMap(q => { const i = groundToImage(eo, q.X, q.Y, q.Z); return [i.x - q.x, i.y - q.y]; });
  };
  const g = gaussNewton(res, p0, [1e-3, 1e-3, 1e-3, 1e-7, 1e-7, 1e-7]);
  const [X0, Y0, Z0, omega, phi, kappa] = g.p;
  return {
    focal, X0, Y0, Z0, omega, phi, kappa, R: rotationMatrix(omega, phi, kappa),
    residuals: points.map((q, i) => ({ id: q.id, vx: g.v[2 * i], vy: g.v[2 * i + 1] })),
    sigma0: g.sigma0, dof: g.dof, std: g.std, iterations: g.iterations, history: g.history, initial: approx,
  };
}

/* ---------- space intersection ---------- */

const rayDir = (eo, x, y) => {
  const R = eo.R || rotationMatrix(eo.omega, eo.phi, eo.kappa);
  return [0, 1, 2].map(i => R[i][0] * x + R[i][1] * y - R[i][2] * eo.focal);
};

// Intersect the rays of one point seen in several images.
// obs: [{ eo, x, y }]. Returns X, Y, Z, image residuals and the closest
// distance between the first two rays (how badly they miss each other).
export function intersect(obs) {
  const [o1, o2] = obs;
  const C1 = [o1.eo.X0, o1.eo.Y0, o1.eo.Z0], C2 = [o2.eo.X0, o2.eo.Y0, o2.eo.Z0];
  const d1 = rayDir(o1.eo, o1.x, o1.y), d2 = rayDir(o2.eo, o2.x, o2.y);
  // closest points between two lines C1 + s d1 and C2 + t d2
  const w = C1.map((c, i) => c - C2[i]);
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const a = dot(d1, d1), b = dot(d1, d2), c = dot(d2, d2), d = dot(d1, w), e = dot(d2, w);
  const den = a * c - b * b;
  const s = (b * e - c * d) / den, t = (a * e - b * d) / den;
  const P1 = C1.map((v, i) => v + s * d1[i]), P2 = C2.map((v, i) => v + t * d2[i]);
  const mid = P1.map((v, i) => (v + P2[i]) / 2);
  const gap = Math.hypot(P1[0] - P2[0], P1[1] - P2[1], P1[2] - P2[2]);
  // refine with all rays by least squares on the collinearity equations
  const res = p => obs.flatMap(o => { const i = groundToImage(o.eo, p[0], p[1], p[2]); return [i.x - o.x, i.y - o.y]; });
  const g = gaussNewton(res, mid, [1e-3, 1e-3, 1e-3], { maxIter: 10 });
  return { X: g.p[0], Y: g.p[1], Z: g.p[2], gap, residuals: g.v };
}

/* ---------- relative orientation (dependent pair) ---------- */

// The left camera defines the model system: projection centre at the origin,
// axes parallel to the camera. The right camera sits at (bx, by, bz) with
// rotation (omega, phi, kappa). bx is fixed (it only sets the model scale);
// the five remaining parameters are found from the coplanarity condition:
// the base and the two rays of a point must lie in one plane.
// pairs: [{ id, x1, y1, x2, y2 }] in mm.
export function relativeOrientation(pairs, focal, bx) {
  if (pairs.length < 5) throw new Error('Relative orientation needs at least five points measured in both photos.');
  if (bx === undefined) bx = pairs.reduce((t, q) => t + (q.x1 - q.x2), 0) / pairs.length;
  const cop = (p, q) => {
    const R = rotationMatrix(p[2], p[3], p[4]);
    const r1 = [q.x1, q.y1, -focal];
    const r2 = [0, 1, 2].map(i => R[i][0] * q.x2 + R[i][1] * q.y2 - R[i][2] * focal);
    const b = [bx, p[0], p[1]];
    const det = b[0] * (r1[1] * r2[2] - r1[2] * r2[1]) - b[1] * (r1[0] * r2[2] - r1[2] * r2[0]) + b[2] * (r1[0] * r2[1] - r1[1] * r2[0]);
    return det / (bx * focal); // approximately the y-parallax in mm
  };
  const g = gaussNewton(p => pairs.map(q => cop(p, q)), [0, 0, 0, 0, 0], [1e-6, 1e-6, 1e-8, 1e-8, 1e-8]);
  const [by, bz, omega, phi, kappa] = g.p;
  const left = { focal, X0: 0, Y0: 0, Z0: 0, omega: 0, phi: 0, kappa: 0, R: rotationMatrix(0, 0, 0) };
  const right = { focal, X0: bx, Y0: by, Z0: bz, omega, phi, kappa, R: rotationMatrix(omega, phi, kappa) };
  const model = pairs.map(q => {
    const m = intersect([{ eo: left, x: q.x1, y: q.y1 }, { eo: right, x: q.x2, y: q.y2 }]);
    return { id: q.id, X: m.X, Y: m.Y, Z: m.Z };
  });
  return {
    bx, by, bz, omega, phi, kappa, left, right, model,
    parallax: pairs.map((q, i) => ({ id: q.id, py: g.v[i] })),
    sigma0: g.sigma0, dof: g.dof, iterations: g.iterations, history: g.history,
  };
}

/* ---------- absolute orientation: 3D similarity (Helmert) ---------- */

// Eigen-decomposition of a symmetric matrix by Jacobi rotations.
function jacobiEigen(S) {
  const n = S.length, A = S.map(r => r.slice());
  const V = A.map((_, i) => A.map((__, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] ** 2;
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(A[p][q]) < 1e-30) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) {
        const akp = A[k][p], akq = A[k][q];
        A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < n; k++) {
        const apk = A[p][k], aqk = A[q][k];
        A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < n; k++) {
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
      }
    }
  }
  return { values: A.map((r, i) => r[i]), vectors: V };
}

// Find scale s, rotation R and translation T with  G = s R M + T  from at
// least three points known in both systems (closed form, Horn 1987).
// pairs: [{ id, model: {X,Y,Z}, ground: {X,Y,Z} }]
export function similarity3D(pairs) {
  if (pairs.length < 3) throw new Error('Absolute orientation needs at least three control points in the model.');
  const n = pairs.length;
  const mean = key => ['X', 'Y', 'Z'].map(k => pairs.reduce((t, q) => t + q[key][k], 0) / n);
  const mm = mean('model'), mg = mean('ground');
  const M = pairs.map(q => ['X', 'Y', 'Z'].map((k, i) => q.model[k] - mm[i]));
  const G = pairs.map(q => ['X', 'Y', 'Z'].map((k, i) => q.ground[k] - mg[i]));
  const Sx = [0, 1, 2].map(a => [0, 1, 2].map(b => M.reduce((t, m, i) => t + m[a] * G[i][b], 0)));
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = Sx;
  const N = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  const { values, vectors } = jacobiEigen(N);
  const k = values.indexOf(Math.max(...values));
  const [q0, q1, q2, q3] = vectors.map(r => r[k]);
  const R = [
    [q0 * q0 + q1 * q1 - q2 * q2 - q3 * q3, 2 * (q1 * q2 - q0 * q3), 2 * (q1 * q3 + q0 * q2)],
    [2 * (q2 * q1 + q0 * q3), q0 * q0 - q1 * q1 + q2 * q2 - q3 * q3, 2 * (q2 * q3 - q0 * q1)],
    [2 * (q3 * q1 - q0 * q2), 2 * (q3 * q2 + q0 * q1), q0 * q0 - q1 * q1 - q2 * q2 + q3 * q3],
  ];
  const RM = M.map(m => [0, 1, 2].map(i => R[i][0] * m[0] + R[i][1] * m[1] + R[i][2] * m[2]));
  const s = RM.reduce((t, r, i) => t + r[0] * G[i][0] + r[1] * G[i][1] + r[2] * G[i][2], 0) / M.reduce((t, m) => t + m[0] ** 2 + m[1] ** 2 + m[2] ** 2, 0);
  const T = [0, 1, 2].map(i => mg[i] - s * (R[i][0] * mm[0] + R[i][1] * mm[1] + R[i][2] * mm[2]));
  const apply = p => [0, 1, 2].map(i => s * (R[i][0] * p.X + R[i][1] * p.Y + R[i][2] * p.Z) + T[i]);
  const residuals = pairs.map(q => { const g = apply(q.model); return { id: q.id, vX: g[0] - q.ground.X, vY: g[1] - q.ground.Y, vZ: g[2] - q.ground.Z }; });
  const dof = 3 * n - 7;
  const sigma0 = dof > 0 ? Math.sqrt(residuals.reduce((t, r) => t + r.vX ** 2 + r.vY ** 2 + r.vZ ** 2, 0) / dof) : NaN;
  return { s, R, T, apply: (X, Y, Z) => { const g = apply({ X, Y, Z }); return { X: g[0], Y: g[1], Z: g[2] }; }, residuals, sigma0, dof, angles: anglesFromMatrix(R) };
}

// Turn a relative orientation plus an absolute orientation into the two
// photos' exterior orientations in the ground system.
export function exteriorFromModel(ro, ao) {
  const mul = (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
  return [ro.left, ro.right].map(cam => {
    const C = ao.apply(cam.X0, cam.Y0, cam.Z0);
    const R = mul(ao.R, cam.R);
    return { focal: cam.focal, X0: C.X, Y0: C.Y, Z0: C.Z, R, ...anglesFromMatrix(R) };
  });
}
