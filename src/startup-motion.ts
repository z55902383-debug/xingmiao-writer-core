// SVG and particle timing from the approved two-second startup preview.
export function startStartupMotion(root: HTMLElement) {
  const $ = (id: string) => root.querySelector<SVGElement>(`#boot-${id}`)!;
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  const smooth = (x: number) => {
    x = clamp(x);
    return x * x * (3 - 2 * x);
  };
  const out = (x: number) => 1 - Math.pow(1 - clamp(x), 3);
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  let disposed = false,
    iconFrame = 0;
  // Seeded stars keep seeking and replay deterministic, with no external textures.
  const starCanvas = root.querySelector<HTMLCanvasElement>("canvas")!;
  const context = starCanvas.getContext("2d");
  const pointer = { x: -1000, y: -1000, active: false };
  let hoverFrame = 0,
    lastHover = 0,
    backgroundTime = 0;
  const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
  let seed = 19271;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const stars = Array.from({ length: 1750 }, () => {
    const band = random() < 0.74,
      x = random(),
      y = band
        ? 0.77 - x * 0.55 + (random() + random() + random() - 1.5) * 0.15
        : random();
    return {
      x,
      y,
      size: 0.17 + Math.pow(random(), 4) * 1.25,
      alpha: 0.13 + random() * 0.5,
      phase: random() * Math.PI * 2,
      warm: random() < 0.075,
      ox: 0,
      oy: 0,
      vx: 0,
      vy: 0,
    };
  });
  function drawStars(time: number, delta = 0) {
    if (!context) return;
    const starCtx = context;
    const bounds = starCanvas.getBoundingClientRect(),
      dpr = Math.min(devicePixelRatio || 1, 2),
      w = Math.round(bounds.width * dpr),
      h = Math.round(bounds.height * dpr);
    if (starCanvas.width !== w || starCanvas.height !== h) {
      starCanvas.width = w;
      starCanvas.height = h;
    }
    starCtx.setTransform(w / 1000, 0, 0, h / 600, 0, 0);
    starCtx.clearRect(0, 0, 1000, 600);
    const light = document.documentElement.dataset.theme === "light",
      reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const star of stars) {
      const depth = 0.35 + star.size * 0.8,
        drift = reduce ? 0 : time * 0.006;
      const bx =
        ((((star.x * 1000 +
          drift * depth +
          12 * Math.sin(time * 0.00012 + star.phase)) %
          1040) +
          1040) %
          1040) -
        20;
      const by =
        star.y * 600 +
        (reduce
          ? 0
          : 5 * Math.sin(time * 0.00018 + star.phase) - drift * 0.18 * depth);
      const dx = bx - pointer.x,
        dy = by - pointer.y,
        distance = Math.hypot(dx, dy),
        radius = 100;
      const influence =
        !reduce && pointer.active && distance < radius
          ? Math.pow(1 - distance / radius, 2)
          : 0;
      const desiredX = distance > 0.001 ? (dx / distance) * influence * 48 : 0,
        desiredY = distance > 0.001 ? (dy / distance) * influence * 48 : 0;
      if (reduce) {
        star.ox = star.oy = star.vx = star.vy = 0;
      } else if (delta) {
        const step = Math.min(delta, 32) / 16.667;
        star.vx += (desiredX - star.ox) * 0.055 * step;
        star.vy += (desiredY - star.oy) * 0.055 * step;
        const friction = Math.pow(0.79, step);
        star.vx *= friction;
        star.vy *= friction;
        star.ox += star.vx * step;
        star.oy += star.vy * step;
      }
      const x = bx + star.ox,
        y = by + star.oy;
      if (y < 0 || y > 600) continue;
      const dist = Math.hypot((x - 500) / 1.25, y - 300),
        space = 0.24 + 0.76 * smooth((dist - 50) / 130),
        pulse = reduce ? 1 : 0.86 + 0.14 * Math.sin(star.phase + time * 0.0009),
        alpha =
          Math.min(0.95, star.alpha * space * pulse * (1 + influence * 0.9)) *
          (light ? 0.42 : 1);
      const rgb = light
        ? "65,94,130"
        : star.warm
          ? "214,182,129"
          : "163,198,225";
      if (star.size > 0.95) {
        const glow = starCtx.createRadialGradient(
          x,
          y,
          0,
          x,
          y,
          star.size * 3.6,
        );
        glow.addColorStop(0, `rgba(${rgb},${alpha * 0.52})`);
        glow.addColorStop(1, `rgba(${rgb},0)`);
        starCtx.fillStyle = glow;
        starCtx.fillRect(
          x - star.size * 3.6,
          y - star.size * 3.6,
          star.size * 7.2,
          star.size * 7.2,
        );
      }
      starCtx.fillStyle = `rgba(${rgb},${alpha})`;
      starCtx.beginPath();
      starCtx.arc(x, y, star.size, 0, Math.PI * 2);
      starCtx.fill();
    }
  }
  function hoverTick(now: number) {
    hoverFrame = 0;
    if (document.hidden || disposed || motionPreference.matches) {
      lastHover = 0;
      return;
    }
    const delta = lastHover ? Math.min(32, now - lastHover) : 16;
    lastHover = now;
    backgroundTime += delta;
    drawStars(backgroundTime, delta);
    hoverFrame = requestAnimationFrame(hoverTick);
  }
  function wakeHover() {
    if (!hoverFrame && !motionPreference.matches && !disposed)
      hoverFrame = requestAnimationFrame(hoverTick);
  }
  const move = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    const rect = root.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 1000;
    pointer.y = ((event.clientY - rect.top) / rect.height) * 600;
    pointer.active = true;
    wakeHover();
  };
  const leave = () => {
    pointer.active = false;
  };
  const visibility = () => {
    if (!document.hidden) wakeHover();
  };
  const preference = () => {
    pointer.active = false;
    drawStars(backgroundTime);
    wakeHover();
  };

  const began = performance.now();
  function iconTick(now: number) {
    if (disposed) return;
    const time = Math.min(1700, now - began);
    drawIcon(time);
    if (time < 1700) iconFrame = requestAnimationFrame(iconTick);
  }
  root.addEventListener("pointermove", move);
  root.addEventListener("pointerleave", leave);
  document.addEventListener("visibilitychange", visibility);
  motionPreference.addEventListener("change", preference);
  const resize = new ResizeObserver(() => drawStars(backgroundTime));
  resize.observe(root);
  const theme = new MutationObserver(() => drawStars(backgroundTime));
  theme.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  const drawIcon = (time: number) => {
    const motionTime = motionPreference.matches ? 3100 : time * 1.875;
    const cat = clamp((motionTime - 100) / 680),
      book = clamp((motionTime - 920) / 520),
      spine = clamp((motionTime - 1510) / 140),
      color = smooth((motionTime - 1350) / 500),
      settle = smooth((motionTime - 3050) / 600);
    $("catLine").style.strokeDashoffset = String(1 - cat);
    $("bookLine").style.strokeDashoffset = String(1 - book);
    $("spineLine").style.strokeDashoffset = String(1 - spine);
    root
      .querySelectorAll<SVGElement>(".sketch")
      .forEach((el) => (el.style.opacity = String(1 - color * 0.92)));
    root
      .querySelectorAll<SVGElement>(".color-fill")
      .forEach((el) => (el.style.opacity = String(color)));
    $("plate").setAttribute(
      "opacity",
      String(smooth((motionTime - 1450) / 500)),
    );
    $("eyes").setAttribute("opacity", String(out((motionTime - 1450) / 300)));
    $("pageDetail").setAttribute("opacity", String(color * 0.65));
    // The nib follows each actual SVG stroke; lifted travel connects separate strokes.
    const point = (id: string, p: number) => {
      const path = $(id) as SVGPathElement;
      return path.getPointAtLength(path.getTotalLength() * clamp(p));
    };
    let tip;
    if (motionTime <= 780) tip = point("catLine", cat);
    else if (motionTime < 920) {
      const t = smooth((motionTime - 780) / 140),
        a = point("catLine", 1),
        b = point("bookLine", 0);
      tip = {
        x: mix(a.x, b.x, t),
        y: mix(a.y, b.y, t) - Math.sin(Math.PI * t) * 27,
      };
    } else if (motionTime <= 1440) tip = point("bookLine", book);
    else if (motionTime < 1510) {
      const t = smooth((motionTime - 1440) / 70),
        a = point("bookLine", 1),
        b = point("spineLine", 0);
      tip = {
        x: mix(a.x, b.x, t),
        y: mix(a.y, b.y, t) - Math.sin(Math.PI * t) * 14,
      };
    } else tip = point("spineLine", spine);
    const lift = out((motionTime - 1650) / 250);
    $("pen").setAttribute(
      "transform",
      `translate(${tip.x + lift * 32} ${tip.y - lift * 35}) rotate(${-lift * 9})`,
    );
    $("pen").setAttribute(
      "opacity",
      String(
        smooth(motionTime / 100) * (1 - smooth((motionTime - 1680) / 260)),
      ),
    );
    const dip =
      smooth((motionTime - 1700) / 430) *
      (1 - smooth((motionTime - 2940) / 450));
    const breath = Math.sin(clamp((motionTime - 1700) / 1700) * Math.PI) * 0.8;
    $("head").setAttribute(
      "transform",
      `translate(0 ${dip * 4 + breath}) rotate(${-dip * 1.1} 0 15)`,
    );
    const blink = 1 - 0.93 * Math.exp(-Math.pow((motionTime - 2040) / 68, 2));
    for (const [id, x, y] of [
      ["eyeL", -44, -11],
      ["eyeR", 42, -5],
    ] as const) {
      $(id).setAttribute("cx", String(x + dip * 2));
      $(id).setAttribute("cy", String(y + dip * 3));
      $(id).setAttribute("ry", String(8.5 * blink));
    }
    const page = smooth((motionTime - 2220) / 990),
      angle = Math.PI * page,
      x = 104 * Math.cos(angle),
      liftPage = Math.sin(angle) * 23,
      bulge = Math.sin(angle) * 9;
    $("turningPage").setAttribute(
      "d",
      `M0 42 C${x * 0.25 + bulge} ${25 - liftPage * 0.4} ${x * 0.7 + bulge} ${1 - liftPage} ${x} ${14 - liftPage * 0.3} L${x * 0.94} ${27 - liftPage * 0.15} C${x * 0.58 - bulge} ${15 - liftPage * 0.4} ${x * 0.2} 34 0 49 Z`,
    );
    $("turningPage").setAttribute(
      "opacity",
      String(out((motionTime - 2190) / 180)),
    );
    $("icon").setAttribute("transform", `translate(500 300) scale(.56)`);
  };
  drawIcon(0);
  drawStars(0);
  if (!motionPreference.matches) iconFrame = requestAnimationFrame(iconTick);
  wakeHover();
  return () => {
    disposed = true;
    cancelAnimationFrame(iconFrame);
    cancelAnimationFrame(hoverFrame);
    resize.disconnect();
    theme.disconnect();
    root.removeEventListener("pointermove", move);
    root.removeEventListener("pointerleave", leave);
    document.removeEventListener("visibilitychange", visibility);
    motionPreference.removeEventListener("change", preference);
  };
}
