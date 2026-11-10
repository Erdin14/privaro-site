// Photographs og/og.html and writes og.jpg, the picture a link to the site is
// shown with. Run from the repository root, only when the picture changes:
//
//   node og/render.js            writes og.jpg
//   node og/render.js out.jpg    writes somewhere else, to look before replacing
//
// Then run python3 build.py: every page names og.jpg with a hash of the file,
// so a new picture gets a new address and previews stop showing the old one.
//
// Needs Node, Playwright with its Chromium, and the Inter typeface (4.0 or
// later, which has the Display cut as a family of its own: rsms.me/inter).
// None of that is needed to build or publish the site.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'og.jpg'));
const WIDTH = 1200, HEIGHT = 630;
const TYPES = { '.html': 'text/html', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
    // The page asks for the site's files by the addresses the site uses
    // (/shots/…, /appstore-badge.svg). They're answered from this folder's
    // parent: no server to start, and nothing is fetched from anywhere else.
    const missing = [];
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      const file = path.join(ROOT, decodeURIComponent(url.pathname));
      if (url.hostname !== 'privaro.invalid' || !file.startsWith(ROOT + path.sep) || !fs.existsSync(file)) {
        missing.push(url.href);
        return route.abort();
      }
      return route.fulfill({ body: fs.readFileSync(file), contentType: TYPES[path.extname(file)] || 'application/octet-stream' });
    });
    await page.goto('http://privaro.invalid/og/og.html', { waitUntil: 'networkidle' });
    if (missing.length) throw new Error('The picture asks for files that are not here: ' + missing.join(', '));

    // A missing typeface doesn't fail, it's quietly replaced, and the name
    // comes out a different width with nothing lined up. So ask what was drawn.
    const session = await page.context().newCDPSession(page);
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const { root } = await session.send('DOM.getDocument');
    for (const selector of ['.mark', '.line']) {
      const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector });
      const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
      const drawn = fonts.map(font => font.familyName);
      if (drawn.some(name => name !== 'Inter Display')) {
        throw new Error(`${selector} was drawn in ${drawn.join(', ')}, not Inter Display. Install Inter (rsms.me/inter) and run this again.`);
      }
    }
    await page.evaluate(() => Promise.all([...document.images].map(img => img.decode())));

    // Quality 92: the photos and the small type stay clean, and the file
    // stays near 100 KB. Previews are fetched on mobile data, and the apps
    // that show them compress the picture again whatever it's given.
    await page.screenshot({ path: OUT, type: 'jpeg', quality: 92 });
    console.log(`wrote ${path.relative(process.cwd(), OUT)} (${WIDTH} by ${HEIGHT}, ${Math.round(fs.statSync(OUT).size / 1024)} KB)`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
