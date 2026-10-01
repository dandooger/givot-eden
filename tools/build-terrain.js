// Real elevation (Terrarium tiles from the open AWS terrain dataset, data/terrain/*.png)
// -> terrain.js: a height grid in meters around the settlement center.
const sharp = require('../../hazira-phone/node_modules/sharp');
const fs = require('fs'), path = require('path');

const LAT0 = 31.66055, LON0 = 35.01595;
const KX = Math.cos((LAT0 * Math.PI) / 180) * 111320, KY = 110540;
const EXT = { x0: -1300, x1: 1300, y0: -1500, y1: 1100 }, STEP = 8;
const Z = 15, N = 2 ** Z;

(async () => {
  const tiles = {};
  for (const f of fs.readdirSync(path.join(__dirname, '../data/terrain'))) {
    const [, x, y] = f.replace('.png', '').split('_').map(Number);
    const { data } = await sharp(path.join(__dirname, '../data/terrain', f)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    tiles[x + '_' + y] = data;
  }
  const px = (X, Y) => { // elevation at global pixel coords (bilinear)
    const get = (gx, gy) => {
      const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256), d = tiles[tx + '_' + ty];
      const i = ((gy - ty * 256) * 256 + (gx - tx * 256)) * 3;
      return d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768;
    };
    const x0 = Math.floor(X), y0 = Math.floor(Y), fx = X - x0, fy = Y - y0;
    return get(x0, y0) * (1 - fx) * (1 - fy) + get(x0 + 1, y0) * fx * (1 - fy) + get(x0, y0 + 1) * (1 - fx) * fy + get(x0 + 1, y0 + 1) * fx * fy;
  };
  const elev = (x, y) => {
    const lon = LON0 + x / KX, lat = LAT0 - y / KY, r = (lat * Math.PI) / 180;
    const X = ((lon + 180) / 360) * N * 256, Y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N * 256;
    return px(X - 0.5, Y - 0.5);
  };
  const base = elev(0, 0);
  const nx = Math.round((EXT.x1 - EXT.x0) / STEP) + 1, ny = Math.round((EXT.y1 - EXT.y0) / STEP) + 1;
  const h = new Int16Array(nx * ny);
  let mn = 1e9, mx = -1e9;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v = elev(EXT.x0 + i * STEP, EXT.y0 + j * STEP) - base;
    h[j * nx + i] = Math.round(v * 10);
    mn = Math.min(mn, v); mx = Math.max(mx, v);
  }
  const b64 = Buffer.from(h.buffer).toString('base64');
  fs.writeFileSync(path.join(__dirname, '../terrain.js'), `window.TERRAIN={x0:${EXT.x0},y0:${EXT.y0},step:${STEP},nx:${nx},ny:${ny},base:${base.toFixed(1)},h:'${b64}'};\n`);
  console.log('center elevation', base.toFixed(1), 'm; relative min/max', mn.toFixed(1), mx.toFixed(1), 'grid', nx, 'x', ny);
  for (const [n, x, y] of [['entrance', -155, -231], ['south', 0, 250], ['east', 250, 0], ['west', -250, 0], ['exit', -300, -988]]) console.log(n, (elev(x, y) - base).toFixed(1));
})();
