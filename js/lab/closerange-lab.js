// Labs L3 (soil erosion) and L4 (sea waves): close-range photogrammetry
// with digital cameras and two epochs. One lab, configured per data set:
// orientation -> y-parallax correction -> matching both epochs -> comparison.
import { loadImage } from './image-viewer.js';
import { GridView } from './gridview.js';
import { DATA, createViewer, toThree, line, label, cssVar } from '../demos/three-util.js';
import { gridMesh, frameGrid } from '../demos/grid3d.js';
import { parseINN, parseABS, parseControl, parseCMR } from '../core/formats.js';
import { makePhoto, greyData } from '../core/camera.js';
import { resection } from '../core/models.js';
import { matchDTM, fitParallaxCorrection } from '../core/matching.js';
import { gridFromJSON, difference, stats, volume, medianFilter, makeGrid, heightAt, cellX, cellY } from '../core/raster.js';
import { leastSquares } from '../core/linalg.js';

const CONFIGS = {
  erosion: {
    title: 'Lab L3 · Soil erosion from two stereo pairs', units: 'mm', digits: 1,
    epochs: [
      { key: '1000', label: 'before rain', left: '1005', right: '1004', seeds: 'START_1000.DAT', ref: 'ref_dtm_1000.json', half: 6 },
      { key: '5000', label: 'after rain', left: '5005', right: '5004', seeds: 'START_5000.DAT', ref: 'ref_dtm_5000.json', half: 5 },
    ],
    match: { pixels: [12, 9, 6], pixel: 9, spacing: 0.8, zMin: 1000, zMax: 1400, rMin: 0.7, median: 1 },
    correction: { degree: 2, along: true }, contour: 10, diffRange: 40, exag: 2,
    approxFromSeeds: false, volume: true, change: 'Height change after − before',
  },
  waves: {
    title: 'Lab L4 · Sea waves from oblique photos', units: 'm', digits: 2,
    epochs: [
      { key: '1912', label: 'time 1', left: '191201', right: '191202', seeds: 'START_PNT.DAT', ref: 'ref_dtm_1912.json', half: 6 },
      { key: '1914', label: 'time 2 (¼ s later)', left: '191401', right: '191402', seeds: 'START_PNT.DAT', ref: 'ref_dtm_1914.json', half: 6 },
    ],
    match: { pixels: [1, 0.5, 0.25], pixel: 0.5, spacing: 0.4, zMin: -1, zMax: 3, rMin: 0.75, median: 2, range: 0.3 },
    correction: { degree: 1, along: false }, contour: 0.25, diffRange: 1.5, exag: 3,
    approxFromSeeds: true, polygon: 'BORDER.DAT', volume: false, change: 'Surface change time 2 − time 1',
  },
};

const nums = l => l.trim().split(/\s+/).map(Number);

