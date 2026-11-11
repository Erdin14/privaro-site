// Inside the encryption (/encryption): a small exhibit in eight steps. The
// visitor's own browser makes a key, encrypts a photo with AES-256-GCM,
// puts the result away, tries a wrong key and a changed bit, and decrypts
// it again. Nothing here is pretended: every byte drawn or listed is one
// the Web Crypto API produced a moment before, and a wrong key or a changed
// bit fails because the cipher says so, not because the script decides it
// should.
//
// It is a small model of what the Security overview describes, not the
// app's code, and the page says so (templates/encryption.html):
// - a random 256-bit vault key, made when the visitor asks for it;
// - for each file a random 128-bit ID, and a key for that file derived from
//   the vault key and the ID with HKDF-SHA256;
// - the file sealed in pieces, each with AES-256-GCM under a fresh random
//   96-bit nonce, each authenticating the file's header and its own place
//   in the file (as the cipher's associated data), so a piece that is
//   changed, dropped or moved doesn't open.
// What it encrypts is the photo's pixels (360 by 540, three bytes each),
// in 12 pieces of 45 rows, so that each piece's ciphertext can be drawn
// where that strip of the photo was. The app encrypts the file, in pieces
// of 1 MB. W, H and PIECES are also in the page's words
// (i18n/strings-encryption.json); tests/publication.py checks they agree.
//
// What it must never do, and the test checks this file for: send anything
// anywhere, or keep anything. It makes no request and writes to no storage.
// A photo the visitor picks is decoded by the browser straight into a
// canvas and goes nowhere else.
// Once a photo is encrypted the script stops using its copy of the pixels
// (it overwrites the array and clears the canvases they were on), so the
// photo that comes back is what decryption returned, checked against a
// SHA-256 of the original. That is tidiness, not secure erasure, and the
// page doesn't call it that: a script can't know what a browser still
// holds in memory.
//
// How it's told. The page is a story of ten parts (an opening, eight steps
// and a close), one on screen at a time, and nothing moves on until the
// visitor presses the button: each part waits to be read. Every part says
// what it needs the photo to be when it begins, readable or encrypted, and
// going to a part makes it so, for real: stepping back from the ciphertext
// to the photo is a decryption with the key, and stepping forward past the
// encryption is an encryption. So the eight lines above the scene lead to
// any step in any order, and what's on screen is always what the data is.
// Only the step's own button plays it slowly enough to watch; getting
// there some other way does the same work at once.
//
// How it's drawn. The file is a sheet of twelve strips, one for each
// piece, and each strip is two small canvases: the photo's rows over that
// piece's ciphertext, the upper one seen through a pane that slides off
// sideways (as privacy-vignette.js does it). The stylesheet holds every
// pose and every transition; this script only names the pose and marks
// the strips. The encryption itself takes a millisecond or two and is done
// before the first strip moves: what's watched is the result, shown at a
// pace that can be followed, and the page says that too. With Reduce
// Motion nothing is paced: each press is the next state.
(() => {
  const exhibit = document.querySelector('.exhibit');
  if (!exhibit) return;
  const find = selector => exhibit.querySelector(selector);
  const all = selector => [...exhibit.querySelectorAll(selector)];
  const scene = find('.scene'), picture = find('.scene-view'), rig = find('.rig'), slabBox = find('.slabs');
  const photo = find('.sheet-photo'), ring = find('.sheet-ring'), keyGrid = find('.key');
  const legend = find('.legend'), fileName = find('.legend-file b'), fileState = find('.legend-file span'), keyState = find('.legend-key span');
  const rail = find('.rail'), stops = all('.rail button'), note = find('.story-note'), live = find('.exhibit-live');
  const controls = find('.story-controls'), go = find('.story-go'), back = find('.story-back'), alts = all('.story-alt');
  const picker = find('.story-picker'), viewSwitch = find('.story-view'), reset = find('.exhibit-reset');
  const value = name => find('[data-value="' + name + '"]');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const words = {};
  all('.exhibit-words [data-w]').forEach(el => { words[el.dataset.w] = el.textContent; });
  const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (_, name) => vars[name]);
  const say = word => { note.textContent = word ? words[word] : ''; };
  const count = new Intl.NumberFormat(document.documentElement.lang || 'en');
  const clamp = n => Math.max(0, Math.min(1, n));
  const make = (tag, name) => { const el = document.createElement(tag); el.className = name; return el; };

  const subtle = window.crypto && crypto.subtle;
  if (!subtle || !document.createElement('canvas').getContext) { say('note_unsupported'); return; }

  // The file, as the demo lays it out. A 32-byte header: eight letters, the
  // file's ID, and its measurements. Then each piece: nonce, ciphertext,
  // tag.
  const W = 360, H = 540, PIECES = 12;
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
  async function seal(plain, vaultKey) {
    const began = performance.now();
    const head = header(random(16)), key = await fileKey(vaultKey, head.subarray(8, 24));
    const file = new Uint8Array(TOTAL);
    file.set(head);
    for (let i = 0; i < PIECES; i++) {
      const nonce = random(NONCE), start = HEAD + i * SLOT;
      const sealed = await subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: bound(head, i), tagLength: 128 },
        key, plain.subarray(i * PIECE, (i + 1) * PIECE));
      file.set(nonce, start);
      file.set(new Uint8Array(sealed), start + NONCE);
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
    const plain = new Uint8Array(PIECES * PIECE);
    for (let i = 0; i < PIECES; i++) {
      const start = HEAD + i * SLOT;
      try {
        const opened = await subtle.decrypt({ name: 'AES-GCM', iv: file.subarray(start, start + NONCE),
          additionalData: bound(head, i), tagLength: 128 }, key, file.subarray(start + NONCE, start + SLOT));
        plain.set(new Uint8Array(opened), i * PIECE);
      } catch {
        plain.fill(0);
        return { failed: i + 1 };
      }
    }
    return { plain };
  }
  const sha256 = async bytes => new Uint8Array(await subtle.digest('SHA-256', bytes));

  // The sheet's twelve strips. Each is the photo's rows over that piece's
  // ciphertext, a line of light for the pane's edge, a name for when it
  // fails its check, and at its end the ring that is its seal.
  const slabs = [];
  for (let i = 0; i < PIECES; i++) {
    const slab = slabBox.appendChild(make('div', 'slab')), face = slab.appendChild(make('div', 'slab-face'));
    const cipher = face.appendChild(make('canvas', 'slab-cipher'));
    const plain = face.appendChild(make('div', 'slab-pane')).appendChild(make('canvas', 'slab-plain'));
    cipher.width = plain.width = W;
    cipher.height = plain.height = ROWS;
    face.appendChild(make('span', 'slab-bar'));
    face.appendChild(make('span', 'slab-name')).textContent = fill(words.piece_n, { n: i + 1 });
    slab.appendChild(make('span', 'slab-seal'));
    slab.style.setProperty('--i', i);
    if (i === 0) slab.dataset.edge = 'top';
    if (i === PIECES - 1) slab.dataset.edge = 'bottom';
    slabs.push({ el: slab, plain: plain.getContext('2d'), cipher: cipher.getContext('2d') });
  }
  // Pixels in and out. Bytes are drawn three to a pixel, as red, green and
  // blue, and nothing else is done to them. A photo is first drawn whole on
  // a canvas of its own, off the page, and read from there.
  const source = make('canvas', ''), sourceContext = source.getContext('2d');
  source.width = W;
  source.height = H;
  function paint(context, bytes, from) {
    const image = context.createImageData(W, ROWS), data = image.data;
    for (let i = 0, j = from; i < data.length; i += 4) {
      data[i] = bytes[j++];
      data[i + 1] = bytes[j++];
      data[i + 2] = bytes[j++];
      data[i + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  }
  const paintPhoto = plain => slabs.forEach((slab, i) => paint(slab.plain, plain, i * PIECE));
  const paintPiece = (file, i) => paint(slabs[i].cipher, file, HEAD + i * SLOT + NONCE);
  // A picture onto the sheet, filling it, cut to its middle if it's
  // another shape.
  function draw(image, width, height) {
    const scale = Math.max(W / width, H / height), w = W / scale, h = H / scale;
    sourceContext.imageSmoothingQuality = 'high';
    sourceContext.fillStyle = '#0d1012';
    sourceContext.fillRect(0, 0, W, H);
    sourceContext.drawImage(image, (width - w) / 2, (height - h) / 2, w, h, 0, 0, W, H);
    slabs.forEach((slab, i) => slab.plain.drawImage(source, 0, i * ROWS, W, ROWS, 0, 0, W, ROWS));
  }
  // Some browsers hand a page made-up pixels in place of a canvas's own, so
  // that it can't be used to tell one device from another (Tor Browser, and
  // Firefox with its fingerprinting resistance on). Encrypting those would
  // be encrypting nonsense, so the demo checks first, with four colours it
  // knows, and says so if they come back wrong. Browsers that only nudge
  // each value a little (Safari's private windows, Brave) pass: the photo
  // is then encrypted with that nudge, which nobody can see. Made-up pixels
  // would have to land within 16 of all twelve values to pass: about one
  // chance in fifty billion.
  function readable() {
    try {
      const probe = make('canvas', ''), swatches = [[18, 52, 86], [201, 120, 33], [240, 240, 240], [7, 160, 99]];
      probe.width = probe.height = 8;
      const context = probe.getContext('2d');
      swatches.forEach((rgb, i) => {
        context.fillStyle = 'rgb(' + rgb.join(',') + ')';
        context.fillRect((i % 2) * 4, (i >> 1) * 4, 4, 4);
      });
      const data = context.getImageData(0, 0, 8, 8).data;
      return swatches.every((rgb, i) => {
        const start = (((i >> 1) * 4 + 1) * 8 + (i % 2) * 4 + 1) * 4;
        return data[start + 3] === 255 && rgb.every((channel, k) => Math.abs(data[start + k] - channel) <= 16);
      });
    } catch {
      return false;
    }
  }
  function readPhoto() {
    if (!readable()) return null;
    const data = sourceContext.getImageData(0, 0, W, H).data, plain = new Uint8Array(W * H * 3);
    for (let i = 0, j = 0; i < data.length; i += 4) {
      plain[j++] = data[i];
      plain[j++] = data[i + 1];
      plain[j++] = data[i + 2];
    }
    return plain;
  }

  // The key's 256 dots, the first bit first.
  const dots = [];
  for (let n = 0; n < 256; n++) {
    const dot = keyGrid.appendChild(document.createElement('i'));
    dot.style.setProperty('--n', n);
    dots.push(dot);
  }
  const showBits = key => dots.forEach((dot, n) => dot.classList.toggle('on', Boolean(key && key[n >> 3] & (128 >> (n & 7)))));
  // Bytes, one to a cell.
  const hex = byte => byte.toString(16).padStart(2, '0');
  function writeBytes(el, bytes, more) {
    el.textContent = '';
    bytes.forEach(byte => { el.appendChild(document.createElement('span')).textContent = hex(byte); });
    if (more) el.appendChild(document.createElement('span')).textContent = '…';
  }
  // The technical view's twelve rows: a piece's number, its nonce, and the
  // start of its tag.
  const rows = [];
  for (let i = 0; i < PIECES; i++) {
    const row = find('.pieces tbody').insertRow();
    row.insertCell().textContent = i + 1;
    [12, 5].forEach(cols => row.insertCell().appendChild(make('span', 'hex')).style.setProperty('--cols', cols));
    rows.push(row);
  }
  // Sentences with a figure in them are kept as written and filled in when
  // the figure exists; until then they aren't shown.
  const blanks = new Map(all('[data-fill]').map(el => [el.dataset.fill, { el, text: el.innerHTML }]));
  blanks.forEach(blank => { blank.el.hidden = true; });
  function write(name, vars) {
    const blank = blanks.get(name);
    blank.el.innerHTML = fill(blank.text, vars);
    blank.el.hidden = false;
  }
  // The figure beside a step: a number, and what it counts.
  function figure(id, number, text) {
    const el = find('.chapter[data-chapter="' + id + '"] .chapter-figure');
    if (!el) return;
    el.hidden = !number;
    if (number) {
      el.firstElementChild.textContent = number;
      el.lastElementChild.textContent = text;
    }
  }

  // A beat is a wait for something to be watched: none with Reduce Motion.
  // A pause is a wait for something to be read, and is kept. Leaving the
  // page, or turning Reduce Motion on, ends both at once, so nothing is
  // left half way.
  const waits = new Set();
  const pause = ms => new Promise(done => {
    const end = () => { clearTimeout(timer); waits.delete(end); done(); };
    const timer = setTimeout(end, ms);
    waits.add(end);
  });
  const beat = ms => reduce.matches ? Promise.resolve() : pause(ms);
  const hurry = () => [...waits].forEach(end => end());
  addEventListener('pagehide', hurry);
  reduce.addEventListener('change', () => { if (reduce.matches) hurry(); });

  // The scene: a pose, the door, how the key shows, and what the two lines
  // under it and its description say.
  const pose = name => { scene.dataset.pose = name; };
  const door = state => { scene.dataset.door = state; };
  const showKey = mode => { scene.dataset.key = mode; };
  function label(file, key, alt) {
    fileName.textContent = /vault|cipher|changed/.test(file) ? words.file_name_stored : words.file_name;
    fileState.textContent = words[file];
    keyState.textContent = words[key];
    picture.setAttribute('aria-label', words[alt]);
  }
  // A change that isn't being watched happens at once.
  function instantly(change) {
    scene.classList.add('is-instant');
    change();
    void scene.offsetWidth;
    scene.classList.remove('is-instant');
  }
  const mark = (name, upTo) => slabs.forEach((slab, i) => slab.el.classList.toggle(name, i < upTo));
  const rest = () => slabs.forEach(slab => slab.el.classList.remove('is-up', 'is-working', 'is-bad'));

  // What there is. While the photo is readable: its pixels. While it's
  // encrypted: the stored file, and nothing else of the photo. The vault
  // key outlives both, as the app's does.
  const BLOCKED = {};
  let held = 'plain', own = false, took = 0;
  let pixels = null, stored = null, vault = null, original = null, changed = null;
  function needKey() {
    if (vault) return;
    vault = random(32);
    showBits(vault);
    writeBytes(value('vault'), vault);
  }
  // Encrypt, for real. The strips' ciphertext is drawn and the technical
  // view filled in; turning the strips over is left to whoever asked.
  async function encrypt() {
    if (!pixels) {
      pixels = readPhoto();
      if (!pixels) throw BLOCKED;
      // What's on the sheet from here on is exactly what will be encrypted.
      paintPhoto(pixels);
    }
    needKey();
    original = await sha256(pixels);
    const result = await seal(pixels, vault);
    stored = result.file;
    took = result.took;
    slabs.forEach((slab, i) => paintPiece(stored, i));
    rows.forEach((row, i) => {
      const start = HEAD + i * SLOT, cells = row.querySelectorAll('.hex');
      writeBytes(cells[0], stored.subarray(start, start + NONCE));
      writeBytes(cells[1], stored.subarray(start + SLOT - TAG, start + SLOT - TAG + 4), true);
      row.classList.remove('is-set');
    });
    writeBytes(value('id'), stored.subarray(8, 24));
    writeBytes(value('hash'), original);
    value('check').textContent = words.check_wait;
    write('size', { pixels: count.format(pixels.length) });
    write('stored', { stored: count.format(stored.length) });
  }
  // The demo's own copy of the photo isn't used again: the array is
  // overwritten and the canvases it was drawn on are cleared. (Not secure
  // erasure; see the note at the top.)
  function letGo() {
    pixels.fill(0);
    pixels = null;
    sourceContext.clearRect(0, 0, W, H);
    slabs.forEach(slab => slab.plain.clearRect(0, 0, W, ROWS));
    held = 'cipher';
  }
  // Decrypt, for real, and check what comes back against the fingerprint
  // taken before encrypting. The photo is drawn under the strips' panes.
  // Answers with the piece that failed, or 0 when none did.
  async function decrypt() {
    const result = await unseal(stored, vault);
    if (!result.plain || !(await sha256(result.plain)).every((byte, i) => byte === original[i])) return result.failed || 1;
    pixels = result.plain;
    paintPhoto(pixels);
    value('check').textContent = words.check_ok;
    return 0;
  }
  function restoreBit() {
    if (!changed) return;
    stored[changed.offset] ^= changed.bit;
    paintPiece(stored, changed.piece);
    changed = null;
    delete scene.dataset.ring;
  }
  // To whichever of the two a step begins with, unwatched.
  async function become(state) {
    if (state === held) return;
    if (state === 'cipher') {
      await encrypt();
      instantly(() => {
        mark('is-cipher', PIECES);
        rows.forEach(row => row.classList.add('is-set'));
      });
      letGo();
    } else {
      if (await decrypt()) throw new Error('decrypt');
      instantly(() => mark('is-cipher', 0));
      held = 'plain';
    }
  }

  // The story. Each part: what the photo is when it begins, how the scene
  // stands, and what the lines under the scene say.
  const order = ['intro', 'photo', 'key', 'cut', 'cipher', 'vault', 'wrong', 'bit', 'unlock', 'end'];
  const first = { needs: 'plain', pose: 'photo', door: 'open', key: () => 'none',
    says: () => ['file_readable', 'key_none', own ? 'alt_own' : 'alt_photo'] };
  const kept = { needs: 'cipher', pose: 'vault', door: 'shut', key: () => 'away', says: () => ['file_vault', 'key_away', 'alt_vault'] };
  const story = {
    intro: first,
    photo: first,
    key: { needs: 'plain', pose: 'key', door: 'open', key: () => vault ? 'shown' : 'none', beat: () => vault ? 'b' : 'a',
      says: () => ['file_readable', vault ? 'key_shown' : 'key_none', 'alt_key'] },
    cut: { needs: 'plain', pose: 'cut', door: 'open', before: needKey, key: () => 'shown',
      says: () => ['file_readable', 'key_use', 'alt_cut'] },
    cipher: { needs: 'cipher', pose: 'cipher', door: 'open', key: () => 'shown', says: () => ['file_cipher', 'key_use', 'alt_cipher'] },
    vault: kept,
    wrong: kept,
    bit: { needs: 'cipher', pose: 'inspect', door: 'open', key: () => 'away', says: () => ['file_cipher', 'key_away', 'alt_cipher'] },
    unlock: kept,
    end: { needs: 'plain', pose: 'open', door: 'open', key: () => 'shown', says: () => ['file_back', 'key_shown', 'alt_open'] }
  };
  const chapters = {}, panels = {};
  all('.chapter').forEach(el => { chapters[el.dataset.chapter] = el; });
  all('.tech-panel').forEach(el => { panels[el.dataset.chapter] = el; });
  let at = 'intro', part = 'a', busy = false;
  const buttons = [go, back, reset, ...alts, ...stops];
  function working(on) {
    busy = on;
    buttons.forEach(button => button.setAttribute('aria-disabled', String(on)));
  }
  // One part, and one of its paragraphs, on screen; the button named for
  // what it does next; the line above for where this is.
  function show(id, paragraph) {
    const step = order.indexOf(id) - 1, focused = document.activeElement;
    let current;
    at = id;
    part = paragraph;
    exhibit.dataset.chapter = id;
    order.forEach(name => {
      chapters[name].classList.toggle('is-current', name === id);
      if (panels[name]) panels[name].classList.toggle('is-current', name === id);
    });
    all('.beat').forEach(el => {
      const on = el.parentElement === chapters[id] && el.dataset.beat === paragraph;
      el.classList.toggle('is-current', on);
      if (on) current = el;
    });
    go.textContent = current.dataset.go;
    back.hidden = id === 'intro';
    const offered = current.dataset.alts && typeof createImageBitmap === 'function' ? (own ? 'sample' : 'pick') : '';
    alts.forEach(button => { button.hidden = button.dataset.act !== offered; });
    // The keyboard's place moves with the button it was on: a button that
    // is taken away would otherwise drop it at the top of the page.
    if (focused && focused.hidden && controls.contains(focused)) go.focus();
    stops.forEach((button, i) => {
      button.parentElement.classList.toggle('is-done', i < step);
      if (i === step) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    live.textContent = [...chapters[id].querySelectorAll('.chapter-kicker, h2'), current].map(el => el.textContent.trim())
      .map(text => /[.!?]$/.test(text) ? text : text + '.').join(' ');
  }
  // Go to a part: make the photo what that part begins with, then stand
  // the scene as it has it.
  async function open(id) {
    if (busy) return;
    const chapter = story[id];
    working(true);
    try {
      restoreBit();
      rest();
      if (chapter.before) chapter.before();
      await become(chapter.needs);
    } catch (error) {
      working(false);
      return error === BLOCKED ? say('note_blocked') : recover();
    }
    say();
    order.forEach(name => figure(name));
    pose(chapter.pose);
    door(chapter.door);
    showBits(vault);
    showKey(chapter.key());
    label(...chapter.says());
    if (id === 'key' && vault) figure('key', words.key_fig, words.key_fig_d);
    if (id === 'cipher') figure('cipher', took < 1 ? words.time_fast : fill(words.time_ms, { ms: Math.round(took) }), words.cipher_fig_d);
    [panels.wrong, panels.bit].forEach(panel => panel.classList.remove('is-ready'));
    show(id, chapter.beat ? chapter.beat() : 'a');
    working(false);
  }
  const next = () => open(order[order.indexOf(at) + 1]);

  // Step 2. The key is made when it's asked for, and typed onto its plate
  // a bit at a time.
  async function makeKey() {
    working(true);
    needKey();
    showKey('shown');
    label('file_readable', 'key_shown', 'alt_key');
    await beat(2100);
    figure('key', words.key_fig, words.key_fig_d);
    show('key', 'b');
    working(false);
  }
  // Step 3. The encryption is done first, all of it; then each strip in
  // turn comes up off the sheet and is turned to its ciphertext, and its
  // row in the technical view filled in. The first three go slowly, so
  // what's happening to a piece can be followed; once that's been seen the
  // rest go a little quicker.
  async function encryptWatched() {
    working(true);
    await encrypt();
    label('file_sealing', 'key_use', 'alt_cut');
    figure('cut', fill(words.cut_fig, { n: 0 }), words.cut_fig_d);
    await beat(500);
    for (let i = 0; i < PIECES; i++) {
      const slow = i < 3;
      if (i === 3) scene.style.setProperty('--wipe', '340ms');
      slabs[i].el.classList.add('is-up', 'is-working');
      await beat(slow ? 240 : 170);
      slabs[i].el.classList.add('is-cipher');
      rows[i].classList.add('is-set');
      figure('cut', fill(words.cut_fig, { n: i + 1 }), words.cut_fig_d);
      await beat(slow ? 520 : 360);
      slabs[i].el.classList.remove('is-up', 'is-working');
    }
    await beat(700);
    scene.style.removeProperty('--wipe');
    letGo();
    label('file_cipher', 'key_use', 'alt_cut_done');
    show('cut', 'b');
    working(false);
  }
  // Step 6. Another key, as random as the first. It's really tried: the
  // first piece's tag doesn't verify, and that's the end of it.
  async function tryAnotherKey() {
    working(true);
    const other = random(32), result = await unseal(stored, other);
    if (!result.failed) throw new Error('opened');
    showBits(other);
    showKey('wrong');
    pose('wrong');
    label('file_vault', 'key_wrong', 'alt_vault');
    writeBytes(value('other'), other);
    await beat(1700);
    scene.classList.add('is-refused');
    await pause(900);
    scene.classList.remove('is-refused');
    panels.wrong.classList.add('is-ready');
    figure('wrong', words.wrong_fig, words.wrong_fig_d);
    show('wrong', 'b');
    await beat(1200);
    showKey('away');
    showBits(vault);
    pose('vault');
    label('file_vault', 'key_away', 'alt_vault');
    other.fill(0);
    working(false);
  }
  // Step 7. One bit of one byte of one piece's ciphertext, turned over.
  // The ring shows where; it's kept clear of the sheet's edge so it shows
  // whole.
  function changeBit() {
    const x = 36 + pick(W - 72), y = 36 + pick(H - 72), piece = Math.floor(y / ROWS);
    const offset = HEAD + piece * SLOT + NONCE + ((y - piece * ROWS) * W + x) * 3 + pick(3), before = stored[offset];
    changed = { offset, bit: 1 << pick(8), piece };
    stored[offset] ^= changed.bit;
    paintPiece(stored, piece);
    ring.style.left = (x + .5) / W * 100 + '%';
    ring.style.top = (y + .5) / H * 100 + '%';
    slabs[piece].el.dataset.side = x > W / 2 ? 'start' : 'end';
    scene.dataset.ring = '';
    label('file_changed', 'key_away', 'alt_bit');
    figure('bit', words.bit_fig, fill(words.bit_fig_d, { bits: count.format(TOTAL * 8) }));
    write('change', { at: count.format(offset + 1), from: hex(before), to: hex(stored[offset]) });
    blanks.get('failed').el.hidden = true;
    panels.bit.classList.add('is-ready');
    show('bit', 'b');
  }
  // The right key, on the changed file: the piece with the changed bit
  // fails its check, and nothing is shown.
  async function tryChangedFile() {
    working(true);
    showKey('shown');
    pose('check');
    label('file_changed', 'key_use', 'alt_bit');
    await beat(1700);
    const failed = await decrypt();
    if (!failed) throw new Error('opened');
    slabs[failed - 1].el.classList.add('is-bad');
    write('failed', { n: failed });
    await beat(1100);
    showKey('away');
    pose('inspect');
    label('file_changed', 'key_away', 'alt_bit');
    show('bit', 'c');
    working(false);
  }
  // Step 8. The door opens and the key is brought out; the file is
  // decrypted and checked, all of it; then the strips are turned back one
  // at a time, a little quicker than they were sealed.
  async function unlockWatched() {
    working(true);
    door('open');
    showKey('shown');
    label('file_cipher', 'key_use', 'alt_cipher');
    await beat(1500);
    if (await decrypt()) throw new Error('decrypt');
    pose('cut');
    figure('unlock', fill(words.unlock_fig, { n: 0 }), words.unlock_fig_d);
    await beat(1500);
    scene.style.setProperty('--wipe', '300ms');
    for (let i = 0; i < PIECES; i++) {
      slabs[i].el.classList.add('is-up', 'is-working');
      await beat(140);
      slabs[i].el.classList.remove('is-cipher');
      figure('unlock', fill(words.unlock_fig, { n: i + 1 }), words.unlock_fig_d);
      await beat(300);
      slabs[i].el.classList.remove('is-up', 'is-working');
    }
    await beat(600);
    scene.style.removeProperty('--wipe');
    instantly(() => mark('is-cipher', 0));
    held = 'plain';
    pose('open');
    label('file_back', 'key_shown', 'alt_open');
    await beat(1300);
    figure('unlock', fill(words.unlock_fig, { n: PIECES }), words.unlock_fig_d);
    show('unlock', 'b');
    working(false);
  }
  // From the beginning: the photo readable, and no key yet.
  function forget() {
    if (vault) vault.fill(0);
    vault = stored = original = null;
    showBits(null);
    [value('vault'), value('id'), value('hash'), value('other')].forEach(el => writeBytes(el, []));
    rows.forEach(row => row.classList.remove('is-set'));
  }
  async function startOver(to) {
    working(true);
    restoreBit();
    await become('plain');
    forget();
    working(false);
    await open(to);
  }
  // Another photo to try it on: the visitor's own, or the sample again.
  function load(image, width, height, mine) {
    restoreBit();
    rest();
    if (pixels) pixels.fill(0);
    pixels = stored = original = null;
    held = 'plain';
    own = mine;
    instantly(() => mark('is-cipher', 0));
    draw(image, width, height);
  }
  // Anything that goes wrong in the middle (it shouldn't) ends with the
  // sample photo, readable, at the start, and a line saying so.
  function recover() {
    hurry();
    scene.style.removeProperty('--wipe');
    scene.classList.remove('is-refused');
    changed = null;
    delete scene.dataset.ring;
    load(photo, photo.naturalWidth, photo.naturalHeight, false);
    forget();
    working(false);
    return open('intro').then(() => say('note_error'));
  }
  picker.addEventListener('change', async () => {
    const file = picker.files[0];
    picker.value = '';
    if (!file || busy) return;
    let chosen;
    try { chosen = await createImageBitmap(file); } catch { return say('note_badfile'); }
    load(chosen, chosen.width, chosen.height, true);
    if (chosen.close) chosen.close();
    await open('photo');
    say('note_own');
  });

  // What the button does, in each part and paragraph of it; anywhere else
  // it goes on to the next part.
  const does = {
    'key.a': makeKey, 'cut.a': encryptWatched, 'wrong.a': tryAnotherKey, 'bit.a': changeBit, 'bit.b': tryChangedFile,
    'unlock.a': unlockWatched, 'end.a': () => startOver('photo')
  };
  async function run(act) {
    if (busy) return;
    try {
      await act();
    } catch (error) {
      if (error !== BLOCKED) return recover();
      working(false);
      say('note_blocked');
    }
  }
  // What the button does happens in the scene, so a press brings the scene
  // on screen if it's mostly off it, or if the button itself runs off the
  // bottom: on a phone the scene to the top of the screen, with the step's
  // words and the button under it; on a wider screen the whole exhibit,
  // clear of the header.
  function bringIn() {
    const box = scene.getBoundingClientRect(), seen = Math.min(box.bottom, innerHeight) - Math.max(box.top, 0);
    if (seen >= box.height * .8 && go.getBoundingClientRect().bottom <= innerHeight) return;
    const top = matchMedia('(max-width: 760px)').matches ? box.top - 8 : exhibit.getBoundingClientRect().top - 76;
    scrollBy({ top, behavior: reduce.matches ? 'auto' : 'smooth' });
  }
  go.addEventListener('click', () => {
    if (busy) return;
    bringIn();
    run(does[at + '.' + part] || next);
  });
  back.addEventListener('click', () => run(() => open(order[order.indexOf(at) - 1])));
  reset.addEventListener('click', () => run(() => startOver('intro')));
  stops.forEach(button => button.addEventListener('click', () => run(() => open(button.dataset.goto))));
  alts.forEach(button => button.addEventListener('click', () => {
    if (busy) return;
    if (button.dataset.act === 'pick') return picker.click();
    load(photo, photo.naturalWidth, photo.naturalHeight, false);
    open('photo');
  }));
  // The two ways of telling it.
  const tell = () => { exhibit.dataset.view = viewSwitch.querySelector('input:checked').value; };
  viewSwitch.addEventListener('change', tell);

  // Under a mouse the scene leans a little toward the pointer, as the
  // homepage's phones do, and eases back when it leaves. Not with Reduce
  // Motion, and not under a finger.
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    let x = 0, y = 0, toX = 0, toY = 0, frame = 0;
    const lean = () => {
      x += (toX - x) * .07;
      y += (toY - y) * .07;
      const still = Math.abs(toX - x) + Math.abs(toY - y) < .01;
      rig.style.transform = still && !toX && !toY ? '' : 'rotateX(' + y.toFixed(3) + 'deg) rotateY(' + x.toFixed(3) + 'deg)';
      frame = still ? 0 : requestAnimationFrame(lean);
    };
    const toward = (h, v) => {
      toX = h;
      toY = v;
      if (!frame) frame = requestAnimationFrame(lean);
    };
    picture.addEventListener('pointermove', event => {
      if (reduce.matches) return;
      const box = picture.getBoundingClientRect();
      toward((clamp((event.clientX - box.left) / box.width) - .5) * 5, (.5 - clamp((event.clientY - box.top) / box.height)) * 3.5);
    });
    picture.addEventListener('pointerleave', () => toward(0, 0));
  }

  // Begin once the sample is there to draw; until then, and without this
  // script, the picture file shows in its place and the steps are all
  // there to read.
  function begin() {
    draw(photo, photo.naturalWidth, photo.naturalHeight);
    exhibit.dataset.live = '';
    controls.hidden = rail.hidden = legend.hidden = reset.hidden = false;
    tell();
    open('intro');
  }
  if (photo.complete && photo.naturalWidth) begin();
  else photo.addEventListener('load', begin, { once: true });
})();
