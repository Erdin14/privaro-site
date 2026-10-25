// The homepage's title arrives the way a vault item opens: as ciphertext that
// resolves, one letter after another, into "Privaro". It runs once, in under a
// second, while the title rises into place (see .home-text in styles.css). With
// Reduce Motion the title is simply there.
//
// Screen readers get the real name throughout, from aria-label.
(() => {
  const title = document.querySelector('.home h1');
  if (!title || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const text = title.textContent;
  // Base64's alphabet: what encrypted bytes look like written down.
  const glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  // Each letter settles 85 ms after the one before; until then it keeps changing.
  const first = 350, step = 85, flicker = 45;
  const start = performance.now();
  title.setAttribute('aria-label', text);

  function frame() {
    const elapsed = performance.now() - start;
    let shown = '';
    for (let i = 0; i < text.length; i++) {
      shown += elapsed >= first + i * step || text[i] === ' '
        ? text[i]
        : glyphs[Math.floor(Math.random() * glyphs.length)];
    }
    title.textContent = shown;
    if (shown === text) {
      title.removeAttribute('aria-label');
    } else {
      setTimeout(frame, flicker);
    }
  }
  frame();
})();
