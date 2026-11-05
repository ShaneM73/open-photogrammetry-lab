// Lab (Chapter 6): a terrain model of the stereo overlap 157/158 by matching.
import { loadPair } from './pair.js';
import { GridView } from './gridview.js';
import { session } from './session.js';
import { matchDTM } from '../core/matching.js';
import { medianFilter, difference, stats, makeGrid, cellX, cellY, heightAt } from '../core/raster.js';
import { createViewer } from '../demos/three-util.js';
import { gridMesh, frameGrid } from '../demos/grid3d.js';

export async function mount(root) {
  root.innerHTML = `
  <div class="demo-head"><h3>Lab · A terrain model by image matching</h3><span class="hint">Set the parameters, run, then inspect the result</span></div>
  <div class="demo-body wide-side">
    <div class="stage" id="dl-stage" style="min-height:520px"></div>
    <div class="side">
      <div class="ctrl"><label>Grid spacing</label><div class="seg" id="dl-px">
        <button class="btn" data-v="40" aria-pressed="false">40 m</button><button class="btn" data-v="20" aria-pressed="true">20 m</button><button class="btn" data-v="10" aria-pressed="false">10 m</button></div></div>
      <div class="ctrl"><label>Correlation window</label><div class="seg" id="dl-win">
        <button class="btn" data-v="3" aria-pressed="false">7 × 7</button><button class="btn" data-v="6" aria-pressed="true">13 × 13</button><button class="btn" data-v="10" aria-pressed="false">21 × 21</button></div></div>
      <div class="ctrl"><label for="dl-r">Accept if r ≥ <output id="dl-ro">0.70</output></label><input type="range" id="dl-r" min="0.4" max="0.95" step="0.05" value="0.7"></div>
      <label class="check"><input type="checkbox" id="dl-med" checked> Median filter after matching</label>
      <button class="btn primary" id="dl-run">Match the overlap</button>
      <div id="dl-prog" class="readout" hidden></div>
      <div class="ctrl"><label>Show</label><div class="seg" id="dl-view">
        <button class="btn" data-v="relief" aria-pressed="true">Relief</button><button class="btn" data-v="corr" aria-pressed="false">Correlation</button><button class="btn" data-v="diff" aria-pressed="false">vs reference</button><button class="btn" data-v="3d" aria-pressed="false">3D</button></div></div>
      <div class="readout" id="dl-read">The reference terrain model is shown until you run the matching.</div>
      <button class="btn" id="dl-use" disabled>Use this model for the orthophoto (Ch. 7)</button>
    </div>
  </div>
  <p class="caption">The matching runs in three passes, from a coarse grid to the final spacing; each pass searches only near the heights found in the previous one. Cells where no height reaches the threshold are filled from their neighbours. Everything runs in your browser.</p>`;

  const $ = s => root.querySelector(s);
  const P = await loadPair();
  const [L, R] = P.photos;
  const area = P.overlap;
  const stage = $('#dl-stage');
  const view = new GridView(stage);
  const params = { pixel: 20, half: 6, rMin: 0.7, median: true };
  let result = null, shown = 'relief', v3 = null;

  // reference model cut to the overlap, for comparison and for the first view
  const refCut = makeGrid(area.xmin, area.xmax, area.ymin, area.ymax, 20);
  for (let r = 0; r < refCut.rows; r++) for (let c = 0; c < refCut.cols; c++) {
    const X = cellX(refCut, c), Y = cellY(refCut, r), z = heightAt(P.ref, X, Y);
    refCut.z[r * refCut.cols + c] = P.inStereo(X, Y, z) ? z : NaN;
  }

  function show() {
    if (v3) { v3.dispose(); v3 = null; }
    view.canvas.hidden = false;
    const g = result ? result.grid : refCut;
    if (shown === '3d') {
      view.canvas.hidden = true; view.label.textContent = ''; view.legend.textContent = '';
      v3 = createViewer(stage, { near: 5, far: 40000 });
      const origin = { X: (g.xmin + g.xmax) / 2, Y: (g.ymin + g.ymax) / 2, Z: 1000 };
      const tex = document.createElement('canvas');
      tex.width = 1024; tex.height = Math.round(1024 * g.rows / g.cols);
      const tctx = tex.getContext('2d');
      const ow = P.s.orthoMeta, sx = P.orthoImg.width / (ow.xmax - ow.xmin), sy = P.orthoImg.height / (ow.ymax - ow.ymin);
      tctx.drawImage(P.orthoImg, (g.xmin - ow.xmin) * sx, (ow.ymax - g.ymax) * sy, (g.xmax - g.xmin) * sx, (g.ymax - g.ymin) * sy, 0, 0, tex.width, tex.height);
      v3.scene.add(gridMesh(g, origin, { exag: 1.5, texture: tex }));
      frameGrid(v3, g, origin, 1.5, 1200);
      return;
    }
    if (shown === 'relief') view.show({ grid: g, mode: 'relief', contour: 10, exag: 1.5, title: result ? 'your terrain model' : 'reference terrain model' });
    else if (!result) view.show({ grid: refCut, mode: 'relief', contour: 10, exag: 1.5, title: 'run the matching first' });
    else if (shown === 'corr') view.show({ grid: g, mode: 'corr', values: result.r, lo: 0.3, hi: 1, digits: 2, title: 'correlation coefficient per cell' });
    else view.show({ grid: g, mode: 'diff', values: result.diff.z, lo: -20, hi: 20, title: 'your model minus the reference' });
  }

  async function run() {
    $('#dl-run').disabled = true; $('#dl-prog').hidden = false;
    const t0 = performance.now();
    try {
      const res = await matchDTM(L, R, {
        area, pixel: params.pixel, zMin: 1000, zMax: 1700, half: params.half, spacing: 1.1, rMin: params.rMin, levels: 3,
        inside: (X, Y) => P.inStereo(X, Y, heightAt(P.ref, X, Y) || 1180),
        onProgress: (f, msg) => { $('#dl-prog').innerHTML = `<b>${Math.round(f * 100)} %</b> · ${msg}`; },
      });
      if (params.median) res.grid = medianFilter(res.grid);
      res.diff = difference(res.grid, P.ref);
      for (let i = 0; i < res.diff.z.length; i++) res.diff.z[i] = -res.diff.z[i]; // yours - reference
      result = res;
      const d = stats(res.diff);
      $('#dl-read').innerHTML =
        `Grid ${res.grid.cols} × ${res.grid.rows} cells at ${params.pixel} m<br>` +
        `Matched directly: <b>${Math.round(100 * res.matched / res.total)} %</b> of the cells<br>` +
        `Time: ${((performance.now() - t0) / 1000).toFixed(1)} s<br>` +
        `Compared with the reference:<br>mean <b>${d.mean.toFixed(2)} m</b>, standard deviation <b>${d.std.toFixed(2)} m</b><br>largest ${d.min.toFixed(1)} / +${d.max.toFixed(1)} m`;
      $('#dl-use').disabled = false;
    } finally {
      $('#dl-run').disabled = false; $('#dl-prog').hidden = true;
    }
    show();
  }

  const seg = (id, key) => root.querySelectorAll(`#${id} .btn`).forEach(b => b.addEventListener('click', () => {
    params[key] = Number(b.dataset.v);
    root.querySelectorAll(`#${id} .btn`).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  }));
  seg('dl-px', 'pixel'); seg('dl-win', 'half');
  $('#dl-r').addEventListener('input', e => { params.rMin = Number(e.target.value); $('#dl-ro').textContent = params.rMin.toFixed(2); });
  $('#dl-med').addEventListener('change', e => (params.median = e.target.checked));
  $('#dl-run').addEventListener('click', run);
  root.querySelectorAll('#dl-view .btn').forEach(b => b.addEventListener('click', () => {
    shown = b.dataset.v;
    root.querySelectorAll('#dl-view .btn').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    show();
  }));
  $('#dl-use').addEventListener('click', () => {
    session.set('dtm', { grid: result.grid, label: `your matched model (${params.pixel} m)` });
    $('#dl-use').textContent = 'Saved for Chapter 7';
  });
  show();
  return () => { view.dispose(); if (v3) v3.dispose(); };
}
