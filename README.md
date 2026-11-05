# Open Photogrammetry Lab

An open, browser-based course in digital photogrammetry. Each chapter pairs a
short explanation with interactive 3D demos, and the labs use the same
in-browser software from interior orientation to orthophotos.

Everything runs client-side: no installation, no server-side processing, and
no upload of the user's images.

## Status

| Part | Chapter | State |
|---|---|---|
| Concepts | 1 · How a photograph measures (central projection, scale, relief displacement) | ✅ text + 3D demo |
| Concepts | 2 · Interior orientation (fiducials, affine/similarity, least squares) | ✅ text + 2D demo + lab |
| Concepts | 3 · The test flight in 3D (exterior orientation, overlap, B/H) | ✅ text + 3D demo on real terrain |
| Concepts | 4 · Relative orientation | planned |
| Concepts | 5 · Absolute orientation | planned |
| Labs | L1 single model · L2 aerial triangulation · L3 special cases | planned |
| Products | 6 · DEM by image matching · 7 · Orthophotos | planned |

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
- Rotation: R = Rz(κ) · Ry(−φ) · Rx(ω), camera to ground.

## License

Code: GPL-3.0 (see `LICENSE`).
