// A map panel for height grids: shaded relief with contours, correlation,
// differences to a reference, or a plain image. Keeps the grid's aspect
// ratio, shows a legend, and reports the value under the pointer.
import { drawGrid, hillshade, contours, HYPSO, DIVERGING, CORR, cellX, cellY } from '../core/raster.js';
import { cssVar } from '../demos/three-util.js';

export class GridView {
  constructor(stage, { units = 'm', onPick = null } = {}) {
    this.stage = stage;
    this.units = units;
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    this.label = document.createElement('div');
    this.label.className = 'stage-label';
    this.legend = document.createElement('div');
    this.legend.className = 'stage-label';
    this.legend.style.cssText = 'top:auto;bottom:8px';
    stage.append(this.canvas, this.label, this.legend);
    this.layer = null;
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(stage);
    this.canvas.addEventListener('pointermove', e => this.hover(e));
    if (onPick) this.canvas.addEventListener('click', e => { const p = this.toGround(e); if (p) onPick(p); });
  }

  // layer: { grid, mode: 'relief' | 'values' | 'diff' | 'corr' | 'image', values?, lo?, hi?, contour?, image?, title, overlay?(ctx, toScreen) }
  show(layer) { this.layer = layer; this.draw(); }

  draw() {
    const L = this.layer, W = this.stage.clientWidth, H = this.stage.clientHeight;
    if (!W || !H) return;
    const c = this.canvas, dpr = Math.min(devicePixelRatio || 1, 2);
    c.width = W * dpr; c.height = H * dpr;
    const ctx = c.getContext('2d');
    ctx.fillStyle = cssVar('--canvas'); ctx.fillRect(0, 0, c.width, c.height);
    if (!L) return;
    const g = L.grid, s = Math.min(c.width / g.cols, c.height / g.rows);
    const w = Math.max(1, Math.floor(g.cols * s)), h = Math.max(1, Math.floor(g.rows * s));
    const ox = (c.width - w) / 2, oy = (c.height - h) / 2;
    this.t = { s: s / dpr, ox: ox / dpr, oy: oy / dpr, dpr };
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    if (L.mode === 'image') off.getContext('2d').drawImage(L.image, 0, 0, w, h);
    else {
      const vals = L.values || g.z;
      let lo = L.lo, hi = L.hi;
      if (lo == null || hi == null) { lo = Infinity; hi = -Infinity; for (const v of vals) if (!Number.isNaN(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
      this.range = [lo, hi];
      const colors = L.mode === 'diff' ? DIVERGING : L.mode === 'corr' ? CORR : HYPSO;
      const shade = L.mode === 'relief' ? (L.shade || (L.shade = hillshade(g, L.exag || 1))) : null;
      const segs = L.contour ? (L.segs || (L.segs = contours(g, L.contour))) : null;
      drawGrid(off, g, { values: vals, lo, hi, colors, shade, contourSegs: segs, contourEvery: L.contour ? L.contour * 5 : null });
    }
    ctx.imageSmoothingEnabled = L.mode === 'image';
    ctx.drawImage(off, ox, oy);
    if (L.overlay) {
      ctx.save(); ctx.scale(dpr, dpr);
      L.overlay(ctx, (X, Y) => this.toScreen(X, Y));
      ctx.restore();
    }
    this.label.textContent = L.title || '';
    this.legend.textContent = L.mode === 'image' ? '' :
      `${L.mode === 'corr' ? 'r' : L.mode === 'diff' ? 'difference' : 'height'}: ${this.range[0].toFixed(L.digits ?? 1)} … ${this.range[1].toFixed(L.digits ?? 1)} ${L.mode === 'corr' ? '' : this.units}` +
      (L.contour ? ` · contours every ${L.contour} ${this.units}` : '');
  }

  toScreen(X, Y) {
    const g = this.layer.grid, t = this.t;
    return [t.ox + (X - g.xmin) / g.pixel * t.s, t.oy + (g.ymax - Y) / g.pixel * t.s];
  }

  toGround(e) {
    if (!this.layer || !this.t) return null;
    const r = this.canvas.getBoundingClientRect(), g = this.layer.grid, t = this.t;
    const c = (e.clientX - r.left - t.ox) / t.s, rr = (e.clientY - r.top - t.oy) / t.s;
    if (c < 0 || rr < 0 || c >= g.cols || rr >= g.rows) return null;
    return { X: g.xmin + c * g.pixel, Y: g.ymax - rr * g.pixel, c: Math.floor(c), r: Math.floor(rr) };
  }

  hover(e) {
    const p = this.toGround(e);
    if (!p || this.layer.mode === 'image') { this.label.textContent = this.layer?.title || ''; return; }
    const g = this.layer.grid, v = (this.layer.values || g.z)[p.r * g.cols + p.c];
    this.label.textContent = `${this.layer.title || ''} · X ${p.X.toFixed(this.layer.xyDigits ?? 0)} Y ${p.Y.toFixed(this.layer.xyDigits ?? 0)} · ${Number.isNaN(v) ? 'no value' : v.toFixed(this.layer.digits ?? 1) + (this.layer.mode === 'corr' ? '' : ' ' + this.units)}`;
  }

  dispose() { this.ro.disconnect(); }
}

export { cellX, cellY };
