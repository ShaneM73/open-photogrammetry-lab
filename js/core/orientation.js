// Orientation models: interior orientation (camera <-> pixel) and the
// collinearity equations (ground <-> camera).
import { leastSquares } from './linalg.js';

/* ---------- Interior orientation ---------- */

// Fit pixel = f(camera) from fiducials measured in the scanned image.
// pairs: [{ x, y, col, row }]   x, y in mm (calibration), col, row in pixels.
// model: 'affine' (6 parameters) or 'similarity' (4 parameters).
export function fitInterior(pairs, model = 'affine') {
  const A = [], l = [];
  for (const p of pairs) {
    if (model === 'affine') {
      A.push([1, p.x, p.y, 0, 0, 0]); l.push(p.col);
      A.push([0, 0, 0, 1, p.x, p.y]); l.push(p.row);
    } else {
      // col = a0 + s cos x - s sin y ;  row = b0 + s sin x + s cos y  (with c = s cos, d = s sin)
      A.push([1, 0, p.x, -p.y]); l.push(p.col);
      A.push([0, 1, p.y, p.x]); l.push(p.row);
    }
  }
  const needed = model === 'affine' ? 3 : 2;
  if (pairs.length < needed) throw new Error(`The ${model} model needs at least ${needed} fiducials.`);
  const r = leastSquares(A, l);
  let coef;
  if (model === 'affine') {
    const [a0, a1, a2, b0, b1, b2] = r.x;
    coef = { a0, a1, a2, b0, b1, b2 };
  } else {
    const [a0, b0, c, d] = r.x;
    coef = { a0, a1: c, a2: -d, b0, b1: d, b2: c };
  }
  const residuals = pairs.map((p, i) => ({ id: p.id, vcol: r.v[2 * i], vrow: r.v[2 * i + 1] }));
  return { model, coef, residuals, sigma0: r.sigma0, dof: r.dof, ...describeAffine(coef) };
}

export function cameraToPixel(c, x, y) {
  return { col: c.a0 + c.a1 * x + c.a2 * y, row: c.b0 + c.b1 * x + c.b2 * y };
}

export function pixelToCamera(c, col, row) {
  const det = c.a1 * c.b2 - c.a2 * c.b1;
  const dc = col - c.a0, dr = row - c.b0;
  return { x: (c.b2 * dc - c.a2 * dr) / det, y: (-c.b1 * dc + c.a1 * dr) / det };
}

// Split the affine matrix into readable quantities: scale per axis
// (pixels per mm), pixel size in micrometres, rotation and shear.
export function describeAffine(c) {
  const sx = Math.hypot(c.a1, c.b1);
  const sy = Math.hypot(c.a2, c.b2);
  const rot = Math.atan2(c.b1, c.a1);
  const shear = Math.atan2(c.a2, c.b2) + rot; // deviation of the y axis from perpendicular
  return { scaleX: sx, scaleY: sy, pixelX_um: 1000 / sx, pixelY_um: 1000 / sy, rotation: rot, shear };
}

/* ---------- Exterior orientation ---------- */

const Rx = o => [[1, 0, 0], [0, Math.cos(o), -Math.sin(o)], [0, Math.sin(o), Math.cos(o)]];
const Ry = p => [[Math.cos(p), 0, Math.sin(p)], [0, 1, 0], [-Math.sin(p), 0, Math.cos(p)]];
const Rz = k => [[Math.cos(k), -Math.sin(k), 0], [Math.sin(k), Math.cos(k), 0], [0, 0, 1]];
const mul = (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));

// Rotation matrix from camera to ground axes, standard omega-phi-kappa
// sequence: R = Rx(omega) * Ry(phi) * Rz(kappa). All angles shown in the
// course use this convention.
export function rotationMatrix(omega, phi, kappa) {
  return mul(mul(Rx(omega), Ry(phi)), Rz(kappa));
}

// Inverse of rotationMatrix().
export function anglesFromMatrix(R) {
  return {
    omega: Math.atan2(-R[1][2], R[2][2]),
    phi: Math.asin(Math.max(-1, Math.min(1, R[0][2]))),
    kappa: Math.atan2(-R[0][1], R[0][0]),
  };
}

// The course data files (.ABS) store three angles (a, b, c) meaning
// R = Ry(a) * Rx(b) * Rz(c): their first angle turns about the Y axis.
// Determined from the sample data sets (aerial, digital close-range and
// oblique): it reproduces the rotation matrices found by resection from
// each file's own points to about 4e-5. See tests/conventions.test.mjs.
export function matrixFromFileAngles(a, b, c) {
  return mul(mul(Ry(a), Rx(b)), Rz(c));
}
export function fileAnglesFromMatrix(R) {
  return {
    a: Math.atan2(R[0][2], R[2][2]),
    b: Math.asin(Math.max(-1, Math.min(1, -R[1][2]))),
    c: Math.atan2(R[1][0], R[1][1]),
  };
}

// Collinearity: ground point -> image coordinates in mm.
export function groundToImage(eo, X, Y, Z) {
  const R = eo.R || rotationMatrix(eo.omega, eo.phi, eo.kappa);
  const d = [X - eo.X0, Y - eo.Y0, Z - eo.Z0];
  const u = [0, 1, 2].map(i => R[0][i] * d[0] + R[1][i] * d[1] + R[2][i] * d[2]); // R^T d
  return { x: -eo.focal * u[0] / u[2], y: -eo.focal * u[1] / u[2] };
}

// Inverse collinearity: image point (mm) -> ground at height Z.
export function imageToGround(eo, x, y, Z) {
  const R = eo.R || rotationMatrix(eo.omega, eo.phi, eo.kappa);
  const v = [x, y, -eo.focal];
  const d = [0, 1, 2].map(i => R[i][0] * v[0] + R[i][1] * v[1] + R[i][2] * v[2]);
  const t = (Z - eo.Z0) / d[2];
  return { X: eo.X0 + t * d[0], Y: eo.Y0 + t * d[1], Z };
}

// Intersect the ray of an image point with a terrain model by iterating on height.
export function imageToTerrain(eo, x, y, heightAt, Zstart = 0, iterations = 20) {
  let Z = Zstart, P;
  for (let i = 0; i < iterations; i++) {
    P = imageToGround(eo, x, y, Z);
    const h = heightAt(P.X, P.Y);
    if (!Number.isFinite(h)) break;
    if (Math.abs(h - Z) < 0.01) { Z = h; break; }
    Z = h;
  }
  return imageToGround(eo, x, y, Z);
}
