// Lab: interior orientation of a scanned aerial photograph.
// Measure the fiducial marks, fit an affine (or similarity) transformation
// from camera millimetres to scanner pixels, and inspect the residuals.
import { ImageViewer, loadImage } from './image-viewer.js';
import { parseCMR, parseINN, parseIMA } from '../core/formats.js';
import { fitInterior, pixelToCamera } from '../core/orientation.js';
import { DATA } from '../demos/three-util.js';

const fmt = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '–');

export async function mount(root) {
  root.innerHTML = `
  <div class="demo-head"><h3>Lab · Interior orientation</h3><span class="hint">Pick a fiducial in the table, then click its centre in the image</span></div>
  <div class="demo-body wide-side">
    <div class="stage" style="min-height:560px"><canvas id="io-c" aria-label="Scanned aerial photograph"></canvas>
      <span class="stage-label" id="io-lbl">Loading image…</span>
      <div style="position:absolute;right:10px;bottom:10px;display:flex;gap:4px">
        <button class="btn" id="io-zin" aria-label="Zoom in">+</button><button class="btn" id="io-zout" aria-label="Zoom out">−</button><button class="btn" id="io-fit">Whole image</button>
      </div>
    </div>
    <div class="side">
      <div class="ctrl"><label>Photograph</label><div class="seg" id="io-img">
        <button class="btn" data-img="157" aria-pressed="true">157</button><button class="btn" data-img="158" aria-pressed="false">158</button>
        <label class="btn" for="io-file" style="display:inline-flex;align-items:center">Open your own…</label>
        <input type="file" id="io-file" accept=".png,.jpg,.jpeg,.ima,.IMA" hidden>
        <label class="btn" for="io-cmr" style="display:inline-flex;align-items:center">Camera file…</label>
        <input type="file" id="io-cmr" accept=".cmr,.CMR,.txt" hidden>
      </div></div>
      <div class="ctrl"><label>Transformation</label><div class="seg" id="io-model">
        <button class="btn" data-m="affine" aria-pressed="true">Affine (6)</button><button class="btn" data-m="similarity" aria-pressed="false">Similarity (4)</button></div></div>
      <div class="table-wrap"><table class="data" id="io-tab"></table></div>
      <div class="seg"><button class="btn" id="io-book">Fill in reference measurements</button><button class="btn" id="io-clear">Clear</button></div>
      <div class="readout" id="io-res">Measure at least three fiducials.</div>
      <div class="ctrl"><label for="io-b">Brightness <output id="io-bo">100%</output></label><input type="range" id="io-b" min="40" max="220" value="100"></div>
      <div class="ctrl"><label for="io-k">Contrast <output id="io-ko">100%</output></label><input type="range" id="io-k" min="40" max="300" value="100"></div>
      <details><summary style="cursor:pointer;font-size:13px">Result file (.INN)</summary>
        <textarea id="io-out" readonly rows="10" style="width:100%;font:12px var(--font-mono);margin-top:6px;background:var(--paper);color:var(--ink);border:1px solid var(--rule);border-radius:6px"></textarea>
        <button class="btn" id="io-copy">Copy</button></details>
    </div>
  </div>
  <p class="caption">Yellow cross: your measurement. Cyan circle: where the fitted transformation puts the fiducial. Red line: the residual, drawn 100 times longer than it really is.</p>`;

  const $ = s => root.querySelector(s);
  const state = {
    imgId: '157', model: 'affine', active: 0, camName: 'RMK_1523.CMR',
    camera: parseCMR(await (await fetch(DATA + 'RMK_1523.CMR')).text()),
    meas: {}, // id -> {col,row}
    result: null, reference: null, ownImage: false,
  };

  const viewer = new ImageViewer($('#io-c'), {
    onClick: (u, v) => {
      const f = state.camera.fiducials[state.active];
      if (!f) return;
      state.meas[f.id] = viewer.toPixel(u, v);
      const next = state.camera.fiducials.findIndex(q => !state.meas[q.id]);
      if (next >= 0) { state.active = next; jumpTo(next); }
      update();
    },
    onDraw: (ctx, v) => {
      for (const f of state.camera.fiducials) {
        const m = state.meas[f.id];
        if (state.result) {
          const c = state.result.coef;
          const p = { col: c.a0 + c.a1 * f.x + c.a2 * f.y, row: c.b0 + c.b1 * f.x + c.b2 * f.y };
          const [px, py] = v.toScreen(...v.fromPixel(p.col, p.row));
          ctx.strokeStyle = '#3cc3d6'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(px, py, 9, 0, 7); ctx.stroke();
          if (m) {
            const [mx, my] = v.toScreen(...v.fromPixel(m.col, m.row));
            ctx.strokeStyle = '#ef6f5c'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx + (px - mx) * 100, my + (py - my) * 100); ctx.stroke();
          }
        }
        if (m) {
          const [x, y] = v.toScreen(...v.fromPixel(m.col, m.row));
          ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(x - 12, y); ctx.lineTo(x - 3, y); ctx.moveTo(x + 3, y); ctx.lineTo(x + 12, y);
          ctx.moveTo(x, y - 12); ctx.lineTo(x, y - 3); ctx.moveTo(x, y + 3); ctx.lineTo(x, y + 12); ctx.stroke();
          ctx.fillStyle = '#ffd166'; ctx.font = '600 12px JetBrains Mono, monospace'; ctx.fillText(String(f.id), x + 10, y - 10);
        }
      }
      $('#io-lbl').textContent = `${state.ownImage ? 'your image' : 'photo ' + state.imgId} · zoom ${v.scale >= 1 ? v.scale.toFixed(1) : v.scale.toFixed(2)}×`;
    },
  });

  // Where to look for fiducial i before anything is measured: a nominal
  // transformation from the image size, assuming roughly 230 mm across.
  function expected(i) {
    const f = state.camera.fiducials[i];
    if (state.result) { const c = state.result.coef; return [c.a0 + c.a1 * f.x + c.a2 * f.y, c.b0 + c.b1 * f.x + c.b2 * f.y]; }
    const img = viewer.img, s = Math.min(img.width, img.height) / 240;
    return [img.width / 2 + f.x * s, img.height / 2 + f.y * s];
  }
  function jumpTo(i) { if (viewer.img) { const [c, r] = expected(i); viewer.goTo(...viewer.fromPixel(c, r), 3); } }

  function update() {
    const pairs = state.camera.fiducials.filter(f => state.meas[f.id]).map(f => ({ id: f.id, x: f.x, y: f.y, ...state.meas[f.id] }));
    state.result = null;
    let err = '';
    try { if (pairs.length >= (state.model === 'affine' ? 3 : 2)) state.result = fitInterior(pairs, state.model); } catch (e) { err = e.message; }
    const r = state.result;
    const resid = id => r && r.residuals.find(q => q.id === id);
    $('#io-tab').innerHTML = `<thead><tr><th>#</th><th>x mm</th><th>y mm</th><th>col</th><th>row</th><th>|v| px</th></tr></thead><tbody>` +
      state.camera.fiducials.map((f, i) => {
        const m = state.meas[f.id], q = resid(f.id);
        const v = q ? Math.hypot(q.vcol, q.vrow) : NaN;
        return `<tr data-i="${i}" class="${i === state.active ? 'active' : ''}"><td>${f.id}</td><td>${fmt(f.x, 0)}</td><td>${fmt(f.y, 0)}</td><td>${m ? fmt(m.col, 1) : '·'}</td><td>${m ? fmt(m.row, 1) : '·'}</td><td>${q && r.dof > 0 ? fmt(v, 2) : '·'}</td></tr>`;
      }).join('') + '</tbody>';
    $('#io-tab').querySelectorAll('tr[data-i]').forEach(tr => tr.addEventListener('click', () => { state.active = Number(tr.dataset.i); jumpTo(state.active); update(); }));

    if (!r) {
      $('#io-res').innerHTML = err || `Measure at least ${state.model === 'affine' ? 'three' : 'two'} fiducials. Measured: ${pairs.length}.`;
      $('#io-out').value = '';
    } else {
      const sig = r.dof > 0 ? `<b>${fmt(r.sigma0, 2)} px</b> (${fmt(r.sigma0 * (r.pixelX_um), 0)} µm)` : 'no redundancy yet';
      const quality = r.dof === 0 ? '' : r.sigma0 < 1 ? '<span class="pill good">good</span>' : r.sigma0 < 2 ? '<span class="pill warn">check</span>' : '<span class="pill bad">re-measure</span>';
      let cmp = '';
      if (state.reference && !state.ownImage) {
        let d = 0; const c1 = r.coef, c2 = state.reference.coef;
        for (let x = -115; x <= 115; x += 23) for (let y = -115; y <= 115; y += 23)
          d = Math.max(d, Math.hypot(c1.a0 + c1.a1 * x + c1.a2 * y - (c2.a0 + c2.a1 * x + c2.a2 * y), c1.b0 + c1.b1 * x + c1.b2 * y - (c2.b0 + c2.b1 * x + c2.b2 * y)));
        cmp = `<br>Differs from reference by at most <b>${fmt(d, 2)} px</b>`;
      }
      $('#io-res').innerHTML =
        `σ₀ = ${sig} ${quality}<br>Redundancy: ${r.dof}<br>` +
        `Pixel size: <b>${fmt(r.pixelX_um, 1)}</b> × <b>${fmt(r.pixelY_um, 1)} µm</b><br>` +
        `Rotation: ${fmt(r.rotation * 180 / Math.PI, 3)}°  Shear: ${fmt(r.shear * 180 / Math.PI, 3)}°<br>` +
        `Principal point at col ${fmt(r.coef.a0, 1)}, row ${fmt(r.coef.b0, 1)}${cmp}`;
      const c = r.coef, E = v => v.toExponential(10).replace(/e([+-])(\d)$/, 'E$10$2').toUpperCase();
      const pad = (s, n) => s.padStart(n);
      $('#io-out').value = [
        [c.a0, c.a1], [c.a2, 0], [c.b0, c.b1], [c.b2, 0],
      ].map(([a, b]) => pad(E(a), 20) + pad(E(b), 20)).join('\n') + '\n' +
        pairs.map(p => `${pad(String(p.id), 4)}${pad(p.col.toFixed(3), 13)}${pad(p.row.toFixed(3), 13)}`).join('\n') +
        `\n${state.camName}\n${pad(state.camera.focal.toFixed(3), 10)}\n`;
    }
    viewer.draw();
  }

  async function loadPhoto(id) {
    state.imgId = id; state.ownImage = false; state.meas = {}; state.active = 0;
    $('#io-lbl').textContent = 'Loading image…';
    const [img, inn] = await Promise.all([loadImage(DATA + id + '.png'), fetch(DATA + id + '.INN').then(r => r.text())]);
    state.reference = parseINN(inn);
    viewer.setImage(img);
    update();
  }

  root.querySelectorAll('#io-img [data-img]').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('#io-img [data-img]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    loadPhoto(b.dataset.img);
  }));
  $('#io-file').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const img = await loadImage(f, parseIMA);
      state.ownImage = true; state.meas = {}; state.active = 0; state.reference = null;
      root.querySelectorAll('#io-img [data-img]').forEach(x => x.setAttribute('aria-pressed', 'false'));
      viewer.setImage(img); update();
    } catch (err) { $('#io-res').textContent = `Could not open ${f.name}: ${err.message}`; }
  });
  $('#io-cmr').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    const cam = parseCMR(await f.text());
    if (cam.fiducials.length < 2) { $('#io-res').textContent = `${f.name} lists no fiducials. Expected one line "id x y" per fiducial, then the focal length.`; return; }
    state.camera = cam; state.camName = f.name; state.meas = {}; state.active = 0; update();
  });
  root.querySelectorAll('#io-model [data-m]').forEach(b => b.addEventListener('click', () => {
    state.model = b.dataset.m;
    root.querySelectorAll('#io-model [data-m]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    update();
  }));
  $('#io-book').addEventListener('click', () => {
    if (!state.reference || state.ownImage) { $('#io-res').textContent = 'Reference measurements exist only for the sample photographs.'; return; }
    state.reference.measured.forEach(m => (state.meas[m.id] = { col: m.col, row: m.row }));
    update();
  });
  $('#io-clear').addEventListener('click', () => { state.meas = {}; state.active = 0; update(); });
  $('#io-zin').addEventListener('click', () => viewer.zoomAt(viewer.w / 2, viewer.h / 2, 1.6));
  $('#io-zout').addEventListener('click', () => viewer.zoomAt(viewer.w / 2, viewer.h / 2, 1 / 1.6));
  $('#io-fit').addEventListener('click', () => viewer.fit());
  $('#io-b').addEventListener('input', e => { viewer.brightness = +e.target.value; $('#io-bo').textContent = e.target.value + '%'; viewer.draw(); });
  $('#io-k').addEventListener('input', e => { viewer.contrast = +e.target.value; $('#io-ko').textContent = e.target.value + '%'; viewer.draw(); });
  $('#io-copy').addEventListener('click', async () => {
    const t = $('#io-out');
    try { await navigator.clipboard.writeText(t.value); $('#io-copy').textContent = 'Copied'; } catch { t.select(); }
  });

  await loadPhoto('157');
  return () => viewer.dispose();
}
