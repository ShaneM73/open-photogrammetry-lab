// Lab (Chapter 7): orthophotos of the overlap 157/158.
import { loadPair } from './pair.js';
import { GridView } from './gridview.js';
import { session } from './session.js';
import { orthophoto, orthoToCanvas } from '../core/ortho.js';
import { makeGrid, cellX, cellY, heightAt, contours } from '../core/raster.js';
import { imageToGround, groundToImage } from '../core/orientation.js';
import { createViewer } from '../demos/three-util.js';
import { gridMesh, frameGrid } from '../demos/grid3d.js';

export async function mount(root) {
  root.innerHTML = `
  <div class="demo-head"><h3>Lab · Making an orthophoto</h3><span class="hint">Choose photos, surface and resampling, then compute</span></div>
  <div class="demo-body wide-side">
    <div class="stage" id="ol-stage" style="min-height:540px"></div>
    <div class="side">
      <div class="ctrl"><label>Photos</label><div class="seg" id="ol-ph">
        <button class="btn" data-v="0" aria-pressed="false">157</button><button class="btn" data-v="1" aria-pressed="false">158</button><button class="btn" data-v="2" aria-pressed="true">Mosaic of both</button></div></div>
      <div class="ctrl"><label>Heights from</label><div class="seg" id="ol-surf">
        <button class="btn" data-v="ref" aria-pressed="true">Reference terrain model</button><button class="btn" data-v="own" aria-pressed="false" id="ol-own" disabled>Your model (Ch. 6)</button><button class="btn" data-v="flat" aria-pressed="false">Level plane 1180 m</button></div></div>
      <div class="ctrl"><label>Pixel size</label><div class="seg" id="ol-px">
        <button class="btn" data-v="1" aria-pressed="false">1 m</button><button class="btn" data-v="2" aria-pressed="true">2 m</button><button class="btn" data-v="5" aria-pressed="false">5 m</button></div></div>
      <div class="ctrl"><label>Resampling</label><div class="seg" id="ol-rs">
        <button class="btn" data-v="nearest" aria-pressed="false">Nearest</button><button class="btn" data-v="bilinear" aria-pressed="true">Bilinear</button><button class="btn" data-v="bicubic" aria-pressed="false">Bicubic</button></div></div>
      <button class="btn primary" id="ol-run">Compute orthophoto</button>
      <div id="ol-prog" class="readout" hidden></div>
      <div class="ctrl"><label>Show</label><div class="seg" id="ol-view">
        <button class="btn" data-v="ortho" aria-pressed="true">Orthophoto</button><button class="btn" data-v="seams" aria-pressed="false">Source photo</button><button class="btn" data-v="ref" aria-pressed="false">Reference</button><button class="btn" data-v="3d" aria-pressed="false">3D</button></div></div>
      <label class="check"><input type="checkbox" id="ol-cont"> Contours (10 m) from the surface used</label>
      <label class="check"><input type="checkbox" id="ol-cp" checked> Control points and position errors</label>
      <div class="readout" id="ol-read">Press <em>Compute orthophoto</em>.</div>
    </div>
  </div>
  <p class="caption">Yellow crosses mark the surveyed positions of the control points. Red arrows (drawn 10 times longer) show how far each point lands from its true position in the orthophoto, computed from the photo geometry and the surface you chose. With a level plane instead of the terrain, every point higher or lower than the plane is shifted along the line to the nadir.</p>`;

  const $ = s => root.querySelector(s);
  const P = await loadPair();
  const area = P.overlap;
  const stage = $('#ol-stage');
  const view = new GridView(stage);
  const params = { photos: 2, surf: 'ref', pixel: 2, method: 'bilinear' };
  let out = null, shown = 'ortho', v3 = null;
  if (session.dtm) $('#ol-own').disabled = false;

  const surfaceGrid = () => params.surf === 'own' && session.dtm ? session.dtm.grid : P.ref;
  const surface = () => params.surf === 'flat' ? 1180 : surfaceGrid();

  // Where does a control point end up in the orthophoto? Project it into the
  // photo it is taken from, then back onto the surface used for rectifying.
  function positionErrors(o) {
    const errs = [];
    for (const p of P.s.control) {
      if (p.X < area.xmin || p.X > area.xmax || p.Y < area.ymin || p.Y > area.ymax) continue;
      const k = o.source[Math.floor((area.ymax - p.Y) / o.pixel) * o.W + Math.floor((p.X - area.xmin) / o.pixel)];
      if (k < 0 || k === undefined) continue;
      const photo = o.photos[k], q = groundToImage(photo.eo, p.X, p.Y, p.Z);
      let Z = typeof o.surface === 'number' ? o.surface : heightAt(o.surface, p.X, p.Y), G;
      for (let i = 0; i < 10; i++) { G = imageToGround(photo.eo, q.x, q.y, Z); if (typeof o.surface === 'number') break; const z2 = heightAt(o.surface, G.X, G.Y); if (Number.isNaN(z2) || Math.abs(z2 - Z) < 0.01) break; Z = z2; }
      errs.push({ id: p.id, X: p.X, Y: p.Y, dX: G.X - p.X, dY: G.Y - p.Y });
    }
    return errs;
  }

  function overlay(ctx, toScreen) {
    if ($('#ol-cont').checked && out && out.segs) {
      const g = out.cgrid;
      ctx.strokeStyle = 'rgba(255,209,102,0.75)'; ctx.lineWidth = 1;
      for (const [x1, y1, x2, y2] of out.segs) {
        ctx.beginPath(); ctx.moveTo(...toScreen(cellX(g, x1), cellY(g, y1))); ctx.lineTo(...toScreen(cellX(g, x2), cellY(g, y2))); ctx.stroke();
      }
    }
    if ($('#ol-cp').checked && out) {
      for (const e of out.errs) {
        const [x, y] = toScreen(e.X, e.Y), [x2, y2] = toScreen(e.X + 10 * e.dX, e.Y + 10 * e.dY);
        ctx.strokeStyle = '#ef6f5c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.strokeStyle = '#ffd166'; ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.lineTo(x + 7, y); ctx.moveTo(x, y - 7); ctx.lineTo(x, y + 7); ctx.stroke();
        ctx.fillStyle = '#ffd166'; ctx.font = '600 11px JetBrains Mono, monospace'; ctx.fillText(String(e.id), x + 8, y - 8);
      }
    }
  }

  function show() {
    if (v3) { v3.dispose(); v3 = null; }
    view.canvas.hidden = false;
    const frame = makeGrid(area.xmin, area.xmax, area.ymin, area.ymax, out ? out.pixel : 5);
    if (shown === '3d' && out) {
      view.canvas.hidden = true; view.label.textContent = ''; view.legend.textContent = '';
      v3 = createViewer(stage, { near: 5, far: 40000 });
      const g = makeGrid(area.xmin, area.xmax, area.ymin, area.ymax, 20), sg = surfaceGrid();
      for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) g.z[r * g.cols + c] = heightAt(sg, cellX(g, c), cellY(g, r));
      const origin = { X: (g.xmin + g.xmax) / 2, Y: (g.ymin + g.ymax) / 2, Z: 1000 };
      v3.scene.add(gridMesh(g, origin, { exag: 1.5, texture: out.canvas }));
      frameGrid(v3, g, origin, 1.5, 1200);
      return;
    }
    if (shown === 'ref' || !out) {
      const ow = P.s.orthoMeta, c = document.createElement('canvas');
      c.width = Math.round((area.xmax - area.xmin) / 5); c.height = Math.round((area.ymax - area.ymin) / 5);
      const sx = P.orthoImg.width / (ow.xmax - ow.xmin), sy = P.orthoImg.height / (ow.ymax - ow.ymin);
      c.getContext('2d').drawImage(P.orthoImg, (area.xmin - ow.xmin) * sx, (ow.ymax - area.ymax) * sy, (area.xmax - area.xmin) * sx, (area.ymax - area.ymin) * sy, 0, 0, c.width, c.height);
      view.show({ grid: makeGrid(area.xmin, area.xmax, area.ymin, area.ymax, 5), mode: 'image', image: c, title: 'reference orthophoto (5 m) delivered with the data', overlay: out ? overlay : null });
      return;
    }
    view.show({ grid: frame, mode: 'image', image: shown === 'seams' ? out.seams : out.canvas, title: shown === 'seams' ? 'which photo each pixel comes from' : `your orthophoto · ${out.label}`, overlay });
  }

  async function run() {
    $('#ol-run').disabled = true; $('#ol-prog').hidden = false;
    const photos = params.photos === 2 ? P.photos : [P.photos[params.photos]];
    const t0 = performance.now();
    try {
      const o = await orthophoto(photos, surface(), area, params.pixel, { method: params.method, onProgress: f => ($('#ol-prog').innerHTML = `<b>${Math.round(f * 100)} %</b>`) });
      o.photos = photos; o.surface = surface();
      o.canvas = orthoToCanvas(o);
      // source map: red = 157, cyan = 158
      o.seams = document.createElement('canvas'); o.seams.width = o.W; o.seams.height = o.H;
      const sctx = o.seams.getContext('2d'), sim = sctx.createImageData(o.W, o.H);
      for (let i = 0; i < o.grey.length; i++) {
        const v = o.grey[i] * 0.6, k = o.source[i] < 0 ? -1 : photos[o.source[i]].id === '157' ? 0 : 1;
        sim.data[4 * i] = k === 0 ? 90 + v : k === 1 ? v * 0.5 : 24; sim.data[4 * i + 1] = k === 1 ? 70 + v : k === 0 ? v * 0.5 : 30; sim.data[4 * i + 2] = k === 1 ? 90 + v : k === 0 ? v * 0.5 : 36; sim.data[4 * i + 3] = 255;
      }
      sctx.putImageData(sim, 0, 0);
      const sg = surfaceGrid();
      o.cgrid = makeGrid(area.xmin, area.xmax, area.ymin, area.ymax, 20);
      for (let r = 0; r < o.cgrid.rows; r++) for (let c = 0; c < o.cgrid.cols; c++) o.cgrid.z[r * o.cgrid.cols + c] = params.surf === 'flat' ? 1180 : heightAt(sg, cellX(o.cgrid, c), cellY(o.cgrid, r));
      o.segs = contours(o.cgrid, 10);
      o.errs = positionErrors(o);
      o.label = `${photos.map(p => p.id).join(' + ')}, ${params.surf === 'flat' ? 'level plane' : params.surf === 'own' ? 'your terrain model' : 'reference terrain model'}, ${params.pixel} m, ${params.method}`;
      out = o;
      const rms = Math.sqrt(o.errs.reduce((s, e) => s + e.dX ** 2 + e.dY ** 2, 0) / Math.max(1, o.errs.length));
      const worst = o.errs.reduce((m, e) => Math.max(m, Math.hypot(e.dX, e.dY)), 0);
      $('#ol-read').innerHTML = `${o.W} × ${o.H} pixels in ${((performance.now() - t0) / 1000).toFixed(1)} s<br>` +
        `Control point positions in the orthophoto:<br>RMS error <b>${rms.toFixed(1)} m</b>, largest ${worst.toFixed(1)} m (${o.errs.length} points)<br>` +
        o.errs.map(e => `${e.id}  ${Math.hypot(e.dX, e.dY).toFixed(1)} m`).join('<br>');
    } finally { $('#ol-run').disabled = false; $('#ol-prog').hidden = true; }
    show();
  }

  const seg = (id, key, num = true) => root.querySelectorAll(`#${id} .btn`).forEach(b => b.addEventListener('click', () => {
    if (b.disabled) return;
    params[key] = num ? Number(b.dataset.v) : b.dataset.v;
    root.querySelectorAll(`#${id} .btn`).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  }));
  seg('ol-ph', 'photos'); seg('ol-surf', 'surf', false); seg('ol-px', 'pixel'); seg('ol-rs', 'method', false);
  root.querySelectorAll('#ol-view .btn').forEach(b => b.addEventListener('click', () => {
    shown = b.dataset.v;
    root.querySelectorAll('#ol-view .btn').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    show();
  }));
  ['#ol-cont', '#ol-cp'].forEach(id => $(id).addEventListener('change', () => view.draw()));
  $('#ol-run').addEventListener('click', run);
  show();
  return () => { view.dispose(); if (v3) v3.dispose(); };
}
