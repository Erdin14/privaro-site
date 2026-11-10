// The on-device encryption illustration: a line passes down the phone's
// screen, and the photo behind it becomes ciphertext.
// Illustrative, never an authentication simulation. The markup is the
// finished state; no script or Reduce Motion leaves it that way.
// On the Security page, where it's on screen from the start, it plays once.
// On the homepage the reader's own scrolling writes it: the photo is whole
// as the phone comes up the screen and ciphertext by the time it reaches
// the top. One way only: scrolling back doesn't bring the photo back,
// because that is the one thing the illustration is there to say. Once it's
// written, nothing here listens to the page any more.
//
// How it's drawn. The ciphertext lies still under the photo and is never
// touched. The photo is seen through a pane that slides down the screen
// while the photo inside it slides up by as much, so the photo stays where
// it is and only its top edge moves. The rows just written are a second,
// bright copy of the ciphertext, seen the same way through a band that
// follows the line and fades upward: written hot, they cool to the resting
// grey as the line moves on. So every frame is five transforms and two
// opacities and nothing is laid out or painted again. (It used to move the
// line by its "top" and cut the photo and the text with clip-path, which is
// a layout and two repaints of fourteen hundred characters per frame.)
(() => {
  const figure = document.querySelector('.privacy-vignette');
  if (!figure) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const screen = figure.querySelector('.vg-screen');
  const pane = figure.querySelector('.vg-pane');
  const photo = figure.querySelector('.vg-photo');
  const cipher = figure.querySelector('.vg-cipher');
  const scan = figure.querySelector('.vg-scan');
  if (!pane || typeof requestAnimationFrame !== 'function') return;
  if (reduce.matches) { figure.dataset.state = 'complete'; return; }
  const hot = document.createElement('div');
  hot.className = 'vg-hot';
  const hotText = hot.appendChild(cipher.cloneNode(true));
  pane.before(hot);
  const moved = [pane, photo, hot, hotText, scan];

  let height = 0, drawn = -1, frame = 0, played = false, observer;
  const clamp = value => Math.max(0, Math.min(1, value));
  // p is how much is written, 0 to 1; reach is how far down the screen that
  // takes the line. Whole device pixels, so nothing is drawn between two.
  function render(p, reach) {
    if (p === drawn) return;
    drawn = p;
    const ratio = devicePixelRatio || 1;
    const cut = Math.round(p * reach * height * ratio) / ratio;
    pane.style.transform = `translateY(${cut}px)`;
    photo.style.transform = `translateY(${-cut}px)`;
    hot.style.transform = `translateY(${cut - height}px)`;
    hotText.style.transform = `translateY(${height - cut}px)`;
    scan.style.transform = `translateY(${cut}px)`;
    // The line fades in as it starts and out as it finishes; the rows above
    // it cool with it.
    scan.style.opacity = clamp(Math.min(p / .05, (1 - p) / .08)).toFixed(3);
    hot.style.opacity = clamp((1 - p) / .14).toFixed(3);
  }
  function settle() {
    cancelAnimationFrame(frame);
    frame = 0;
    drawn = -1;
    moved.forEach(el => { el.style.transform = el.style.opacity = ''; });
    figure.dataset.state = 'complete';
  }
  reduce.addEventListener('change', () => { if (reduce.matches) { settle(); observer?.disconnect(); } });
  window.addEventListener('pagehide', settle);

  if (figure.closest('.safety')) {
    // The phone's foot is below the edge of its column, so the line only
    // has to cross the part of the screen that shows.
    const reach = .74;
    // How far the reader has scrolled it, and how far the line has got. The
    // line follows a moment behind and eases up to where it should be, so
    // a wheel's steps, a flick or a jump down the page all draw as one
    // steady pass rather than as the steps they arrive in.
    let goal = 0, at = 0, last = 0, listening = false;
    const wake = () => { if (!frame && figure.dataset.state === 'scrub') { last = performance.now(); frame = requestAnimationFrame(tick); } };
    const listen = on => {
      if (on === listening) return;
      listening = on;
      (on ? addEventListener : removeEventListener)('scroll', wake, { passive: true });
      (on ? addEventListener : removeEventListener)('resize', resize);
    };
    function resize() { height = screen.offsetHeight; drawn = -1; wake(); }
    function tick(now) {
      frame = 0;
      if (reduce.matches || figure.dataset.state !== 'scrub') return listen(false);
      // Whole until its top is just past halfway up the screen, so the photo
      // has been seen; written by the time the top nears the header. Only
      // ever further: the line never goes back up.
      const top = figure.getBoundingClientRect().top;
      goal = Math.max(goal, clamp((innerHeight * .56 - top) / (innerHeight * .44)));
      at += (goal - at) * (1 - Math.exp(-Math.min(now - last, 64) / 90));
      last = now;
      if (goal - at < .002) at = goal;
      render(at, reach);
      if (at >= 1) { listen(false); return settle(); }
      if (at < goal) frame = requestAnimationFrame(tick);
    }
    const begin = () => {
      if (reduce.matches || at >= 1) return;
      figure.dataset.state = 'scrub';
      listen(true);
      resize();
    };
    // Back from the page cache, where leaving had settled it: as far as it
    // had got, and on from there.
    addEventListener('pageshow', event => { if (event.persisted) begin(); });
    begin();
    return;
  }

  // The Security page: once, by itself, when it's on screen.
  function play() {
    if (reduce.matches || document.hidden) return;
    played = true;
    height = screen.offsetHeight;
    figure.dataset.state = 'playing';
    const sweep = 1900;
    const start = performance.now() + 450 + (document.documentElement.classList.contains('page-crossfade') ? 180 : 0);
    const step = now => {
      if (figure.dataset.state !== 'playing') return;
      const t = clamp((now - start) / sweep);
      // Slow to leave, slow to arrive.
      render(t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2, 1);
      if (t < 1) frame = requestAnimationFrame(step);
      else settle();
    };
    frame = requestAnimationFrame(step);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && figure.dataset.state === 'playing') settle();
    else if (!document.hidden && !played && figure.dataset.state === 'ready') {
      const rect = figure.getBoundingClientRect();
      const visible = Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0);
      if (visible >= rect.height * .4) { observer?.disconnect(); play(); }
    }
  });
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
