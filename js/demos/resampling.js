// Demo: resampling. A small piece of photo 157 is rotated and enlarged;
// each output pixel needs a grey value from between the input pixels.
import { loadPair } from '../lab/pair.js';
import { sampleNearest, sampleBilinear, sampleBicubic } from '../core/camera.js';

const METHODS = [['nearest', 'Nearest neighbour', sampleNearest], ['bilinear', 'Bilinear', sampleBilinear], ['bicubic', 'Bicubic', sampleBicubic]];

export async function mount(root) {
  root.innerHTML = `
  <div class="demo-head"><h3>Three ways to resample</h3><span class="hint">Rotate and enlarge a small piece of photo 157</span></div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:2px;background:var(--rule)">
    ${METHODS.map(([k, name]) => `<figure style="margin:0;background:var(--canvas);position:relative"><canvas id="rs-${k}" width="360" height="360" style="width:100%;display:block" aria-label="${name}"></canvas><span class="stage-label">${name}</span></figure>`).join('')}
  </div>
  <div class="side" style="border-left:0;border-top:1px solid var(--rule);display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
    <div class="ctrl"><label for="rs-rot">Rotation <output id="rs-roto">20°</output></label><input type="range" id="rs-rot" min="0" max="90" value="20"></div>
    <div class="ctrl"><label for="rs-zoom">Enlargement <output id="rs-zoomo">8×</output></label><input type="range" id="rs-zoom" min="1" max="16" step="0.5" value="8"></div>
    <div class="ctrl"><label>Area</label><div class="seg" id="rs-area"><button class="btn" data-c="1700,1260" aria-pressed="true">Town</button><button class="btn" data-c="700,900" aria-pressed="false">Fields</button><button class="btn" data-c="2730,1454" aria-pressed="false">Fiducial</button></div></div>
  </div>
  <p class="caption">Nearest neighbour copies the closest input pixel: fast, keeps the original grey values, but edges become staircases. Bilinear interpolation weights the four surrounding pixels: smooth, slightly blurred. Bicubic convolution uses sixteen pixels: sharper than bilinear, and may overshoot a little at strong edges.</p>`;

  const $ = s => root.querySelector(s);
  const img = (await loadPair()).photos[0].grey; // full-resolution photo 157
  const state = { rot: 20, zoom: 8, cx: 1700, cy: 1260 };

  function draw() {
    for (const [k, , fn] of METHODS) {
      const cv = $(`#rs-${k}`), ctx = cv.getContext('2d'), N = cv.width, out = ctx.createImageData(N, N);
      // output pixel (x, y) -> input position: rotate about the centre, shrink by the enlargement
      const a = state.rot * Math.PI / 180, ca = Math.cos(a) / state.zoom, sa = Math.sin(a) / state.zoom;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const dx = x - N / 2, dy = y - N / 2;
        const g = fn(img, state.cx + ca * dx - sa * dy, state.cy + sa * dx + ca * dy);
        const i = 4 * (y * N + x);
        out.data[i] = out.data[i + 1] = out.data[i + 2] = g < 0 ? 20 : g; out.data[i + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
    }
    $('#rs-roto').textContent = state.rot + '°'; $('#rs-zoomo').textContent = state.zoom + '×';
  }
  $('#rs-rot').addEventListener('input', e => { state.rot = Number(e.target.value); draw(); });
  $('#rs-zoom').addEventListener('input', e => { state.zoom = Number(e.target.value); draw(); });
  root.querySelectorAll('#rs-area .btn').forEach(b => b.addEventListener('click', () => {
    const [c, r] = b.dataset.c.split(',').map(Number);
    state.cx = c; state.cy = r;
    root.querySelectorAll('#rs-area .btn').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    draw();
  }));
  draw();
}
