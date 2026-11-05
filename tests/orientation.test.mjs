// Checks the core modules against reference results shipped with the data.
// Run:  node tests/orientation.test.mjs [data_dir]   (default: data/sample)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCMR, parseINN, parseABS, parseIMA } from '../js/core/formats.js';
import { fitInterior, groundToImage, pixelToCamera, cameraToPixel } from '../js/core/orientation.js';

const dir = process.argv[2] || 'data/sample';
const read = f => readFileSync(join(dir, f), 'utf8');
let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
};

const cam = parseCMR(read('RMK_1523.CMR'));
check('camera file: 4 fiducials, f = 152.910', cam.fiducials.length === 4 && cam.focal === 152.91);

for (const img of ['157', '158']) {
  const inn = parseINN(read(`${img}.INN`));
  const pairs = inn.measured.map(m => {
    const f = cam.fiducials.find(q => q.id === m.id);
    return { id: m.id, x: f.x, y: f.y, col: m.col, row: m.row };
  });
  const io = fitInterior(pairs, 'affine');
  // Compare where both transforms put points across the whole 230 mm format.
  let maxDiff = 0;
  for (let x = -115; x <= 115; x += 23) for (let y = -115; y <= 115; y += 23) {
    const a = cameraToPixel(io.coef, x, y), b = cameraToPixel(inn.coef, x, y);
    maxDiff = Math.max(maxDiff, Math.hypot(a.col - b.col, a.row - b.row));
  }
  check(`${img}: affine interior orientation matches .INN`, maxDiff < 0.01, `max difference ${maxDiff.toFixed(4)} px`);
  const back = cameraToPixel(io.coef, ...Object.values(pixelToCamera(io.coef, 1000, 2000)));
  check(`${img}: pixel -> camera -> pixel round trip`, Math.hypot(back.col - 1000, back.row - 2000) < 1e-9);

  const eo = parseABS(read(`${img}.ABS`));
  const res = eo.points.map(p => { const q = groundToImage(eo, p.X, p.Y, p.Z); return Math.hypot(q.x - p.x, q.y - p.y); });
  const rms = Math.sqrt(res.reduce((s, r) => s + r * r, 0) / res.length);
  check(`${img}: collinearity reproduces .ABS image points`, rms < 0.15, `rms ${(rms * 1000).toFixed(0)} µm`);
}

// Optional: raw .IMA reader, when the original data folder is passed as a second argument.
if (process.argv[3]) {
  const buf = readFileSync(join(process.argv[3], 'tutorial_2/output/gitt.ima'));
  const { meta, data } = parseIMA(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  check('IMA reader: DEM size 1220 x 1300', meta.rows === 1220 && meta.cols === 1300);
  check('IMA reader: heights within 1000-1700 m', data.every(z => z >= 1000 && z <= 1700));
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
