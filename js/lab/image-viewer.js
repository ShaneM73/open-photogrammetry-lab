// A pan/zoom viewer for large scanned photographs, used by all labs.
// The viewer works in raster coordinates: continuous, origin at the top-left
// corner of the image, u to the right and v down (pixel i covers i..i+1).
// Labs convert to the course's image-pixel convention (origin bottom-left,
// row up) with toPixel / fromPixel below.
// Drag to pan, scroll or pinch to zoom, click (without dragging) to measure.

export class ImageViewer {
  constructor(canvas, { onClick, onDraw } = {}) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.onClick = onClick;
    this.onDraw = onDraw;
    this.img = null;
    this.scale = 0.2; this.cx = 0; this.cy = 0; // image point shown at the canvas centre
    this.brightness = 100; this.contrast = 100;
    this.pointers = new Map();
    this._bind();
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(canvas);
  }

  setImage(img) { // HTMLImageElement, ImageBitmap or canvas
    this.img = img;
    this.fit();
  }

  get w() { return this.c.clientWidth; }
  get h() { return this.c.clientHeight; }

  fit() {
    if (!this.img) return;
    this.scale = Math.min(this.w / this.img.width, this.h / this.img.height) * 0.96;
    this.cx = this.img.width / 2; this.cy = this.img.height / 2;
    this.draw();
  }

  goTo(col, row, scale = 4) {
    this.cx = col; this.cy = row; this.scale = scale;
    this.draw();
  }

  toScreen(col, row) { return [(col - this.cx) * this.scale + this.w / 2, (row - this.cy) * this.scale + this.h / 2]; }
  toImage(x, y) { return [(x - this.w / 2) / this.scale + this.cx, (y - this.h / 2) / this.scale + this.cy]; }

  zoomAt(x, y, factor) {
    const [col, row] = this.toImage(x, y);
    this.scale = Math.max(0.02, Math.min(40, this.scale * factor));
    this.cx = col - (x - this.w / 2) / this.scale;
    this.cy = row - (y - this.h / 2) / this.scale;
    this.draw();
  }

  draw() {
    const { c, ctx } = this;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== Math.round(this.w * dpr) || c.height !== Math.round(this.h * dpr)) {
      c.width = Math.round(this.w * dpr); c.height = Math.round(this.h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0f1720';
    ctx.fillRect(0, 0, this.w, this.h);
    if (this.img) {
      ctx.save();
      ctx.imageSmoothingEnabled = this.scale < 3;
      ctx.filter = `brightness(${this.brightness}%) contrast(${this.contrast}%)`;
      const [x0, y0] = this.toScreen(0, 0);
      ctx.drawImage(this.img, x0, y0, this.img.width * this.scale, this.img.height * this.scale);
      ctx.restore();
    }
    if (this.onDraw) this.onDraw(ctx, this);
  }

  _bind() {
    const c = this.c;
    let down = null, moved = false, pinch = null;
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      this.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (this.pointers.size === 1) { down = [e.clientX, e.clientY, this.cx, this.cy]; moved = false; }
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: this.scale };
        moved = true;
      }
    });
    c.addEventListener('pointermove', e => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const r = c.getBoundingClientRect();
        const f = (Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d) * pinch.s / this.scale;
        this.zoomAt((a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top, f);
        return;
      }
      if (!down) return;
      const dx = e.clientX - down[0], dy = e.clientY - down[1];
      if (Math.hypot(dx, dy) > 4) moved = true;
      if (moved) { this.cx = down[2] - dx / this.scale; this.cy = down[3] - dy / this.scale; this.draw(); }
    });
    const up = e => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) pinch = null;
      if (down && !moved && this.pointers.size === 0 && this.onClick && this.img) {
        const r = c.getBoundingClientRect();
        const [col, row] = this.toImage(e.clientX - r.left, e.clientY - r.top);
        this.onClick(col, row);
      }
      if (this.pointers.size === 0) down = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
  }

  // Course convention: col to the right, row upward from the bottom-left corner.
  toPixel(u, v) { return { col: u, row: this.img.height - v }; }
  fromPixel(col, row) { return [col, this.img.height - row]; }

  dispose() { this.ro.disconnect(); }
}

// Load an image for the viewer: a URL, or a File (PNG/JPG, or the course's .IMA raster).
export async function loadImage(src, parseIMA) {
  if (src instanceof File && /\.ima$/i.test(src.name)) {
    const { meta, data } = parseIMA(await src.arrayBuffer());
    if (meta.bits !== 8) throw new Error('Only 8-bit .IMA images can be shown.');
    const cv = document.createElement('canvas');
    cv.width = meta.cols; cv.height = meta.rows;
    const id = cv.getContext('2d').createImageData(meta.cols, meta.rows);
    for (let i = 0; i < data.length; i++) { id.data[4 * i] = id.data[4 * i + 1] = id.data[4 * i + 2] = data[i]; id.data[4 * i + 3] = 255; }
    cv.getContext('2d').putImageData(id, 0, 0);
    return cv;
  }
  const url = src instanceof File ? URL.createObjectURL(src) : src;
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  return img;
}
