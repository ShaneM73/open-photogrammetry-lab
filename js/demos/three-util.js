// Shared Three.js setup for the 3D demos (Three r147 is loaded globally in index.html).
// World axes follow survey convention: X east, Y north, Z up.
// Three.js uses y-up, so a ground point (X, Y, Z) is placed at (X, Z, -Y).

export const DATA = 'data/sample/';

export function toThree(X, Y, Z, origin = { X: 0, Y: 0, Z: 0 }, exag = 1) {
  return new THREE.Vector3(X - origin.X, (Z - origin.Z) * exag, -(Y - origin.Y));
}

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

export function createViewer(stage, { near = 1, far = 50000, fov = 45 } = {}) {
  if (!window.THREE) throw new Error('The 3D library did not load. Check your connection and reload.');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  stage.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(cssVar('--canvas'));
  const camera = new THREE.PerspectiveCamera(fov, 1, near, far);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 0.6);
  sun.position.set(-1, 2, 1);
  scene.add(sun);

  let raf = 0, alive = true;
  const resize = () => {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  resize();
  const hooks = [];
  const loop = () => {
    if (!alive) return;
    controls.update();
    hooks.forEach(f => f());
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  loop();
  return {
    scene, camera, renderer, controls, onFrame: f => hooks.push(f),
    dispose() {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      scene.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) [].concat(o.material).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
      });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

export function line(points, color, opts = {}) {
  const g = new THREE.BufferGeometry().setFromPoints(points);
  const m = opts.dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: opts.dash || 20, gapSize: opts.gap || 12, transparent: true, opacity: opts.opacity ?? 1 })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity: opts.opacity ?? 1 });
  const l = new THREE.Line(g, m);
  if (opts.dashed) l.computeLineDistances();
  return l;
}

// A text label as a camera-facing sprite.
export function label(text, color = '#ffffff', size = 60) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = '600 44px "JetBrains Mono", monospace';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 20;
  c.width = w; c.height = 64;
  ctx.font = font;
  ctx.fillStyle = 'rgba(10,15,20,0.72)';
  ctx.fillRect(0, 0, w, 64);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 10, 34);
  const tex = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(size * w / 64, size, 1);
  s.renderOrder = 10;
  return s;
}
