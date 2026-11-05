# Course data

The site reads everything from `data/sample/`. That folder is ignored by git:
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
| `dem20.f32` + `dem20.json` | Terrain heights, float32, row 0 = north edge, with the grid's extent |
| `ortho.jpg` + `ortho.json` | Orthophoto covering the same extent as the terrain model |

Pixel coordinates in the `.INN` files use the bottom-left corner of the scan
as origin, with rows counted upward.

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
