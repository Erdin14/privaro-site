// Optional ambient motion. CSS owns the animation; JS only handles user
// preferences and visibility. No animation frame loop or pointer tracking.
(() => {
  const script = document.currentScript;
  const links = document.querySelector('.foot-links');
  if (!script || !links || !window.matchMedia) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const storageKey = 'privaro-background-paused';
  let paused = false;
  try { paused = localStorage.getItem(storageKey) === 'true'; } catch (_) {}

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'motion-toggle';
  button.hidden = true;
  // A stable label with aria-pressed expresses whether background motion is on.
  button.setAttribute('aria-pressed', String(!paused));
  button.innerHTML = '<svg class="motion-pause" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M3 2h2v8H3zm4 0h2v8H7z"/></svg>' +
    '<svg class="motion-play" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="m3 1 8 5-8 5z"/></svg>';
  // Just the icon to see; the name for screen readers and the tooltip.
  button.setAttribute('aria-label', script.dataset.label);
  button.title = script.dataset.label;
  links.insertBefore(button, links.querySelector('.lang'));

  function sync() {
    document.body.classList.toggle('motion-paused', paused || reduce.matches || document.hidden || !!document.querySelector('.shot-viewer[open]'));
    button.setAttribute('aria-pressed', String(!paused));
    button.hidden = reduce.matches;
  }
  button.addEventListener('click', () => {
    paused = !paused;
    try { localStorage.setItem(storageKey, String(paused)); } catch (_) {}
    sync();
  });
  reduce.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  document.addEventListener('privaro:viewerchange', sync);
  sync();
  document.body.classList.add('motion-ready');
})();
