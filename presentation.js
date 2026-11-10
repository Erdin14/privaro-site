// Product motion is progressive enhancement. The page is readable and the
// gallery is visible before this script runs, or if animations are unavailable.
// The homepage's entrances are CSS (.rise in styles.css); this adds what needs
// a script: the header's softened band, the phones leaning toward the
// pointer, and the screenshot viewer. The reading pages have no entrances at
// all: their words are simply there, and nothing on them can be hidden from
// a link or a search.
(() => {
  const script = document.currentScript;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  // The stylesheet's durations and curves, read from it by name, so what
  // moves here keeps the same time as what moves there (styles.css, :root).
  const tokens = getComputedStyle(document.documentElement);
  const token = (name, fallback) => tokens.getPropertyValue(name).trim() || fallback;
  const time = { state: parseFloat(token('--dur-state', '240')), move: parseFloat(token('--dur-move', '460')),
    reveal: parseFloat(token('--dur-reveal', '700')) };
  const ease = token('--ease', 'cubic-bezier(.16, 1, .3, 1)');
  const easeState = token('--ease-state', 'cubic-bezier(.4, 0, .2, 1)');
  const spring = token('--ease-spring', ease);
  const active = new Set();
  function animate(el, frames, options = {}) {
    if (reduce.matches || !el.animate) return null;
    let animation;
    // A curve this browser can't read (the spring, in an old one) falls back to the arrival's.
    try { animation = el.animate(frames, { duration: time.move, easing: ease, ...options }); }
    catch { animation = el.animate(frames, { duration: time.move, ...options, easing: ease }); }
    active.add(animation);
    animation.finished.catch(() => {}).finally(() => active.delete(animation));
    return animation;
  }
  const finish = animation => animation?.finished.catch(() => {});
  // A native page crossfade is already an entrance. Avoid layering another
  // entrance over it; this also covers back/forward cache restoration.
  window.addEventListener('pagereveal', event => {
    if (event.viewTransition) active.forEach(animation => animation.cancel());
  });
  reduce.addEventListener('change', () => {
    if (reduce.matches) active.forEach(animation => animation.cancel());
  });

  // Once anything has scrolled under the header, the top of the page softens
  // away behind it (styles.css). Past halfway down, the canvas beyond the page
  // takes the colour of its foot.
  const head = document.querySelector('.site-head');
  if (head) {
    let queued = false;
    const root = document.documentElement;
    const sync = () => {
      queued = false;
      const end = root.scrollHeight - innerHeight;
      head.classList.toggle('scrolled', scrollY > 4);
      root.classList.toggle('near-end', end > 0 && scrollY > end / 2);
    };
    addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(sync); } }, { passive: true });
    sync();
  }

  // A link to a part of the same page glides there instead of jumping: quick
  // to start, soft to stop, in 0.4s for a short hop and never more than 0.75s
  // however far. It lands where the browser would (the target's
  // scroll-margin, clear of the header), puts the address in the history so
  // Back works, and hands focus to the target for the keyboard and screen
  // readers. Any scroll of the reader's own stops it; with Reduce Motion it's
  // the browser's ordinary jump.
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.('a[href^="#"]');
    if (!link || reduce.matches) return;
    let id;
    try { id = decodeURIComponent(link.getAttribute('href').slice(1)); } catch { return; }
    const target = id && document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
    const end = Math.max(0, Math.min(target.getBoundingClientRect().top + scrollY - margin,
      document.documentElement.scrollHeight - innerHeight));
    const start = scrollY, distance = end - start;
    const duration = Math.min(750, 400 + Math.abs(distance) * .05);
    const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    if (location.hash !== '#' + link.getAttribute('href').slice(1)) history.pushState(null, '', link.getAttribute('href'));
    const land = () => {
      if (!target.matches('a, button, input, select, textarea, [tabindex]')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    };
    if (Math.abs(distance) < 2) return land();
    let begun, frame;
    const stop = () => {
      cancelAnimationFrame(frame);
      ['wheel', 'touchstart', 'keydown'].forEach(name => removeEventListener(name, stop));
    };
    ['wheel', 'touchstart', 'keydown'].forEach(name => addEventListener(name, stop, { passive: true }));
    const step = now => {
      begun ??= now;
      const t = Math.min((now - begun) / duration, 1);
      scrollTo(0, start + distance * ease(t));
      if (t < 1) frame = requestAnimationFrame(step);
      else { stop(); land(); }
    };
    frame = requestAnimationFrame(step);
  });

  // On a long read, the list of sections marks the one being read: the last
  // whose heading has passed the top third of the screen, or the last of all
  // once the page is scrolled to its end.
  const toc = document.querySelector('.long-read .toc');
  if (toc) {
    const links = [...toc.querySelectorAll('a[href^="#"]')]
      .map(link => [link, document.getElementById(link.getAttribute('href').slice(1))]).filter(([, head]) => head);
    let marked, queued = false;
    const mark = () => {
      queued = false;
      const root = document.documentElement;
      let current = links[0];
      if (scrollY + innerHeight >= root.scrollHeight - 2) current = links[links.length - 1];
      else for (const pair of links) if (pair[1].getBoundingClientRect().top < innerHeight / 3) current = pair;
      if (!current || current[0] === marked) return;
      marked?.removeAttribute('aria-current');
      marked = current[0];
      marked.setAttribute('aria-current', 'location');
    };
    addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(mark); } }, { passive: true });
    addEventListener('resize', mark);
    mark();
  }

  const figures = [...document.querySelectorAll('.shots figure')];
  if (!figures.length || typeof HTMLDialogElement === 'undefined') return;

  const icons = {
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    previous: '<path d="m14 5-7 7 7 7"/>',
    next: '<path d="m10 5 7 7-7 7"/>'
  };
  const svg = paths => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  const dialog = document.createElement('dialog');
  dialog.className = 'shot-viewer';
  dialog.setAttribute('aria-labelledby', 'viewer-title');
  dialog.innerHTML = '<div class="viewer-surface" aria-hidden="true"></div>' +
    '<div class="viewer-toolbar viewer-chrome"><h2 id="viewer-title"></h2><button class="viewer-close" type="button">' + svg(icons.close) + '</button></div>' +
    '<div class="viewer-stage"><img class="viewer-image" alt="" draggable="false"></div>' +
    '<div class="viewer-navigation viewer-chrome"><button class="viewer-previous" type="button">' + svg(icons.previous) + '</button><p class="viewer-count" role="status" aria-live="polite" aria-atomic="true"></p><button class="viewer-next" type="button">' + svg(icons.next) + '</button></div>';
  // Focusable itself, for opening by touch or mouse (see open()).
  dialog.tabIndex = -1;
  const image = dialog.querySelector('.viewer-image');
  const surface = dialog.querySelector('.viewer-surface');
  const title = dialog.querySelector('#viewer-title');
  const chrome = [...dialog.querySelectorAll('.viewer-chrome')];
  const closeButton = dialog.querySelector('.viewer-close');
  const previousButton = dialog.querySelector('.viewer-previous');
  const nextButton = dialog.querySelector('.viewer-next');
  closeButton.setAttribute('aria-label', script.dataset.close);
  previousButton.setAttribute('aria-label', script.dataset.previous);
  nextButton.setAttribute('aria-label', script.dataset.next);
  document.body.append(dialog);
  const sources = figures.map(figure => {
    const original = figure.querySelector('img');
    const caption = figure.querySelector('figcaption strong').textContent;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'shot-open';
    button.setAttribute('aria-label', script.dataset.enlarge.replace('{name}', caption));
    button.setAttribute('aria-haspopup', 'dialog');
    // The image moves with its <picture>, so it keeps the WebP the browser chose.
    const shot = original.closest('picture') || original;
    shot.replaceWith(button);
    // The light on the glass (styles.css): one soft glow, moved, never redrawn.
    const light = document.createElement('span');
    light.className = 'shot-light';
    light.setAttribute('aria-hidden', 'true');
    const glow = light.appendChild(document.createElement('i'));
    button.append(shot, light);
    return { original, caption, button, figure, glow };
  });
  document.querySelector('.shots').classList.add('viewer-ready');

  // A phone leans a few degrees toward a mouse or trackpad pointer, and the
  // light on its glass goes where the pointer does. It has weight: the lean
  // is a spring that follows the pointer and comes to rest without
  // overshooting, so it neither snaps to each new position nor lags a fixed
  // time behind, and when the pointer leaves it swings back the same way.
  // (It used to chase the pointer with a fresh 200ms transition on every
  // move.) Only transforms are written, a frame at a time, and only while
  // something is still moving. Touch and Reduce Motion get no lean.
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  // Where the light rests: high and to the left, like the page's.
  const rest = [0, 0, .2, -.1];
  const stiffness = 210, damping = 29;
  sources.forEach(source => {
    const { button, figure, glow } = source;
    // The lean, across and down, from -.5 to .5; then the light's place on the glass.
    const at = [...rest], speed = [0, 0, 0, 0];
    let goal = rest, frame = 0, last = 0, width = 0, height = 0;
    const draw = () => {
      button.style.transform = `rotateY(${(at[0] * 8).toFixed(3)}deg) rotateX(${(at[1] * -6).toFixed(3)}deg)`;
      glow.style.transform = `translate(${(at[2] * width).toFixed(1)}px, ${(at[3] * height).toFixed(1)}px)`;
    };
    const still = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      rest.forEach((value, i) => { at[i] = value; speed[i] = 0; });
      goal = rest;
      button.style.transform = glow.style.transform = '';
    };
    const tick = now => {
      const dt = Math.min((now - last) / 1000, .032);
      last = now;
      let moving = false;
      for (let i = 0; i < 4; i++) {
        speed[i] += ((goal[i] - at[i]) * stiffness - speed[i] * damping) * dt;
        at[i] += speed[i] * dt;
        if (Math.abs(goal[i] - at[i]) > .0004 || Math.abs(speed[i]) > .004) moving = true;
      }
      if (!moving && goal === rest) return still();
      draw();
      frame = moving ? requestAnimationFrame(tick) : 0;
    };
    const wake = () => { if (!frame) { last = performance.now(); frame = requestAnimationFrame(tick); } };
    button.addEventListener('pointermove', event => {
      if (event.pointerType !== 'mouse' || !fine.matches || reduce.matches || dialog.open) return;
      // Measured on the figure, which never leans, so the lean can't feed back into itself.
      const box = figure.getBoundingClientRect();
      width = button.offsetWidth;
      height = button.offsetHeight;
      const x = Math.min(Math.max((event.clientX - box.left) / width, 0), 1);
      const y = Math.min(Math.max((event.clientY - box.top) / height, 0), 1);
      goal = [x - .5, y - .5, x, y];
      wake();
    });
    button.addEventListener('pointerleave', () => { if (goal !== rest) { goal = rest; wake(); } });
    source.untilt = still;
  });
  reduce.addEventListener('change', () => { if (reduce.matches) sources.forEach(source => source.untilt()); });

  let current = 0, closing = false, byKeyboard = false, flight, surfaceMotion;
  let chromeMotion = [];
  let overflow, padding;
  const rtl = document.documentElement.dir === 'rtl';
  const numbers = new Intl.NumberFormat(document.documentElement.lang);
  const stage = dialog.querySelector('.viewer-stage');
  const clamp = value => Math.max(0, Math.min(1, value));
  function fit() {
    const height = Math.max(100, Math.min(innerHeight - 168, (innerWidth - 48) * 1573 / 760, 1000));
    image.style.height = height + 'px';
    image.style.width = (height * 760 / 1573) + 'px';
  }
  function setCurrent(index) {
    sources[current].original.style.visibility = '';
    current = (index + sources.length) % sources.length;
    const source = sources[current];
    image.src = source.original.currentSrc || source.original.src;
    image.alt = source.original.alt;
    title.textContent = source.caption;
    dialog.querySelector('.viewer-count').textContent = numbers.format(current + 1) + ' / ' + numbers.format(sources.length);
    sources[current].original.style.visibility = 'hidden';
  }
  function transform(rect, base) {
    return `translate(${rect.left - base.left}px, ${rect.top - base.top}px) scale(${rect.width / base.width}, ${rect.height / base.height})`;
  }
  function fly(from, to, duration) {
    flight?.cancel();
    const base = image.getBoundingClientRect();
    flight = animate(image, [{ transform: transform(from, base) }, { transform: transform(to, base) }], { duration });
    return flight;
  }
  // Whatever a finger left on the image, the surface and the controls
  // (see the drag below) is handed to the animation that follows it.
  function release() {
    const held = { dim: parseFloat(getComputedStyle(surface).opacity), chrome: parseFloat(getComputedStyle(chrome[0]).opacity) };
    image.style.transform = image.style.transformOrigin = surface.style.opacity = '';
    chrome.forEach(el => { el.style.opacity = ''; });
    return held;
  }
  // A phone mid-entrance, or leaning toward the pointer, is measured squared
  // up, as the viewer will show it: its entrance is finished, its tilt let go.
  function settle(source) {
    source.figure.getAnimations({ subtree: true }).forEach(animation => animation.finish());
    source.untilt();
  }
  function open(index, keyboard) {
    if (dialog.open) return;
    settle(sources[index]);
    const from = sources[index].original.getBoundingClientRect();
    overflow = document.documentElement.style.overflow;
    padding = document.body.style.paddingRight;
    const gap = innerWidth - document.documentElement.clientWidth;
    document.documentElement.style.overflow = 'hidden';
    if (gap > 0) document.body.style.paddingRight = gap + 'px';
    setCurrent(index);
    fit();
    dialog.showModal();
    // Past the page's ends, behind the status bar and the address bar, the
    // canvas darkens with the surface (styles.css).
    document.documentElement.classList.add('viewing');
    closing = false;
    fly(from, image.getBoundingClientRect(), time.reveal);
    surfaceMotion = animate(surface, [{ opacity: 0 }, { opacity: 1 }], { easing: easeState });
    chromeMotion = chrome.map((el, i) => animate(el, [{ opacity: 0, transform: `translateY(${i ? 8 : -8}px)` }, { opacity: 1, transform: 'none' }],
      { delay: 160, fill: 'backwards' }));
    // Opened from the keyboard, focus goes to Close, ring and all. Opened by
    // a tap or click it goes to the viewer itself: Safari rings a button
    // focused from a script even after a tap, and Tab still reaches Close.
    byKeyboard = keyboard;
    (keyboard ? closeButton : dialog).focus({ preventScroll: true });
  }
  async function close() {
    if (!dialog.open || closing) return;
    closing = true;
    // From wherever it is: mid-flight, or pulled halfway down by a finger.
    const from = image.getBoundingClientRect();
    const held = release();
    flight?.cancel();
    surfaceMotion?.cancel();
    chromeMotion.forEach(animation => animation?.cancel());
    const source = sources[current];
    settle(source);
    // On phones, the last viewed image may be outside the horizontal strip.
    // Only the strip moves for it: the page stays where it was left.
    const top = scrollY;
    source.button.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    scrollTo({ top, behavior: 'instant' });
    const to = source.original.getBoundingClientRect();
    const returning = fly(from, to, time.move);
    // The fades hold their end until the dialog is gone: a fade that ended
    // first would snap the dark surface and controls back for a frame or two.
    const fades = [
      animate(surface, [{ opacity: held.dim }, { opacity: 0 }], { easing: easeState, fill: 'forwards' }),
      ...chrome.map(el => animate(el, [{ opacity: held.chrome }, { opacity: 0 }], { duration: time.state / 1.5, fill: 'forwards' }))
    ];
    document.documentElement.classList.remove('viewing');
    await finish(returning);
    source.original.style.visibility = '';
    dialog.close();
    fades.forEach(animation => animation?.cancel());
    document.documentElement.style.overflow = overflow;
    document.body.style.paddingRight = padding;
    closing = false;
    // From the keyboard, back to the screenshot last shown. After a tap or
    // click the dialog puts focus back where it was, so Safari doesn't ring
    // the screenshot.
    if (byKeyboard) source.button.focus({ preventScroll: true });
  }
  // To the next screen. The one on show leaves the way it was going, as a
  // copy that fades as it goes, while the next comes in from the side it
  // comes from; the name above follows. (The one on show used to vanish.)
  // `dragged` is how far a finger had already taken it.
  function step(delta, dragged = 0) {
    if (!dialog.open || closing) return;
    flight?.cancel();
    release();
    const way = delta * (rtl ? -1 : 1);
    const ghost = image.cloneNode();
    ghost.classList.add('viewer-ghost');
    ghost.alt = '';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.left = image.offsetLeft + 'px';
    ghost.style.top = image.offsetTop + 'px';
    image.after(ghost);
    const leaving = animate(ghost, [{ opacity: 1, transform: `translateX(${dragged}px)` },
      { opacity: 0, transform: `translateX(${dragged - way * 64}px) scale(.96)` }], { duration: time.state, easing: easeState, fill: 'forwards' });
    (leaving ? finish(leaving) : Promise.resolve()).then(() => ghost.remove());
    setCurrent(current + delta);
    flight = animate(image, [{ opacity: 0, transform: `translateX(${way * 64}px) scale(.96)`, transformOrigin: '50% 50%' },
      { opacity: 1, transform: 'none', transformOrigin: '50% 50%' }]);
    animate(title, [{ opacity: 0 }, { opacity: 1 }], { duration: time.state, easing: easeState });
  }
  // Let go short of anywhere: back to where it was, on the spring.
  function back() {
    const from = image.style.transform || 'none';
    const held = release();
    image.style.transformOrigin = '50% 50%';
    flight = animate(image, [{ transform: from }, { transform: 'none' }], { easing: spring });
    (flight ? finish(flight) : Promise.resolve()).then(() => { if (!drag) image.style.transformOrigin = ''; });
    if (held.dim < 1) animate(surface, [{ opacity: held.dim }, { opacity: 1 }], { duration: time.state, easing: easeState });
    if (held.chrome < 1) chrome.forEach(el => animate(el, [{ opacity: held.chrome }, { opacity: 1 }], { duration: time.state, easing: easeState }));
  }
  // A click from Enter or Space has no click count.
  sources.forEach((source, index) => source.button.addEventListener('click', event => open(index, event.detail === 0)));
  closeButton.addEventListener('click', close);
  previousButton.addEventListener('click', () => step(-1));
  nextButton.addEventListener('click', () => step(1));
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('click', event => {
    if (event.target === dialog || event.target === surface || event.target === stage) close();
  });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Tab') {
      if (event.shiftKey && document.activeElement === closeButton) {
        event.preventDefault(); nextButton.focus();
      } else if (!event.shiftKey && document.activeElement === nextButton) {
        event.preventDefault(); closeButton.focus();
      }
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      step((event.key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1));
    }
  });
  // Safari on iPhone scrolls the page under the viewer whatever the page's
  // overflow and the viewer's touch-action say; only turning down the drag
  // itself stops it.
  dialog.addEventListener('touchmove', event => event.preventDefault(), { passive: false });
  // Under a finger (or a pen) the screen is held, not just swiped at. It
  // goes where the finger goes: sideways, to the next screen or the one
  // before, if it's let go far enough across or moving fast enough; down,
  // it comes away from the page, a little smaller, the page showing through
  // behind it, and let go there it flies back to its place in the row.
  // Let go short of either, it springs back. A mouse has the buttons, the
  // arrow keys and a click beside the screen.
  let drag;
  stage.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' || !event.isPrimary || closing || drag) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, axis: '', dx: 0, dy: 0, vx: 0, vy: 0,
      lastX: event.clientX, lastY: event.clientY, lastT: event.timeStamp };
  });
  stage.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.axis) {
      if (Math.hypot(dx, dy) < 8) return;
      drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      stage.setPointerCapture(drag.id);
      // Whatever was still arriving is where it's going.
      flight?.finish();
      image.style.transformOrigin = '50% 50%';
    }
    // How fast it's moving, in pixels a millisecond, smoothed over the last few moves.
    const dt = Math.max(1, event.timeStamp - drag.lastT);
    drag.vx = .6 * (event.clientX - drag.lastX) / dt + .4 * drag.vx;
    drag.vy = .6 * (event.clientY - drag.lastY) / dt + .4 * drag.vy;
    Object.assign(drag, { dx, dy, lastX: event.clientX, lastY: event.clientY, lastT: event.timeStamp });
    if (drag.axis === 'x') {
      image.style.transform = `translateX(${dx}px)`;
    } else {
      // Upwards there's nowhere to go: it gives a little and no more.
      const pull = dy > 0 ? dy : dy * .2;
      const far = clamp(pull / (innerHeight * .6));
      image.style.transform = `translate(${dx * .35}px, ${pull}px) scale(${1 - far * .18})`;
      surface.style.opacity = 1 - far * .75;
      chrome.forEach(el => { el.style.opacity = clamp(1 - pull / 90); });
    }
  });
  const drop = event => {
    if (!drag || event.pointerId !== drag.id) return;
    const { axis, dx, dy, vx, vy } = drag;
    drag = null;
    if (!axis) return;
    const released = event.type === 'pointerup';
    if (axis === 'x' && released && Math.sign(vx || dx) === Math.sign(dx) && (Math.abs(dx) > Math.min(140, innerWidth * .22) || Math.abs(vx) > .45)) {
      step((dx < 0 ? 1 : -1) * (rtl ? -1 : 1), dx);
    } else if (axis === 'y' && released && dy > 0 && vy > -.1 && (dy > 120 || vy > .5)) {
      close();
    } else {
      back();
    }
  };
  stage.addEventListener('pointerup', drop);
  stage.addEventListener('pointercancel', drop);
  window.addEventListener('resize', () => {
    if (!dialog.open || closing) return;
    flight?.cancel();
    fit();
  });
})();
