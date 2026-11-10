// Inside the encryption: the homepage's working demo. The reader's own
// browser encrypts a photo with AES-256-GCM, shows the ciphertext where the
// photo was, puts the key away, and opens it again. Nothing here is
// pretended: every byte drawn or listed is one the Web Crypto API produced
// a moment before, and a wrong key or a changed bit fails because the
// cipher says so, not because the script decides it should.
//
// It is a small model of what the Security overview describes, not the
// app's code, and the page says so (templates/partials/inside.html):
// - a random 256-bit vault key, made once, the first time it's needed;
// - for each file a random 128-bit ID, and a key for that file derived from
//   the vault key and the ID with HKDF-SHA256;
// - the file sealed in pieces, each with AES-256-GCM under a fresh random
//   96-bit nonce, each authenticating the file's header and its own place
//   in the file (as the cipher's associated data), so a piece that is
//   changed, dropped or moved doesn't open.
// What it encrypts is the photo's pixels (360 by 540, three bytes each),
// in 12 pieces of 45 rows, so that the ciphertext can be drawn in the same
// place, pixel for pixel. The app encrypts the file, in pieces of 1 MB.
// The numbers W, H and PIECES are also in the page's words
// (i18n/strings-inside.json) and in styles.css (the frame's twelfths);
// tests/publication.py checks they agree.
//
// What it must never do, and the test checks this file for: send anything
// anywhere, or keep anything. It makes no request and writes to no storage.
// A photo the reader picks is decoded by the browser straight into the
// canvas and goes nowhere else. Once a photo is encrypted the script wipes
// its copy of the pixels and clears the canvas they were on: the photo that
// comes back is what decryption returned, checked against a SHA-256 of the
// original.
//
// How it's drawn: as the drawing above it is (privacy-vignette.js). The
// ciphertext lies still under the photo; the photo is seen through a pane
// that slides down while the photo inside slides up by as much, so only its
// edge moves; a line rides that edge. Three transforms and an opacity a
// frame. The encryption itself takes a few milliseconds and is finished
// before the line starts: the line shows the result at a speed that can be
// watched, and the page says that too. With Reduce Motion there is no
// line; each step is the next state.
(() => {
  const lab = document.querySelector('.lab');
  if (!lab) return;
  const find = selector => lab.querySelector(selector);
  const frame = find('.lab-frame'), pane = find('.lab-pane'), scan = find('.lab-scan'), photo = find('.lab-photo');
  const plainCanvas = find('.lab-plain'), cipherCanvas = find('.lab-cipher');
  const band = find('.lab-band'), bandName = find('.lab-band-name'), mark = find('.lab-mark');
  const keyGrid = find('.lab-key'), keyNote = find('.lab-keynote'), fileLabel = find('.lab-file-label');
  const status = find('.lab-status'), actions = find('.lab-actions'), go = find('.lab-go'), picker = find('.lab-picker');
  const alts = [...lab.querySelectorAll('.lab-alt')];
  const view = find('.lab-view'), stepList = find('.lab-steps'), tech = find('.lab-tech'), table = find('.lab-table');
  const steps = [...stepList.children];
  const value = name => find('[data-value="' + name + '"]');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const words = {};
  lab.querySelectorAll('.lab-words [data-w]').forEach(el => { words[el.dataset.w] = el.textContent; });
  const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (_, name) => vars[name]);
  const say = (word, vars) => { status.textContent = vars ? fill(words[word], vars) : words[word]; };
  const count = new Intl.NumberFormat(document.documentElement.lang || 'en');
  const clamp = n => Math.max(0, Math.min(1, n));

  const subtle = window.crypto && crypto.subtle;
  if (!subtle || !plainCanvas.getContext) { say('unsupported'); return; }

  // The file, as the demo lays it out. A 32-byte header: eight letters, the
  // file's ID, and its measurements. Then each piece: nonce, ciphertext,
  // tag.
  const W = plainCanvas.width, H = plainCanvas.height, PIECES = 12;
  const ROWS = H / PIECES, PIECE = ROWS * W * 3;
  const NONCE = 12, TAG = 16, HEAD = 32, SLOT = NONCE + PIECE + TAG, TOTAL = HEAD + PIECES * SLOT;
  const MAGIC = [...'PRIVDEMO'].map(letter => letter.charCodeAt(0));
  const INFO = new TextEncoder().encode('Privaro demo file key');
  const random = length => crypto.getRandomValues(new Uint8Array(length));
  const pick = below => new DataView(random(4).buffer).getUint32(0) % below;

  // The key for one file: HKDF-SHA256 over the vault key, salted with the
  // file's ID. The browser holds the result; the script can use it and
  // can't read it.
  async function fileKey(vaultKey, id) {
    const base = await subtle.importKey('raw', vaultKey, 'HKDF', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: id, info: INFO }, base,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  function header(id) {
    const head = new Uint8Array(HEAD), fields = new DataView(head.buffer);
    head.set(MAGIC);
    head.set(id, 8);
    [W, H, ROWS, PIECES].forEach((n, i) => fields.setUint16(24 + i * 2, n));
    return head;
  }
  // What each piece's tag covers besides the piece: the whole header, and
  // which piece it is.
  function bound(head, index) {
    const data = new Uint8Array(HEAD + 4);
    data.set(head);
    new DataView(data.buffer).setUint32(HEAD, index);
    return data;
  }
  async function seal(pixels, vaultKey) {
    const began = performance.now();
    const head = header(random(16)), key = await fileKey(vaultKey, head.subarray(8, 24));
    const file = new Uint8Array(TOTAL);
    file.set(head);
    for (let i = 0; i < PIECES; i++) {
      const nonce = random(NONCE), at = HEAD + i * SLOT;
      const sealed = await subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: bound(head, i), tagLength: 128 },
        key, pixels.subarray(i * PIECE, (i + 1) * PIECE));
      file.set(nonce, at);
      file.set(new Uint8Array(sealed), at + NONCE);
    }
    return { file, took: performance.now() - began };
  }
  // All of it or none of it: the first piece that fails its check ends it,
  // and what had been decrypted so far is thrown away.
  async function unseal(file, vaultKey) {
    const head = file.subarray(0, HEAD), fields = new DataView(file.buffer, file.byteOffset, HEAD);
    const expected = [W, H, ROWS, PIECES];
    if (file.length !== TOTAL || MAGIC.some((code, i) => head[i] !== code)
      || expected.some((n, i) => fields.getUint16(24 + i * 2) !== n)) return { failed: 1 };
    const key = await fileKey(vaultKey, head.subarray(8, 24));
    const pixels = new Uint8Array(PIECES * PIECE);
    for (let i = 0; i < PIECES; i++) {
      const at = HEAD + i * SLOT;
      try {
        const opened = await subtle.decrypt({ name: 'AES-GCM', iv: file.subarray(at, at + NONCE),
          additionalData: bound(head, i), tagLength: 128 }, key, file.subarray(at + NONCE, at + SLOT));
        pixels.set(new Uint8Array(opened), i * PIECE);
      } catch {
        pixels.fill(0);
        return { failed: i + 1 };
      }
    }
    return { pixels };
  }
  const sha256 = async bytes => new Uint8Array(await subtle.digest('SHA-256', bytes));

  // Pixels in and out of the two canvases. Bytes are drawn three to a
  // pixel, as red, green and blue, and nothing else is done to them.
  const plainContext = plainCanvas.getContext('2d'), cipherContext = cipherCanvas.getContext('2d');
  function paint(context, bytes, from, rows, top) {
    const image = context.createImageData(W, rows), data = image.data;
    for (let i = 0, j = from; i < data.length; i += 4) {
      data[i] = bytes[j++];
      data[i + 1] = bytes[j++];
      data[i + 2] = bytes[j++];
      data[i + 3] = 255;
    }
    context.putImageData(image, 0, top);
  }
  const paintPhoto = pixels => paint(plainContext, pixels, 0, H, 0);
  const paintPiece = (file, i) => paint(cipherContext, file, HEAD + i * SLOT + NONCE, ROWS, i * ROWS);
  // A picture into the frame, filling it, cut to its middle if it's another
  // shape.
  function draw(source, width, height) {
    const scale = Math.max(W / width, H / height), w = W / scale, h = H / scale;
    plainContext.imageSmoothingQuality = 'high';
    plainContext.fillStyle = '#0d1012';
    plainContext.fillRect(0, 0, W, H);
    plainContext.drawImage(source, (width - w) / 2, (height - h) / 2, w, h, 0, 0, W, H);
  }
  // Some browsers hand a page made-up pixels in place of a canvas's own, so
  // that it can't be used to tell one device from another (Tor Browser, and
  // Firefox with its fingerprinting resistance on). Encrypting those would
  // be encrypting nonsense, so the demo checks first, with four colours it
  // knows, and says so if they come back wrong. Browsers that only nudge a
  // value by one or two pass: the photo is then encrypted with that nudge,
  // which nobody can see.
  function readable() {
    try {
      const probe = document.createElement('canvas'), swatches = [[18, 52, 86], [201, 120, 33], [240, 240, 240], [7, 160, 99]];
      probe.width = probe.height = 8;
      const context = probe.getContext('2d');
      swatches.forEach((rgb, i) => {
        context.fillStyle = 'rgb(' + rgb.join(',') + ')';
        context.fillRect((i % 2) * 4, (i >> 1) * 4, 4, 4);
      });
      const data = context.getImageData(0, 0, 8, 8).data;
      return swatches.every((rgb, i) => {
        const at = (((i >> 1) * 4 + 1) * 8 + (i % 2) * 4 + 1) * 4;
        return data[at + 3] === 255 && rgb.every((channel, k) => Math.abs(data[at + k] - channel) <= 6);
      });
    } catch {
      return false;
    }
  }
  function readPhoto() {
    if (!readable()) return null;
    const data = plainContext.getImageData(0, 0, W, H).data, pixels = new Uint8Array(W * H * 3);
    for (let i = 0, j = 0; i < data.length; i += 4) {
      pixels[j++] = data[i];
      pixels[j++] = data[i + 1];
      pixels[j++] = data[i + 2];
    }
    return pixels;
  }

  // The key's 256 dots, the first bit first.
  const dots = [];
  for (let n = 0; n < 256; n++) {
    const dot = document.createElement('i');
    dot.style.setProperty('--n', n);
    dots.push(keyGrid.appendChild(dot));
  }
  const showBits = key => dots.forEach((dot, n) => dot.classList.toggle('on', Boolean(key[n >> 3] & (128 >> (n & 7)))));
  function showKey(mode) {
    keyGrid.dataset.key = mode;
    keyNote.textContent = words['key_' + mode];
  }
  // Bytes, one to a cell.
  function writeBytes(el, bytes, more) {
    el.textContent = '';
    bytes.forEach(byte => { el.appendChild(document.createElement('span')).textContent = byte.toString(16).padStart(2, '0'); });
    if (more) el.appendChild(document.createElement('span')).textContent = '…';
  }
  // The technical view's twelve rows: a piece's number, its nonce, and the
  // start of its tag.
  const rows = [];
  for (let i = 0; i < PIECES; i++) {
    const row = table.tBodies[0].insertRow();
    row.insertCell().textContent = i + 1;
    [12, 5].forEach(cols => {
      const cell = row.insertCell().appendChild(document.createElement('span'));
      cell.className = 'lab-hex';
      cell.style.setProperty('--cols', cols);
    });
    rows.push(row);
  }
  function listPieces(file) {
    rows.forEach((row, i) => {
      const at = HEAD + i * SLOT, cells = row.querySelectorAll('.lab-hex');
      writeBytes(cells[0], file.subarray(at, at + NONCE));
      writeBytes(cells[1], file.subarray(at + SLOT - TAG, at + SLOT - TAG + 4), true);
    });
  }
  // How many pieces the line has passed: their rows are filled in, and the
  // technical view outlines the one it's on.
  let reached = -1, outlined = -1;
  function passed(p) {
    const done = p >= 1 ? PIECES : Math.floor(p * PIECES + 1e-9);
    if (done !== reached) {
      reached = done;
      rows.forEach((row, i) => row.classList.toggle('is-set', i < done));
    }
    if (p > 0 && p < 1) outline(Math.min(done, PIECES - 1), 'on');
    else if (lab.dataset.band === 'on') outline(-1);
  }
  function outline(index, kind) {
    if (index < 0) { outlined = -1; delete lab.dataset.band; return; }
    if (index !== outlined) {
      outlined = index;
      band.style.transform = 'translateY(' + index * 100 + '%)';
      bandName.textContent = fill(words.piece_n, { n: index + 1 });
    }
    lab.dataset.band = kind;
  }
  function failed(index) {
    table.classList.toggle('has-bad', index >= 0);
    rows.forEach((row, i) => row.classList.toggle('is-bad', i === index));
    outline(index, 'bad');
  }
  function clearTech() {
    reached = -1;
    rows.forEach(row => row.classList.remove('is-set'));
    failed(-1);
    writeBytes(value('id'), []);
    writeBytes(value('hash'), []);
    value('stored').textContent = words.stored_none;
    value('time').textContent = '—';
    value('check').textContent = words.check_wait;
    value('last').textContent = words.last_none;
  }

  // The line. p runs from 0 to 1 down the frame; sealing, the photo is what
  // is left below the line, and opening, what has appeared above it. Whole
  // device pixels, so nothing is drawn between two.
  let height = 0, frameRequest = 0, finishLine = null;
  function place(opening, p) {
    const ratio = devicePixelRatio || 1, cut = Math.round(p * height * ratio) / ratio, shift = opening ? cut - height : cut;
    pane.style.transform = 'translateY(' + shift + 'px)';
    plainCanvas.style.transform = 'translateY(' + -shift + 'px)';
    scan.style.transform = 'translateY(' + cut + 'px)';
    scan.style.opacity = clamp(Math.min(p / .05, (1 - p) / .08)).toFixed(3);
  }
  // Back to where the stylesheet has them, once the state says what shows.
  const settle = () => [pane, plainCanvas, scan].forEach(el => { el.style.transform = el.style.opacity = ''; });
  function line(opening, duration) {
    return new Promise(done => {
      const end = () => {
        cancelAnimationFrame(frameRequest);
        finishLine = null;
        passed(1);
        done();
      };
      if (reduce.matches) return end();
      height = frame.offsetHeight;
      const began = performance.now();
      const step = now => {
        const t = clamp((now - began) / duration);
        // Slow to leave, slow to arrive.
        const p = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        place(opening, p);
        passed(p);
        if (t < 1) frameRequest = requestAnimationFrame(step);
        else end();
      };
      finishLine = end;
      place(opening, 0);
      frameRequest = requestAnimationFrame(step);
    });
  }
  // A pause for something to be seen. Leaving the page, or turning Reduce
  // Motion on, ends every pause and the line at once, so nothing is left
  // half way.
  const pauses = new Set();
  const pause = ms => new Promise(done => {
    const end = () => { clearTimeout(timer); pauses.delete(end); done(); };
    const timer = setTimeout(end, ms);
    pauses.add(end);
  });
  const beat = ms => reduce.matches ? Promise.resolve() : pause(ms);
  const hurry = () => { [...pauses].forEach(end => end()); if (finishLine) finishLine(); };
  addEventListener('pagehide', hurry);
  reduce.addEventListener('change', () => { if (reduce.matches) hurry(); });

  // What there is, between steps. While the photo is readable: its pixels.
  // While it's in the vault: the stored file and nothing else of the photo.
  // The vault key outlives both, as the app's does, and is made the first
  // time it's needed.
  let state = 'idle', busy = false, own = false;
  let pixels = null, stored = null, vault = null, original = null, changed = null;
  const offer = () => typeof createImageBitmap === 'function' ? [own ? 'sample' : 'pick'] : [];
  const scenes = {
    idle: { step: 1, go: 'go_encrypt', alts: offer, key: () => vault ? 'shown' : 'none' },
    keying: { step: 2, key: () => 'shown' },
    sealing: { step: 3, key: () => 'shown' },
    locked: { step: 4, go: 'go_unlock', alts: () => ['wrong', 'flip'], key: () => 'away' },
    tampered: { step: 4, go: 'go_unlock', alts: () => ['undo'], key: () => 'away' },
    opening: { step: 5, key: () => 'shown' },
    open: { step: 5, go: 'go_again', alts: offer, key: () => 'shown' }
  };
  function working(on) {
    busy = on;
    [go, ...alts].forEach(button => button.setAttribute('aria-disabled', String(on)));
  }
  function enter(name, word, vars) {
    const scene = scenes[name], vaulted = name === 'locked' || name === 'tampered';
    const offered = scene.go ? scene.alts() : [], held = alts.find(button => button === document.activeElement);
    state = lab.dataset.state = name;
    working(!scene.go);
    if (scene.go) go.textContent = words[scene.go];
    alts.forEach(button => { button.hidden = !offered.includes(button.dataset.act); });
    // The keyboard's place moves with the button it was on: a button that
    // is taken away would otherwise drop it at the top of the page.
    if (held && held.hidden) (alts.find(button => !button.hidden) || go).focus();
    steps.forEach((step, i) => {
      step.classList.toggle('is-done', i + 1 < scene.step);
      if (i + 1 === scene.step) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
    });
    showKey(scene.key());
    fileLabel.textContent = vaulted ? words.file_vault : words.file_plain;
    frame.setAttribute('aria-label', vaulted ? words.alt_cipher : own ? words.alt_own : words.alt_photo);
    if (word) say(word, vars);
  }
  // If the frame is mostly off screen when a button is pressed, it's
  // brought on: what the button does happens there.
  function bringIn() {
    const box = frame.getBoundingClientRect(), seen = Math.min(box.bottom, innerHeight) - Math.max(box.top, 0);
    if (seen < box.height * .6) frame.scrollIntoView({ block: 'nearest', behavior: reduce.matches ? 'auto' : 'smooth' });
  }

  async function encrypt() {
    if (!pixels) {
      pixels = readPhoto();
      if (!pixels) return say('blocked');
      // What's on screen from here on is exactly what will be encrypted.
      paintPhoto(pixels);
    }
    bringIn();
    if (!vault) {
      vault = random(32);
      showBits(vault);
      writeBytes(value('vault'), vault);
      enter('keying', 'keying');
      await beat(1000);
    }
    enter('sealing', 'sealing');
    failed(-1);
    original = await sha256(pixels);
    const { file, took } = await seal(pixels, vault);
    stored = file;
    for (let i = 0; i < PIECES; i++) paintPiece(stored, i);
    listPieces(stored);
    writeBytes(value('id'), stored.subarray(8, 24));
    writeBytes(value('hash'), original);
    const time = took < 1 ? words.time_fast : fill(words.time_ms, { ms: Math.round(took) });
    value('stored').textContent = fill(words.stored_v, { pixels: count.format(pixels.length), stored: count.format(stored.length) });
    value('time').textContent = time;
    value('check').textContent = words.check_wait;
    value('last').textContent = words.last_none;
    await line(false, 2400);
    // The page's copy of the photo goes: from here it exists only as the
    // ciphertext.
    pixels.fill(0);
    pixels = null;
    plainContext.clearRect(0, 0, W, H);
    enter('locked', 'locked', { time });
    settle();
  }

  async function unlock() {
    bringIn();
    height = frame.offsetHeight;
    if (!reduce.matches) place(true, 0);
    enter('opening', 'opening');
    await beat(700);
    const result = await unseal(stored, vault);
    const same = result.pixels && (await sha256(result.pixels)).every((byte, i) => byte === original[i]);
    if (!same) {
      const n = result.failed || 1;
      failed(n - 1);
      value('last').textContent = fill(words.last_bad, { n });
      enter('tampered', 'broken', { n });
      settle();
      return;
    }
    pixels = result.pixels;
    paintPhoto(pixels);
    value('check').textContent = words.check_ok;
    value('last').textContent = words.last_ok;
    await line(true, 1700);
    enter('open', 'open');
    settle();
  }

  // Another key, as random as the first. It's really tried: the first
  // piece's tag doesn't verify, and that's the end of it.
  async function tryWrongKey() {
    working(true);
    const other = random(32), result = await unseal(stored, other);
    if (result.failed) {
      showBits(other);
      showKey('wrong');
      say('denied');
      value('last').textContent = words.last_wrong;
      await pause(1600);
      showBits(vault);
      showKey('away');
    }
    other.fill(0);
    working(false);
  }
  // One bit of one byte of one piece's ciphertext, turned over. The ring
  // shows where; it's kept clear of the frame's edge so it shows whole.
  function changeBit() {
    const x = 12 + pick(W - 24), y = 12 + pick(H - 24), piece = Math.floor(y / ROWS);
    const at = HEAD + piece * SLOT + NONCE + ((y - piece * ROWS) * W + x) * 3 + pick(3);
    changed = { at, bit: 1 << pick(8), piece };
    band.dataset.side = x > W / 2 ? 'start' : 'end';
    stored[at] ^= changed.bit;
    paintPiece(stored, piece);
    mark.style.left = (x + .5) / W * 100 + '%';
    mark.style.top = (y + .5) / H * 100 + '%';
    enter('tampered', 'tampered');
  }
  function undoChange() {
    if (changed) {
      stored[changed.at] ^= changed.bit;
      paintPiece(stored, changed.piece);
    }
    changed = null;
    failed(-1);
    value('last').textContent = words.last_none;
    enter('locked', 'mended');
  }
  // Another photo to try it on: the reader's own, or the sample again.
  function show(source, width, height, mine) {
    draw(source, width, height);
    if (pixels) pixels.fill(0);
    pixels = stored = original = null;
    own = mine;
    clearTech();
    enter('idle', mine ? 'own' : 'idle');
  }
  picker.addEventListener('change', async () => {
    const file = picker.files[0];
    picker.value = '';
    if (!file || busy) return;
    let picture;
    try { picture = await createImageBitmap(file); } catch { return say('badfile'); }
    show(picture, picture.width, picture.height, true);
    if (picture.close) picture.close();
  });

  const does = {
    go: () => ({ idle: encrypt, open: encrypt, locked: unlock, tampered: unlock })[state](),
    wrong: tryWrongKey,
    flip: changeBit,
    undo: undoChange,
    pick: () => picker.click(),
    sample: () => show(photo, photo.naturalWidth, photo.naturalHeight, false)
  };
  // Anything that goes wrong in the middle leaves the photo as it was.
  async function run(act) {
    if (busy) return;
    try {
      await does[act]();
    } catch {
      hurry();
      settle();
      if (pixels) enter(state === 'open' ? 'open' : 'idle', 'unsupported');
      else if (stored) enter(changed ? 'tampered' : 'locked', 'unsupported');
      working(false);
    }
  }
  go.addEventListener('click', () => run('go'));
  alts.forEach(button => button.addEventListener('click', () => run(button.dataset.act)));

  // The two ways of telling it. In the technical view, pointing at a piece's
  // row outlines that piece on the photo.
  function tell() {
    const mode = view.querySelector('input:checked').value;
    lab.dataset.view = mode;
    stepList.hidden = mode === 'tech';
    tech.hidden = mode !== 'tech';
  }
  view.addEventListener('change', tell);
  table.tBodies[0].addEventListener('pointerover', event => {
    const row = event.target.closest('tr');
    if (row && !busy && lab.dataset.band !== 'bad') outline(rows.indexOf(row), 'on');
  });
  table.tBodies[0].addEventListener('pointerleave', () => { if (!busy && lab.dataset.band === 'on') outline(-1); });

  // Begin once the sample is there to draw; until then, and without this
  // script, the picture file shows in its place.
  function begin() {
    draw(photo, photo.naturalWidth, photo.naturalHeight);
    lab.dataset.ready = '';
    actions.hidden = view.hidden = false;
    tell();
    enter('idle');
  }
  if (photo.complete && photo.naturalWidth) begin();
  else photo.addEventListener('load', begin, { once: true });
})();
