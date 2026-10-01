// Renders tools/icon.svg into the app icons (uses sharp from the hazira-phone folder).
const sharp = require('../../hazira-phone/node_modules/sharp');
const fs = require('fs'), path = require('path');
const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'));
const out = f => path.join(__dirname, '../icons', f);
(async () => {
  for (const s of [192, 512]) await sharp(svg).resize(s, s).png().toFile(out(`icon-${s}.png`));
  await sharp(svg).resize(180, 180).png().toFile(out('apple-touch-icon.png'));
  await sharp(svg).resize(64, 64).png().toFile(out('favicon.png'));
  // maskable: same art, a bit smaller inside a safe zone
  const inner = await sharp(svg).resize(410, 410).png().toBuffer();
  await sharp({ create: { width: 512, height: 512, channels: 4, background: '#2f6b3f' } }).composite([{ input: inner, top: 51, left: 51 }]).png().toFile(out('maskable-512.png'));
  console.log('icons done');
})();
