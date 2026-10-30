// Product motion is progressive enhancement. The page is readable and the
// gallery is visible before this script runs, or if animations are unavailable.
// The homepage's entrances are CSS (.rise in styles.css); this adds what needs
// a script: the header's solid state, the phones leaning toward the pointer,
// the screenshot viewer, and the reveals on the longer pages.
(() => {
  const script = document.currentScript;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const ease = 'cubic-bezier(.16, 1, .3, 1)';
  const active = new Set();
  function animate(el, frames, options = {}) {
    if (reduce.matches || !el.animate) return null;
    const animation = el.animate(frames, { duration: 550, easing: ease, ...options });
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
  let observer;
  reduce.addEventListener('change', () => {
    if (!reduce.matches) return;
    active.forEach(animation => animation.cancel());
    document.querySelectorAll('.reveal-pending').forEach(el => el.classList.remove('reveal-pending'));
    observer?.disconnect();
  });

  // The header turns solid once anything has scrolled under it.
  const head = document.querySelector('.site-head');
  if (head) {
    let queued = false;
    const sync = () => { queued = false; head.classList.toggle('scrolled', scrollY > 4); };
    addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(sync); } }, { passive: true });
    sync();
  }

  // Only a few section headings and feature blocks; never animate every paragraph.
  if (!reduce.matches && 'IntersectionObserver' in window) {
    const candidates = [
      ...document.querySelectorAll('.features > li'),
      ...[...document.querySelectorAll('.doc > h2')].filter((_, i) => i % 3 === 0),
      ...[...document.querySelectorAll('.faq > h2')].filter((_, i) => i % 3 === 0)
    ];
    observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      entry.target.classList.remove('reveal-pending');
      animate(entry.target, [{ opacity: .65, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }]);
    }), { threshold: .15, rootMargin: '0px 0px -24px 0px' });
    candidates.forEach(el => {
      if (el.getBoundingClientRect().top < innerHeight + 24 || el.matches(':target')) return;
      el.classList.add('reveal-pending');
      observer.observe(el);
    });
    // Anchor jumps and keyboard focus must expose their destination immediately.
    const expose = el => {
      const target = el?.closest('.reveal-pending');
      if (target) { target.classList.remove('reveal-pending'); observer.unobserve(target); }
    };
    document.addEventListener('focusin', event => expose(event.target));
    window.addEventListener('hashchange', () => expose(document.getElementById(decodeURIComponent(location.hash.slice(1)))));
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
    '<div class="viewer-toolbar viewer-chrome"><h2 id="viewer-title"></h2><button class="viewer-close" type="button" autofocus>' + svg(icons.close) + '</button></div>' +
    '<div class="viewer-stage"><img class="viewer-image" alt="" draggable="false"></div>' +
    '<div class="viewer-navigation viewer-chrome"><button class="viewer-previous" type="button">' + svg(icons.previous) + '</button><p class="viewer-count" role="status" aria-live="polite" aria-atomic="true"></p><button class="viewer-next" type="button">' + svg(icons.next) + '</button></div>';
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
    const caption = figure.querySelector('figcaption').textContent;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'shot-open';
    button.setAttribute('aria-label', script.dataset.enlarge.replace('{name}', caption));
    button.setAttribute('aria-haspopup', 'dialog');
    original.replaceWith(button);
    button.append(original);
    const cue = document.createElement('span');
    cue.className = 'shot-cue';
    cue.setAttribute('aria-hidden', 'true');
    cue.textContent = '↗';
    figure.querySelector('figcaption').append(cue);
    return { original, caption, button, figure };
  });
  document.querySelector('.shots').classList.add('viewer-ready');

  // A phone leans a few degrees toward a mouse or trackpad pointer, and the
  // light on its glass follows. Touch and Reduce Motion get no tilt. CSS
  // reads --rx/--ry/--mx/--my; one frame at most per pointer move.
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  function untilt(button) {
    button.classList.remove('tilting');
    ['--rx', '--ry', '--mx', '--my'].forEach(name => button.style.removeProperty(name));
  }
  sources.forEach(({ button }) => {
    let frame = 0, point;
    button.addEventListener('pointermove', event => {
      if (event.pointerType !== 'mouse' || !fine.matches || reduce.matches || dialog.open) return;
      point = event;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const rect = button.getBoundingClientRect();
        const x = Math.min(Math.max((point.clientX - rect.left) / rect.width, 0), 1);
        const y = Math.min(Math.max((point.clientY - rect.top) / rect.height, 0), 1);
        button.classList.add('tilting');
        button.style.setProperty('--ry', ((x - .5) * 12).toFixed(2) + 'deg');
        button.style.setProperty('--rx', ((.5 - y) * 9).toFixed(2) + 'deg');
        button.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
        button.style.setProperty('--my', (y * 100).toFixed(1) + '%');
      });
    });
    button.addEventListener('pointerleave', () => { cancelAnimationFrame(frame); frame = 0; untilt(button); });
  });

  let current = 0, closing = false, flight, surfaceMotion;
  let chromeMotion = [];
  let overflow, padding;
  const rtl = document.documentElement.dir === 'rtl';
  const numbers = new Intl.NumberFormat(document.documentElement.lang);
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
  // A phone mid-entrance, or turned in the arc, is measured squared up, as
  // the viewer will show it: its entrance is finished and its tilt let go.
  function settle(source) {
    source.figure.getAnimations().forEach(animation => animation.finish());
    untilt(source.button);
    source.button.classList.add('squared');
  }
  function open(index) {
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
    document.dispatchEvent(new Event('privaro:viewerchange'));
    closing = false;
    fly(from, image.getBoundingClientRect(), 620);
    surfaceMotion = animate(surface, [{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: 'ease-out' });
    chromeMotion = chrome.map((el, i) => animate(el, [{ opacity: 0, transform: `translateY(${i ? 8 : -8}px)` }, { opacity: 1, transform: 'none' }],
      { duration: 420, delay: 160, fill: 'backwards' }));
    closeButton.focus({ preventScroll: true });
  }
  async function close() {
    if (!dialog.open || closing) return;
    closing = true;
    const from = image.getBoundingClientRect();
    flight?.cancel();
    surfaceMotion?.cancel();
    chromeMotion.forEach(animation => animation?.cancel());
    const source = sources[current];
    settle(source);
    // On phones, the last viewed image may be outside the horizontal strip.
    source.button.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    const to = source.original.getBoundingClientRect();
    const returning = fly(from, to, 480);
    animate(surface, [{ opacity: 1 }, { opacity: 0 }], { duration: 420, easing: 'ease-in-out' });
    chrome.forEach(el => animate(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 160 }));
    await finish(returning);
    source.original.style.visibility = '';
    dialog.close();
    // Back into the arc, slowly, now that it's in its place again.
    requestAnimationFrame(() => sources.forEach(({ button }) => button.classList.remove('squared')));
    document.dispatchEvent(new Event('privaro:viewerchange'));
    document.documentElement.style.overflow = overflow;
    document.body.style.paddingRight = padding;
    closing = false;
    source.button.focus({ preventScroll: true });
  }
  // The next screen slides in from the side it comes from, out of a little
  // depth; the name above it follows.
  function step(delta) {
    if (!dialog.open || closing) return;
    flight?.cancel();
    setCurrent(current + delta);
    const shift = delta * (rtl ? -1 : 1) * 56;
    flight = animate(image, [{ opacity: 0, transform: `translateX(${shift}px) scale(.94)` }, { opacity: 1, transform: 'none' }], { duration: 520 });
    animate(title, [{ opacity: 0 }, { opacity: 1 }], { duration: 360 });
  }
  sources.forEach((source, index) => source.button.addEventListener('click', () => open(index)));
  closeButton.addEventListener('click', close);
  previousButton.addEventListener('click', () => step(-1));
  nextButton.addEventListener('click', () => step(1));
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('click', event => {
    if (event.target === dialog || event.target === surface || event.target.classList.contains('viewer-stage')) close();
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
  let touch;
  image.addEventListener('touchstart', event => { touch = event.touches[0]; }, { passive: true });
  image.addEventListener('touchend', event => {
    if (!touch) return;
    const dx = event.changedTouches[0].clientX - touch.clientX;
    const dy = event.changedTouches[0].clientY - touch.clientY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) step((dx < 0 ? 1 : -1) * (rtl ? -1 : 1));
    touch = null;
  }, { passive: true });
  window.addEventListener('resize', () => {
    if (!dialog.open || closing) return;
    flight?.cancel();
    fit();
  });
})();
