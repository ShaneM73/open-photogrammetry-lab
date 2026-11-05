// Lab L2: aerial triangulation of a block of 21 photos in three strips.
// The steps follow a production workflow: control points, strip
// connections, approximate values, automatic tie points, bundle adjustment
// with blunder detection, and checks.
import { ImageViewer, loadImage } from './image-viewer.js';
import { DATA, createViewer, toThree, line, label, cssVar } from '../demos/three-util.js';
import { loadSample, terrainMesh } from '../demos/terrain.js';
import { parseINN, parseControl } from '../core/formats.js';
import { makePhoto, greyData } from '../core/camera.js';
import { imageToGround } from '../core/orientation.js';
import { intersect } from '../core/models.js';
import { parseTiePoints, parseControlApprox, measureControl, measureStripTies, denseTies } from '../core/triangulation.js';
import { block2D, bundleAdjust } from '../core/bundle.js';

const B = DATA.replace('sample/', 'block/');
const FOCAL = 152.91;
const STEPS = [
  ['control', '1 · Control points'], ['strips', '2 · Strip connections'], ['approx', '3 · Approximate values'],
  ['aatm', '4 · Automatic tie points'], ['bundle', '5 · Bundle adjustment'], ['check', '6 · Checks and 3D'],
];

export async function mount(root) {
  root.innerHTML = `
  <div class="demo-head"><h3>Lab L2 · Aerial triangulation of 21 photos</h3><span class="hint" id="bl-status">Loading 21 photos…</span></div>
  <div class="seg" id="bl-steps" style="padding:10px 16px;border-bottom:1px solid var(--rule)">
    ${STEPS.map(([k, t], i) => `<button class="btn" data-s="${k}" aria-pressed="${i === 0}">${t}</button>`).join('')}
    <button class="btn primary" id="bl-all" style="margin-left:auto">Run all steps</button>
  </div>
  <div class="demo-body wide-side">
    <div class="stage" id="bl-stage" style="height:640px"><canvas id="bl-plan" aria-label="Plan of the block"></canvas><span class="stage-label" id="bl-plan-l"></span></div>
    <div class="side" id="bl-side" style="max-height:640px;overflow-y:auto"></div>
  </div>
  <div id="bl-insp" hidden>
    <div class="demo-head" style="border-top:1px solid var(--rule)"><h3 id="bl-insp-t">Check a control point</h3><span class="hint">Compare with the chip; click the exact spot to correct the measurement</span></div>
    <div class="demo-body"><div class="stage" style="min-height:380px"><canvas id="bl-iv" aria-label="Photo around the control point"></canvas><span class="stage-label" id="bl-iv-l"></span></div>
      <div class="side"><img id="bl-chip" width="121" height="121" alt="" style="width:181px;height:181px;image-rendering:pixelated;border-radius:6px"><div class="readout" id="bl-insp-r"></div>
      <div class="seg"><button class="btn" id="bl-acc">Accept</button><button class="btn" id="bl-rej">Reject</button></div></div></div>
  </div>
  <p class="caption">Plan view over the reference orthophoto. Outlines: photo footprints from the current orientations (strip 1 red, strip 2 white, strip 3 cyan). Triangles: control points (hollow: used as check points). Dots: tie points, coloured by the number of photos they connect.</p>`;

  const $ = s => root.querySelector(s);
  const s = await loadSample();
  const block = await (await fetch(B + 'block.json')).json();
  const ids = block.photos;
  const [ctrlText, tieText, cpText, ...inns] = await Promise.all([
    fetch(B + 'CONTROL.DAT').then(r => r.text()), fetch(B + 'TIEPOINT.DAT').then(r => r.text()), fetch(B + 'CP_ICOOR.DAT').then(r => r.text()),
    ...ids.map(id => fetch(B + id + '.INN').then(r => r.text())),
  ]);
  const controlAll = parseControl(ctrlText).map(p => ({ ...p, id: String(p.id) }));
  const strips = [ids.filter(i => +i < 150), ids.filter(i => +i >= 150 && +i < 163), ids.filter(i => +i >= 163)];
  const stripOf = id => strips.findIndex(st => st.includes(id));
  const photos = {};
  let loaded = 0;
  await Promise.all(ids.map(async (id, k) => {
    const img = await loadImage(B + id + '.jpg');
    photos[id] = makePhoto({ id, inn: parseINN(inns[k]), fullRows: 2834, scale: 2, grey: greyData(img), format: { hx: 108, hy: 108 } });
    photos[id].img = img;
    $('#bl-status').textContent = `Loading photos… ${++loaded} / ${ids.length}`;
  }));
  const chips = new Map();
  const chipImgs = {};
  await Promise.all(controlAll.map(async p => { const im = await loadImage(B + `chip_${p.id}.png`); chipImgs[p.id] = im; chips.set(p.id, greyData(im)); }));
  $('#bl-status').textContent = 'Ready';

  const st = {
    step: 'control', checkIds: new Set(), cobs: null, tobs: null, dobs: null, approx: null, sparse: null, final: null,
    log: [], eo: null, points: {}, spacing: 200, removed: 0,
  };
  const control = () => new Map(controlAll.filter(p => !st.checkIds.has(p.id)).map(p => [p.id, p]));
  const usableObs = () => [...(st.cobs || []), ...(st.tobs || []), ...(st.dobs || [])].filter(o => o.ok);

  /* ---------- plan view ---------- */
  const plan = $('#bl-plan'), ortho = await loadImage(DATA + 'ortho.jpg');
  const om = s.orthoMeta;
  let world = { xmin: om.xmin, xmax: om.xmax, ymin: om.ymin, ymax: om.ymax };
  function fitWorld() {
    world = { xmin: om.xmin, xmax: om.xmax, ymin: om.ymin, ymax: om.ymax };
    const grow = (X, Y) => { world.xmin = Math.min(world.xmin, X - 200); world.xmax = Math.max(world.xmax, X + 200); world.ymin = Math.min(world.ymin, Y - 200); world.ymax = Math.max(world.ymax, Y + 200); };
    controlAll.forEach(c => grow(c.X, c.Y));
    if (st.eo) for (const id of ids) for (const [x, y] of [[-115, -115], [115, 115], [-115, 115], [115, -115]]) { const g = imageToGround(st.eo[id], x, y, 1180); grow(g.X, g.Y); }
  }
  function drawPlan() {
    fitWorld();
    const W = plan.clientWidth, H = plan.clientHeight, dpr = Math.min(devicePixelRatio, 2);
    plan.width = W * dpr; plan.height = H * dpr;
    const ctx = plan.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sc = Math.min(W / (world.xmax - world.xmin), H / (world.ymax - world.ymin));
    const ox = (W - (world.xmax - world.xmin) * sc) / 2, oy = (H - (world.ymax - world.ymin) * sc) / 2;
    const P = (X, Y) => [ox + (X - world.xmin) * sc, oy + (world.ymax - Y) * sc];
    ctx.fillStyle = cssVar('--canvas'); ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.75; ctx.drawImage(ortho, ...P(om.xmin, om.ymax), (om.xmax - om.xmin) * sc, (om.ymax - om.ymin) * sc); ctx.globalAlpha = 1;
    const colors = [cssVar('--left'), '#ffffff', cssVar('--right')];
    if (st.eo) for (const id of ids) {
      const e = st.eo[id]; if (!e) continue;
      const cs = [[-115, -115], [115, -115], [115, 115], [-115, 115]].map(([x, y]) => { const g = imageToGround(e, x, y, 1180); return P(g.X, g.Y); });
      ctx.strokeStyle = colors[stripOf(id)]; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.85;
      ctx.beginPath(); cs.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p))); ctx.closePath(); ctx.stroke();
      ctx.globalAlpha = 1;
      const [cx, cy] = P(e.X0, e.Y0);
      ctx.fillStyle = colors[stripOf(id)]; ctx.beginPath(); ctx.arc(cx, cy, 3, 0, 7); ctx.fill();
      ctx.font = '600 11px JetBrains Mono, monospace'; ctx.fillText(id, cx + 5, cy - 5);
    }
    // tie points coloured by multiplicity
    const mult = new Map();
    for (const o of usableObs()) if (!control().has(o.point)) mult.set(o.point, (mult.get(o.point) || 0) + 1);
    const pts = st.final ? st.final.points : st.points;
    for (const [id, n] of mult) {
      const p = pts[id]; if (!p) continue;
      const [x, y] = P(p.X, p.Y);
      ctx.fillStyle = n >= 4 ? '#ffd166' : n === 3 ? '#9be37f' : '#c9d3dc';
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    for (const c of controlAll) {
      const [x, y] = P(c.X, c.Y), chk = st.checkIds.has(c.id);
      ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x + 7, y + 5); ctx.lineTo(x - 7, y + 5); ctx.closePath();
      ctx.lineWidth = 2; ctx.strokeStyle = '#ffd166';
      if (chk) ctx.stroke(); else { ctx.fillStyle = '#ffd166'; ctx.fill(); ctx.strokeStyle = '#0f1720'; ctx.stroke(); }
      ctx.fillStyle = '#ffd166'; ctx.font = '11px JetBrains Mono, monospace'; ctx.fillText(c.id, x + 8, y + 4);
    }
    $('#bl-plan-l').textContent = st.final ? `adjusted block · σ₀ ${(st.final.sigma0 * 1000).toFixed(0)} µm` : st.eo ? 'approximate orientations' : 'control points of the block';
  }
  new ResizeObserver(drawPlan).observe(plan);

  /* ---------- control point inspector ---------- */
  let inspected = null;
  const iv = new ImageViewer($('#bl-iv'), {
    onClick: (u, v) => {
      if (!inspected) return;
      const p = photos[inspected.photo], mm = p.fromRaster(u, v);
      Object.assign(inspected, { x: mm.x, y: mm.y, ok: true, manual: true, blunder: false });
      showInspector(inspected); renderSide();
    },
    onDraw: (ctx, vw) => {
      if (!inspected) return;
      const p = photos[inspected.photo], [u, v] = p.toRaster(inspected.x, inspected.y);
      const [x, y] = vw.toScreen(u, v);
      ctx.strokeStyle = inspected.ok ? '#ffd166' : '#ef6f5c'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x - 14, y); ctx.lineTo(x - 4, y); ctx.moveTo(x + 4, y); ctx.lineTo(x + 14, y); ctx.moveTo(x, y - 14); ctx.lineTo(x, y - 4); ctx.moveTo(x, y + 4); ctx.lineTo(x, y + 14); ctx.stroke();
      $('#bl-iv-l').textContent = `photo ${inspected.photo} (half resolution) · zoom ${vw.scale.toFixed(1)}×`;
    },
  });
  function showInspector(o) {
    inspected = o;
    $('#bl-insp').hidden = false;
    $('#bl-insp-t').textContent = `Control point ${o.point} in photo ${o.photo}`;
    $('#bl-chip').src = chipImgs[o.point].src; $('#bl-chip').alt = `Image chip of control point ${o.point}`;
    const p = photos[o.photo];
    if (iv.img !== p.img) iv.setImage(p.img);
    const [u, v] = p.toRaster(o.x, o.y);
    iv.goTo(u, v, 3);
    $('#bl-insp-r').innerHTML = `Correlation with the chip: <b>${o.r.toFixed(2)}</b><br>${o.blunder ? 'removed by the bundle adjustment: its residual was more than 4 σ₀' : o.manual ? 'measured by hand' : o.ok ? 'accepted automatically' : 'rejected (r below 0.6)'}<br>The chip is enlarged to the same scale as the photo shown (the photos here have half the scan resolution).`;
  }
  $('#bl-acc').addEventListener('click', () => { if (inspected) { inspected.ok = true; inspected.blunder = false; showInspector(inspected); renderSide(); } });
  $('#bl-rej').addEventListener('click', () => { if (inspected) { inspected.ok = false; showInspector(inspected); renderSide(); } });

  /* ---------- the steps ---------- */
  const tick = () => new Promise(r => setTimeout(r, 0));
  const ACTIONS = {
    async control() { st.cobs = measureControl(photos, chips, parseControlApprox(cpText)); },
    async strips() { st.tobs = measureStripTies(photos, parseTiePoints(tieText)); },
    async approx() {
      const b = block2D(ids, usableObs().filter(o => o.kind !== 'dense'), control(), FOCAL);
      st.approx = b; st.eo = b.eo; st.points = b.points;
      for (const id of ids) photos[id].setEO(b.eo[id]);
      const sp = bundleAdjust({ photos: b.eo, points: b.points, control: control(), obs: usableObs().filter(o => o.kind !== 'dense'), focal: FOCAL }, { maxIter: 8 });
      st.sparse = sp; st.eo = sp.photos; st.points = { ...sp.points };
      for (const id of ids) photos[id].setEO(sp.photos[id]);
    },
    async aatm(progress) {
      const known = [...Object.values(st.points), ...control().values()];
      const hAt = (X, Y) => { let best = null, bd = Infinity; for (const p of known) { const d = (p.X - X) ** 2 + (p.Y - Y) ** 2; if (d < bd) { bd = d; best = p; } } return best.Z; };
      const xs = ids.map(i => st.eo[i].X0), ys = ids.map(i => st.eo[i].Y0);
      const area = { xmin: Math.min(...xs) - 900, xmax: Math.max(...xs) + 900, ymin: Math.min(...ys) - 900, ymax: Math.max(...ys) + 900 };
      st.dobs = await denseTies(photos, area, st.spacing, hAt, { onProgress: (f, n) => progress(`${Math.round(f * 100)} % · ${n} measurements`) });
      // starting positions for the new points: their ray from the first photo at the local height
      for (const o of st.dobs) if (!st.points[o.point]) {
        const e = st.eo[o.photo], Z = hAt(e.X0, e.Y0), g = imageToGround(e, o.x, o.y, Z);
        st.points[o.point] = { X: g.X, Y: g.Y, Z };
      }
    },
    async bundle(progress) {
      st.log = []; st.removed = 0;
      let res;
      for (let round = 0; round < 4; round++) {
        res = bundleAdjust({ photos: st.eo, points: st.points, control: control(), obs: usableObs(), focal: FOCAL }, { maxIter: 8 });
        const lim = 4 * res.sigma0;
        const bad = res.residuals.filter(r => Math.hypot(r.vx, r.vy) > lim);
        st.log.push({ round: round + 1, sigma0: res.sigma0, removed: bad.length, nObs: res.nObs, red: res.redundancy, iters: res.history.length - 1 });
        progress(`round ${round + 1}: σ₀ ${(res.sigma0 * 1000).toFixed(0)} µm, ${bad.length} blunders removed`);
        await tick();
        if (!bad.length) break;
        const key = new Set(bad.map(r => r.photo + '|' + r.point));
        for (const o of usableObs()) if (key.has(o.photo + '|' + o.point)) { o.ok = false; o.blunder = true; st.removed++; }
        st.eo = res.photos; st.points = { ...st.points, ...res.points };
      }
      st.final = res; st.eo = res.photos; st.points = { ...st.points, ...res.points };
      for (const id of ids) photos[id].setEO(res.photos[id]);
    },
    async check() {},
  };
  const ORDER = STEPS.map(x => x[0]);
  const ready = step => ({ control: true, strips: true, approx: !!(st.cobs && st.tobs), aatm: !!st.sparse, bundle: !!st.sparse, check: !!st.final })[step];

  async function runStep(step) {
    const btn = $('#bl-run');
    if (btn) btn.disabled = true;
    const prog = m => { const el = $('#bl-prog'); if (el) { el.hidden = false; el.innerHTML = m; } };
    prog('working…'); await tick();
    const t0 = performance.now();
    try { await ACTIONS[step](prog); st[step + 'Time'] = (performance.now() - t0) / 1000; }
    catch (e) { console.error(e); st[step + 'Error'] = e.message; }
    if (['control', 'strips', 'approx', 'aatm'].includes(step)) { st.final = null; if (step !== 'aatm') st.dobs = step === 'approx' ? st.dobs : null; }
    renderSide(); drawPlan();
  }

  /* ---------- side panel per step ---------- */
  function renderSide() {
    const side = $('#bl-side'), step = st.step;
    const runBtn = (label) => ready(step) ? `<button class="btn primary" id="bl-run">${label}</button><div class="readout" id="bl-prog" hidden></div>` : `<div class="readout">Finish the earlier steps first.</div>`;
    let html = '';
    if (step === 'control') {
      html = `<p style="margin:0">Each control point has a small image chip. The software searches for it near its approximate position in every photo that shows it. Click a row to check a measurement yourself. Tick <em>check</em> to keep a point out of the adjustment and use it for an independent accuracy test.</p>${runBtn('Measure control points')}`;
      if (st.cobs) {
        html += `<div class="table-wrap"><table class="data" id="bl-ct"><thead><tr><th>Point</th><th>Photo</th><th>r</th><th>Status</th></tr></thead><tbody>` +
          st.cobs.map((o, i) => `<tr data-i="${i}"><td>${o.point}</td><td>${o.photo}</td><td>${o.r.toFixed(2)}</td><td>${o.blunder ? '<span class="pill warn">removed by adjustment</span>' : o.manual ? '<span class="pill good">by hand</span>' : o.ok ? '<span class="pill good">ok</span>' : '<span class="pill bad">rejected</span>'}</td></tr>`).join('') + '</tbody></table></div>';
        html += `<div class="ctrl"><label>Use as check points (not in the adjustment)</label><div class="seg" id="bl-chk">${controlAll.map(c => `<button class="btn" data-id="${c.id}" aria-pressed="${st.checkIds.has(c.id)}">${c.id}</button>`).join('')}</div></div>`;
      }
    } else if (step === 'strips') {
      html = `<p style="margin:0">Strip connections tie the three strips together. Their rough positions were picked by hand on small overview images (file TIEPOINT.DAT). The software moves each to a well-defined spot in its first photo and finds it by matching in the others.</p>${runBtn('Measure strip connections')}`;
      if (st.tobs) {
        const n = new Set(st.tobs.map(o => o.point)).size, ok = st.tobs.filter(o => o.ok).length;
        html += `<div class="readout">${n} points, ${st.tobs.length} measurements, ${ok} accepted (r ≥ 0.75)<br>Time ${st.stripsTime.toFixed(1)} s</div>`;
      }
    } else if (step === 'approx') {
      html = `<p style="margin:0">A bundle adjustment needs starting values. First, every photo is treated as a flat map and fitted by a 2D similarity transformation, all photos at once (a 2D block adjustment). That gives each photo's position, rotation κ and scale, and so its flying height. A first bundle adjustment with only the control and strip points then refines them.</p>${runBtn('Compute approximate values')}`;
      if (st.approx) html += `<div class="readout">2D block: σ₀ <b>${st.approx.sigma0.toFixed(1)} m</b> on the ground<br>First bundle: σ₀ <b>${(st.sparse.sigma0 * 1000).toFixed(0)} µm</b> with ${st.sparse.nObs} observations</div>`;
    } else if (step === 'aatm') {
      html = `<p style="margin:0">With the photos approximately oriented, the software can predict where any ground point appears. It lays a grid over the block, picks a well-defined spot near each grid point in the photo closest to its nadir, and matches it into every other photo that shows it.</p>
        <div class="ctrl"><label>Grid spacing</label><div class="seg" id="bl-sp">${[300, 200, 150].map(v => `<button class="btn" data-v="${v}" aria-pressed="${st.spacing === v}">${v} m</button>`).join('')}</div></div>${runBtn('Find tie points')}`;
      if (st.dobs) {
        const per = new Map(); for (const o of st.dobs) per.set(o.point, (per.get(o.point) || 0) + 1);
        const hist = [2, 3, 4, 5, 6].map(k => [k, [...per.values()].filter(n => (k === 6 ? n >= 6 : n === k)).length]);
        html += `<div class="readout">${per.size} points, ${st.dobs.length} measurements in ${st.aatmTime.toFixed(1)} s<br>Photos per point: ${hist.map(([k, n]) => `${k === 6 ? '6+' : k}: ${n}`).join(' · ')}</div>`;
      }
    } else if (step === 'bundle') {
      html = `<p style="margin:0">All measurements together: ${usableObs().length} image points. Each round adjusts the whole block, then removes measurements whose residual exceeds four times σ₀ (likely mismatches), until none is left.</p>${runBtn('Run the bundle adjustment')}`;
      if (st.final) {
        html += `<div class="table-wrap"><table class="data"><thead><tr><th>Round</th><th>σ₀ µm</th><th>Removed</th><th>Redundancy</th></tr></thead><tbody>` +
          st.log.map(l => `<tr><td>${l.round}</td><td>${(l.sigma0 * 1000).toFixed(1)}</td><td>${l.removed}</td><td>${l.red}</td></tr>`).join('') + '</tbody></table></div>';
        html += `<div class="readout">Final σ₀ <b>${(st.final.sigma0 * 1000).toFixed(0)} µm</b> = ${(st.final.sigma0 * 1000 / 84.7).toFixed(2)} scan pixels<br>${st.final.nObs} observations, ${st.final.nUnknowns} unknowns</div>`;
        html += `<div class="table-wrap"><table class="data"><thead><tr><th>Photo</th><th>σX₀ m</th><th>σY₀ m</th><th>σZ₀ m</th><th>σκ °</th></tr></thead><tbody>` +
          ids.map(id => { const sd = st.final.photos[id].std; return `<tr><td>${id}</td><td>${sd[0].toFixed(2)}</td><td>${sd[1].toFixed(2)}</td><td>${sd[2].toFixed(2)}</td><td>${(sd[5] * 180 / Math.PI).toFixed(4)}</td></tr>`; }).join('') + '</tbody></table></div>';
      }
    } else if (step === 'check') {
      html = ready('check') ? checkReport() + `<button class="btn primary" id="bl-3d">Show the block in 3D</button>` : '<div class="readout">Run the bundle adjustment first.</div>';
    }
    side.innerHTML = html;
    side.querySelector('#bl-run')?.addEventListener('click', () => runStep(step));
    side.querySelectorAll('#bl-ct tr[data-i]').forEach(tr => tr.addEventListener('click', () => showInspector(st.cobs[Number(tr.dataset.i)])));
    side.querySelectorAll('#bl-chk .btn').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.id; st.checkIds.has(id) ? st.checkIds.delete(id) : st.checkIds.add(id);
      st.final = null; renderSide(); drawPlan();
    }));
    side.querySelectorAll('#bl-sp .btn').forEach(b => b.addEventListener('click', () => { st.spacing = Number(b.dataset.v); renderSide(); }));
    side.querySelector('#bl-3d')?.addEventListener('click', show3D);
  }

  function checkReport() {
    const res = st.final;
    let html = '';
    const ck = controlAll.filter(c => st.checkIds.has(c.id) && res.points[c.id]);
    if (ck.length) {
      const d = ck.map(c => ({ id: c.id, dX: res.points[c.id].X - c.X, dY: res.points[c.id].Y - c.Y, dZ: res.points[c.id].Z - c.Z }));
      const rms = k => Math.sqrt(d.reduce((s, e) => s + e[k] ** 2, 0) / d.length);
      html += `<div class="readout"><b>Your check points</b><br>` + d.map(e => `${e.id} ${e.dX.toFixed(2).padStart(6)} ${e.dY.toFixed(2).padStart(6)} ${e.dZ.toFixed(2).padStart(6)}`).join('<br>') +
        `<br>RMS X ${rms('dX').toFixed(2)}  Y ${rms('dY').toFixed(2)}  Z ${rms('dZ').toFixed(2)} m</div>`;
    } else html += `<div class="readout">No check points chosen. In step 1 you can keep some control points out of the adjustment to test the result independently.</div>`;
    // independent test with the surveyed points of Lab L1 (photos 157 and 158)
    const a = s.abs[157], b = s.abs[158];
    const common = a.points.filter(p => b.points.some(q => q.id === p.id));
    const d = common.map(p => {
      const q = b.points.find(r => r.id === p.id);
      const P = intersect([{ eo: res.photos['157'], x: p.x, y: p.y }, { eo: res.photos['158'], x: q.x, y: q.y }]);
      return { id: p.id, dX: P.X - p.X, dY: P.Y - p.Y, dZ: P.Z - p.Z };
    });
    const rms = k => Math.sqrt(d.reduce((s2, e) => s2 + e[k] ** 2, 0) / d.length);
    html += `<div class="readout"><b>Independent check: the six surveyed points of Lab L1</b>, measured in photos 157 and 158 and intersected with the block orientations (m)<br>` +
      d.map(e => `${e.id} ${e.dX.toFixed(2).padStart(6)} ${e.dY.toFixed(2).padStart(6)} ${e.dZ.toFixed(2).padStart(6)}`).join('<br>') +
      `<br>RMS X <b>${rms('dX').toFixed(2)}</b>  Y <b>${rms('dY').toFixed(2)}</b>  Z <b>${rms('dZ').toFixed(2)}</b></div>`;
    return html;
  }

  let v3 = null;
  async function show3D() {
    if (v3) { v3.dispose(); v3 = null; return; }
    plan.hidden = true;
    v3 = createViewer($('#bl-stage'), { near: 10, far: 80000 });
    const origin = s.origin;
    v3.scene.add(await terrainMesh(s, origin));
    const colors = [cssVar('--left'), '#ffffff', cssVar('--right')];
    for (const id of ids) {
      const e = st.final.photos[id], O = toThree(e.X0, e.Y0, e.Z0, origin);
      const m = new THREE.Mesh(new THREE.SphereGeometry(35, 12, 8), new THREE.MeshBasicMaterial({ color: colors[stripOf(id)] }));
      m.position.copy(O); v3.scene.add(m);
      const k = 300 / FOCAL;
      const cs = [[-115, -115], [115, -115], [115, 115], [-115, 115]].map(([x, y]) => { const d = [0, 1, 2].map(i => e.R[i][0] * x * k + e.R[i][1] * y * k - e.R[i][2] * FOCAL * k); return toThree(e.X0 + d[0], e.Y0 + d[1], e.Z0 + d[2], origin); });
      v3.scene.add(line([...cs, cs[0]], colors[stripOf(id)]));
      cs.forEach(c => v3.scene.add(line([O, c], colors[stripOf(id)], { opacity: 0.35 })));
    }
    const pos = [];
    for (const p of Object.values(st.final.points)) { const t = toThree(p.X, p.Y, p.Z, origin); pos.push(t.x, t.y + 8, t.z); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    v3.scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffd166, size: 30 })));
    v3.camera.position.set(-6000, 6000, 6000); v3.controls.target.set(0, 400, 0);
    $('#bl-3d').textContent = 'Back to the plan view';
    const old = v3.dispose; v3.dispose = () => { old(); plan.hidden = false; drawPlan(); };
  }

  root.querySelectorAll('#bl-steps [data-s]').forEach(b => b.addEventListener('click', () => {
    st.step = b.dataset.s;
    root.querySelectorAll('#bl-steps [data-s]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    if (v3) v3.dispose(), (v3 = null);
    renderSide();
  }));
  $('#bl-all').addEventListener('click', async () => {
    $('#bl-all').disabled = true;
    for (const step of ORDER.slice(0, 5)) {
      st.step = step;
      root.querySelectorAll('#bl-steps [data-s]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.s === step)));
      renderSide();
      await runStep(step);
    }
    st.step = 'check';
    root.querySelectorAll('#bl-steps [data-s]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.s === 'check')));
    renderSide();
    $('#bl-all').disabled = false;
  });
  renderSide(); drawPlan();
  return () => { iv.dispose(); if (v3) v3.dispose(); };
}
