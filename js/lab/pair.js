// Loads the sample stereo pair 157/158 once per visit: photos with their
// reference orientations and grey values, plus the reference terrain model.
import { loadSample } from '../demos/terrain.js';
import { DATA } from '../demos/three-util.js';
import { loadImage } from './image-viewer.js';
import { makePhoto, greyData } from '../core/camera.js';
import { gridFromJSON } from '../core/raster.js';

let cache = null;
export function loadPair() {
  if (cache) return cache;
  cache = (async () => {
    const s = await loadSample();
    const imgs = await Promise.all(['157', '158'].map(id => loadImage(DATA + id + '.png')));
    // usable format: inside the fiducial notches of the 230 mm film frame
    const photos = ['157', '158'].map((id, k) => makePhoto({ id, inn: s.inn[id], eo: s.abs[id], fullRows: imgs[k].height, grey: greyData(imgs[k]), format: { hx: 108, hy: 108 } }));
    const ref = gridFromJSON(s.demMeta);
    const orthoImg = await loadImage(DATA + 'ortho.jpg');
    // the stereo overlap of the pair, kept a little inside the photo edges
    const overlap = { xmin: 1137100, xmax: 1140200, ymin: 969700, ymax: 971900 };
    // a ground point is in the stereo model if both photos see it
    const inStereo = (X, Y, Z = 1180) => photos.every(p => p.projectMM(X, Y, Z));
    return { s, imgs, photos, ref, orthoImg, overlap, inStereo };
  })();
  cache.catch(() => { cache = null; });
  return cache;
}

// Draw the part of the reference orthophoto covering `area` into a canvas.
export function drawOrthoArea(ctx, orthoImg, orthoMeta, area, W, H) {
  const sx = orthoImg.width / (orthoMeta.xmax - orthoMeta.xmin), sy = orthoImg.height / (orthoMeta.ymax - orthoMeta.ymin);
  ctx.drawImage(orthoImg, (area.xmin - orthoMeta.xmin) * sx, (orthoMeta.ymax - area.ymax) * sy,
    (area.xmax - area.xmin) * sx, (area.ymax - area.ymin) * sy, 0, 0, W, H);
}
