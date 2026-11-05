// Course shell: chapter list, hash routing, and mounting of demos/labs.
// A chapter is an HTML fragment in content/. Any element with
// data-demo="name" inside it is brought to life by js/demos/name.js or
// js/lab/name.js, which export mount(element) and return a cleanup function.

export const CHAPTERS = [
  { part: 'Start', items: [{ id: 'home', n: '0', title: 'About this course' }] },
  { part: 'I · Concepts', items: [
    { id: 'central-projection', n: '1', title: 'How a photograph measures' },
    { id: 'interior-orientation', n: '2', title: 'Interior orientation' },
    { id: 'flight-3d', n: '3', title: 'The test flight in 3D' },
    { id: 'space-resection', n: '4', title: 'Space resection' },
    { id: 'stereo-model', n: '5', title: 'The stereo model' },
  ] },
  { part: 'II · Labs', items: [
    { id: 'lab-single-model', n: 'L1', title: 'A single stereo model' },
    { id: 'lab-triangulation', n: 'L2', title: 'Aerial triangulation' },
    { id: 'lab-special', n: 'L3', title: 'Special cases: soil erosion' },
    { id: 'lab-waves', n: 'L4', title: 'Close range: sea waves' },
  ] },
  { part: 'III · Products', items: [
    { id: 'dem', n: '6', title: 'Terrain models by image matching' },
    { id: 'orthophoto', n: '7', title: 'Orthophotos' },
  ] },
];

const MODULES = {
  projection3d: () => import('./demos/projection3d.js'),
  affine2d: () => import('./demos/affine2d.js'),
  flight3d: () => import('./demos/flight3d.js'),
  resection3d: () => import('./demos/resection3d.js'),
  stereomodel3d: () => import('./demos/stereomodel3d.js'),
  ioLab: () => import('./lab/io-lab.js'),
  modelLab: () => import('./lab/model-lab.js'),
  matchdemo: () => import('./demos/matchdemo.js'),
  dtmLab: () => import('./lab/dtm-lab.js'),
  resampling: () => import('./demos/resampling.js'),
  orthoLab: () => import('./lab/ortho-lab.js'),
  blockLab: () => import('./lab/block-lab.js'),
  closerangeLab: () => import('./lab/closerange-lab.js'),
  pseudocam: () => import('./demos/pseudocam.js'),
  distortion: () => import('./demos/distortion.js'),
};

const toc = document.getElementById('toc');
const page = document.getElementById('page');
const rail = document.getElementById('rail');
const menuBtn = document.getElementById('menuBtn');
let cleanups = [];

toc.innerHTML = CHAPTERS.map(g => `
  <div><h4>${g.part}</h4><ol>${g.items.map(c =>
    `<li><a href="#${c.id}" data-id="${c.id}" class="${c.soon ? 'soon' : ''}"><span class="n">${c.n}</span><span>${c.title}</span></a></li>`).join('')}
  </ol></div>`).join('');

menuBtn.addEventListener('click', () => {
  const open = rail.classList.toggle('open');
  menuBtn.setAttribute('aria-expanded', String(open));
});

async function route() {
  const all = CHAPTERS.flatMap(g => g.items);
  let id = location.hash.replace('#', '') || 'home';
  if (!all.some(c => c.id === id && !c.soon)) id = 'home';
  cleanups.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
  cleanups = [];
  toc.querySelectorAll('a').forEach(a => a.toggleAttribute('aria-current', a.dataset.id === id));
  toc.querySelectorAll('a').forEach(a => { if (a.dataset.id === id) a.setAttribute('aria-current', 'page'); });
  rail.classList.remove('open');
  menuBtn.setAttribute('aria-expanded', 'false');
  try {
    const res = await fetch(`content/${id}.html`);
    if (!res.ok) throw new Error(res.status);
    page.innerHTML = await res.text();
  } catch (e) {
    page.innerHTML = `<p class="loading">This chapter could not be loaded. If you opened the file directly from disk, serve the folder instead (for example <code>python3 -m http.server</code>).</p>`;
    return;
  }
  const idx = all.findIndex(c => c.id === id);
  const next = all.slice(idx + 1).find(c => !c.soon);
  if (next) page.insertAdjacentHTML('beforeend', `<p style="margin-top:56px"><a class="btn primary" href="#${next.id}" style="text-decoration:none">Next: ${next.n} · ${next.title} →</a></p>`);
  window.scrollTo(0, 0);
  for (const el of page.querySelectorAll('[data-demo]')) {
    const load = MODULES[el.dataset.demo];
    if (!load) continue;
    try {
      const mod = await load();
      const off = await mod.mount(el);
      if (typeof off === 'function') cleanups.push(off);
    } catch (e) {
      console.error(e);
      el.insertAdjacentHTML('beforeend', `<p class="caption">This demo failed to start: ${e.message}</p>`);
    }
  }
}

window.addEventListener('hashchange', route);
route();
