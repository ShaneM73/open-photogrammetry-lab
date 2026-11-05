// The rotation convention of the data files, checked on three very different
// geometries: vertical aerial photos, near-vertical close-range photos taken
// with a digital camera, and strongly oblique photos of sea waves.
// For each .ABS file, a resection from the file's own points (started from
// the file's orientation) must reproduce the rotation matrix read from it.
// Run:  node tests/conventions.test.mjs [data_dir]   (default: data)
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseABS, formatABS } from '../js/core/formats.js';
import { resection } from '../js/core/models.js';

const dir = process.argv[2] || 'data';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); if (!ok) failures++; };
const maxDiff = (A, B) => Math.max(...A.flatMap((r, i) => r.map((v, j) => Math.abs(v - B[i][j]))));

const sets = [
  ['sample', ['157', '158'], 1e-4],
  ['erosion', ['1004', '1005', '5004', '5005'], 2e-4],
  // 191201/191202: the stored orientations fit their own points less well
  // (residuals of several pixels), so the comparison is looser there.
  ['waves', ['191401', '191402'], 2e-4],
  ['waves', ['191201', '191202'], 2e-2],
];
for (const [set, ids, tol] of sets) {
  for (const id of ids) {
    const f = join(dir, set, id + '.ABS');
    if (!existsSync(f)) { console.log(`SKIP  ${set}/${id}.ABS not found`); continue; }
    const e = parseABS(readFileSync(f, 'utf8'));
    const r = resection(e.points, e.focal, [e.X0, e.Y0, e.Z0, e.omega, e.phi, e.kappa]);
    const d = maxDiff(r.R, e.R);
    check(`${set}/${id}: file angles give the resected rotation`, d < tol, `max |ΔR| ${d.toExponential(1)}, σ0 ${(r.sigma0 * 1000).toFixed(0)} µm`);
    // writing and reading back must not change the orientation
    const back = parseABS(formatABS(e, e.points));
    check(`${set}/${id}: .ABS write/read round trip`, maxDiff(back.R, e.R) < 2e-6 && Math.abs(back.X0 - e.X0) < 1e-3);
  }
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
