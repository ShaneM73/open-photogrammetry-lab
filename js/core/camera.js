// A photo ready for measuring and resampling: interior orientation (camera
// mm <-> pixels), exterior orientation (ground <-> camera mm) and, when
// loaded, its grey values. Works for scanned film (affine from fiducials)
// and digital sensors (affine from pixel size and principal point) alike,
// because both are described by the same 6-parameter relation.
import { cameraToPixel, pixelToCamera, rotationMatrix } from './orientation.js';

// inn: parsed .INN/.IDC; fullRows: rows of the original image (for the
// bottom-left pixel convention); scale: original pixels per loaded pixel;
// format: { hx, hy } half-size in mm of the usable image area (inside the
// film frame and fiducial marks); points outside it count as not seen.
export function makePhoto({ id, inn, eo = null, fullRows, scale = 1, grey = null, format = null }) {
  const c = inn.coef;
  const photo = {
    id, inn, eo, scale, grey, fullRows, format,
    focal: inn.focal || eo?.focal,
    // camera mm -> raster position in the loaded image (origin top-left, pixel i covers i..i+1)
    toRaster(x, y) {
      const p = cameraToPixel(c, x, y);
      return [p.col / scale, (fullRows - p.row) / scale];
    },
    fromRaster(u, v) {
      return pixelToCamera(c, u * scale, fullRows - v * scale);
    },
    setEO(e) {
      photo.eo = { ...e, R: e.R || rotationMatrix(e.omega, e.phi, e.kappa) };
      return photo;
    },
    // ground -> image coordinates in mm (null if behind the camera or outside the format)
    projectMM(X, Y, Z) {
      const e = photo.eo, R = e.R;
      const dx = X - e.X0, dy = Y - e.Y0, dz = Z - e.Z0;
      const u2 = R[0][2] * dx + R[1][2] * dy + R[2][2] * dz;
      if (u2 >= 0) return null;
      const x = -e.focal * (R[0][0] * dx + R[1][0] * dy + R[2][0] * dz) / u2;
      const y = -e.focal * (R[0][1] * dx + R[1][1] * dy + R[2][1] * dz) / u2;
      if (photo.format && (Math.abs(x) > photo.format.hx || Math.abs(y) > photo.format.hy)) return null;
      return [x, y];
    },
    // ground -> raster position in the loaded image
    project(X, Y, Z) {
      const m = photo.projectMM(X, Y, Z);
      return m ? photo.toRaster(m[0], m[1]) : null;
    },
    // grey value at a ground point (bilinear), or -1 outside the photo
    sampleGround(X, Y, Z) {
      const r = photo.project(X, Y, Z);
      return r ? sampleBilinear(photo.grey, r[0] - 0.5, r[1] - 0.5) : -1;
    },
  };
  if (eo) photo.setEO(eo);
  return photo;
}

// g: { w, h, g: Uint8Array }; (u, v) in pixel-centre coordinates.
export function sampleBilinear(img, u, v) {
  const u0 = Math.floor(u), v0 = Math.floor(v);
  if (u0 < 0 || v0 < 0 || u0 >= img.w - 1 || v0 >= img.h - 1) return -1;
  const fu = u - u0, fv = v - v0, i = v0 * img.w + u0, g = img.g;
  return (g[i] * (1 - fu) + g[i + 1] * fu) * (1 - fv) + (g[i + img.w] * (1 - fu) + g[i + img.w + 1] * fu) * fv;
}

export function sampleNearest(img, u, v) {
  const a = Math.round(u), b = Math.round(v);
  if (a < 0 || b < 0 || a >= img.w || b >= img.h) return -1;
  return img.g[b * img.w + a];
}

// Bicubic convolution (a = -0.5), 4 x 4 neighbourhood.
export function sampleBicubic(img, u, v) {
  const u0 = Math.floor(u), v0 = Math.floor(v);
  if (u0 < 1 || v0 < 1 || u0 >= img.w - 2 || v0 >= img.h - 2) return sampleBilinear(img, u, v);
  const w = t => { t = Math.abs(t); return t <= 1 ? 1.5 * t ** 3 - 2.5 * t ** 2 + 1 : t < 2 ? -0.5 * t ** 3 + 2.5 * t ** 2 - 4 * t + 2 : 0; };
  let s = 0;
  for (let j = -1; j <= 2; j++) {
    const wy = w(v - (v0 + j));
    for (let i = -1; i <= 2; i++) s += wy * w(u - (u0 + i)) * img.g[(v0 + j) * img.w + u0 + i];
  }
  return Math.max(0, Math.min(255, s));
}

// Grey values of an image element as { w, h, g }.
export function greyData(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const rgba = ctx.getImageData(0, 0, img.width, img.height).data;
  const g = new Uint8Array(img.width * img.height);
  for (let i = 0; i < g.length; i++) g[i] = rgba[4 * i];
  return { w: img.width, h: img.height, g };
}
