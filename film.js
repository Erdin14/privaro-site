// The homepage film: plays once, muted, when most of it is on screen, and
// stops on its last frame, the end card. It never loops: it's a minute-long
// piece with a beginning and an end, and the page around it is for reading.
// Scrolling away pauses it and coming back resumes it; Pause, Sound and Play
// again sit under it, and the line along its bottom edge shows where it is
// and moves it. With Reduce Motion it waits for Play; so it does for anyone
// who has asked their browser to save data, and then nothing of the film is
// fetched until they press it: it's some tens of megabytes.
(() => {
  const figure = document.querySelector('.film-card');
  if (!figure) return;
  const video = figure.querySelector('video');
  const play = figure.querySelector('.film-play');
  const label = play.querySelector('.film-play-label');
  const sound = figure.querySelector('.film-sound');
  const progress = figure.querySelector('.film-progress');
  const fill = progress.querySelector('.film-progress-fill');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const frugal = navigator.connection?.saveData === true;
  // Paused by the person, not by scrolling: scrolling back never overrides it.
  let held = reduce.matches || frugal;
  let inView = false;

  video.removeAttribute('controls');
  play.hidden = false;
  sound.hidden = false;
  progress.hidden = false;
  figure.dataset.ready = '';

  function sync() {
    const state = video.ended ? 'again' : video.paused ? 'play' : 'pause';
    figure.dataset.state = state;
    label.textContent = { again: 'Play again', play: 'Play', pause: 'Pause' }[state];
    sound.setAttribute('aria-pressed', String(!video.muted));
  }
  // The line is redrawn every frame while the film plays, so it glides rather
  // than stepping with timeupdate; the slider's numbers follow timeupdate.
  const clock = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  let frame = 0;
  function draw() {
    fill.style.transform = 'scaleX(' + (video.duration ? video.currentTime / video.duration : 0) + ')';
  }
  function tick() {
    draw();
    frame = video.paused ? 0 : requestAnimationFrame(tick);
  }
  function describe() {
    const length = video.duration || 0;
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', String(Math.round(length)));
    progress.setAttribute('aria-valuenow', String(Math.round(video.currentTime)));
    progress.setAttribute('aria-valuetext', clock(video.currentTime) + ' of ' + clock(length));
    draw();
  }
  function seek(seconds) {
    if (!video.duration) return;
    video.currentTime = Math.min(video.duration, Math.max(0, seconds));
    describe();
  }
  function seekToPointer(event) {
    const box = progress.getBoundingClientRect();
    seek((event.clientX - box.left) / box.width * video.duration);
  }

  function start() {
    // A browser may still refuse (an iPhone in Low Power Mode does); Play is
    // there for that. The film opens on black, so its first frame as a
    // poster then looks like a film that failed to load, a tall empty box:
    // it gets the end card instead, as with Reduce Motion. Only a refusal
    // counts: being scrolled away mid-start also ends the attempt, and
    // that used to be taken for one, so coming back never played it.
    video.play().catch(error => {
      if (error.name !== 'NotAllowedError') return;
      held = true;
      if (!video.played.length) video.poster = video.poster.replace('-start.', '-end.');
      sync();
    });
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
  ['play', 'pause', 'ended', 'volumechange', 'seeking', 'seeked'].forEach(type => video.addEventListener(type, sync));
  ['loadedmetadata', 'durationchange', 'timeupdate', 'seeked', 'ended'].forEach(type => video.addEventListener(type, describe));
  video.addEventListener('play', () => { if (!frame) frame = requestAnimationFrame(tick); });

  // Drag along the line to move through the film; it keeps playing or stays
  // paused, as it was.
  progress.addEventListener('pointerdown', event => {
    if (!video.duration || event.button > 0) return;
    progress.setPointerCapture(event.pointerId);
    figure.dataset.seeking = '';
    seekToPointer(event);
  });
  progress.addEventListener('pointermove', event => {
    if (progress.hasPointerCapture(event.pointerId)) seekToPointer(event);
  });
  ['pointerup', 'pointercancel'].forEach(type => progress.addEventListener(type, () => delete figure.dataset.seeking));
  progress.addEventListener('keydown', event => {
    const by = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -10, PageUp: 10 }[event.key];
    if (by !== undefined) seek(video.currentTime + by);
    else if (event.key === 'Home') seek(0);
    else if (event.key === 'End') seek(video.duration);
    else return;
    event.preventDefault();
  });
  reduce.addEventListener('change', () => { if (reduce.matches) { held = true; video.pause(); } });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) video.pause();
    else if (inView && !held && !video.ended) start();
  });
  sync();
  describe();

  if (!('IntersectionObserver' in window)) return;
  // A screen or so before it arrives, fetch what describes it (its length,
  // for the line along its edge), not the film: asked for all of it this
  // early, a browser may download tens of megabytes for someone who scrolls
  // straight past. The picture itself starts arriving when it starts to
  // play; until then the poster is its first frame, so nothing is seen to
  // wait.
  const near = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    near.disconnect();
    if (!frugal) video.preload = 'metadata';
  }, { rootMargin: '100% 0px' });
  near.observe(figure);
  const watch = new IntersectionObserver(entries => entries.forEach(entry => {
    inView = entry.intersectionRatio >= .6;
    if (inView && !held && !video.ended && !document.hidden) start();
    else if (entry.intersectionRatio < .25 && !video.paused) video.pause();
  }), { threshold: [0, .25, .6] });
  watch.observe(figure);
})();
