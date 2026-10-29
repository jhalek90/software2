// The living background: a few soft colour blobs drifting on a canvas behind the glass
// cards. Calm when idle, livelier while estimating and building (following the build's
// progress), a green bloom on success and a muted red after a failure or Stop. It
// leans a little towards the mouse.
// Cheap on purpose: a handful of gradient fills on a GPU canvas, at most 30 frames a
// second (15 when calm), paused while the page is hidden or the window minimised. (A
// smaller canvas scaled up costs no less, and shows the gradients' dithering as a grid.) With prefers-reduced-motion it is a still
// gradient that only changes colour with the state.
// A plain script like renderer.ts; its one global is `backdrop`.

type Scene = 'idle' | 'estimating' | 'confirm' | 'building' | 'done' | 'failed' | 'stopped';

const backdrop = (() => {
  const canvas = document.getElementById('backdrop') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  // 30 frames a second while something happens, 15 when calm: the idle drift is slow
  // enough that nobody sees the difference, and it halves the cost.
  const BUSY_FRAME_MS = 1000 / 30;
  const CALM_FRAME_MS = 1000 / 15;

  type Rgb = [number, number, number];
  const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
  const PALETTES = {
    light: {
      base: hex('#eef1f6'),
      blobs: ['#a9c8ff', '#c4b5ff', '#9fe0e4', '#bcd6ff', '#e4c8f5'].map(hex),
      alpha: 0.75,
      work: hex('#6ea8ff'),
      ok: hex('#86dc96'),
      bad: hex('#eba3a6'),
      fade: 0.92,
    },
    dark: {
      base: hex('#12151b'),
      blobs: ['#1f4a9e', '#45309a', '#0f5f6c', '#24408a', '#55286f'].map(hex),
      alpha: 0.6,
      work: hex('#2a6fd6'),
      ok: hex('#1e8a4c'),
      bad: hex('#8a3040'),
      fade: 0.8,
    },
  };

  // Each blob drifts around its home on two slow sine waves; `depth` is how much it
  // shifts with the mouse.
  const BLOBS = [
    { x: 0.2, y: 0.25, r: 0.62, ax: 0.1, ay: 0.08, fx: 0.031, fy: 0.023, p: 0.0, depth: 0.05 },
    { x: 0.82, y: 0.2, r: 0.55, ax: 0.08, ay: 0.1, fx: 0.022, fy: 0.034, p: 1.7, depth: -0.04 },
    { x: 0.7, y: 0.75, r: 0.6, ax: 0.12, ay: 0.07, fx: 0.027, fy: 0.019, p: 3.1, depth: 0.03 },
    { x: 0.15, y: 0.8, r: 0.5, ax: 0.09, ay: 0.09, fx: 0.018, fy: 0.029, p: 4.4, depth: -0.05 },
    { x: 0.5, y: 0.45, r: 0.45, ax: 0.14, ay: 0.1, fx: 0.025, fy: 0.021, p: 5.6, depth: 0.06 },
  ];

  // How each scene looks: speed of the drift, energy (brightness of the blobs and the
  // working glow), and a tint colour with its strength.
  type Look = { speed: number; energy: number; tint: 'work' | 'ok' | 'bad' | null; tintAlpha: number };
  const LOOKS: Record<Scene, Look> = {
    idle: { speed: 1, energy: 0, tint: null, tintAlpha: 0 },
    confirm: { speed: 1.4, energy: 0.25, tint: 'work', tintAlpha: 0.15 },
    estimating: { speed: 2.6, energy: 0.45, tint: 'work', tintAlpha: 0.3 },
    building: { speed: 2.2, energy: 0.5, tint: 'work', tintAlpha: 0.3 },
    done: { speed: 1.2, energy: 0.2, tint: 'ok', tintAlpha: 0.35 },
    failed: { speed: 0.8, energy: 0, tint: 'bad', tintAlpha: 0.5 },
    stopped: { speed: 0.8, energy: 0, tint: 'bad', tintAlpha: 0.4 },
  };

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const dark = matchMedia('(prefers-color-scheme: dark)');

  let scene: Scene = 'idle';
  let progress = 0;
  let minimized = false;
  // Smoothed values, eased towards the scene's look every frame.
  const now = { speed: 1, energy: 0, tintAlpha: 0, progress: 0, glowY: 0.6, mx: 0, my: 0, bloom: 0 };
  let tintColor: Rgb = PALETTES.light.work;
  let mouse = { x: 0, y: 0 };
  let t = 40; // the drift's clock, in seconds of idle speed
  let bloomStart = -1;
  let frame = 0;
  let last = 0;
  let drawn = 0; // frames drawn, for the demo's CPU check

  function resize(): void {
    canvas.width = Math.max(1, innerWidth);
    canvas.height = Math.max(1, innerHeight);
  }

  const rgba = (c: Rgb, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a))})`;
  const mix = (a: Rgb, b: Rgb, k: number): Rgb => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

  function blob(x: number, y: number, r: number, c: Rgb, a: number): void {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(c, a));
    g.addColorStop(0.55, rgba(c, a * 0.45));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function draw(): void {
    const pal = dark.matches ? PALETTES.dark : PALETTES.light;
    const w = canvas.width;
    const h = canvas.height;
    const size = Math.max(w, h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = rgba(pal.base, 1);
    ctx.fillRect(0, 0, w, h);

    BLOBS.forEach((b, i) => {
      const x = (b.x + b.ax * Math.sin(t * b.fx * 6.283 + b.p) + now.mx * b.depth) * w;
      const y = (b.y + b.ay * Math.cos(t * b.fy * 6.283 + b.p) + now.my * b.depth) * h;
      const color = mix(pal.blobs[i], tintColor, now.tintAlpha * 0.5);
      blob(x, y, b.r * size, color, pal.alpha * (0.85 + 0.25 * now.energy));
    });

    // The tint's glow; while building it rises from the bottom as the build goes on.
    if (now.tintAlpha > 0.01) {
      const x = (0.5 + 0.18 * Math.sin(t * 0.05)) * w;
      blob(x, now.glowY * h, (0.55 + 0.2 * now.progress) * size, tintColor, now.tintAlpha * (0.8 + 0.4 * now.energy));
    }
    // The success bloom: a green swell from the centre that settles into the tint.
    if (now.bloom > 0.01) blob(w / 2, h * 0.5, (0.35 + 0.45 * (1 - now.bloom)) * size, pal.ok, 0.8 * now.bloom);
    // A faint light where the mouse is.
    blob((0.5 + now.mx * 0.9) * w, (0.5 + now.my * 0.9) * h, 0.35 * size, dark.matches ? [90, 120, 200] : [255, 255, 255], dark.matches ? 0.12 : 0.25);

    // The bottom fades back to the plain background, so the disclaimer keeps its contrast.
    const fade = ctx.createLinearGradient(0, h * 0.78, 0, h);
    fade.addColorStop(0, rgba(pal.base, 0));
    fade.addColorStop(1, rgba(pal.base, pal.fade));
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, w, h);
  }

  /** Eases the smoothed values towards the scene's look; `dt` in seconds. */
  function step(dt: number): void {
    const look = LOOKS[scene];
    const k = 1 - Math.exp(-dt * 2.2);
    const pal = dark.matches ? PALETTES.dark : PALETTES.light;
    const busy = scene === 'building' ? 0.6 * progress : 0;
    now.speed += (look.speed + busy * 2 - now.speed) * k;
    now.energy += (look.energy + busy - now.energy) * k;
    now.tintAlpha += (look.tintAlpha + busy * 0.25 - now.tintAlpha) * k;
    now.progress += ((scene === 'building' ? progress : 0) - now.progress) * k;
    now.glowY += ((scene === 'building' || scene === 'estimating' ? 0.95 - 0.4 * progress : 0.55) - now.glowY) * k;
    if (look.tint) tintColor = mix(tintColor, pal[look.tint], k);
    now.mx += (mouse.x - now.mx) * (1 - Math.exp(-dt * 1.2));
    now.my += (mouse.y - now.my) * (1 - Math.exp(-dt * 1.2));
    if (bloomStart >= 0) {
      const s = (performance.now() - bloomStart) / 1000;
      now.bloom = s < 0.5 ? s / 0.5 : Math.max(0, 1 - (s - 0.5) / 2.5);
      if (s > 3) bloomStart = -1;
    }
    t += dt * now.speed;
  }

  /** Jumps straight to the scene's look, for the still (reduced-motion) background. */
  function settle(): void {
    const look = LOOKS[scene];
    const pal = dark.matches ? PALETTES.dark : PALETTES.light;
    Object.assign(now, { speed: look.speed, energy: look.energy, tintAlpha: look.tintAlpha, progress: 0, glowY: 0.55, mx: 0, my: 0, bloom: 0 });
    tintColor = look.tint ? pal[look.tint] : pal.work;
    bloomStart = -1;
  }

  function loop(time: number): void {
    frame = 0;
    const busy = scene === 'estimating' || scene === 'building' || bloomStart >= 0 || Math.abs(now.speed - LOOKS[scene].speed) > 0.05;
    if (time - last >= (busy ? BUSY_FRAME_MS : CALM_FRAME_MS) - 1) {
      step(Math.min(0.1, (time - last) / 1000));
      last = time;
      draw();
      drawn++;
    }
    schedule();
  }

  function running(): boolean {
    return !reduced.matches && !document.hidden && !minimized;
  }

  function schedule(): void {
    if (!frame && running()) frame = requestAnimationFrame(loop);
  }

  function restart(): void {
    cancelAnimationFrame(frame);
    frame = 0;
    last = performance.now();
    if (reduced.matches) {
      settle();
      draw();
    } else schedule();
  }

  resize();
  settle();
  draw();
  restart();
  addEventListener('resize', () => {
    resize();
    draw();
  });
  document.addEventListener('visibilitychange', restart);
  reduced.addEventListener('change', restart);
  dark.addEventListener('change', () => {
    settle();
    draw();
  });
  addEventListener('pointermove', (e) => {
    mouse = { x: e.clientX / innerWidth - 0.5, y: e.clientY / innerHeight - 0.5 };
  });

  return {
    /** What the app is doing now; the background eases into its look. */
    setScene(next: Scene): void {
      if (next === scene) return;
      if (next === 'done' && !reduced.matches) bloomStart = performance.now();
      scene = next;
      if (next !== 'building') progress = 0;
      if (reduced.matches) {
        settle();
        draw();
      }
    },
    /** The build's progress against its estimate, 0 to 1. */
    setProgress(p: number): void {
      progress = Math.max(0, Math.min(1, p));
    },
    setMinimized(on: boolean): void {
      minimized = on;
      restart();
    },
    get framesDrawn(): number {
      return drawn;
    },
  };
})();
