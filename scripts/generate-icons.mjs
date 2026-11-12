// Generates every app icon in public/ from scripts/icons/icon.svg.
// Run with: npm run icons
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public');
mkdirSync(out, { recursive: true });

const master = readFileSync(join(root, 'scripts/icons/icon.svg'), 'utf8');

// Rounded-corner variant for browser tabs (browsers don't mask favicons).
const rounded = master
  .replace('<rect width="512" height="512" fill="url(#bg)"/>',
    '<rect width="512" height="512" rx="112" fill="url(#bg)"/>')
  .replace(/\s*<!--[\s\S]*?-->/, '');

const png = (svg, size) =>
  new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();

const write = (name, data) => {
  writeFileSync(join(out, name), data);
  console.log('  public/' + name);
};

// Minimal ICO container holding PNG images.
const ico = (images) => {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.data)]);
};

const og = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#F5F5F7"/>
  <g transform="translate(150 155) scale(0.625)">${rounded
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')}</g>
  <text x="510" y="300" font-family="SF Pro Display, Helvetica Neue, Helvetica, Arial, sans-serif" font-size="112" font-weight="700" letter-spacing="-3" fill="#111">Ledger</text>
  <text x="514" y="380" font-family="SF Pro Text, Helvetica Neue, Helvetica, Arial, sans-serif" font-size="40" fill="#6E6E73">Simple, fast expense tracking</text>
</svg>`;

console.log('Generating icons:');
write('favicon.svg', rounded);
write('favicon.ico', ico([16, 32, 48].map((size) => ({ size, data: png(rounded, size) }))));
write('apple-touch-icon.png', png(master, 180));
write('icon-192.png', png(rounded, 192));
write('icon-512.png', png(rounded, 512));
write('icon-maskable-512.png', png(master, 512));
write('og-image.png', new Resvg(og, { fitTo: { mode: 'width', value: 1200 } }).render().asPng());
