// Lab L1: a single stereo model.
// Part A: measure control points in photos 157 and 158, resect each photo.
// Part B: view the model in stereo and measure heights with a floating mark.
import { ImageViewer, loadImage } from './image-viewer.js';
import { pixelToCamera, cameraToPixel, groundToImage } from '../core/orientation.js';
import { resection } from '../core/models.js';
import { loadSample } from '../demos/terrain.js';
import { DATA } from '../demos/three-util.js';
import { greyData, makeProjector, renderPair, matchHeight } from './stereo-render.js';

const IDS = ['157', '158'];
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '–');

export async function mount(root) {
  root.innerHTML = `
  <div class="demo-head"><h3>Lab L1 · Part A: control points in both photos</h3><span class="hint">Pick a point in the table, find it in each photo, click its centre</span></div>
  <div class="pair">
    ${IDS.map(id => `<div class="stage" style="min-height:440px"><canvas id="ml-c${id}" aria-label="Photo ${id}"></canvas>
      <span class="stage-label" id="ml-l${id}">photo ${id}</span>
      <div style="position:absolute;right:10px;bottom:10px;display:flex;gap:4px">
        <button class="btn" data-z="${id}" data-f="1.6" aria-label="Zoom in">+</button><button class="btn" data-z="${id}" data-f="0.625" aria-label="Zoom out">−</button></div></div>`).join('')}
  </div>
  <div class="lab-panel">
    <div style="min-width:0">
      <div class="table-wrap"><table class="data" id="ml-tab"></table></div>
      <div class="seg" style="margin-top:10px"><button class="btn" id="ml-ref">Fill in reference measurements</button><button class="btn" id="ml-clear">Clear</button></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:12px;min-width:0">
      <div style="display:flex;gap:12px;align-items:flex-start"><img id="ml-chip" alt="" width="121" height="121" style="image-rendering:pixelated;border-radius:6px;background:var(--canvas)">
        <div class="readout" id="ml-hint" style="flex:1">Choose a control point. The small picture shows what it looks like on the ground, at the centre of the chip.</div></div>
      <div class="readout" id="ml-res"></div>
    </div>
  </div>

  <div class="demo-head" style="border-top:1px solid var(--rule)"><h3>Part B: the model in stereo</h3><span class="hint">Red-cyan glasses for 3D · drag to move · scroll to zoom</span></div>
  <div class="demo-body">
    <div class="stage" style="min-height:460px"><canvas id="ml-st" aria-label="Stereo view of the model"></canvas><span class="stage-label" id="ml-stl"></span></div>
    <div class="side">
      <div class="ctrl"><label>Display</label><div class="seg" id="ml-mode">
        <button class="btn" data-m="anaglyph" aria-pressed="true">Anaglyph</button><button class="btn" data-m="flicker" aria-pressed="false">Flicker</button><button class="btn" data-m="side" aria-pressed="false">Side by side</button></div></div>
      <div class="ctrl"><label for="ml-z">Floating mark height <output id="ml-zo"></output></label><input type="range" id="ml-z" min="1000" max="1700" step="0.5" value="1180"></div>
      <div class="seg"><button class="btn" data-dz="-5">−5</button><button class="btn" data-dz="-1">−1</button><button class="btn" data-dz="1">+1</button><button class="btn" data-dz="5">+5</button><button class="btn primary" id="ml-snap">Snap to surface</button></div>
      <div class="ctrl"><label for="ml-go">Go to control point</label><select id="ml-go" class="btn" style="text-align:left"></select></div>
      <div class="readout" id="ml-st-read"></div>
      <button class="btn" id="ml-rec">Record this point</button>
      <div class="table-wrap"><table class="data" id="ml-pts"></table></div>
    </div>
  </div>
  <p class="caption">The stereo view resamples both photos onto a level plane at the height of the floating mark (the white cross). Ground at that height lines up in both images; higher and lower ground separate, red and cyan, along the flight direction. When the mark sits on the ground, the two images agree exactly at the cross.</p>`;

  const $ = s => root.querySelector(s);
  const s = await loadSample();
  const ctrl = s.control;
  const state = { active: null, meas: { 157: {}, 158: {} }, eo: { 157: null, 158: null }, own: false };

  // ---------- Part A ----------
  const imgs = await Promise.all(IDS.map(id => loadImage(DATA + id + '.png')));
  const viewers = {};
  IDS.forEach((id, k) => {
    viewers[id] = new ImageViewer($(`#ml-c${id}`), {
      onClick: (u, v) => {
        if (state.active == null) return;
        const px = viewers[id].toPixel(u, v);
        state.meas[id][state.active] = pixelToCamera(s.inn[id].coef, px.col, px.row);
        update();
      },
      onDraw: (ctx, vw) => {
        for (const p of ctrl) {
          const m = state.meas[id][p.id];
          const eo = state.eo[id];
          if (eo) { // predicted position from this photo's resection
            const q = groundToImage(eo, p.X, p.Y, p.Z), px = cameraToPixel(s.inn[id].coef, q.x, q.y);
            const [x, y] = vw.toScreen(...vw.fromPixel(px.col, px.row));
            ctx.strokeStyle = '#3cc3d6'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.stroke();
          }
          if (m) {
            const px = cameraToPixel(s.inn[id].coef, m.x, m.y);
            const [x, y] = vw.toScreen(...vw.fromPixel(px.col, px.row));
            ctx.strokeStyle = p.id === state.active ? '#ffffff' : '#ffd166'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(x - 12, y); ctx.lineTo(x - 3, y); ctx.moveTo(x + 3, y); ctx.lineTo(x + 12, y);
            ctx.moveTo(x, y - 12); ctx.lineTo(x, y - 3); ctx.moveTo(x, y + 3); ctx.lineTo(x, y + 12); ctx.stroke();
            ctx.fillStyle = '#ffd166'; ctx.font = '600 12px JetBrains Mono, monospace'; ctx.fillText(String(p.id), x + 10, y - 10);
          }
        }
        $(`#ml-l${id}`).textContent = `photo ${id} · zoom ${vw.scale >= 1 ? vw.scale.toFixed(1) : vw.scale.toFixed(2)}×`;
      },
    });
    viewers[id].setImage(imgs[k]);
  });
  root.querySelectorAll('[data-z]').forEach(b => b.addEventListener('click', () => { const vw = viewers[b.dataset.z]; vw.zoomAt(vw.w / 2, vw.h / 2, Number(b.dataset.f)); }));

  // Where a point lies in a photo, for navigation: from this photo's own
  // resection once available, otherwise from the reference orientation.
  const locate = (id, p) => {
    const eo = state.eo[id] || s.abs[id];
    const q = groundToImage(eo, p.X, p.Y, p.Z), px = cameraToPixel(s.inn[id].coef, q.x, q.y);
    const inside = px.col > 0 && px.col < imgs[0].width && px.row > 0 && px.row < imgs[0].height;
    return { ...px, inside, precise: !!state.eo[id] };
  };

  function select(pid) {
    state.active = pid;
    const p = ctrl.find(c => c.id === pid);
    $('#ml-chip').src = `${DATA}chip_${pid}.png`; $('#ml-chip').alt = `Ground around control point ${pid}`;
    const where = IDS.map(id => {
      const L = locate(id, p);
      if (L.inside) viewers[id].goTo(...viewers[id].fromPixel(L.col, L.row), L.precise ? 3 : 0.6);
      return `${id}: ${L.inside ? (L.precise ? 'predicted from your resection' : 'in this area, find it') : 'not in this photo'}`;
    });
    $('#ml-hint').innerHTML = `<b>Point ${pid}</b><br>X ${p.X.toFixed(2)}  Y ${p.Y.toFixed(2)}  Z ${p.Z.toFixed(2)}<br>${where.join('<br>')}`;
    update();
  }

  function update() {
    const res = {};
    for (const id of IDS) {
      const pts = ctrl.filter(p => state.meas[id][p.id]).map(p => ({ id: p.id, ...state.meas[id][p.id], X: p.X, Y: p.Y, Z: p.Z }));
      state.eo[id] = null;
      if (pts.length >= 4) {
        try { const r = resection(pts, s.abs[id].focal); if ([r.X0, r.Y0, r.Z0].every(Number.isFinite)) { state.eo[id] = r; res[id] = r; } }
        catch (e) { res[id] = { error: e.message }; }
      }
      viewers[id].draw();
    }
    const vres = (id, pid) => { const r = res[id]; const q = r && r.residuals && r.residuals.find(x => x.id === pid); return q ? (Math.hypot(q.vx, q.vy) * 1000).toFixed(0) : ''; };
    $('#ml-tab').innerHTML = `<thead><tr><th>Point</th><th>157</th><th>158</th><th>Residual 157 (µm)</th><th>Residual 158 (µm)</th></tr></thead><tbody>` +
      ctrl.map(p => `<tr data-id="${p.id}" class="${p.id === state.active ? 'active' : ''}"><td>${p.id}</td>` +
        IDS.map(id => `<td>${state.meas[id][p.id] ? '✓' : locate(id, p).inside ? '·' : ''}</td>`).join('') +
        `<td>${vres('157', p.id)}</td><td>${vres('158', p.id)}</td></tr>`).join('') + '</tbody>';
    $('#ml-tab').querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => select(Number(tr.dataset.id))));
    const deg = r => (r * 180 / Math.PI).toFixed(4);
    $('#ml-res').innerHTML = IDS.map(id => {
      const r = res[id], ref = s.abs[id], n = Object.keys(state.meas[id]).length;
      if (!r) return `<b>Photo ${id}</b>: ${n} point${n === 1 ? '' : 's'} measured, resection needs 4 (3 + 1 check).`;
      if (r.error) return `<b>Photo ${id}</b>: ${r.error}`;
      const q = r.sigma0 * 1000;
      return `<b>Photo ${id}</b> · σ₀ <b>${q.toFixed(0)} µm</b> ${q < 130 ? '<span class="pill good">good</span>' : q < 250 ? '<span class="pill warn">check</span>' : '<span class="pill bad">re-measure</span>'}<br>` +
        `X₀ ${fmt(r.X0)} Y₀ ${fmt(r.Y0)} Z₀ ${fmt(r.Z0)}<br>ω ${deg(r.omega)}° φ ${deg(r.phi)}° κ ${deg(r.kappa)}°<br>` +
        `Camera is ${Math.hypot(r.X0 - ref.X0, r.Y0 - ref.Y0, r.Z0 - ref.Z0).toFixed(2)} m from the reference solution`;
    }).join('<br><br>');
    refreshStereoSource();
  }

  $('#ml-ref').addEventListener('click', () => {
    for (const id of IDS) for (const p of s.abs[id].points) state.meas[id][p.id] = { x: p.x, y: p.y };
    update();
  });
  $('#ml-clear').addEventListener('click', () => { state.meas = { 157: {}, 158: {} }; update(); });

  // ---------- Part B: stereo ----------
  const grey = { 157: greyData(imgs[0]), 158: greyData(imgs[1]) };
  const st = $('#ml-st'), sctx = st.getContext('2d');
  const view = { X: 0, Y: 0, gsd: 2, ex: [0, 1] };
  let Z = 1180, mode = 'anaglyph', projL, projR, phase = 0, flick = 0, srcLabel = '', recorded = [];

  function refreshStereoSource() {
    const own = state.eo[157] && state.eo[158];
    const eoL = own ? state.eo[157] : s.abs[157], eoR = own ? state.eo[158] : s.abs[158];
    srcLabel = own ? 'your orientations' : 'reference orientations';
    projL = makeProjector(eoL, s.inn[157], grey[157]);
    projR = makeProjector(eoR, s.inn[158], grey[158]);
    const B = Math.hypot(eoR.X0 - eoL.X0, eoR.Y0 - eoL.Y0);
    view.ex = [(eoR.X0 - eoL.X0) / B, (eoR.Y0 - eoL.Y0) / B];
    state.eoPair = [eoL, eoR];
    drawStereo();
  }

  function drawStereo() {
    if (!projL) return;
    const W = Math.max(50, Math.floor(st.clientWidth)), H = Math.max(50, Math.floor(st.clientHeight));
    if (st.width !== W || st.height !== H) { st.width = W; st.height = H; }
    renderPair(sctx, W, H, view, Z, projL, projR, mode, phase);
    const cross = (cx, cy) => {
      sctx.strokeStyle = '#ffffff'; sctx.lineWidth = 2;
      sctx.beginPath(); sctx.moveTo(cx - 10, cy); sctx.lineTo(cx - 3, cy); sctx.moveTo(cx + 3, cy); sctx.lineTo(cx + 10, cy);
      sctx.moveTo(cx, cy - 10); sctx.lineTo(cx, cy - 3); sctx.moveTo(cx, cy + 3); sctx.lineTo(cx, cy + 10); sctx.stroke();
    };
    if (mode === 'side') { cross(W / 4, H / 2); cross(3 * W / 4, H / 2); sctx.fillStyle = '#0f1720'; sctx.fillRect(W / 2 - 1, 0, 2, H); }
    else cross(W / 2, H / 2);
    const dem = s.heightAt(view.X, view.Y);
    $('#ml-zo').textContent = Z.toFixed(1) + ' m';
    $('#ml-stl').textContent = `${srcLabel} · ${view.gsd.toFixed(1)} m per screen pixel`;
    $('#ml-st-read').innerHTML = `Mark at X ${view.X.toFixed(1)}  Y ${view.Y.toFixed(1)}<br>Z <b>${Z.toFixed(1)} m</b>` +
      (Number.isFinite(dem) ? `<br>Reference terrain model: ${dem.toFixed(1)} m (Δ ${(Z - dem).toFixed(1)})` : '') +
      (state.lastMatch ? `<br>Match quality r = ${state.lastMatch.toFixed(2)}` : '');
  }

  const setZ = z => { Z = Math.max(1000, Math.min(1700, z)); $('#ml-z').value = Z; state.lastMatch = null; drawStereo(); };
  $('#ml-z').addEventListener('input', e => setZ(Number(e.target.value)));
  root.querySelectorAll('[data-dz]').forEach(b => b.addEventListener('click', () => setZ(Z + Number(b.dataset.dz))));
  $('#ml-snap').addEventListener('click', () => {
    const m = matchHeight(view, view.X, view.Y, projL, projR, Math.max(1000, Z - 120), Math.min(1700, Z + 120), 0.5, 10, Math.max(1.5, view.gsd));
    if (Number.isFinite(m.z)) { setZ(m.z); state.lastMatch = m.r; drawStereo(); }
  });
  root.querySelectorAll('#ml-mode .btn').forEach(b => b.addEventListener('click', () => {
    mode = b.dataset.m;
    root.querySelectorAll('#ml-mode .btn').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    clearInterval(flick);
    if (mode === 'flicker') flick = setInterval(() => { phase ^= 1; drawStereo(); }, 450);
    drawStereo();
  }));
  $('#ml-go').innerHTML = `<option value="">Choose…</option>` + ctrl.map(p => `<option value="${p.id}">${p.id}  (Z ${p.Z.toFixed(1)})</option>`).join('');
  $('#ml-go').addEventListener('change', e => {
    const p = ctrl.find(c => c.id === Number(e.target.value)); if (!p) return;
    view.X = p.X; view.Y = p.Y; view.gsd = 0.6; setZ(Math.round(p.Z / 5) * 5 + 12);
  });
  $('#ml-rec').addEventListener('click', () => {
    recorded.push({ n: recorded.length + 1, X: view.X, Y: view.Y, Z, dem: s.heightAt(view.X, view.Y) });
    $('#ml-pts').innerHTML = `<thead><tr><th>#</th><th>X</th><th>Y</th><th>Z</th><th>Δ DEM</th></tr></thead><tbody>` +
      recorded.map(r => `<tr><td>${r.n}</td><td>${r.X.toFixed(1)}</td><td>${r.Y.toFixed(1)}</td><td>${r.Z.toFixed(1)}</td><td>${fmt(r.Z - r.dem, 1)}</td></tr>`).join('') + '</tbody>';
  });

  // pan and zoom in the stereo view
  let drag = null;
  st.addEventListener('pointerdown', e => { st.setPointerCapture(e.pointerId); drag = [e.clientX, e.clientY, view.X, view.Y]; });
  st.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = (e.clientX - drag[0]) * view.gsd, dy = (e.clientY - drag[1]) * view.gsd;
    view.X = drag[2] - dx * view.ex[0] - dy * view.ex[1]; view.Y = drag[3] - dx * view.ex[1] + dy * view.ex[0];
    drawStereo();
  });
  st.addEventListener('pointerup', () => (drag = null));
  st.addEventListener('wheel', e => { e.preventDefault(); view.gsd = Math.max(0.3, Math.min(12, view.gsd * Math.exp(e.deltaY * 0.0015))); drawStereo(); }, { passive: false });
  const ro = new ResizeObserver(drawStereo); ro.observe(st);

  // start in the middle of the overlap, on the town
  const [a, b] = [s.abs[157], s.abs[158]];
  view.X = (a.X0 + b.X0) / 2; view.Y = (a.Y0 + b.Y0) / 2;
  update();
  setZ(Math.round(s.heightAt(view.X, view.Y) || 1180));
  return () => { clearInterval(flick); ro.disconnect(); IDS.forEach(id => viewers[id].dispose()); };
}
