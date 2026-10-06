// Two small demos on the homepage. Neither sends anything anywhere: the
// photo is read, encrypted and drawn inside this page.

// "See it encrypted": AES-256-GCM over a photo's pixels, with the encrypted
// bytes drawn back as pixels. Pressing and holding really decrypts them.
(() => {
  const demo = document.getElementById('demo');
  if (!demo || !window.crypto || !crypto.subtle) return;
  demo.hidden = false;

  const before = demo.querySelector('.demo-before');
  const after = demo.querySelector('.demo-after');
  const keyOut = demo.querySelector('.demo-key code');
  const MAX = 640;
  let w, h, rgb, key, iv, cipher, showing = false;

  function draw(canvas, bytes) {
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let i = 0, j = 0; j < w * h * 3; i += 4, j += 3) {
      img.data[i] = bytes[j];
      img.data[i + 1] = bytes[j + 1];
      img.data[i + 2] = bytes[j + 2];
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  async function encrypt() {
    key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    iv = crypto.getRandomValues(new Uint8Array(12));
    cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, rgb));
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
    keyOut.textContent = Array.from(raw, b => b.toString(16).padStart(2, '0')).join('');
    draw(after, cipher);
  }

  async function reveal(on) {
    showing = on;
    if (!cipher) return;
    if (!on) return draw(after, cipher);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher));
    if (showing) draw(after, plain);
  }

  function load(src) {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      w = Math.max(1, Math.round(img.naturalWidth * scale));
      h = Math.max(1, Math.round(img.naturalHeight * scale));
      before.width = w;
      before.height = h;
      const ctx = before.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const px = ctx.getImageData(0, 0, w, h).data;
      rgb = new Uint8Array(w * h * 3);
      for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
        rgb[j] = px[i];
        rgb[j + 1] = px[i + 1];
        rgb[j + 2] = px[i + 2];
      }
      if (src.startsWith('blob:')) URL.revokeObjectURL(src);
      encrypt();
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
  demo.querySelector('.demo-rekey').addEventListener('click', () => { if (rgb) encrypt(); });

  // Start with a screenshot of the vault, once the section is close to view.
  new IntersectionObserver((entries, io) => {
    if (entries.some(e => e.isIntersecting)) { io.disconnect(); load('/shots/shot-vault.jpg'); }
  }, { rootMargin: '400px' }).observe(demo);
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
