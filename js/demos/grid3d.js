// A Three.js surface from a height grid (see core/raster.js), textured with
// a canvas (orthophoto, colour map) or plain shaded. Cells without height
// are left out.
import { toThree } from './three-util.js';
import { cellX, cellY } from '../core/raster.js';

export function gridMesh(g, origin, { exag = 1, texture = null, color = 0xbfc8b0, step = 1 } = {}) {
  const R = Math.ceil(g.rows / step), C = Math.ceil(g.cols / step);
  const pos = new Float32Array(R * C * 3), uv = new Float32Array(R * C * 2);
  const valid = new Uint8Array(R * C);
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const gr = Math.min(g.rows - 1, r * step), gc = Math.min(g.cols - 1, c * step), i = r * C + c;
    const z = g.z[gr * g.cols + gc];
    valid[i] = Number.isNaN(z) ? 0 : 1;
    const p = toThree(cellX(g, gc), cellY(g, gr), Number.isNaN(z) ? origin.Z : z, origin, exag);
    pos[3 * i] = p.x; pos[3 * i + 1] = p.y; pos[3 * i + 2] = p.z;
    uv[2 * i] = (gc + 0.5) / g.cols; uv[2 * i + 1] = 1 - (gr + 0.5) / g.rows;
  }
  const idx = [];
  for (let r = 0; r < R - 1; r++) for (let c = 0; c < C - 1; c++) {
    const a = r * C + c, b = a + 1, d = a + C, e = d + 1;
    if (valid[a] && valid[d] && valid[b]) idx.push(a, d, b);
    if (valid[b] && valid[d] && valid[e]) idx.push(b, d, e);
  }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(idx);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const mat = texture
    ? new THREE.MeshLambertMaterial({ map: texture instanceof THREE.Texture ? texture : new THREE.CanvasTexture(texture), side: THREE.DoubleSide })
    : new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
  return new THREE.Mesh(geo, mat);
}

// Frame a grid in the viewer: camera from the south-west, looking at the centre.
export function frameGrid(v, g, origin, exag = 1, zMean = origin.Z) {
  const w = g.xmax - g.xmin, h = g.ymax - g.ymin, d = Math.max(w, h);
  const t = toThree((g.xmin + g.xmax) / 2, (g.ymin + g.ymax) / 2, zMean, origin, exag);
  v.controls.target.copy(t);
  v.camera.position.set(t.x - 0.55 * d, t.y + 0.75 * d, t.z + 0.85 * d);
  v.camera.near = d / 2000; v.camera.far = d * 20; v.camera.updateProjectionMatrix();
}
