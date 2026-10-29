// Illustrative import into a local vault, never an authentication simulation.
// Default SVG is the finished state; no script or Reduce Motion stays static.
(() => {
  const figure = document.querySelector('.privacy-vignette');
  if (!figure) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const replay = figure.querySelector('.vignette-replay');
  const tiles = [...figure.querySelectorAll('.vignette-tile')];
  const lock = figure.querySelector('.vignette-lock');
  const shackle = figure.querySelector('.vignette-shackle');
  const supported = typeof figure.animate === 'function';
  let animations = [], observer, run = 0, played = false;
  const ease = 'cubic-bezier(.22, 1, .36, 1)';
  function settle() {
    run++;
    animations.forEach(animation => animation.cancel());
    animations = [];
    figure.dataset.state = 'complete';
    replay.disabled = false;
  }
  function play() {
    if (!supported || reduce.matches || document.hidden) return;
    settle();
    played = true;
    const token = run;
    figure.dataset.state = 'playing';
    replay.disabled = true;
    const baseDelay = document.documentElement.classList.contains('page-crossfade') ? 180 : 0;
    function animate(el, frames, duration, delay) {
      const animation = el.animate(frames, { duration, delay: baseDelay + delay, easing: ease, fill: 'backwards' });
      animations.push(animation);
      animation.finished.catch(() => {});
      return animation;
    }
    tiles.forEach((tile, i) => {
      const style = getComputedStyle(tile);
      const from = `translate(${style.getPropertyValue('--tile-x')}, ${style.getPropertyValue('--tile-y')}) rotate(${style.getPropertyValue('--tile-angle')}) scale(.94)`;
      animate(tile, [{ transform: from }, { transform: 'none' }], 1000 + i * 50, i * 130);
    });
    animate(lock, [{ opacity: 0 }, { opacity: 1 }], 260, 1320);
    const last = animate(shackle, [{ transform: 'translateY(-5px) rotate(-12deg)' }, { transform: 'none' }], 420, 1430);
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
