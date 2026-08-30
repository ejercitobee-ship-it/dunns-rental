// Extract text positions from the lease PDF to find exact coordinates for form fields
const { readFile } = require('fs/promises');
const { join } = require('path');

async function main() {
  // Dynamic import for the ES module
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const INPUT = 'C:/Users/ejerc/Downloads/MH-Dunn-Residential-Lease-Agreement (Lease).pdf';
  const data = new Uint8Array(await readFile(INPUT));
  const doc = await pdfjsLib.getDocument({ data }).promise;

  // Extract text with positions for pages 2-5, 13-14
  const pagesToExtract = [2, 3, 4, 5, 13, 14];

  for (const pageNum of pagesToExtract) {
    const page = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });

    console.log(`\n${'='.repeat(70)}`);
    console.log(`PAGE ${pageNum} (${viewport.width} x ${viewport.height})`);
    console.log('='.repeat(70));

    // Group items by approximate y-position (within 3pt)
    const lines = [];
    for (const item of textContent.items) {
      if (!item.str || !item.str.trim()) continue;

      const tx = item.transform;
      // transform is [scaleX, skewY, skewX, scaleY, translateX, translateY]
      const x = Math.round(tx[4] * 10) / 10;
      const y = Math.round(tx[5] * 10) / 10;
      const fontSize = Math.round(Math.abs(tx[0]) * 10) / 10;
      const width = Math.round(item.width * 10) / 10;

      lines.push({ text: item.str, x, y, fontSize, width });
    }

    // Sort by y descending (top of page first), then x ascending
    lines.sort((a, b) => b.y - a.y || a.x - b.x);

    for (const item of lines) {
      const endX = Math.round((item.x + item.width) * 10) / 10;
      console.log(`  y=${String(item.y).padStart(6)} x=${String(item.x).padStart(6)} endX=${String(endX).padStart(6)} fs=${item.fontSize}  "${item.text}"`);
    }
  }

  await doc.destroy();
}

main().catch(err => { console.error(err); process.exit(1); });
