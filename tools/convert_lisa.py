"""Convert the original course data (.IMA rasters, .QLK chips) into web-friendly files.

Usage: python3 -I tools/convert_lisa.py <data_dir> <out_dir>

.IMA layout: 370-byte ASCII header (rows, cols, bits, xmin, xmax, ymin, ymax,
pixel size, zmin, zmax, ...), then for 8-bit images a 768-byte RGB palette,
then raw pixels row by row (top row first). 16-bit rasters are little-endian
and store heights as z = zmin + v * (zmax - zmin) / 32767.
"""
import sys, os, json
import numpy as np
from PIL import Image

def read_ima(path):
    b = open(path, 'rb').read()
    h = b[:370].decode('latin1')
    rows, cols, bits = int(h[0:6]), int(h[6:12]), int(h[12:14])
    nums = [float(v) for v in h[14:].split()[:7]]
    meta = dict(rows=rows, cols=cols, bits=bits, xmin=nums[0], xmax=nums[1],
                ymin=nums[2], ymax=nums[3], pixel=nums[4], zmin=nums[5], zmax=nums[6])
    if bits == 8:
        a = np.frombuffer(b[1138:1138 + rows * cols], dtype='u1').reshape(rows, cols)
    else:
        a = np.frombuffer(b[370:370 + rows * cols * 2], dtype='<i2').reshape(rows, cols)
    return meta, a

def main(src, out):
    os.makedirs(out, exist_ok=True)
    t1 = os.path.join(src, 'tutorial_1')
    for name in ['157', '158']:
        meta, a = read_ima(os.path.join(t1, 'input', name + '.IMA'))
        Image.fromarray(a).save(os.path.join(out, name + '.png'), optimize=True)
        # small overview for 3D texturing
        Image.fromarray(a).resize((a.shape[1] // 4, a.shape[0] // 4), Image.LANCZOS).save(
            os.path.join(out, name + '_q.jpg'), quality=85)
        json.dump(meta, open(os.path.join(out, name + '.json'), 'w'))
    for f in sorted(os.listdir(os.path.join(t1, 'input'))):
        if f.upper().endswith('.QLK'):
            a = np.frombuffer(open(os.path.join(t1, 'input', f), 'rb').read(), dtype='u1').reshape(121, 121)
            Image.fromarray(a).save(os.path.join(out, 'chip_' + f.split('.')[0] + '.png'))
    t2 = os.path.join(src, 'tutorial_2', 'output')
    meta, dem = read_ima(os.path.join(t2, 'gitt.ima'))
    z = meta['zmin'] + dem.astype(float) * (meta['zmax'] - meta['zmin']) / 32767
    step = 4  # 20 m grid for the 3D scene
    zs = z[::step, ::step]
    meta_d = dict(meta, rows=zs.shape[0], cols=zs.shape[1], pixel=meta['pixel'] * step)
    np.round(zs, 1).astype('<f4').tofile(os.path.join(out, 'dem20.f32'))
    json.dump(meta_d, open(os.path.join(out, 'dem20.json'), 'w'))
    meta, ortho = read_ima(os.path.join(t2, 'ortho.ima'))
    Image.fromarray(ortho).save(os.path.join(out, 'ortho.jpg'), quality=85)
    json.dump(meta, open(os.path.join(out, 'ortho.json'), 'w'))
    # plain-text reference files are copied as-is
    for f in ['CONTROL.DAT', 'RMK_1523.CMR', '157.INN', '158.INN', '157.ABS', '158.ABS']:
        open(os.path.join(out, f), 'wb').write(open(os.path.join(t1, 'output', f), 'rb').read())

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
