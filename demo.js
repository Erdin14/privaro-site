// Two small demos on the homepage. Neither sends anything anywhere: the
// photo is read, encrypted and drawn inside this page.

// "See it encrypted": AES-256-GCM over a photo's pixels, with the encrypted
// bytes drawn back as pixels. Pressing and holding really decrypts them. The
// reveal then follows the bytes in order, the way the cipher walks through
// them sixteen at a time: a line sweeps down with the photo above it and the
// byte offset riding on it.
(() => {
  const demo = document.getElementById('demo');
  if (!demo || !window.crypto || !crypto.subtle) return;
  demo.hidden = false;

  const before = demo.querySelector('.demo-before');
  const after = demo.querySelector('.demo-after');
  const scan = demo.querySelector('.scan');
  const readout = scan.querySelector('span');
  const keyOut = demo.querySelector('.demo-key code');
  const ctx = after.getContext('2d');
  const MAX = 640;
  const motion = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w, h, n, rgb, key, iv, cipher, plain, out, showing = false;

  // Pixels lo..hi (in reading order) show the photo; the rest show ciphertext.
  // A reveal moves hi down, letting go moves it back up, and encrypting a new
  // photo moves lo down.
  let lo = 0, hi = 0, tween = null, frame = 0, fade = 0;

  // Copy pixels from..to of `src` (packed RGB) to the canvas, redrawing only those rows.
  function paint(from, to, src) {
    const d = out.data;
    for (let i = from * 4, j = from * 3, end = to * 3; j < end; i += 4, j += 3) {
      d[i] = src[j];
      d[i + 1] = src[j + 1];
      d[i + 2] = src[j + 2];
    }
    const y0 = Math.floor(from / w), y1 = Math.ceil(to / w);
    if (y1 > y0) ctx.putImageData(out, 0, 0, 0, y0, w, y1 - y0);
  }
  function setLo(v) { if (v > lo) paint(lo, v, cipher); lo = v; }
  function setHi(v) {
    if (v > hi) paint(hi, v, plain);
    else if (v < hi) paint(v, hi, cipher);
    hi = v;
  }

  // Put the line at pixel `p` and show its byte offset, or `text`.
  function line(p, text) {
    const y = after.clientTop + (p / w / h) * after.clientHeight;
    scan.style.transform = `translateY(${y.toFixed(2)}px)`;
    scan.classList.toggle('flip', y > after.clientHeight - 24);
    // Offsets count whole 16-byte AES blocks, the unit the cipher works in.
    readout.textContent = text || '0x' + (Math.floor(p * 3 / 16) * 16).toString(16).toUpperCase().padStart(6, '0');
    clearTimeout(fade);
    scan.classList.add('on');
  }
  function hideLine(delay) {
    clearTimeout(fade);
    fade = setTimeout(() => scan.classList.remove('on'), delay || 0);
  }

  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  // Move lo or hi to `to`. A full sweep takes `ms`; a partial one, its share of that.
  function run(which, to, ms, done) {
    cancelAnimationFrame(frame);
    frame = 0;
    const set = which === 'lo' ? setLo : setHi;
    const from = which === 'lo' ? lo : hi;
    if (!motion || from === to) {
      tween = null;
      set(to);
      if (done) done();
      return;
    }
    tween = { set, from, to, done, start: performance.now(), dur: Math.max(180, ms * Math.abs(to - from) / n), lo: which === 'lo' };
    frame = requestAnimationFrame(step);
  }
  function step(now) {
    const t = Math.min(1, Math.max(0, (now - tween.start) / tween.dur));
    const v = Math.round(tween.from + (tween.to - tween.from) * ease(t));
    tween.set(v);
    line(v);
    if (t < 1) { frame = requestAnimationFrame(step); return; }
    frame = 0;
    const done = tween.done;
    tween = null;
    if (done) done();
  }

  // Finish encrypting a new photo at once, so a reveal starts from all noise.
  function settle() {
    if (tween && tween.lo) { cancelAnimationFrame(frame); frame = 0; tween = null; }
    if (lo > 0) setLo(n);
    if (lo === n) lo = hi = 0;
  }

  async function encrypt(fromPhoto) {
    key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    iv = crypto.getRandomValues(new Uint8Array(12));
    cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, rgb));
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
    keyOut.textContent = Array.from(raw, b => b.toString(16).padStart(2, '0')).join('');
    cancelAnimationFrame(frame);
    frame = 0;
    tween = null;
    if (fromPhoto) {
      // A new photo starts out whole and is encrypted from the first byte down.
      plain = rgb;
      lo = 0;
      hi = n;
      paint(0, n, rgb);
      run('lo', n, 1200, () => { lo = hi = 0; hideLine(150); });
    } else {
      lo = hi = 0;
      paint(0, n, cipher);
      hideLine();
    }
  }

  async function reveal(on) {
    showing = on;
    if (!cipher) return;
    if (!on) {
      if (tween && tween.lo) return;
      if (hi > 0) run('hi', 0, 560, () => hideLine());
      return;
    }
    const decrypted = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher));
    if (!showing) return;
    settle();
    plain = decrypted;
    // decrypt() only returns once the GCM tag has checked out, so say so at the end.
    run('hi', n, 1000, () => { if (motion) { line(n, 'GCM tag ✓'); hideLine(1100); } });
  }

  function load(src) {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      w = Math.max(1, Math.round(img.naturalWidth * scale));
      h = Math.max(1, Math.round(img.naturalHeight * scale));
      n = w * h;
      before.width = after.width = w;
      before.height = after.height = h;
      const bctx = before.getContext('2d');
      bctx.drawImage(img, 0, 0, w, h);
      const px = bctx.getImageData(0, 0, w, h).data;
      rgb = new Uint8Array(n * 3);
      for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
        rgb[j] = px[i];
        rgb[j + 1] = px[i + 1];
        rgb[j + 2] = px[i + 2];
      }
      out = ctx.createImageData(w, h);
      for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
      if (src.startsWith('blob:')) URL.revokeObjectURL(src);
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
  // the first encryption sweep happens where it can be seen.
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
