// Generate the PWA / home-screen icons from the brand house mark.
// Run once with: node scripts/gen-pwa-icons.cjs
const sharp = require('sharp');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public');

// The rounded brand mark (matches favicon.svg), used for the "any" icons.
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#24503f"/>
  <path d="M8 16.2 L16 9 L24 16.2 V24.5 A0.9 0.9 0 0 1 23.1 25.4 H8.9 A0.9 0.9 0 0 1 8 24.5 Z" fill="#f4f1ea"/>
  <path d="M5.4 16.9 L16 7.2 L26.6 16.9 A1 1 0 0 1 25.2 18.4 L16 10 L6.8 18.4 A1 1 0 0 1 5.4 16.9 Z" fill="#1c4032"/>
  <rect x="13.2" y="17.7" width="5.6" height="5.6" rx="0.6" fill="#cf9f2e"/>
  <path d="M16 17.7 V23.3 M13.2 20.5 H18.8" stroke="#f4f1ea" stroke-width="0.9"/>
</svg>`;

// Full-bleed green square (no rounded corners) for maskable + Apple, so the OS
// applies its own shape cleanly and the house stays inside the safe zone.
const fullBleed = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="#24503f"/>
  <g transform="translate(16 16) scale(0.82) translate(-16 -16)">
    <path d="M8 16.2 L16 9 L24 16.2 V24.5 A0.9 0.9 0 0 1 23.1 25.4 H8.9 A0.9 0.9 0 0 1 8 24.5 Z" fill="#f4f1ea"/>
    <path d="M5.4 16.9 L16 7.2 L26.6 16.9 A1 1 0 0 1 25.2 18.4 L16 10 L6.8 18.4 A1 1 0 0 1 5.4 16.9 Z" fill="#1c4032"/>
    <rect x="13.2" y="17.7" width="5.6" height="5.6" rx="0.6" fill="#cf9f2e"/>
    <path d="M16 17.7 V23.3 M13.2 20.5 H18.8" stroke="#f4f1ea" stroke-width="0.9"/>
  </g>
</svg>`;

async function render(svg, size, name) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(path.join(OUT, name));
  console.log('wrote', name, size + 'x' + size);
}

(async () => {
  await render(rounded, 192, 'icon-192.png');
  await render(rounded, 512, 'icon-512.png');
  await render(fullBleed, 512, 'icon-maskable-512.png');
  await render(fullBleed, 180, 'apple-touch-icon.png');
})();
