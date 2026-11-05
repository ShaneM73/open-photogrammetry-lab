// Orthophotos: for every cell of a ground grid, take its height from a
// terrain model, project the point into a photo with the collinearity
// equations, and resample the grey value there (indirect rectification).
// With several photos, each cell takes its value from the photo whose
// nadir point is nearest, which places the seamlines midway between them.
import { sampleNearest, sampleBilinear, sampleBicubic } from './camera.js';
import { heightAt } from './raster.js';

const SAMPLERS = { nearest: sampleNearest, bilinear: sampleBilinear, bicubic: sampleBicubic };

// surface: a height grid, or a number (a level plane at that height).
// area: {xmin,xmax,ymin,ymax}; pixel: ground size of an output pixel.
export async function orthophoto(photos, surface, area, pixel, { method = 'bilinear', onProgress = () => {} } = {}) {
  const W = Math.round((area.xmax - area.xmin) / pixel), H = Math.round((area.ymax - area.ymin) / pixel);
  const grey = new Uint8ClampedArray(W * H), source = new Int8Array(W * H).fill(-1);
  const sample = SAMPLERS[method];
  const zAt = typeof surface === 'number' ? () => surface : (X, Y) => heightAt(surface, X, Y);
  let t0 = performance.now();
  for (let r = 0; r < H; r++) {
    const Y = area.ymax - (r + 0.5) * pixel;
    for (let c = 0; c < W; c++) {
      const X = area.xmin + (c + 0.5) * pixel, Z = zAt(X, Y);
      if (Number.isNaN(Z)) continue;
      // photos ordered by distance of their nadir to this point
      let best = -1, bestD = Infinity, val = -1;
      for (let k = 0; k < photos.length; k++) {
        const e = photos[k].eo, d = (X - e.X0) ** 2 + (Y - e.Y0) ** 2;
        if (d < bestD) {
          const p = photos[k].project(X, Y, Z);
          if (!p) continue;
          const v = sample(photos[k].grey, p[0] - 0.5, p[1] - 0.5);
          if (v >= 0) { best = k; bestD = d; val = v; }
        }
      }
      if (best >= 0) { grey[r * W + c] = val; source[r * W + c] = best; }
    }
    if (performance.now() - t0 > 40) { onProgress((r + 1) / H); await new Promise(res => setTimeout(res, 0)); t0 = performance.now(); }
  }
  onProgress(1);
  return { W, H, grey, source, area, pixel };
}

// Paint an orthophoto into a canvas (cells without data stay dark).
export function orthoToCanvas(o) {
  const c = document.createElement('canvas');
  c.width = o.W; c.height = o.H;
  const ctx = c.getContext('2d'), img = ctx.createImageData(o.W, o.H);
  for (let i = 0; i < o.grey.length; i++) {
    const has = o.source[i] >= 0, v = o.grey[i];
    img.data[4 * i] = has ? v : 24; img.data[4 * i + 1] = has ? v : 30; img.data[4 * i + 2] = has ? v : 36; img.data[4 * i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
