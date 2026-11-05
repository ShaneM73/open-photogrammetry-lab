// Shared loader for the sample terrain (DEM + orthophoto) and reference files.
import { DATA, toThree } from './three-util.js';
import { parseABS, parseINN, parseControl } from '../core/formats.js';
import { rotationMatrix } from '../core/orientation.js';

let cache = null;

export function loadSample() {
  if (cache) return cache;
  const get = (f, type = 'text') => fetch(DATA + f).then(r => { if (!r.ok) throw new Error(`${f} is missing`); return r[type](); });
  cache = (async () => {
    const [demMeta, orthoMeta, control, a157, a158, i157, i158] = await Promise.all([
      get('dem20.json', 'json'), get('ortho.json', 'json'), get('CONTROL.DAT'),
      get('157.ABS'), get('158.ABS'), get('157.INN'), get('158.INN'),
    ]);
    const dem = Float32Array.from(demMeta.heights_dm, h => h / 10);
    const { rows, cols, xmin, ymax, pixel } = demMeta;
    const heightAt = (X, Y) => {
      const c = (X - xmin) / pixel - 0.5, r = (ymax - Y) / pixel - 0.5;
      if (c < 0 || r < 0 || c > cols - 1 || r > rows - 1) return NaN;
      const c0 = Math.floor(c), r0 = Math.floor(r), c1 = Math.min(c0 + 1, cols - 1), r1 = Math.min(r0 + 1, rows - 1);
      const fc = c - c0, fr = r - r0, z = (rr, cc) => dem[rr * cols + cc];
      return (z(r0, c0) * (1 - fc) + z(r0, c1) * fc) * (1 - fr) + (z(r1, c0) * (1 - fc) + z(r1, c1) * fc) * fr;
    };
    const abs = { 157: parseABS(a157), 158: parseABS(a158) };
    for (const e of Object.values(abs)) e.R = rotationMatrix(e.omega, e.phi, e.kappa);
    return {
      demMeta, orthoMeta, dem, heightAt, abs,
      inn: { 157: parseINN(i157), 158: parseINN(i158) },
      control: parseControl(control),
      origin: { X: (demMeta.xmin + demMeta.xmax) / 2, Y: (demMeta.ymin + demMeta.ymax) / 2, Z: 1000 },
    };
  })();
  cache.catch(() => { cache = null; });
  return cache;
}

// Terrain mesh draped with the orthophoto. `crop` (optional) limits it to
// {xmin,xmax,ymin,ymax}. Returns the mesh; call mesh.userData.setExag(e) to rescale.
export async function terrainMesh(s, origin, crop = null, exag = 1) {
  const { demMeta: m, orthoMeta: o, dem } = s;
  let c0 = 0, c1 = m.cols - 1, r0 = 0, r1 = m.rows - 1;
  if (crop) {
    c0 = Math.max(0, Math.floor((crop.xmin - m.xmin) / m.pixel)); c1 = Math.min(m.cols - 1, Math.ceil((crop.xmax - m.xmin) / m.pixel));
    r0 = Math.max(0, Math.floor((m.ymax - crop.ymax) / m.pixel)); r1 = Math.min(m.rows - 1, Math.ceil((m.ymax - crop.ymin) / m.pixel));
  }
  const W = c1 - c0 + 1, H = r1 - r0 + 1;
  const pos = new Float32Array(W * H * 3), uv = new Float32Array(W * H * 2);
  const geo = new THREE.BufferGeometry();
  const place = e => {
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const i = r * W + c, X = m.xmin + (c + c0 + 0.5) * m.pixel, Y = m.ymax - (r + r0 + 0.5) * m.pixel;
      const p = toThree(X, Y, dem[(r + r0) * m.cols + c + c0], origin, e);
      pos[3 * i] = p.x; pos[3 * i + 1] = p.y; pos[3 * i + 2] = p.z;
      uv[2 * i] = (X - o.xmin) / (o.xmax - o.xmin); uv[2 * i + 1] = (Y - o.ymin) / (o.ymax - o.ymin);
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  };
  const idx = [];
  for (let r = 0; r < H - 1; r++) for (let c = 0; c < W - 1; c++) { const a = r * W + c; idx.push(a, a + W, a + 1, a + 1, a + W, a + W + 1); }
  geo.setIndex(idx);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  place(exag);
  const tex = await new THREE.TextureLoader().loadAsync(DATA + 'ortho.jpg');
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
  mesh.userData.setExag = place;
  return mesh;
}
