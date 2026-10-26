/**
 * Mini encodeur PNG (sans dépendance) : dessine des disques sur une image.
 * Les points du « juste prix » sont envoyés sous forme d'IMAGE et non de liste,
 * pour qu'on ne puisse pas les compter en lisant le code de la page.
 */
const zlib = require('zlib');

const TABLE_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) { let c = -1; for (const b of buf) c = TABLE_CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }

function bloc(type, donnees) {
  const longueur = Buffer.alloc(4); longueur.writeUInt32BE(donnees.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), donnees]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([longueur, td, crc]);
}

/**
 * @param {number} l largeur  @param {number} h hauteur
 * @param {Array<{x,y,r,c:[r,g,b]}>} disques
 * @param {[r,g,b]} fond
 * @param {Function} bruit () => [0..1[ pour un léger grain (complique l'analyse automatique)
 * @returns {string} data URL PNG
 */
function dessinerDisques(l, h, disques, fond, bruit) {
  const px = Buffer.alloc(l * h * 3);
  for (let i = 0; i < l * h; i++) {
    const g = Math.floor(bruit() * 10) - 5;
    px[i * 3] = fond[0] + g; px[i * 3 + 1] = fond[1] + g; px[i * 3 + 2] = fond[2] + g;
  }
  for (const d of disques) {
    for (let y = Math.max(0, Math.floor(d.y - d.r - 1)); y <= Math.min(h - 1, Math.ceil(d.y + d.r + 1)); y++) {
      for (let x = Math.max(0, Math.floor(d.x - d.r - 1)); x <= Math.min(l - 1, Math.ceil(d.x + d.r + 1)); x++) {
        const dist = Math.hypot(x - d.x, y - d.y);
        const a = Math.max(0, Math.min(1, d.r + 0.5 - dist)); // anticrénelage simple
        if (a <= 0) continue;
        const o = (y * l + x) * 3;
        for (let k = 0; k < 3; k++) px[o + k] = Math.round(px[o + k] * (1 - a) + d.c[k] * a);
      }
    }
  }
  const brut = Buffer.alloc((l * 3 + 1) * h);
  for (let y = 0; y < h; y++) { brut[y * (l * 3 + 1)] = 0; px.copy(brut, y * (l * 3 + 1) + 1, y * l * 3, (y + 1) * l * 3); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(l, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc('IHDR', ihdr), bloc('IDAT', zlib.deflateSync(brut, { level: 9 })), bloc('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

module.exports = { dessinerDisques };
