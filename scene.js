// The homepage's background: the app's lock screen, in its Indigo theme.
//
// This draws the aurora (Privaro/Design/Components/AuroraBackground.swift):
// three soft lights drifting over the dark base, each to and fro on its own
// clock. The dot lattice and its sweeping light are CSS (see styles.css).
//
// The lights have no edges, so they're drawn at a sixth of the page's size and
// scaled up by the browser: it looks the same, and a frame costs next to
// nothing. With Reduce Motion each light sits at the middle of its path.
(() => {
  const canvas = document.querySelector('.aurora');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // Colour, strength, diameter as a share of the longest side, path, and the
  // seconds one way takes. As in the app: the theme's colours at half
  // strength, and travel times that never line up.
  const lights = [
    { rgb: '158,158,255', alpha: 0.17, size: 1.25, from: [0.12, 0.08], to: [0.48, 0.36], seconds: 11 },
    { rgb: '51,46,133', alpha: 0.15, size: 1.15, from: [0.94, 0.26], to: [0.58, 0.02], seconds: 15 },
    { rgb: '128,184,255', alpha: 0.10, size: 0.95, from: [0.86, 0.82], to: [0.52, 0.96], seconds: 19 },
  ];
  // How a light fades from its centre to its rim: no bright core, no edge.
  const falloff = [[0, 1], [0.15, 0.96], [0.3, 0.85], [0.45, 0.67], [0.6, 0.46], [0.75, 0.25], [0.88, 0.09], [1, 0]];
  const SCALE = 6;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const start = performance.now();
  let width = 0, height = 0, frame = 0, last = 0;

  // SwiftUI's easeInOut, cubic-bezier(0.42, 0, 0.58, 1).
  function ease(x) {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const u = 1 - t;
      const error = 1.26 * t * u * u + 1.74 * t * t * u + t * t * t - x;
      const slope = 1.26 * u * u + 0.96 * t * u + 1.26 * t * t;
      if (Math.abs(error) < 1e-5 || slope === 0) break;
      t -= error / slope;
    }
    return t * t * (3 - 2 * t);
  }

  function resize() {
    width = Math.max(1, Math.ceil(canvas.clientWidth / SCALE));
    height = Math.max(1, Math.ceil(canvas.clientHeight / SCALE));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function draw(now) {
    const elapsed = (now - start) / 1000;
    const longest = Math.max(width, height);
    ctx.clearRect(0, 0, width, height);
    for (const light of lights) {
      // There and back: 0 to 2 is one round trip.
      const phase = (elapsed / light.seconds) % 2;
      const p = reduce.matches ? 0.5 : ease(phase < 1 ? phase : 2 - phase);
      const x = (light.from[0] + (light.to[0] - light.from[0]) * p) * width;
      const y = (light.from[1] + (light.to[1] - light.from[1]) * p) * height;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, (longest * light.size) / 2);
      for (const [at, alpha] of falloff) gradient.addColorStop(at, `rgba(${light.rgb},${light.alpha * alpha})`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    }
  }

  // 30 frames a second is plenty for lights this slow and this soft.
  function tick(now) {
    if (now - last >= 32) {
      last = now;
      draw(now);
    }
    frame = requestAnimationFrame(tick);
  }

  function run() {
    cancelAnimationFrame(frame);
    resize();
    draw(performance.now());
    if (!reduce.matches) frame = requestAnimationFrame(tick);
  }

  addEventListener('resize', () => {
    resize();
    draw(performance.now());
  });
  reduce.addEventListener('change', run);
  run();
})();
