// Demo: the sample stereo pair 157/158 reconstructed in 3D from the data files.
// Terrain = the DEM, draped with the orthophoto. Each camera is placed with
// its exterior orientation (.ABS); its photo is drawn on the enlarged image
// plane, and the footprint is found by intersecting corner rays with the DEM.
import { createViewer, toThree, line, label, cssVar, DATA } from './three-util.js';
import { parseABS, parseINN, parseControl } from '../core/formats.js';
import { rotationMatrix, groundToImage, imageToTerrain, pixelToCamera, cameraToPixel } from '../core/orientation.js';

const IMAGES = ['157', '158'];
const SIZE = { cols: 2848, rows: 2834 };

export async function mount(root) {
  root.innerHTML = `
  <div class="demo-head"><h3>The test flight: photos 157 and 158 over the terrain</h3><span class="hint">Drag to orbit · right-drag to pan · click a control point</span></div>
  <div class="demo-body wide-side">
    <div class="stage" id="f3-stage" style="min-height:560px"><span class="stage-label" id="f3-lbl">Loading terrain and photos…</span></div>
    <div class="side">
      <div class="ctrl"><label for="f3-ex">Vertical exaggeration <output id="f3-exo">1.5×</output></label><input type="range" id="f3-ex" min="1" max="4" step="0.5" value="1.5"></div>
      <label class="check"><input type="checkbox" id="f3-photo" checked> Photos on image planes</label>
      <label class="check"><input type="checkbox" id="f3-rays" checked> Rays to control points</label>
      <label class="check"><input type="checkbox" id="f3-foot" checked> Footprints and bundles</label>
      <div class="seg"><button class="btn" id="f3-v1">Oblique view</button><button class="btn" id="f3-v2">From above</button><button class="btn" id="f3-v3">Along the base</button></div>
      <div class="readout" id="f3-read"></div>
      <div id="f3-pt" class="readout">Click a control point (white, red or cyan marker) to see its coordinates and where it appears in each photo.</div>
    </div>
  </div>
  <p class="caption">Everything here is computed from the data files: terrain from the DEM, cameras from the exterior orientations, footprints by intersecting the rays through the photo corners with the terrain. Marker colours: <span style="color:var(--left)">seen in 157 only</span>, <span style="color:var(--right)">158 only</span>, white: in both photos (the stereo overlap).</p>`;

  const $ = s => root.querySelector(s);
  const stage = $('#f3-stage');
  const v = createViewer(stage, { near: 10, far: 80000 });
  const colLeft = cssVar('--left'), colRight = cssVar('--right');

  const get = (f, type = 'text') => fetch(DATA + f).then(r => { if (!r.ok) throw new Error(`${f} is missing`); return r[type](); });
  const [demMeta, orthoMeta, control, ...rest] = await Promise.all([
    get('dem20.json', 'json'), get('ortho.json', 'json'), get('CONTROL.DAT'),
    ...IMAGES.flatMap(id => [get(id + '.ABS'), get(id + '.INN')]),
  ]);
  const dem = Float32Array.from(demMeta.heights_dm, h => h / 10);
  const ctrl = parseControl(control);
  const cams = IMAGES.map((id, i) => {
    const eo = parseABS(rest[2 * i]);
    eo.R = rotationMatrix(eo.omega, eo.phi, eo.kappa);
    return { id, eo, inn: parseINN(rest[2 * i + 1]), color: i === 0 ? colLeft : colRight };
  });

  // Terrain heights by bilinear interpolation; DEM row 0 is the northern edge.
  const { rows, cols, xmin, ymax, pixel } = demMeta;
  const heightAt = (X, Y) => {
    const c = (X - xmin) / pixel - 0.5, r = (ymax - Y) / pixel - 0.5;
    if (c < 0 || r < 0 || c > cols - 1 || r > rows - 1) return NaN;
    const c0 = Math.floor(c), r0 = Math.floor(r), c1 = Math.min(c0 + 1, cols - 1), r1 = Math.min(r0 + 1, rows - 1);
    const fc = c - c0, fr = r - r0, z = (rr, cc) => dem[rr * cols + cc];
    return (z(r0, c0) * (1 - fc) + z(r0, c1) * fc) * (1 - fr) + (z(r1, c0) * (1 - fc) + z(r1, c1) * fc) * fr;
  };
  const origin = { X: (demMeta.xmin + demMeta.xmax) / 2, Y: (demMeta.ymin + demMeta.ymax) / 2, Z: 1000 };
  const meanZ = ctrl.reduce((s, p) => s + p.Z, 0) / ctrl.length;

  let exag = 1.5;
  const P = (X, Y, Z) => toThree(X, Y, Z, origin, exag);

  // ---- terrain mesh ----
  const terrainGeo = new THREE.BufferGeometry();
  const pos = new Float32Array(rows * cols * 3), uv = new Float32Array(rows * cols * 2);
  const ow = orthoMeta.xmax - orthoMeta.xmin, oh = orthoMeta.ymax - orthoMeta.ymin;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, X = xmin + (c + 0.5) * pixel, Y = ymax - (r + 0.5) * pixel;
    uv[2 * i] = (X - orthoMeta.xmin) / ow; uv[2 * i + 1] = (Y - orthoMeta.ymin) / oh;
  }
  const idx = [];
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
    const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  terrainGeo.setIndex(idx);
  terrainGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  terrainGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const orthoTex = await new THREE.TextureLoader().loadAsync(DATA + 'ortho.jpg');
  orthoTex.anisotropy = 4;
  const terrain = new THREE.Mesh(terrainGeo, new THREE.MeshLambertMaterial({ map: orthoTex }));
  v.scene.add(terrain);
  const photoTex = await Promise.all(IMAGES.map(id => new THREE.TextureLoader().loadAsync(DATA + id + '_q.jpg')));

  const dyn = new THREE.Group();
  v.scene.add(dyn);
  const pickables = [];

  function placeTerrain() {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c, p = P(xmin + (c + 0.5) * pixel, ymax - (r + 0.5) * pixel, dem[i]);
      pos[3 * i] = p.x; pos[3 * i + 1] = p.y; pos[3 * i + 2] = p.z;
    }
    terrainGeo.attributes.position.needsUpdate = true;
    terrainGeo.computeVertexNormals();
    terrainGeo.computeBoundingSphere();
  }

  // Which control points fall inside each photo (by collinearity + interior orientation)
  const inPhoto = (cam, p) => {
    const q = groundToImage(cam.eo, p.X, p.Y, p.Z);
    const px = cameraToPixel(cam.inn.coef, q.x, q.y);
    return px.col > 0 && px.col < SIZE.cols && px.row > 0 && px.row < SIZE.rows ? { ...q, ...px } : null;
  };

  function build() {
    dyn.children.forEach(o => { o.geometry?.dispose(); if (o.material && o.material.map && !photoTex.includes(o.material.map)) o.material.map.dispose(); o.material?.dispose(); });
    dyn.clear();
    pickables.length = 0;
    const show = { photo: $('#f3-photo').checked, rays: $('#f3-rays').checked, foot: $('#f3-foot').checked };
    const k = 450 / (cams[0].eo.focal / 1000) / 1000; // enlargement: image plane 450 m below the camera
    const footprints = [];
    cams.forEach((cam, ci) => {
      const { eo } = cam;
      const O = P(eo.X0, eo.Y0, eo.Z0);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(40, 16, 12), new THREE.MeshBasicMaterial({ color: cam.color }));
      ball.position.copy(O); dyn.add(ball);
      const tag = label(`photo ${cam.id}`, '#ffffff', 90); tag.position.copy(O).add(new THREE.Vector3(0, 150, 0)); dyn.add(tag);
      // photo corners: pixel -> camera mm -> world (enlarged image plane)
      const cornersPx = [[0, 0], [SIZE.cols, 0], [SIZE.cols, SIZE.rows], [0, SIZE.rows]];
      const cornersMm = cornersPx.map(([c, r]) => pixelToCamera(cam.inn.coef, c, r));
      const onPlane = cornersMm.map(({ x, y }) => {
        const vv = [x * k, y * k, -eo.focal * k];
        const d = [0, 1, 2].map(i => eo.R[i][0] * vv[0] + eo.R[i][1] * vv[1] + eo.R[i][2] * vv[2]);
        return P(eo.X0 + d[0], eo.Y0 + d[1], eo.Z0 + d[2]);
      });
      if (show.photo) {
        const g = new THREE.BufferGeometry().setFromPoints([onPlane[0], onPlane[1], onPlane[2], onPlane[0], onPlane[2], onPlane[3]]);
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]), 2));
        dyn.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: photoTex[ci], side: THREE.DoubleSide, transparent: true, opacity: 0.92 })));
      }
      dyn.add(line([...onPlane, onPlane[0]], cam.color));
      // footprint: sample the photo border, intersect each ray with the terrain
      const border = [];
      for (let s = 0; s < 4; s++) for (let t = 0; t < 1; t += 1 / 24) {
        const a = cornersMm[s], b = cornersMm[(s + 1) % 4];
        border.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
      const ground = border.map(q => imageToTerrain(eo, q.x, q.y, (X, Y) => heightAt(X, Y), meanZ));
      footprints.push(ground);
      if (show.foot) {
        const pts = ground.map(g => P(g.X, g.Y, heightAt(g.X, g.Y) + 6));
        dyn.add(line([...pts, pts[0]], cam.color));
        [0, 24, 48, 72].forEach(i => dyn.add(line([O, pts[i]], cam.color, { opacity: 0.4 })));
      }
      cam.O = O;
    });
    // control points
    ctrl.forEach(p => {
      const seen = cams.map(c => inPhoto(c, p));
      const color = seen[0] && seen[1] ? 0xffffff : seen[0] ? colLeft : seen[1] ? colRight : 0x888888;
      const pin = new THREE.Mesh(new THREE.ConeGeometry(28, 90, 12), new THREE.MeshBasicMaterial({ color }));
      pin.rotation.x = Math.PI;
      pin.position.copy(P(p.X, p.Y, p.Z)).add(new THREE.Vector3(0, 45, 0));
      pin.userData = { point: p, seen };
      dyn.add(pin); pickables.push(pin);
      const t = label(String(p.id), '#ffffff', 55); t.position.copy(pin.position).add(new THREE.Vector3(0, 90, 0)); dyn.add(t);
      if (show.rays) cams.forEach((c, i) => { if (seen[i]) dyn.add(line([c.O, P(p.X, p.Y, p.Z)], c.color, { opacity: 0.55 })); });
    });
    // stereo geometry readout
    const [a, b] = cams.map(c => c.eo);
    const B = Math.hypot(b.X0 - a.X0, b.Y0 - a.Y0);
    const H = (a.Z0 + b.Z0) / 2 - meanZ;
    const dir = [(b.X0 - a.X0) / B, (b.Y0 - a.Y0) / B];
    const extent = fp => { const s = fp.map(g => g.X * dir[0] + g.Y * dir[1]); return Math.max(...s) - Math.min(...s); };
    const L = (extent(footprints[0]) + extent(footprints[1])) / 2;
    $('#f3-read').innerHTML =
      `Flying height above ground ≈ <b>${Math.round(H)} m</b><br>Image scale ≈ <b>1 : ${Math.round(H / (a.focal / 1000) / 100) * 100}</b><br>` +
      `Air base B = <b>${Math.round(B)} m</b>   B/H = <b>${(B / H).toFixed(2)}</b><br>` +
      `Footprint length ≈ ${(L / 1000).toFixed(2)} km<br>Forward overlap ≈ <b>${Math.round((1 - B / L) * 100)} %</b>`;
    $('#f3-lbl').textContent = `vertical exaggeration ${exag}×`;
  }

  function setView(which) {
    const c = cams.map(x => x.O).reduce((s, p) => s.add(p.clone()), new THREE.Vector3()).multiplyScalar(0.5);
    const tgt = P(origin.X, origin.Y, meanZ);
    tgt.x = c.x; tgt.z = c.z;
    v.controls.target.copy(tgt);
    if (which === 'top') v.camera.position.set(tgt.x, tgt.y + 9000, tgt.z + 1);
    else if (which === 'base') v.camera.position.set(tgt.x - 5500, tgt.y + 1400, tgt.z + 300);
    else v.camera.position.set(tgt.x - 4200, tgt.y + 3800, tgt.z + 5200);
  }

  // picking control points
  const ray = new THREE.Raycaster();
  let downAt = null;
  v.renderer.domElement.addEventListener('pointerdown', e => (downAt = [e.clientX, e.clientY]));
  v.renderer.domElement.addEventListener('pointerup', e => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
    const r = v.renderer.domElement.getBoundingClientRect();
    ray.setFromCamera({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }, v.camera);
    const hit = ray.intersectObjects(pickables)[0];
    if (!hit) return;
    const { point: p, seen } = hit.object.userData;
    $('#f3-pt').innerHTML =
      `<b>Point ${p.id}</b><br>X ${p.X.toFixed(2)}  Y ${p.Y.toFixed(2)}<br>Z ${p.Z.toFixed(2)} m<br>` +
      cams.map((c, i) => seen[i]
        ? `In ${c.id}: x ${seen[i].x.toFixed(2)}  y ${seen[i].y.toFixed(2)} mm<br>  = col ${seen[i].col.toFixed(1)}  row ${seen[i].row.toFixed(1)}`
        : `Not in ${c.id}`).join('<br>') +
      `<img src="${DATA}chip_${p.id}.png" alt="Image chip around point ${p.id}" style="display:block;margin-top:8px;width:121px;image-rendering:pixelated;border-radius:4px">`;
  });

  $('#f3-ex').addEventListener('input', e => { exag = Number(e.target.value); $('#f3-exo').textContent = exag + '×'; placeTerrain(); build(); });
  ['#f3-photo', '#f3-rays', '#f3-foot'].forEach(id => $(id).addEventListener('change', build));
  $('#f3-v1').addEventListener('click', () => setView('oblique'));
  $('#f3-v2').addEventListener('click', () => setView('top'));
  $('#f3-v3').addEventListener('click', () => setView('base'));

  placeTerrain();
  build();
  setView('oblique');
  return () => v.dispose();
}