export async function mount(root) {
  const cfg = CONFIGS[root.dataset.set];
  const base = DATA.replace('sample/', root.dataset.set + '/');
  const U = cfg.units;
  root.innerHTML = `
  <div class="demo-head"><h3>${cfg.title}</h3><span class="hint" id="cr-status">Loading photos…</span></div>
  <div class="seg" id="cr-steps" style="padding:10px 16px;border-bottom:1px solid var(--rule)">
    <button class="btn" data-s="orient" aria-pressed="true">1 · Orientation</button>
    <button class="btn" data-s="parallax" aria-pressed="false">2 · y-parallax correction</button>
    <button class="btn" data-s="match" aria-pressed="false">3 · Matching</button>
    <button class="btn" data-s="results" aria-pressed="false">4 · Results</button>
  </div>
  <div class="demo-body wide-side">
    <div class="stage" id="cr-stage" style="height:600px"></div>
    <div class="side" id="cr-side" style="max-height:600px;overflow-y:auto"></div>
  </div>
  <p class="caption" id="cr-cap"></p>`;
  const $ = s => root.querySelector(s);

  // ---------- load ----------
  const ids = cfg.epochs.flatMap(e => [e.left, e.right]);
  const texts = await Promise.all(['CAMERA.INN', 'CAMERA.CMR', 'CONTROL.DAT', ...ids.map(i => i + '.ABS'), ...new Set(cfg.epochs.map(e => e.seeds)), ...(cfg.polygon ? [cfg.polygon] : [])]
    .map(f => fetch(base + f).then(r => r.text())));
  const inn = parseINN(texts[0]), cmr = parseCMR(texts[1]), control = parseControl(texts[2]);
  const abs = Object.fromEntries(ids.map((id, k) => [id, parseABS(texts[3 + k])]));
  const seedFiles = [...new Set(cfg.epochs.map(e => e.seeds))];
  const seeds = Object.fromEntries(seedFiles.map((f, k) => [f, texts[3 + ids.length + k].split(/\r?\n/).map(nums).filter(v => v.length >= 4).map(([id, X, Y, Z]) => ({ id, X, Y, Z }))]));
  let polygon = null;
  if (cfg.polygon) {
    polygon = [];
    for (const v of texts[texts.length - 1].split(/\r?\n/).map(nums).slice(1)) { if (v[0] === -99) break; if (v.length >= 3) polygon.push([v[1], v[2]]); }
  }
  const inPoly = (X, Y) => {
    if (!polygon) return true;
    let c = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
      if ((yi > Y) !== (yj > Y) && X < (xj - xi) * (Y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const hx = Math.max(...cmr.fiducials.map(f => Math.abs(f.x))) * 0.97, hy = Math.max(...cmr.fiducials.map(f => Math.abs(f.y))) * 0.97;
  const refs = Object.fromEntries(await Promise.all(cfg.epochs.map(async e => [e.key, gridFromJSON(await (await fetch(base + e.ref)).json())])));
  const photos = {};
  let n = 0;
  await Promise.all(ids.map(async id => {
    const [img, meta] = await Promise.all([loadImage(base + id + '.png'), fetch(base + id + '.json').then(r => r.json())]);
    photos[id] = makePhoto({ id, inn, fullRows: meta.rows, grey: greyData(img), format: { hx, hy } });
    photos[id].img = img;
    $('#cr-status').textContent = `Loading photos… ${++n} / ${ids.length}`;
  }));
  $('#cr-status').textContent = 'Ready';
  const ref0 = refs[cfg.epochs[0].key];
  const area = polygon
    ? { xmin: Math.min(...polygon.map(p => p[0])), xmax: Math.max(...polygon.map(p => p[0])), ymin: Math.min(...polygon.map(p => p[1])), ymax: Math.max(...polygon.map(p => p[1])) }
    : { xmin: ref0.xmin, xmax: ref0.xmax, ymin: ref0.ymin, ymax: ref0.ymax };

  const st = { step: 'orient', ori: null, corr: {}, res: {}, view: 'e0', pixel: cfg.match.pixel, corrOn: true };
  const stage = $('#cr-stage');
  const view = new GridView(stage, { units: U });
  let v3 = null;
  const clear3D = () => { if (v3) { v3.dispose(); v3 = null; } view.canvas.hidden = false; };

  // ---------- step 1: orientation ----------
  function orient() {
    st.ori = {};
    for (const id of ids) {
      const a = abs[id];
      // start from the stored orientation: oblique and convergent photos need good approximate values
      const r = resection(a.points, a.focal, [a.X0, a.Y0, a.Z0, a.omega, a.phi, a.kappa]);
      st.ori[id] = r;
      photos[id].setEO(r);
    }
  }

  // ---------- step 2: y-parallax ----------
  function correct() {
    for (const e of cfg.epochs) {
      const L = photos[e.left], R = photos[e.right];
      R.correction = null;
      const pc = fitParallaxCorrection(L, R, seeds[e.seeds], { degree: cfg.correction.degree, alongEpipolar: cfg.correction.along });
      st.corr[e.key] = pc;
      R.correction = st.corrOn ? pc.correction : null;
    }
  }

  // ---------- step 3: matching ----------
  async function match(progress) {
    for (const [k, e] of cfg.epochs.entries()) {
      const L = photos[e.left], R = photos[e.right], sd = seeds[e.seeds];
      // a level of reference: a plane through the start points (the plot is inclined)
      const pl = leastSquares(sd.map(p => [1, p.X, p.Y]), sd.map(p => p.Z)).x;
      const zPlane = (X, Y) => pl[0] + pl[1] * X + pl[2] * Y;
      const idw = (X, Y) => { let sw = 0, sz = 0; for (const p of sd) { const d2 = (p.X - X) ** 2 + (p.Y - Y) ** 2 + 1e-6; const w = 1 / (d2 * d2); sw += w; sz += w * p.Z; } return sz / sw; };
      const t0 = performance.now();
      const res = await matchDTM(L, R, {
        area, pixel: st.pixel, zMin: cfg.match.zMin, zMax: cfg.match.zMax, half: e.half, spacing: cfg.match.spacing, rMin: cfg.match.rMin, levels: 3,
        inside: (X, Y) => inPoly(X, Y) && L.projectMM(X, Y, zPlane(X, Y)) && R.projectMM(X, Y, zPlane(X, Y)),
        start: cfg.approxFromSeeds ? null : sd,
        approx: cfg.approxFromSeeds ? idw : null, range: cfg.match.range,
        onProgress: (f, msg) => progress(`${e.label}: <b>${Math.round(f * 100)} %</b> · ${msg}`),
      });
      if (cfg.match.median) res.grid = medianFilter(res.grid, cfg.match.median);
      res.time = (performance.now() - t0) / 1000;
      const d = difference(res.grid, refs[e.key]);
      for (let i = 0; i < d.z.length; i++) d.z[i] = -d.z[i];
      res.vsRef = d; res.vsRefStats = stats(d);
      st.res[e.key] = res;
    }
    const [a, b] = cfg.epochs.map(e => st.res[e.key]);
    st.change = difference(a.grid, b.grid);
    st.changeRef = difference(refs[cfg.epochs[0].key], refs[cfg.epochs[1].key]);
    // cells matched directly in both epochs (not filled from neighbours)
    const both = new Uint8Array(a.grid.z.length);
    for (let i = 0; i < both.length; i++) both[i] = !Number.isNaN(a.raw.z[i]) && !Number.isNaN(b.raw.z[i]) ? 1 : 0;
    st.both = both;
  }

  // ---------- 3D scene of the set-up ----------
  function setup3D() {
    clear3D(); view.canvas.hidden = true; view.label.textContent = ''; view.legend.textContent = '';
    v3 = createViewer(stage, { near: 0.01, far: 1e7 });
    const g = refs[cfg.epochs[0].key], z0 = stats(g).mean;
    const origin = { X: (g.xmin + g.xmax) / 2, Y: (g.ymin + g.ymax) / 2, Z: z0 };
    v3.scene.add(gridMesh(g, origin, { color: 0x9aa38a, step: Math.max(1, Math.round(g.cols / 150)) }));
    const colors = [cssVar('--left'), cssVar('--right')];
    const span = Math.max(g.xmax - g.xmin, g.ymax - g.ymin);
    for (const [k, e] of cfg.epochs.entries()) for (const [j, id] of [e.left, e.right].entries()) {
      const eo = st.ori[id], O = toThree(eo.X0, eo.Y0, eo.Z0, origin);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(span / 80, 12, 8), new THREE.MeshBasicMaterial({ color: colors[j] }));
      ball.position.copy(O); v3.scene.add(ball);
      if (k === 0) { const t = label(`${id} / ${cfg.epochs[1][j ? 'right' : 'left']}`, '#ffffff', span / 30); t.position.copy(O).add(new THREE.Vector3(0, span / 20, 0)); v3.scene.add(t); }
      // viewing cone, drawn to the distance of the area centre (oblique views never reach a level plane)
      const depth = Math.hypot(eo.X0 - origin.X, eo.Y0 - origin.Y, eo.Z0 - z0) * 1.1;
      const cs = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([x, y]) => {
        const d = [0, 1, 2].map(i => eo.R[i][0] * x + eo.R[i][1] * y - eo.R[i][2] * eo.focal);
        const t = depth / Math.hypot(...d);
        return toThree(eo.X0 + t * d[0], eo.Y0 + t * d[1], eo.Z0 + t * d[2], origin);
      });
      if (k === 0) { v3.scene.add(line([...cs, cs[0]], colors[j], { opacity: 0.8 })); cs.forEach(c => v3.scene.add(line([O, c], colors[j], { opacity: 0.3 }))); }
    }
    for (const p of control) {
      const m = new THREE.Mesh(new THREE.ConeGeometry(span / 150, span / 50, 8), new THREE.MeshBasicMaterial({ color: 0xffd166 }));
      m.rotation.x = Math.PI; m.position.copy(toThree(p.X, p.Y, p.Z, origin)).add(new THREE.Vector3(0, span / 100, 0)); v3.scene.add(m);
    }
    if (polygon) v3.scene.add(line([...polygon, polygon[0]].map(([X, Y]) => toThree(X, Y, z0 + 0.5, origin)), 0xffffff));
    // look from behind and above the cameras towards the area
    const C = ids.map(id => st.ori[id]);
    const cx = C.reduce((s2, e) => s2 + e.X0, 0) / C.length, cy = C.reduce((s2, e) => s2 + e.Y0, 0) / C.length, cz = C.reduce((s2, e) => s2 + e.Z0, 0) / C.length;
    const cam = toThree(cx, cy, cz, origin), tgt = toThree(origin.X, origin.Y, z0, origin);
    const back = cam.clone().sub(tgt);
    const dist = back.length();
    back.y = 0; back.normalize();
    const side = new THREE.Vector3(-back.z, 0, back.x);
    v3.controls.target.copy(cam.clone().lerp(tgt, 0.5));
    v3.camera.position.copy(cam).add(back.multiplyScalar(dist * 0.6)).add(side.multiplyScalar(dist * 0.5)).add(new THREE.Vector3(0, dist * 0.5, 0));
    v3.camera.near = dist / 1000; v3.camera.far = dist * 50; v3.camera.updateProjectionMatrix();
  }

  // ---------- results views ----------
  function showResult() {
    clear3D();
    const [e0, e1] = cfg.epochs, r0 = st.res[e0.key], r1 = st.res[e1.key];
    const lo = Math.min(stats(r0.grid).min, stats(r1.grid).min), hi = Math.max(stats(r0.grid).max, stats(r1.grid).max);
    const common = { contour: cfg.contour, exag: cfg.exag, digits: cfg.digits, xyDigits: cfg.units === 'mm' ? 0 : 1 };
    const v = st.view;
    if (v === 'e0' || v === 'e1') { const e = v === 'e0' ? e0 : e1; view.show({ grid: st.res[e.key].grid, mode: 'relief', lo, hi, ...common, title: `your surface, ${e.label}` }); }
    else if (v === 'r0' || v === 'r1') { const e = v === 'r0' ? e0 : e1; view.show({ grid: refs[e.key], mode: 'relief', lo, hi, ...common, title: `reference surface, ${e.label}` }); }
    else if (v === 'change') view.show({ grid: st.change, mode: 'diff', lo: -cfg.diffRange, hi: cfg.diffRange, ...common, contour: null, title: cfg.change });
    else if (v === 'corr') view.show({ grid: r1.grid, mode: 'corr', values: r1.r, lo: 0.3, hi: 1, digits: 2, title: `correlation, ${e1.label}` });
    else if (v === 'vsref') view.show({ grid: r1.grid, mode: 'diff', values: r1.vsRef.z, lo: -cfg.diffRange, hi: cfg.diffRange, ...common, contour: null, title: `yours minus reference, ${e1.label}` });
    else if (v === '3d') {
      view.canvas.hidden = true; view.label.textContent = ''; view.legend.textContent = '';
      v3 = createViewer(stage, { near: 0.01, far: 1e7 });
      const g = st.res[st.epoch3d || e0.key].grid, z0 = stats(g).mean;
      const origin = { X: (g.xmin + g.xmax) / 2, Y: (g.ymin + g.ymax) / 2, Z: z0 };
      // texture: the left photo resampled onto the surface
      const L = photos[cfg.epochs.find(e => e.key === (st.epoch3d || e0.key)).left];
      const tex = document.createElement('canvas'); tex.width = g.cols; tex.height = g.rows;
      const tctx = tex.getContext('2d'), im = tctx.createImageData(g.cols, g.rows);
      for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
        const z = g.z[r * g.cols + c], val = Number.isNaN(z) ? 40 : L.sampleGround(cellX(g, c), cellY(g, r), z), i = 4 * (r * g.cols + c);
        im.data[i] = im.data[i + 1] = im.data[i + 2] = val < 0 ? 40 : val; im.data[i + 3] = 255;
      }
      tctx.putImageData(im, 0, 0);
      v3.scene.add(gridMesh(g, origin, { exag: cfg.exag, texture: tex }));
      frameGrid(v3, g, origin, cfg.exag, z0);
    }
  }

  // ---------- side panel ----------
  const tick = () => new Promise(r => setTimeout(r, 0));
  function side() {
    const el = $('#cr-side'), step = st.step;
    let h = '';
    const fmt = (x, d = cfg.digits) => x.toFixed(d);
    if (step === 'orient') {
      h = `<p style="margin:0">Each photo is oriented by space resection from the control points measured in it (the measurements come with the data). The cameras are digital, so the interior orientation is fixed by the camera definition: pixel size, principal point and focal length (${inn.focal || abs[ids[0]].focal} mm).</p><button class="btn primary" id="cr-run">Resect all four photos</button>`;
      if (st.ori) {
        h += `<div class="table-wrap"><table class="data"><thead><tr><th>Photo</th><th>Points</th><th>σ₀ µm</th><th>X₀</th><th>Y₀</th><th>Z₀</th></tr></thead><tbody>` +
          ids.map(id => { const r = st.ori[id]; return `<tr><td>${id}</td><td>${abs[id].points.length}</td><td>${(r.sigma0 * 1000).toFixed(0)}</td><td>${fmt(r.X0, 2)}</td><td>${fmt(r.Y0, 2)}</td><td>${fmt(r.Z0, 2)}</td></tr>`; }).join('') + '</tbody></table></div>';
        const pix = Math.abs(1 / inn.coef.a1) * 1000;
        h += `<div class="readout">Sensor pixel ${pix.toFixed(1)} µm: σ₀ of ${Math.max(...ids.map(id => st.ori[id].sigma0 * 1000)).toFixed(0)} µm is ${(Math.max(...ids.map(id => st.ori[id].sigma0 * 1000)) / pix).toFixed(1)} pixels at most.<br>` +
          cfg.epochs.map(e => `${e.left} vs ${cfg.epochs[1 - cfg.epochs.indexOf(e)].left}`).slice(0, 1).map(() => {
            const a = st.ori[cfg.epochs[0].left], b = st.ori[cfg.epochs[1].left];
            return `The same camera in both epochs (${cfg.epochs[0].left} and ${cfg.epochs[1].left}): positions differ by ${fmt(Math.hypot(a.X0 - b.X0, a.Y0 - b.Y0, a.Z0 - b.Z0), 2)} ${U}.`;
          }).join('') + `</div>`;
      }
    } else if (step === 'parallax') {
      h = `<p style="margin:0">Corresponding points should lie on the same epipolar line. Here they do not quite: the lens distortion of these cameras was not calibrated. Matching the start points in 2D shows the remaining y-parallax, and a ${cfg.correction.degree === 1 ? 'linear (affine)' : 'second-order'} polynomial fitted to it corrects the right-hand photo of each pair.${cfg.correction.along ? ' The start points carry heights from an earlier adjustment, so the offsets along the epipolar line are corrected too.' : ''}</p>` +
        (st.ori ? `<button class="btn primary" id="cr-run">Measure and fit the correction</button>` : '<div class="readout">Orient the photos first.</div>');
      if (Object.keys(st.corr).length) {
        h += cfg.epochs.map(e => { const c = st.corr[e.key]; return `<div class="readout"><b>${e.label}</b> (${e.left}/${e.right}): ${c.n} points<br>y-parallax RMS <b>${c.before.toFixed(2)} px</b> → <b>${c.after.toFixed(2)} px</b>${cfg.correction.along ? `<br>along the epipolar line ${c.pxBefore.toFixed(2)} → ${c.pxAfter.toFixed(2)} px` : ''}</div>`; }).join('');
        h += `<label class="check"><input type="checkbox" id="cr-corr" ${st.corrOn ? 'checked' : ''}> Use the correction when matching</label>`;
      }
    } else if (step === 'match') {
      h = `<p style="margin:0">Both epochs are matched on the same grid, from coarse to fine${cfg.approxFromSeeds ? ', searching only a narrow band around a surface interpolated from the start points (repeating wave crests produce false correlation peaks otherwise)' : ', seeded with the start points'}.</p>
        <div class="ctrl"><label>Grid spacing</label><div class="seg" id="cr-px">${cfg.match.pixels.map(p => `<button class="btn" data-v="${p}" aria-pressed="${p === st.pixel}">${p} ${U}</button>`).join('')}</div></div>` +
        (Object.keys(st.corr).length ? `<button class="btn primary" id="cr-run">Match both epochs</button>` : '<div class="readout">Fit the y-parallax correction first.</div>');
      if (Object.keys(st.res).length === 2) h += cfg.epochs.map(e => { const r = st.res[e.key], d = r.vsRefStats; return `<div class="readout"><b>${e.label}</b>: ${r.grid.cols} × ${r.grid.rows} cells, matched directly ${Math.round(100 * r.matched / r.total)} %, ${r.time.toFixed(1)} s<br>vs reference: mean ${fmt(d.mean)} ${U}, std ${fmt(d.std)} ${U}</div>`; }).join('');
    } else if (step === 'results') {
      if (Object.keys(st.res).length < 2) h = '<div class="readout">Run the matching first.</div>';
      else {
        const views = [['e0', cfg.epochs[0].label], ['e1', cfg.epochs[1].label], ['change', 'Change'], ['corr', 'Correlation'], ['vsref', 'vs reference'], ['r0', 'Reference 1'], ['r1', 'Reference 2'], ['3d', '3D']];
        h = `<div class="seg" id="cr-views">${views.map(([k, t]) => `<button class="btn" data-v="${k}" aria-pressed="${st.view === k}">${t}</button>`).join('')}</div>`;
        if (st.view === '3d') h += `<div class="seg" id="cr-ep3">${cfg.epochs.map(e => `<button class="btn" data-v="${e.key}" aria-pressed="${(st.epoch3d || cfg.epochs[0].key) === e.key}">${e.label}</button>`).join('')}</div>`;
        const ch = stats(st.change), chR = stats(st.changeRef);
        h += `<div class="readout"><b>${cfg.change}</b><br>yours: mean ${fmt(ch.mean)} ${U}, range ${fmt(ch.min)} … ${fmt(ch.max)}<br>reference surfaces: mean ${fmt(chR.mean)} ${U}</div>`;
        if (cfg.volume) {
          const all = volume(st.change), both = volume(st.change, (r, c) => st.both[r * st.change.cols + c]), ref = volume(st.changeRef);
          const dm3 = v => (v / 1e6).toFixed(2);
          h += `<div class="readout"><b>Volume of soil removed</b> (1 dm³ = 10⁶ mm³)<br>yours, all cells: <b>${dm3(-all.net)} dm³</b>, mean ${(-all.meanChange).toFixed(1)} mm<br>yours, matched in both: <b>${dm3(-both.net)} dm³</b> over ${(both.area / 1e6).toFixed(3)} m², mean ${(-both.meanChange).toFixed(1)} mm<br>reference surfaces: ${dm3(-ref.net)} dm³, mean ${(-ref.meanChange).toFixed(1)} mm</div>`;
        }
      }
    }
    el.innerHTML = h;
    el.querySelector('#cr-run')?.addEventListener('click', async e => {
      e.target.disabled = true;
      const prog = m => { $('#cr-status').innerHTML = m; };
      prog('working…'); await tick();
      try {
        if (step === 'orient') { orient(); setup3D(); }
        else if (step === 'parallax') { correct(); drawParallax(); }
        else if (step === 'match') { await match(prog); st.view = 'e0'; showResult(); }
      } catch (err) { console.error(err); prog(err.message); }
      $('#cr-status').textContent = 'Ready';
      side();
    });
    el.querySelector('#cr-corr')?.addEventListener('change', ev => { st.corrOn = ev.target.checked; for (const e of cfg.epochs) photos[e.right].correction = st.corrOn ? st.corr[e.key].correction : null; });
    el.querySelectorAll('#cr-px .btn').forEach(b => b.addEventListener('click', () => { st.pixel = Number(b.dataset.v); side(); }));
    el.querySelectorAll('#cr-views .btn').forEach(b => b.addEventListener('click', () => { st.view = b.dataset.v; showResult(); side(); }));
    el.querySelectorAll('#cr-ep3 .btn').forEach(b => b.addEventListener('click', () => { st.epoch3d = b.dataset.v; showResult(); side(); }));
  }

  // The measured y-parallaxes as arrows on the right photo (enlarged 40 times)
  function drawParallax() {
    clear3D();
    const e = cfg.epochs[0], c = st.corr[e.key], R = photos[e.right];
    const cv = document.createElement('canvas'), W = R.grey.w, H = R.grey.h;
    cv.width = W / 4; cv.height = H / 4;
    const ctx = cv.getContext('2d');
    ctx.drawImage(R.img, 0, 0, cv.width, cv.height);
    ctx.fillStyle = 'rgba(15,23,32,0.35)'; ctx.fillRect(0, 0, cv.width, cv.height);
    for (const p of c.points) {
      const x = p.u / 4, y = p.v / 4, k = 40 / 4;
      ctx.strokeStyle = '#ef6f5c'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + p.n[0] * p.py * k, y + p.n[1] * p.py * k); ctx.stroke();
      if (c.correction) {
        const q = c.correction(p.u, p.v);
        ctx.strokeStyle = '#3cc3d6'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + q[0] * k, y + q[1] * k); ctx.stroke();
      }
      ctx.fillStyle = '#ffd166'; ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    view.show({ grid: makeGrid(0, W, 0, H, 4), mode: 'image', image: cv, title: `photo ${e.right}: measured y-parallax (red) and the fitted correction (cyan), drawn 40 times longer` });
  }

  root.querySelectorAll('#cr-steps .btn').forEach(b => b.addEventListener('click', () => {
    st.step = b.dataset.s;
    root.querySelectorAll('#cr-steps .btn').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    if (st.step === 'orient' && st.ori) setup3D();
    else if (st.step === 'parallax' && Object.keys(st.corr).length) drawParallax();
    else if (st.step === 'results' && Object.keys(st.res).length === 2) showResult();
    side();
  }));
  $('#cr-cap').textContent = cfg.volume
    ? 'Units are millimetres in a local system of the test field. Yellow cones: control points. Red and cyan: left and right camera of each pair.'
    : 'Units are metres in Gauss-Krüger coordinates. Yellow cones: control points on the shore and the groyne. The white outline is the area evaluated on the water.';
  // start with the orientation done, so the set-up is visible at once
  orient(); setup3D(); side();
  return () => { view.dispose(); if (v3) v3.dispose(); };
}
