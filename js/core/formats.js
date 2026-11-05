// Readers for the course data files.
// The text formats follow the files distributed with the original course data,
// so the same code reads both that data set and new data prepared the same way.

import { matrixFromFileAngles, fileAnglesFromMatrix, anglesFromMatrix } from './orientation.js';

const nums = line => line.trim().split(/\s+/).filter(Boolean).map(Number);
const lines = text => text.split(/\r?\n/).filter(l => l.trim() !== '');

// Camera definition (.CMR): one line per fiducial "id x y" in mm, then the
// calibrated focal length in mm on a line of its own.
export function parseCMR(text) {
  const fiducials = [];
  let focal = NaN;
  for (const l of lines(text)) {
    const v = nums(l);
    if (v.length >= 3) fiducials.push({ id: v[0], x: v[1], y: v[2] });
    else if (v.length === 1) focal = v[0];
  }
  return { fiducials, focal };
}

// Pixel positions (col, row) are continuous coordinates with the origin at the
// bottom-left corner of the scan: col to the right, row upward, so a pixel's
// centre is at i + 0.5. This keeps the camera's y axis and the row axis parallel.
//
// Interior orientation result (.INN): 8 coefficients (camera mm -> pixel),
// the measured fiducials "id col row", the camera file name and focal length.
//   col = a0 + a1 x + a2 y      row = b0 + b1 x + b2 y
export function parseINN(text) {
  const L = lines(text);
  const c = [...nums(L[0]), ...nums(L[1]), ...nums(L[2]), ...nums(L[3])];
  const measured = [];
  let i = 4;
  for (; i < L.length; i++) {
    const v = nums(L[i]);
    if (v.length === 3 && !isNaN(v[0])) measured.push({ id: v[0], col: v[1], row: v[2] });
    else break;
  }
  return {
    coef: { a0: c[0], a1: c[1], a2: c[2], b0: c[4], b1: c[5], b2: c[6] },
    measured,
    camera: L[i] ? L[i].trim() : '',
    focal: L[i + 1] ? Number(L[i + 1]) : NaN,
  };
}

// Exterior orientation (.ABS): focal length; three rotation angles (radians,
// in the file convention R = Ry(a) Rx(b) Rz(c)); X0 Y0 Z0; then
// "id x y X Y Z" for each point used. The result carries the rotation matrix
// R and the angles converted to the course's standard omega-phi-kappa.
export function parseABS(text) {
  const L = lines(text);
  const fileAngles = nums(L[1]);
  const [X0, Y0, Z0] = nums(L[2]);
  const points = L.slice(3).map(nums).filter(v => v.length >= 6)
    .map(v => ({ id: v[0], x: v[1], y: v[2], X: v[3], Y: v[4], Z: v[5] }));
  const R = matrixFromFileAngles(...fileAngles);
  return { focal: Number(L[0]), ...anglesFromMatrix(R), R, fileAngles, X0, Y0, Z0, points };
}

// Write an exterior orientation in the .ABS layout.
export function formatABS(eo, points = []) {
  const { a, b, c } = fileAnglesFromMatrix(eo.R);
  const f = (v, w, d) => v.toFixed(d).padStart(w);
  return [f(eo.focal, 12, 3), f(a, 12, 6) + f(b, 12, 6) + f(c, 12, 6), f(eo.X0, 12, 3) + f(eo.Y0, 12, 3) + f(eo.Z0, 12, 3),
    ...points.map(p => String(p.id).padStart(10) + f(p.x, 12, 3) + f(p.y, 12, 3) + f(p.X, 13, 3) + f(p.Y, 13, 3) + f(p.Z, 13, 3))].join('\n') + '\n';
}

// Ground control (.DAT): "id X Y Z" per line.
export function parseControl(text) {
  return lines(text).map(nums).filter(v => v.length >= 4)
    .map(v => ({ id: v[0], X: v[1], Y: v[2], Z: v[3] }));
}

// Raster (.IMA): 370-byte ASCII header, an RGB palette (768 bytes) for 8-bit
// images, then pixels row by row starting at the top. 16-bit rasters hold
// heights as z = zmin + v (zmax - zmin) / 32767.
export function parseIMA(buffer) {
  const bytes = new Uint8Array(buffer);
  const header = new TextDecoder('latin1').decode(bytes.subarray(0, 370));
  const rows = parseInt(header.slice(0, 6), 10);
  const cols = parseInt(header.slice(6, 12), 10);
  const bits = parseInt(header.slice(12, 14), 10);
  const f = header.slice(14).trim().split(/\s+/).slice(0, 7).map(Number);
  const meta = { rows, cols, bits, xmin: f[0], xmax: f[1], ymin: f[2], ymax: f[3], pixel: f[4], zmin: f[5], zmax: f[6] };
  if (bits === 8) {
    return { meta, data: bytes.slice(1138, 1138 + rows * cols) };
  }
  const raw = new DataView(buffer, 370, rows * cols * 2);
  const data = new Float32Array(rows * cols);
  const k = (meta.zmax - meta.zmin) / 32767;
  for (let i = 0; i < data.length; i++) data[i] = meta.zmin + raw.getInt16(i * 2, true) * k;
  return { meta, data };
}
