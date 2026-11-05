# Open Photogrammetry Lab

An open, browser-based course in digital photogrammetry. Each chapter pairs a
short explanation with interactive 3D demos, and the labs use the same
in-browser software from interior orientation to orthophotos.

Everything runs client-side: no installation, no server-side processing, and
no upload of the user's images.

## Status

| Part | Chapter | Content |
|---|---|---|
| Concepts | 1 · How a photograph measures | central projection, scale, relief displacement · 3D demo |
| Concepts | 2 · Interior orientation | fiducials, affine/similarity, least squares · 2D demo + lab |
| Concepts | 3 · The test flight in 3D | exterior orientation, overlap, B/H · 3D demo on the real terrain |
| Concepts | 4 · Space resection | Gauss-Newton step by step · 3D demo |
| Concepts | 5 · The stereo model | intersection, relative + absolute orientation · 3D demo |
| Labs | L1 · A single stereo model | two-photo measurement, resection, anaglyph stereo, floating mark |
| Labs | L2 · Aerial triangulation | 21 photos: control by chip matching, strip connections, 2D block, AATM, bundle adjustment with blunder removal, check points |
| Labs | L3 · Special cases: soil erosion | pseudo camera definition, lens distortion, digital camera, y-parallax correction, DTMs of two epochs, volume |
| Labs | L4 · Close range: sea waves | oblique convergent cameras, water surface at two moments |
| Products | 6 · Terrain models by image matching | correlation explorer, coarse-to-fine matching lab |
| Products | 7 · Orthophotos | resampling demo, orthophoto and mosaic lab |

## Run locally

The site is static HTML, CSS and ES modules, with no build step.

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

(Opening `index.html` directly from disk does not work, because the chapters are
loaded with `fetch`.) Three.js r147 is loaded from jsDelivr.

## Data

The demos and labs read their data from `data/sample/`. This folder is **not**
in the repository. See [`data/README.md`](data/README.md) for the expected files
and how to produce them, either from the original course data set (with
`tools/convert_lisa.py`) or from your own photographs.

## Tests

The core math is checked against reference results shipped with the data:

```bash
node tests/orientation.test.mjs data/sample [path/to/original/data]
node tests/models.test.mjs data/sample
node tests/conventions.test.mjs data
node tests/bundle.test.mjs
```

## Layout

```
index.html            course shell (chapter rail + reading column)
content/*.html        chapter text (one fragment per chapter)
css/style.css         design tokens and layout, light and dark themes
js/app.js             chapter list, hash routing, mounts demos/labs
js/core/              file formats, linear algebra, orientation models
js/demos/             interactive figures (Three.js and canvas)
js/lab/               measuring software (image viewer, labs)
tools/                data conversion scripts
tests/                checks against reference results
```

To add a demo, create `js/demos/name.js` exporting `mount(element)` (return a
cleanup function), register it in `MODULES` in `js/app.js`, and place
`<div class="demo" data-demo="name"></div>` in a chapter.

## Conventions

- Ground: X east, Y north, Z up (metres).
- Camera: x, y in mm from the principal point, y toward the top of the photo.
- Pixels: continuous coordinates, origin at the **bottom-left** corner of the
  scan, col to the right, row upward (a pixel centre is at i + 0.5).
- Rotation: R = Rx(ω) · Ry(φ) · Rz(κ), camera to ground (standard ω-φ-κ). The course
  data files store R = Ry(a) · Rx(b) · Rz(c); `parseABS`/`formatABS` convert.

## License

Copyright © 2026 Xin (Shane) Miao.

- Software: MIT License (see `LICENSE`).
- Course text, figures and exercises: Creative Commons Attribution 4.0
  International, CC BY 4.0 (see `LICENSE-CONTENT.md` and `LICENSES/CC-BY-4.0.txt`).
