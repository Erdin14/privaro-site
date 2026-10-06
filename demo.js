// Two small demos on the homepage. Neither sends anything anywhere: the
// photo is read, encrypted and drawn inside this page.

// "See it encrypted": AES-256-GCM over a photo's pixels, with the encrypted
// bytes drawn back as pixels. Pressing and holding really decrypts them; the
// photo then unscrambles block by block, roughly top to bottom.
(() => {
  const demo = document.getElementById('demo');
  if (!demo || !window.crypto || !crypto.subtle) return;
  demo.hidden = false;

  const before = demo.querySelector('.demo-before');
  const after = demo.querySelector('.demo-after');
  const keyOut = demo.querySelector('.demo-key code');
  const ctx = after.getContext('2d');
  const MAX = 640;
  const motion = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w, h, rgb, key, iv, cipher, plain, showing = false;

  // The encrypted canvas is drawn in square tiles. `order` is the sequence
  // they switch in; `pos` counts how many, in that order, show the photo.
  let out, order, tile, cols, pos = 0, target = 0, speed = 0, last = 0, frame = 0;

  function setup() {
    tile = Math.max(4, Math.round(Math.min(w, h) / 56));
    cols = Math.ceil(w / tile);
    const rows = Math.ceil(h / tile);
    const tiles = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) tiles.push([r * cols + c, 0.55 * (r / rows) + 0.45 * Math.random()]);
    }
    tiles.sort((a, b) => a[1] - b[1]);
    order = Uint32Array.from(tiles, t => t[0]);
    after.width = w;
    after.height = h;
    out = ctx.createImageData(w, h);
    for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
    cancelAnimationFrame(frame);
    frame = 0;
  }

  // Copy tiles order[from..to) from `src` (packed RGB) into the canvas buffer.
  function paint(from, to, src) {
    const d = out.data;
    for (let k = from; k < to; k++) {
      const x0 = (order[k] % cols) * tile, y0 = Math.floor(order[k] / cols) * tile;
      const x1 = Math.min(x0 + tile, w), y1 = Math.min(y0 + tile, h);
      for (let y = y0; y < y1; y++) {
        for (let x = x0, i = (y * w + x0) * 4, j = (y * w + x0) * 3; x < x1; x++, i += 4, j += 3) {
          d[i] = src[j];
          d[i + 1] = src[j + 1];
          d[i + 2] = src[j + 2];
        }
      }
    }
  }

  function show(state) {
    paint(0, order.length, state ? plain : cipher);
    pos = target = state ? order.length : 0;
    ctx.putImageData(out, 0, 0);
  }

  // Move towards all-photo (1) or all-noise (0) over `ms`, from wherever it is now.
  function animate(to, ms) {
    if (!motion) {
      cancelAnimationFrame(frame);
      frame = 0;
      return show(to === 1);
    }
    target = to * order.length;
    speed = order.length / ms;
    if (!frame) { last = performance.now(); frame = requestAnimationFrame(step); }
  }

  function step(now) {
    // A frame's timestamp can be slightly earlier than the call that asked
    // for it, so clamp the step instead of ever moving backwards.
    const dt = Math.max(0, Math.min(now - last, 50));
    last = Math.max(last, now);
    const next = pos < target ? Math.min(target, pos + speed * dt) : Math.max(target, pos - speed * dt);
    const a = Math.floor(pos), b = Math.floor(next);
    if (b > a) paint(a, b, plain);
    else if (b < a) paint(b, a, cipher);
    pos = next;
    ctx.putImageData(out, 0, 0);
    frame = pos !== target ? requestAnimationFrame(step) : 0;
  }

  async function encrypt(fromPhoto) {
    key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    iv = crypto.getRandomValues(new Uint8Array(12));
    cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, rgb));
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
    keyOut.textContent = Array.from(raw, b => b.toString(16).padStart(2, '0')).join('');
    cancelAnimationFrame(frame);
    frame = 0;
    if (fromPhoto) {
      // A new photo starts out visible and dissolves into its ciphertext.
      plain = rgb;
      show(true);
      animate(0, 900);
    } else {
      show(false);
    }
  }

  async function reveal(on) {
    showing = on;
    if (!cipher) return;
    if (!on) return animate(0, 320);
    const decrypted = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher));
    if (!showing) return;
    plain = decrypted;
    animate(1, 560);
  }

  function load(src) {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      w = Math.max(1, Math.round(img.naturalWidth * scale));
      h = Math.max(1, Math.round(img.naturalHeight * scale));
      before.width = w;
      before.height = h;
      const bctx = before.getContext('2d');
      bctx.drawImage(img, 0, 0, w, h);
      const px = bctx.getImageData(0, 0, w, h).data;
      rgb = new Uint8Array(w * h * 3);
      for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
        rgb[j] = px[i];
        rgb[j + 1] = px[i + 1];
        rgb[j + 2] = px[i + 2];
      }
      if (src.startsWith('blob:')) URL.revokeObjectURL(src);
      setup();
      encrypt(true);
    };
    img.src = src;
  }

  after.addEventListener('pointerdown', e => { after.setPointerCapture(e.pointerId); reveal(true); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) after.addEventListener(type, () => reveal(false));
  after.addEventListener('contextmenu', e => e.preventDefault());
  after.addEventListener('keydown', e => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); reveal(true); }
  });
  after.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') reveal(false); });

  demo.querySelector('.demo-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) load(URL.createObjectURL(file));
  });
  demo.querySelector('.demo-rekey').addEventListener('click', () => { if (rgb && !showing) encrypt(false); });

  // Start with a screenshot of the vault, once the section is in view, so
  // the first dissolve into noise happens where it can be seen.
  new IntersectionObserver((entries, io) => {
    if (entries.some(e => e.isIntersecting)) { io.disconnect(); load('/shots/shot-vault.jpg'); }
  }, { threshold: 0.3 }).observe(demo);
})();

// "Try it on this tab": the disguise feature, applied to the browser tab.
(() => {
  const btn = document.querySelector('.disguise');
  const icon = document.querySelector('link[rel="icon"]');
  if (!btn || !icon) return;
  btn.hidden = false;
  const original = { title: document.title, href: icon.href, label: btn.textContent };
  const calculator = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    '<rect width="64" height="64" rx="14" fill="#1c1c1e"/>' +
    '<rect x="12" y="10" width="40" height="12" rx="3" fill="#3a3a3c"/>' +
    '<g fill="#a5a5a5"><circle cx="18" cy="34" r="5"/><circle cx="32" cy="34" r="5"/>' +
    '<circle cx="18" cy="49" r="5"/><circle cx="32" cy="49" r="5"/></g>' +
    '<g fill="#ff9f0a"><circle cx="46" cy="34" r="5"/><circle cx="46" cy="49" r="5"/></g></svg>');
  let disguised = false;
  btn.addEventListener('click', () => {
    disguised = !disguised;
    document.title = disguised ? btn.dataset.name : original.title;
    icon.href = disguised ? calculator : original.href;
    btn.textContent = disguised ? btn.dataset.undo : original.label;
  });
})();
