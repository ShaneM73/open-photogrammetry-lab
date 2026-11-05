// The measurement steps of an aerial triangulation, independent of any
// user interface. Photos are made with camera.js makePhoto (with grey values).
import { template, search, interestPoint, shrink } from './aatm.js';

const nums = l => l.trim().split(/\s+/).map(Number);

// TIEPOINT.DAT: "id col row photo" in a ~300 x 300 pixel overview of each
// photo (rows from the top). These are rough positions to start matching from.
export function parseTiePoints(text, overview = 300) {
  return text.split(/\r?\n/).map(nums).filter(v => v.length >= 4 && Number.isFinite(v[3]))
    .map(([id, c, r, photo]) => ({ id: String(id), photo: String(photo), fu: c / overview, fv: r / overview }));
}

// CP_ICOOR.DAT: per model a header "LLLLL000RRRRR f camera", then lines
// "id colL rowL colR rowR" (full-resolution pixels, rows from the bottom),
// ending with -99. Fiducials (id 1..4) are skipped.
export function parseControlApprox(text) {
  const out = new Map();
  let left = null, right = null;
  for (const line of text.split(/\r?\n/)) {
    const v = line.trim().split(/\s+/);
    if (!v[0]) continue;
    if (v[0] === '-99') { left = right = null; continue; }
    if (v.length === 3 && v[0].length >= 9) { left = String(Number(v[0].slice(0, -6))); right = String(Number(v[0].slice(-3))); continue; }
    const n = v.map(Number);
    if (!left || n.length < 5 || n[0] <= 4) continue;
    for (const [ph, c, r] of [[left, n[1], n[2]], [right, n[3], n[4]]]) {
      const key = `${n[0]}@${ph}`;
      if (!out.has(key)) out.set(key, { id: String(n[0]), photo: ph, col: c, row: r });
    }
  }
  return [...out.values()];
}

// Control points: match the point's image chip around its approximate position.
// chips: Map id -> grey chip (full resolution); approx: from parseControlApprox.
export function measureControl(photos, chips, approx, { R = 24, rMin = 0.6 } = {}) {
  const res = [];
  for (const a of approx) {
    const p = photos[a.photo], chip = chips.get(a.id);
    if (!p || !chip) continue;
    const small = shrink(chip, p.scale);
    const h = Math.floor(Math.min(small.w, small.h) / 2) - 1;
    const tpl = template(small, small.w / 2, small.h / 2, h);
    const u = a.col / p.scale, v = (p.fullRows - a.row) / p.scale;
    const m = search(p.grey, tpl, u, v, R);
    if (!m) continue;
    // the control point is the centre of the chip, which may lie between the
    // template's pixels after shrinking: shift by that difference
    const cu = chip.w / 2 / p.scale, cv = chip.h / 2 / p.scale;
    const mm = p.fromRaster(m.u + (cu - tpl.u), m.v + (cv - tpl.v));
    res.push({ photo: a.photo, point: a.id, x: mm.x, y: mm.y, r: m.r, ok: m.r >= rMin && !m.edge, kind: 'control' });
  }
  return res;
}

// Strip connections: each tie point is taken from its first photo and
// searched in every other photo listed for it.
export function measureStripTies(photos, ties, { h = 10, R = 30, rMin = 0.75 } = {}) {
  const byId = new Map();
  for (const t of ties) { if (!byId.has(t.id)) byId.set(t.id, []); byId.get(t.id).push(t); }
  const res = [];
  for (const [id, list] of byId) {
    const m0 = list[0], P0 = photos[m0.photo];
    if (!P0) continue;
    // move the rough position onto a well-defined spot
    const ip = interestPoint(P0.grey, m0.fu * P0.grey.w, m0.fv * P0.grey.h, 8);
    if (!ip) continue;
    const tpl = template(P0.grey, ip.u, ip.v, h);
    if (!tpl) continue;
    const mm0 = P0.fromRaster(ip.u, ip.v);
    const found = [{ photo: m0.photo, point: id, x: mm0.x, y: mm0.y, r: 1, ok: true, kind: 'strip' }];
    for (const t of list.slice(1)) {
      const P = photos[t.photo];
      if (!P) continue;
      const m = search(P.grey, tpl, t.fu * P.grey.w, t.fv * P.grey.h, R);
      if (!m) continue;
      const mm = P.fromRaster(m.u, m.v);
      found.push({ photo: t.photo, point: id, x: mm.x, y: mm.y, r: m.r, ok: m.r >= rMin && !m.edge, kind: 'strip' });
    }
    if (found.filter(f => f.ok).length >= 2) res.push(...found);
  }
  return res;
}

// Dense tie points from oriented photos: for a grid of ground positions,
// predict where each appears (heights from heightAt), choose a well-defined
// spot in the photo closest to its nadir, and match it into all others.
export async function denseTies(photos, area, spacing, heightAt, { h = 8, R = 6, rMin = 0.8, prefix = 'T', onProgress = () => {} } = {}) {
  const list = Object.values(photos);
  const res = [];
  let n = 0, t0 = performance.now();
  const rows = Math.floor((area.ymax - area.ymin) / spacing), cols = Math.floor((area.xmax - area.xmin) / spacing);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const X = area.xmin + (c + 0.5) * spacing, Y = area.ymax - (r + 0.5) * spacing, Z = heightAt(X, Y);
      if (!Number.isFinite(Z)) continue;
      const seen = list.filter(p => p.projectMM(X, Y, Z));
      if (seen.length < 2) continue;
      seen.sort((a, b) => ((X - a.eo.X0) ** 2 + (Y - a.eo.Y0) ** 2) - ((X - b.eo.X0) ** 2 + (Y - b.eo.Y0) ** 2));
      const master = seen[0], pr = master.project(X, Y, Z);
      const ip = interestPoint(master.grey, pr[0], pr[1], 12);
      if (!ip || ip.s < 2000) continue;
      const tpl = template(master.grey, ip.u, ip.v, h);
      if (!tpl) continue;
      // the chosen spot moved a little: shift the ground position to match
      const mm0 = master.fromRaster(ip.u, ip.v);
      const id = `${prefix}${++n}`;
      const found = [{ photo: master.id, point: id, x: mm0.x, y: mm0.y, r: 1, ok: true, kind: 'dense' }];
      const dU = ip.u - pr[0], dV = ip.v - pr[1];
      for (const p of seen.slice(1)) {
        const q = p.project(X, Y, Z);
        if (!q) continue;
        // transfer the offset approximately (photos have similar scale and rotation)
        const m = search(p.grey, tpl, q[0] + dU, q[1] + dV, R + 4);
        if (!m || m.r < rMin || m.edge) continue;
        const mm = p.fromRaster(m.u, m.v);
        found.push({ photo: p.id, point: id, x: mm.x, y: mm.y, r: m.r, ok: true, kind: 'dense' });
      }
      if (found.length >= 2) res.push(...found);
    }
    if (performance.now() - t0 > 40) { onProgress((r + 1) / rows, res.length); await new Promise(z => setTimeout(z, 0)); t0 = performance.now(); }
  }
  onProgress(1, res.length);
  return res;
}
