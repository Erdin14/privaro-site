// The on-device encryption illustration: a scan line passes down the phone's
// screen, the photo behind it becomes ciphertext, and a lock closes over it.
// Illustrative, never an authentication simulation. The markup is the
// finished state; no script or Reduce Motion leaves it that way.
(() => {
  const figure = document.querySelector('.privacy-vignette');
  if (!figure) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const replay = figure.querySelector('.vignette-replay');
  const screen = figure.querySelector('.vg-screen');
  const photo = figure.querySelector('.vg-photo');
  const cipher = figure.querySelector('.vg-cipher');
  const scan = figure.querySelector('.vg-scan');
  const lock = figure.querySelector('.vg-lock');
  const ring = figure.querySelector('.vg-ring');
  const shackle = figure.querySelector('.vg-shackle');
  const text = cipher.textContent;
  const glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const supported = typeof figure.animate === 'function';
  let animations = [], observer, run = 0, played = false, scramble = 0;
  const ease = 'cubic-bezier(.22, 1, .36, 1)';
  function settle() {
    run++;
    animations.forEach(animation => animation.cancel());
    animations = [];
    clearTimeout(scramble);
    cipher.textContent = text;
    figure.dataset.state = 'complete';
    replay.disabled = false;
  }
  // Freshly written ciphertext churns for a moment before it settles.
  function churn(token, until) {
    if (token !== run) return;
    if (performance.now() >= until) { cipher.textContent = text; return; }
    let out = '';
    for (let i = 0; i < text.length; i++) out += Math.random() < .18 ? glyphs[Math.random() * 64 | 0] : text[i];
    cipher.textContent = out;
    scramble = setTimeout(() => churn(token, until), 70);
  }
  function play() {
    if (!supported || reduce.matches || document.hidden) return;
    settle();
    played = true;
    const token = run;
    figure.dataset.state = 'playing';
    replay.disabled = true;
    const baseDelay = document.documentElement.classList.contains('page-crossfade') ? 180 : 0;
    function animate(el, frames, duration, delay, easing = ease, fill = 'backwards') {
      const animation = el.animate(frames, { duration, delay: baseDelay + delay, easing, fill });
      animations.push(animation);
      animation.finished.catch(() => {});
      return animation;
    }
    const sweep = 1900, start = 450, curve = 'cubic-bezier(.45, .05, .3, 1)';
    const height = screen.offsetHeight;
    animate(photo, [{ clipPath: 'inset(0 0 0 0)' }, { clipPath: 'inset(100% 0 0 0)' }], sweep, start, curve);
    animate(cipher, [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)' }], sweep, start, curve);
    animate(scan, [
      { opacity: 0, transform: 'translateY(0)' },
      { opacity: 1, transform: `translateY(${height * .06}px)`, offset: .06 },
      { opacity: 1, transform: `translateY(${height * .7}px)`, offset: .7 },
      { opacity: 0, transform: `translateY(${height}px)` }
    ], sweep, start, curve);
    animate(lock, [{ opacity: 0, transform: 'translate(-50%, -50%) scale(.8)' }, { opacity: 1, transform: 'translate(-50%, -50%)' }], 700, start + 1350);
    animate(shackle, [{ transform: 'translateY(-3.5px)' }, { transform: 'none' }], 360, start + 1900, 'cubic-bezier(.3, 1.6, .55, 1)');
    const last = animate(ring, [{ opacity: .55, transform: 'translate(-50%, -50%) scale(1)' }, { opacity: 0, transform: 'translate(-50%, -50%) scale(1.7)' }], 1000, start + 2150, 'ease-out', 'none');
    scramble = setTimeout(() => churn(token, performance.now() + sweep + 300), baseDelay + start);
    last.finished.catch(() => {}).then(() => {
      if (token !== run) return;
      figure.dataset.state = 'complete';
      replay.disabled = false;
      animations = [];
    });
  }
  function sync() {
    replay.hidden = !supported || reduce.matches;
    if (reduce.matches) { settle(); observer?.disconnect(); }
  }
  replay.addEventListener('click', play);
  reduce.addEventListener('change', sync);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && figure.dataset.state === 'playing') settle();
    else if (!document.hidden && !played && figure.dataset.state === 'ready') {
      const rect = figure.getBoundingClientRect();
      const visible = Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0);
      if (visible >= rect.height * .4) { observer?.disconnect(); play(); }
    }
  });
  window.addEventListener('pagehide', settle);
  sync();
  if (!supported || reduce.matches) return;
  if ('IntersectionObserver' in window) {
    figure.dataset.state = 'ready';
    observer = new IntersectionObserver(entries => {
      if (!played && entries.some(entry => entry.isIntersecting) && !document.hidden) {
        observer.disconnect(); play();
      }
    }, { threshold: .4 });
    observer.observe(figure);
  }
})();
