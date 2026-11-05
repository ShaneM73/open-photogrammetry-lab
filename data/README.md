# Course data

The site reads its data from `data/sample/`, `data/block/`, `data/erosion/` and `data/waves/`. These folders are ignored by git:
the data set used during development comes from a published textbook and is
not redistributed here. A replacement data set for the open course is planned.

## Files the site expects in `data/sample/`

| File | Content |
|---|---|
| `157.png`, `158.png` | Scanned photographs, 8-bit grey, full resolution |
| `157_q.jpg`, `158_q.jpg` | Same photos at 1/4 size (texture for the 3D scene) |
| `RMK_1523.CMR` | Camera: one line per fiducial `id x y` (mm), then the focal length (mm) |
| `157.INN`, `158.INN` | Reference interior orientations |
| `157.ABS`, `158.ABS` | Exterior orientations: focal length; ω φ κ (rad); X₀ Y₀ Z₀; then `id x y X Y Z` |
| `CONTROL.DAT` | Ground control points: `id X Y Z` |
| `chip_<id>.png` | 121 × 121 image chips around each control point |
| `dem20.json` | Terrain grid: extent, cell size, and `heights_dm` (heights in decimetres, row by row from the north edge) |
| `ortho.jpg` + `ortho.json` | Orthophoto covering the same extent as the terrain model |

Pixel coordinates in the `.INN` files use the bottom-left corner of the scan
as origin, with rows counted upward.

## Other data sets

`tools/convert_lisa.py` also writes:

- `data/block/`: 21 photos of a block (half resolution JPEG), their `.INN` files, `CONTROL.DAT`, control point chips, `TIEPOINT.DAT` (rough strip-connection positions in a ~300 px overview, rows from the top) and `CP_ICOOR.DAT` (approximate control positions).
- `data/erosion/`, `data/waves/`: digital-camera photos (PNG), `CAMERA.INN` (interior orientation of the sensor), `CAMERA.CMR`, `.ABS` per photo, `CONTROL.DAT`, start points, reference surfaces as JSON grids (`divisor`, `values`, null = no data), and for the waves the evaluation polygon `BORDER.DAT`.

Rotation angles in `.ABS` files mean R = Ry(a) · Rx(b) · Rz(c) for the three stored angles; the software converts them to the standard ω-φ-κ convention on reading.

## From the original course data

```bash
python3 -I tools/convert_lisa.py /path/to/data data/sample
```

where `/path/to/data` contains `tutorial_1/` … `tutorial_4/`. Requires
`numpy` and `Pillow`.

## Your own data

Any scan that a browser can open (PNG or JPEG) works in the labs. Write the
camera file and control points as plain text in the formats above. A converter
for common photogrammetry exchange formats is on the to-do list.
