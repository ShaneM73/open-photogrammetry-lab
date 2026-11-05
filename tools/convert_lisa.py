"""Convert the original course data (.IMA rasters, .QLK chips) into web-friendly files.

Usage: python3 -I tools/convert_lisa.py <data_dir> <out_dir>

Writes <out_dir>/sample (tutorial 1), block (tutorial 2), erosion (tutorial 3), waves (tutorial 4).

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

def grid_json(meta, z, valid, path, step=1, decimals=1):
    """Write a height grid as compact JSON: integers in units of 10^-decimals, null = no data.
    Row 0 is the northern (top) edge."""
    z = z[::step, ::step]; valid = valid[::step, ::step]
    k = 10 ** decimals
    vals = np.where(valid, np.round(z * k), np.nan).ravel()
    out = dict(rows=z.shape[0], cols=z.shape[1], xmin=meta['xmin'], xmax=meta['xmax'], ymin=meta['ymin'],
               ymax=meta['ymax'], pixel=meta['pixel'] * step, divisor=k,
               values=[None if np.isnan(v) else int(v) for v in vals])
    json.dump(out, open(path, 'w'), separators=(',', ':'))

def heights(meta, a):
    z = meta['zmin'] + a.astype(float) * (meta['zmax'] - meta['zmin']) / 32767
    return z, a != 0   # raw 0 marks cells without a height

def copy_text(src, dst):
    open(dst, 'wb').write(open(src, 'rb').read())

def convert_block(src, out):
    """Tutorial 2: a block of 21 photos in 3 strips. Photos are stored at half
    resolution to keep the download reasonable; 'scale' in each .json says so."""
    os.makedirs(out, exist_ok=True)
    t2 = os.path.join(src, 'tutorial_2')
    photos = sorted(f.split('.')[0] for f in os.listdir(os.path.join(t2, 'input')) if f.upper().endswith('.IMA'))
    for name in photos:
        meta, a = read_ima(os.path.join(t2, 'input', name + '.IMA'))
        im = Image.fromarray(a)
        im.resize((a.shape[1] // 2, a.shape[0] // 2), Image.LANCZOS).save(os.path.join(out, name + '.jpg'), quality=90)
        json.dump(dict(meta, scale=2), open(os.path.join(out, name + '.json'), 'w'))
        copy_text(os.path.join(t2, 'output', name + '.INN'), os.path.join(out, name + '.INN'))
    for f in os.listdir(os.path.join(t2, 'input')):
        if f.upper().endswith('.QLK'):
            a = np.frombuffer(open(os.path.join(t2, 'input', f), 'rb').read(), dtype='u1').reshape(121, 121)
            Image.fromarray(a).save(os.path.join(out, 'chip_' + f.split('.')[0] + '.png'))
    copy_text(os.path.join(t2, 'input', 'control.dat'), os.path.join(out, 'CONTROL.DAT'))
    copy_text(os.path.join(t2, 'input', 'RMK_1523.CMR'), os.path.join(out, 'RMK_1523.CMR'))
    copy_text(os.path.join(t2, 'output', 'TIEPOINT.DAT'), os.path.join(out, 'TIEPOINT.DAT'))
    copy_text(os.path.join(t2, 'output', 'cp_icoor.dat'), os.path.join(out, 'CP_ICOOR.DAT'))
    json.dump(dict(photos=photos), open(os.path.join(out, 'block.json'), 'w'))

def convert_closerange(src, out, tut, images, cam, dtms, extra=()):
    """Tutorials 3 and 4: digital cameras, close range."""
    os.makedirs(out, exist_ok=True)
    t = os.path.join(src, tut)
    for name in images:
        f = [x for x in os.listdir(os.path.join(t, 'input')) if x.split('.')[0] == name][0]
        meta, a = read_ima(os.path.join(t, 'input', f))
        Image.fromarray(a).save(os.path.join(out, name + '.png'), optimize=True)
        json.dump(meta, open(os.path.join(out, name + '.json'), 'w'))
        copy_text(os.path.join(t, 'output', name + '.ABS'), os.path.join(out, name + '.ABS'))
    copy_text(os.path.join(t, 'output', cam + '.IDC'), os.path.join(out, 'CAMERA.INN'))
    copy_text(os.path.join(t, 'output', cam + '.CMR'), os.path.join(out, 'CAMERA.CMR'))
    copy_text(os.path.join(t, 'output', 'control.dat'), os.path.join(out, 'CONTROL.DAT'))
    for f, dst in extra:
        copy_text(os.path.join(t, f), os.path.join(out, dst))
    for f, dst, step, dec in dtms:
        meta, a = read_ima(os.path.join(t, 'output', f))
        z, valid = heights(meta, a)
        grid_json(meta, z, valid, os.path.join(out, dst), step, dec)

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
    # heights in decimetres as integers keep the JSON compact
    meta_d['heights_dm'] = np.round(zs * 10).astype(int).ravel().tolist()
    json.dump(meta_d, open(os.path.join(out, 'dem20.json'), 'w'), separators=(',', ':'))
    meta, ortho = read_ima(os.path.join(t2, 'ortho.ima'))
    Image.fromarray(ortho).save(os.path.join(out, 'ortho.jpg'), quality=85)
    json.dump(meta, open(os.path.join(out, 'ortho.json'), 'w'))
    # plain-text reference files are copied as-is
    for f in ['CONTROL.DAT', 'RMK_1523.CMR', '157.INN', '158.INN', '157.ABS', '158.ABS']:
        open(os.path.join(out, f), 'wb').write(open(os.path.join(t1, 'output', f), 'rb').read())

if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    main(src, os.path.join(out, 'sample'))
    convert_block(src, os.path.join(out, 'block'))
    convert_closerange(src, os.path.join(out, 'erosion'), 'tutorial_3', ['1004', '1005', '5004', '5005'], 'CAMERA_1',
                       [('GITT_1000.IMA', 'ref_dtm_1000.json', 1, 1), ('GITT_5000.IMA', 'ref_dtm_5000.json', 1, 1)],
                       extra=[('output/DAXYZ_1000.DAT', 'START_1000.DAT'), ('output/DAXYZ_5000.DAT', 'START_5000.DAT')])
    convert_closerange(src, os.path.join(out, 'waves'), 'tutorial_4', ['191201', '191202', '191401', '191402'], 'CAMERA_1',
                       [('GITT_1912.IMA', 'ref_dtm_1912.json', 2, 2), ('GITT_1914.IMA', 'ref_dtm_1914.json', 2, 2)],
                       extra=[('output/START_PNT.DAT', 'START_PNT.DAT'), ('input/border.dat', 'BORDER.DAT')])
