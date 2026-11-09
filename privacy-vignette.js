// The on-device encryption illustration: a scan line passes down the phone's
// screen, and the photo behind it becomes ciphertext.
// Illustrative, never an authentication simulation. The markup is the
// finished state; no script or Reduce Motion leaves it that way.
// On the Security page, where it's on screen from the start, it plays once.
// On the homepage the reader's own scrolling writes it: the photo is whole
// as the phone comes up the screen and ciphertext by the time it reaches
// the top. One way only: scrolling back doesn't bring the photo back,
// because that is the one thing the illustration is there to say. Once it's
// written, nothing here listens to the page any more. Played once on its
// own it was two seconds that were easy to miss, and then a dim phone.
(() => {
  const figure = document.querySelector('.privacy-vignette');
  if (!figure) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const screen = figure.querySelector('.vg-screen');
  const photo = figure.querySelector('.vg-photo');
  const cipher = figure.querySelector('.vg-cipher');
  const scan = figure.querySelector('.vg-scan');
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
  }
  // Freshly written ciphertext churns for a moment before it settles.
  function churned() {
    let out = '';
    for (let i = 0; i < text.length; i++) out += Math.random() < .18 ? glyphs[Math.random() * 64 | 0] : text[i];
    return out;
  }
  function churn(token, until) {
    if (token !== run) return;
    if (performance.now() >= until) { cipher.textContent = text; return; }
    cipher.textContent = churned();
    scramble = setTimeout(() => churn(token, until), 70);
  }
  function play() {
    if (!supported || reduce.matches || document.hidden) return;
    settle();
    played = true;
    const token = run;
    figure.dataset.state = 'playing';
    const baseDelay = document.documentElement.classList.contains('page-crossfade') ? 180 : 0;
    function animate(el, frames, duration, delay, easing = ease) {
      const animation = el.animate(frames, { duration, delay: baseDelay + delay, easing, fill: 'backwards' });
      animations.push(animation);
      animation.finished.catch(() => {});
      return animation;
    }
    const sweep = 1900, start = 450, curve = 'cubic-bezier(.45, .05, .3, 1)';
    const height = screen.offsetHeight;
    animate(photo, [{ clipPath: 'inset(0 0 0 0)' }, { clipPath: 'inset(100% 0 0 0)' }], sweep, start, curve);
    animate(cipher, [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)' }], sweep, start, curve);
    const last = animate(scan, [
      { opacity: 0, transform: 'translateY(0)' },
      { opacity: 1, transform: `translateY(${height * .06}px)`, offset: .06 },
      { opacity: 1, transform: `translateY(${height * .7}px)`, offset: .7 },
      { opacity: 0, transform: `translateY(${height}px)` }
    ], sweep, start, curve);
    scramble = setTimeout(() => churn(token, performance.now() + sweep + 300), baseDelay + start);
    last.finished.catch(() => {}).then(() => {
      if (token !== run) return;
      figure.dataset.state = 'complete';
      animations = [];
    });
  }
  function sync() {
    if (reduce.matches) { settle(); observer?.disconnect(); }
  }
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
  if (figure.closest('.safety')) {
    // The phone's foot is below the edge of its column, so the line only
    // has to cross the part of the screen that shows.
    const reach = .74;
    let queued = false, furthest = 0, listening = false;
    const queue = () => { if (!queued) { queued = true; requestAnimationFrame(draw); } };
    const listen = on => {
      if (on === listening) return;
      listening = on;
      (on ? addEventListener : removeEventListener)('scroll', queue, { passive: true });
      (on ? addEventListener : removeEventListener)('resize', queue);
    };
    function draw() {
      queued = false;
      if (reduce.matches || figure.dataset.state !== 'scrub') return listen(false);
      const top = figure.getBoundingClientRect().top;
      // Whole until its top is just past halfway up the screen, so the photo
      // has been seen; written by the time the top nears the header. Only
      // ever further: the line never goes back up.
      const p = Math.max(furthest, Math.min(1, (innerHeight * .56 - top) / (innerHeight * .44)));
      if (p === furthest && p > 0) return;
      furthest = p;
      // The ciphertext itself holds still: only the line moves. (It churned
      // as it was written, which under a finger read as the whole screen
      // flickering.)
      figure.style.setProperty('--cut', (p * reach * 100).toFixed(2) + '%');
      figure.style.setProperty('--scan', Math.max(0, Math.min(1, p / .05, (1 - p) / .08)).toFixed(2));
      if (p >= 1) { listen(false); figure.dataset.state = 'complete'; }
    }
    const begin = () => {
      if (reduce.matches || furthest >= 1) return;
      figure.dataset.state = 'scrub';
      listen(true);
      draw();
    };
    // Back from the page cache, where leaving had settled it: as far as it
    // had got, and on from there.
    addEventListener('pageshow', event => { if (event.persisted) begin(); });
    begin();
    return;
  }
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
