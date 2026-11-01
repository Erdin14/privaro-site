// The homepage film: plays once, muted, when most of it is on screen, and
// stops on its last frame, the end card. It never loops: it's a 26-second
// piece with a beginning and an end, and the page around it is for reading.
// Scrolling away pauses it and coming back resumes it; Pause, Sound and Play
// again are in its caption. With Reduce Motion it waits for Play.
(() => {
  const figure = document.querySelector('.film-card');
  if (!figure) return;
  const video = figure.querySelector('video');
  const play = figure.querySelector('.film-play');
  const label = play.querySelector('.film-play-label');
  const sound = figure.querySelector('.film-sound');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  // Paused by the person, not by scrolling: scrolling back never overrides it.
  let held = reduce.matches;
  let inView = false;

  video.removeAttribute('controls');
  play.hidden = false;
  sound.hidden = false;
  figure.dataset.ready = '';

  function sync() {
    const state = video.ended ? 'again' : video.paused ? 'play' : 'pause';
    figure.dataset.state = state;
    label.textContent = { again: 'Play again', play: 'Play', pause: 'Pause' }[state];
    sound.setAttribute('aria-pressed', String(!video.muted));
  }
  function start() {
    // A browser may still refuse (Low Power Mode, say); Play is there for that.
    video.play().catch(() => { held = true; sync(); });
  }
  function toggle() {
    if (video.paused) {
      held = false;
      if (video.ended) video.currentTime = 0;
      start();
    } else {
      held = true;
      video.pause();
    }
  }

  play.addEventListener('click', toggle);
  video.addEventListener('click', toggle);
  sound.addEventListener('click', () => { video.muted = !video.muted; sync(); });
  ['play', 'pause', 'ended', 'volumechange'].forEach(type => video.addEventListener(type, sync));
  reduce.addEventListener('change', () => { if (reduce.matches) { held = true; video.pause(); } });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) video.pause();
    else if (inView && !held && !video.ended) start();
  });
  sync();

  if (!('IntersectionObserver' in window)) return;
  // Start fetching a screen or so before it arrives, so it's ready to play.
  const near = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    near.disconnect();
    video.preload = 'auto';
  }, { rootMargin: '100% 0px' });
  near.observe(figure);
  const watch = new IntersectionObserver(entries => entries.forEach(entry => {
    inView = entry.intersectionRatio >= .6;
    if (inView && !held && !video.ended && !document.hidden) start();
    else if (entry.intersectionRatio < .25 && !video.paused) video.pause();
  }), { threshold: [0, .25, .6] });
  watch.observe(figure);
})();
