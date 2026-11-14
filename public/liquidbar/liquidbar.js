/*!
 * LiquidBar web v1.2.0 — port 1:1 de la barra de cristal líquido de github.com/mkandreum/liquidbar
 * (Jetpack Compose) a JavaScript sin dependencias.
 *
 * Mismos valores que la versión nativa (LiquidBar.kt, glass/Touch.kt, LiquidMotion.kt, GlassSurface.kt):
 *  - cristal: desenfoque 3 dp, saturación ×1,5, canto de 24 dp que refracta 24 dp hacia dentro con
 *    perfil circular, tinte, filo de luz a 45° y contorno oscuro;
 *  - lupa: el indicador crece ×78/56, refracta con aberración cromática (dispersion 0,5, depthEffect) y
 *    deja ver una copia teñida de las pestañas ampliada ×1,2; se arrastra y se suelta al 2,5 % del destino;
 *  - muelles: los mismos dampingRatio/stiffness de Compose, resueltos de forma analítica;
 *  - plegado: tween de 560/470 ms con SpringEasing(0,55/0,74), etiquetas con opacidad 1 − 3·pliegue;
 *  - brillo bajo el dedo (GlassGlow) y estiramiento elástico (elasticStretch).
 *
 * La refracción usa `backdrop-filter: url(#filtro)` con mapas de desplazamiento SVG, que hoy solo pinta
 * Chromium (Chrome, Edge, Android). En Safari y Firefox se ve el mismo cristal sin el canto refractado,
 * igual que el `fallback` de la librería nativa por debajo de Android 13.
 *
 * Uso:
 *   const bar = LiquidBar.create(document.querySelector('#barra'), {
 *     items: [{ label: 'Inicio', icon: '<svg…>', href: '#inicio' }, …],
 *     selectedIndex: 0,
 *     onSelect: i => …,
 *     action: { label: 'Nuevo', icon: '<svg…>', onClick: () => … },
 *     detachAction: true,
 *     fold: { mode: 'direction' },          // o 'top' (como rememberLiquidBarFoldState())
 *     colors: { accent: '#0A84FF' },
 *     glass: { surface: 'rgba(29,19,22,.55)' },
 *   });
 *   bar.setSelected(2);                      // cambio programático (scroll-spy, rutas…)
 *   bar.fold(); bar.unfold(); bar.destroy();
 *
 *   // Píldora fina (LiquidPillBar): pestañas de icono, la activa se expande con su etiqueta y es la lente.
 *   const pill = LiquidBar.createPill(document.querySelector('#barra'), {
 *     items, selectedIndex: 0, onSelect: i => …,
 *     colors: { accent: '#27F58B', onAccent: '#0A0A0A', content: '#8A8A8A' },
 *   });
 *   pill.setSelected(1); pill.setLabel(3, 'Chat · 2'); pill.setColors({ accent: '#FF8A3D' });
 *   // Riel lateral (escritorio): LiquidBar.createPill(el, { …, vertical: true }) — solo iconos, lente en vertical.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LiquidBar = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const clamp01 = (v) => clamp(v, 0, 1);
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ───────────────────────── Curvas ───────────────────────── */

  function cubicBezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = (s) => ((ax * s + bx) * s + cx) * s;
    const sy = (s) => ((ay * s + by) * s + cy) * s;
    const dsx = (s) => (3 * ax * s + 2 * bx) * s + cx;
    return (t) => {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      let s = t;
      for (let i = 0; i < 8; i++) {
        const e = sx(s) - t;
        if (Math.abs(e) < 1e-6) return sy(s);
        const d = dsx(s);
        if (Math.abs(d) < 1e-6) break;
        s -= e / d;
      }
      let lo = 0, hi = 1;
      s = t;
      for (let i = 0; i < 40; i++) {
        const x = sx(s);
        if (Math.abs(x - t) < 1e-6) break;
        if (x < t) lo = s; else hi = s;
        s = (lo + hi) / 2;
      }
      return sy(s);
    };
  }
  const FastOutSlowIn = cubicBezier(0.4, 0, 0.2, 1);
  const EaseOut = cubicBezier(0, 0, 0.58, 1);

  /**
   * Muelle subamortiguado comprimido en una duración fija (LiquidMotion.kt · SpringEasing).
   * damping 0,55 ≈ 12 % de rebote; 0,74 ≈ 3 %.
   */
  function springEasing(damping, stiffness = 7.8) {
    const wd = stiffness * Math.sqrt(1 - damping * damping);
    const k = (damping * stiffness) / wd;
    const step = (t) => 1 - Math.exp(-damping * stiffness * t) * (Math.cos(wd * t) + k * Math.sin(wd * t));
    const residual = 1 - step(1);
    return (f) => (f >= 1 ? 1 : step(f) + residual * f);
  }

  const Motion = {
    FoldMs: 560,
    FoldEasing: springEasing(0.55),
    UnfoldMs: 470,
    UnfoldEasing: springEasing(0.74),
    FoldThreshold: 50,
    UnfoldThreshold: 8,
  };

  /** Igual que `spring(dampingRatio, stiffness)` de Compose (masa 1). */
  const spring = (dampingRatio, stiffness) => ({ type: 'spring', dampingRatio, stiffness });
  const tween = (duration, easing) => ({ type: 'tween', duration, easing });

  /* ───────────────────────── Reloj ───────────────────────── */

  const running = new Set();
  const frameHooks = new Set();
  let waiters = [];
  let rafId = 0;
  let lastT = 0;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function kick() {
    if (rafId || typeof requestAnimationFrame !== 'function') return;
    lastT = now();
    rafId = requestAnimationFrame(tick);
  }

  function tick(t) {
    rafId = 0;
    const dt = clamp((t - lastT) / 1000, 0, 0.064);
    lastT = t;
    running.forEach((a) => a._step(dt, t));
    if (waiters.length) {
      const pending = waiters;
      waiters = [];
      pending.forEach((w) => {
        if (w.cancelled && w.cancelled()) w.resolve(false);
        else if (w.test()) w.resolve(true);
        else waiters.push(w);
      });
    }
    frameHooks.forEach((h) => h(t));
    // Lo que se anima durante el fotograma ya ha llamado a kick(): no programar un segundo callback,
    // o cada fotograma duplicaría los siguientes (crecimiento exponencial al arrastrar la lente).
    if ((running.size || waiters.length) && !rafId) rafId = requestAnimationFrame(tick);
  }

  /** Espera a un fotograma en que `test()` sea cierto (snapshotFlow { … }.first { it }). */
  function waitUntil(test, cancelled) {
    return new Promise((resolve) => { waiters.push({ test, cancelled, resolve }); kick(); });
  }
  const nextFrame = (cancelled) => waitUntil(() => true, cancelled);

  /** Respuesta exacta de un oscilador amortiguado (masa 1) tras `dt` segundos. */
  function springStep(x, v, z, k, dt) {
    const w = Math.sqrt(k);
    if (z < 1 - 1e-4) {
      const wd = w * Math.sqrt(1 - z * z);
      const e = Math.exp(-z * w * dt), c = Math.cos(wd * dt), s = Math.sin(wd * dt);
      const B = (v + z * w * x) / wd;
      const pos = x * c + B * s;
      return [e * pos, e * (-z * w * pos + (-x * wd * s + B * wd * c))];
    }
    if (z > 1 + 1e-4) {
      const sq = Math.sqrt(z * z - 1);
      const r1 = -w * (z - sq), r2 = -w * (z + sq);
      const C2 = (v - r1 * x) / (r2 - r1), C1 = x - C2;
      const e1 = Math.exp(r1 * dt), e2 = Math.exp(r2 * dt);
      return [C1 * e1 + C2 * e2, C1 * r1 * e1 + C2 * r2 * e2];
    }
    const e = Math.exp(-w * dt), B = v + w * x;
    return [(x + B * dt) * e, (B - w * (x + B * dt)) * e];
  }

  /** Equivalente a `Animatable`: animar a un destino cancela la animación anterior y conserva la velocidad. */
  class Anim {
    constructor(value, threshold = 0.001) {
      this.value = value;
      this.target = value;
      this.velocity = 0;
      this.threshold = threshold;
      this._job = null;
    }
    get isRunning() { return !!this._job; }
    snapTo(v) {
      this._cancel();
      this.value = this.target = v;
      this.velocity = 0;
      kick();
      return Promise.resolve(true);
    }
    animateTo(target, spec, onFrame) {
      this._cancel();
      this.target = target;
      return new Promise((resolve) => {
        this._job = { spec, onFrame, resolve, t0: now(), from: this.value };
        running.add(this);
        kick();
      });
    }
    _cancel() {
      const job = this._job;
      if (!job) return;
      this._job = null;
      running.delete(this);
      job.resolve(false);
    }
    _finish() {
      const job = this._job;
      this._job = null;
      running.delete(this);
      this.value = this.target;
      this.velocity = 0;
      if (job) job.resolve(true);
    }
    _step(dt, t) {
      const job = this._job;
      if (!job) return;
      const spec = job.spec;
      if (spec.type === 'tween') {
        const f = clamp((t - job.t0) / spec.duration, 0, 1);
        const prev = this.value;
        this.value = job.from + (this.target - job.from) * spec.easing(f);
        this.velocity = dt > 0 ? (this.value - prev) / dt : 0;
        if (job.onFrame) job.onFrame();
        if (f >= 1) this._finish();
        return;
      }
      const [x, v] = springStep(this.value - this.target, this.velocity, spec.dampingRatio, spec.stiffness, dt);
      this.value = this.target + x;
      this.velocity = v;
      if (job.onFrame) job.onFrame();
      if (Math.abs(x) < this.threshold && Math.abs(v) < this.threshold * 62.5) this._finish();
    }
  }

  /* ───────────────────────── Colores ───────────────────────── */

  let colorCtx = null;
  function parseColor(c) {
    if (Array.isArray(c)) return c;
    if (!colorCtx) colorCtx = document.createElement('canvas').getContext('2d');
    colorCtx.fillStyle = '#000';
    colorCtx.fillStyle = c;
    const s = String(colorCtx.fillStyle);
    if (s[0] === '#') return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 1];
    const m = s.match(/[\d.]+/g).map(Number);
    return [m[0], m[1], m[2], m.length > 3 ? m[3] : 1];
  }
  const css = (c) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${+c[3].toFixed(4)})`;
  const alphaOf = (c, a) => [c[0], c[1], c[2], a];
  function over(top, under) {
    const a = top[3] + under[3] * (1 - top[3]);
    if (a <= 0) return [0, 0, 0, 0];
    const mix = (i) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a;
    return [mix(0), mix(1), mix(2), a];
  }

  /* ───────────────────────── Soporte ───────────────────────── */

  const hasDOM = typeof window !== 'undefined' && typeof document !== 'undefined';
  const supportsCss = (p, v) => hasDOM && typeof CSS !== 'undefined' && CSS.supports && CSS.supports(p, v);
  const backdropProp = supportsCss('backdrop-filter', 'blur(1px)') ? 'backdropFilter'
    : supportsCss('-webkit-backdrop-filter', 'blur(1px)') ? 'webkitBackdropFilter' : null;
  const isChromium = hasDOM && (
    (navigator.userAgentData && navigator.userAgentData.brands && navigator.userAgentData.brands.some((b) => /Chromium/.test(b.brand))) ||
    (/Chrome\/|Chromium\/|Edg\//.test(navigator.userAgent) && !/Firefox|FxiOS|CriOS|EdgiOS/.test(navigator.userAgent))
  );
  /** Android 12 desenfoca; Android 13 refracta. En web: desenfoque donde haya backdrop-filter, refracción en Chromium. */
  const support = { blur: !!backdropProp, refraction: !!backdropProp && isChromium };

  /** Radio de RenderEffect/BlurMaskFilter (Android) → desviación típica de CSS. */
  const sigma = (radius) => (radius > 0 ? radius * 0.57735 + 0.25 : 0);

  /* ───────────────────────── Refracción (mapas SVG) ───────────────────────── */

  let defsEl = null;
  let uid = 0;
  function defs() {
    if (defsEl && defsEl.isConnected) return defsEl;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    defsEl = document.createElementNS(SVG_NS, 'defs');
    svg.appendChild(defsEl);
    document.body.appendChild(svg);
    return defsEl;
  }
  function svgEl(tag, attrs, parent) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  }

  /** Distancia firmada a un rectángulo redondeado centrado (negativa dentro), como `shapeDistance` del AGSL. */
  function sdf(px, py, hw, hh, r) {
    const qx = Math.abs(px) - hw + r, qy = Math.abs(py) - hh + r;
    return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
  }

  /**
   * Desplazamiento del shader `RefractionAgsl` en un punto, normalizado (−1…1): en la franja del canto se
   * muestrea hacia dentro siguiendo la normal, con el perfil circular 1 − √(1 − t²).
   */
  function rimSample(px, py, hw, hh, r, band, depth) {
    const d = sdf(px, py, hw, hh, r);
    if (d > 0 || -d >= band) return null;
    const t = 1 - -d / band;
    const bend = 1 - Math.sqrt(Math.max(1 - t * t, 0));
    const e = 0.75;
    let nx = sdf(px + e, py, hw, hh, r) - sdf(px - e, py, hw, hh, r);
    let ny = sdf(px, py + e, hw, hh, r) - sdf(px, py - e, hw, hh, r);
    let len = Math.hypot(nx, ny);
    if (len > 1e-4) { nx /= len; ny /= len; } else { nx = 0; ny = 0; }
    if (depth) {
      const pl = Math.hypot(px, py);
      if (pl > 1e-4) { nx += px / pl; ny += py / pl; }
      len = Math.hypot(nx, ny);
      if (len > 1e-4) { nx /= len; ny /= len; }
    }
    return [-nx * bend, -ny * bend];
  }

  const enc = (v) => clamp(Math.round(128 + 127 * v), 0, 255);
  function newCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  const TILE_KEYS = ['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r'];
  const tileCache = new Map();
  /**
   * Mapa del canto troceado en 8 piezas (4 esquinas y 4 bordes de 1 px). Los bordes se estiran sin error,
   * así que el mismo mapa vale para cualquier anchura: la cápsula puede plegarse sin regenerar nada.
   */
  function rimTiles(r, band, c) {
    const key = `${r}|${band}|${c}`;
    if (tileCache.has(key)) return tileCache.get(key);
    const S = 2 * c + 1;
    const src = newCanvas(S, S);
    const ctx = src.getContext('2d');
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const s = rimSample(x + 0.5 - S / 2, y + 0.5 - S / 2, S / 2, S / 2, r, band, false);
        const i = (y * S + x) * 4;
        img.data[i] = s ? enc(s[0]) : 128;
        img.data[i + 1] = s ? enc(s[1]) : 128;
        img.data[i + 2] = 128;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const cut = (sx, sy, w, h) => {
      const t = newCanvas(w, h);
      t.getContext('2d').drawImage(src, sx, sy, w, h, 0, 0, w, h);
      return t.toDataURL('image/png');
    };
    const tiles = [
      cut(0, 0, c, c), cut(c + 1, 0, c, c), cut(0, c + 1, c, c), cut(c + 1, c + 1, c, c),
      cut(c, 0, 1, c), cut(c, c + 1, 1, c), cut(0, c, c, 1), cut(c + 1, c, c, 1),
    ];
    tileCache.set(key, tiles);
    return tiles;
  }

  /** Filtro de refracción del canto para superficies redondeadas que cambian de tamaño (cápsula, círculos). */
  class RimFilter {
    constructor(band, amount, radius) {
      this.id = `lbw-rim-${++uid}`;
      this.band = band;
      this.amount = amount;
      this.radius = radius; // null = píldora (media altura)
      this.w = -1;
      this.h = -1;
      this.key = '';
      const f = (this.el = svgEl('filter', {
        id: this.id, x: 0, y: 0, width: 1, height: 1,
        filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB',
      }, defs()));
      this.flood = svgEl('feFlood', { 'flood-color': 'rgb(128,128,128)', 'flood-opacity': 1, x: 0, y: 0, width: 1, height: 1, result: 'n' }, f);
      this.tiles = TILE_KEYS.map((k) => svgEl('feImage', { preserveAspectRatio: 'none', result: `t${k}`, x: 0, y: 0, width: 0, height: 0 }, f));
      const merge = svgEl('feMerge', { result: 'map' }, f);
      svgEl('feMergeNode', { in: 'n' }, merge);
      TILE_KEYS.forEach((k) => svgEl('feMergeNode', { in: `t${k}` }, merge));
      svgEl('feDisplacementMap', { in: 'SourceGraphic', in2: 'map', scale: 2 * amount, xChannelSelector: 'R', yChannelSelector: 'G' }, f);
    }
    update(w, h) {
      w = Math.max(2, Math.round(w));
      h = Math.max(2, Math.round(h));
      if (w === this.w && h === this.h) return;
      this.w = w;
      this.h = h;
      const minD = Math.min(w, h);
      const r = Math.min(this.radius == null ? minD / 2 : this.radius, minD / 2);
      const band = Math.min(this.band, minD / 2);
      const c = Math.ceil(Math.max(r, band));
      const key = `${r}|${band}|${c}`;
      if (key !== this.key) {
        this.key = key;
        rimTiles(r, band, c).forEach((href, i) => this.tiles[i].setAttribute('href', href));
      }
      const set = (el, x, y, ww, hh) => {
        el.setAttribute('x', x); el.setAttribute('y', y);
        el.setAttribute('width', Math.max(0, ww)); el.setAttribute('height', Math.max(0, hh));
      };
      set(this.el, 0, 0, w, h);
      set(this.flood, 0, 0, w, h);
      const [tl, tr, bl, br, t, b, l, rr] = this.tiles;
      set(tl, 0, 0, c, c); set(tr, w - c, 0, c, c); set(bl, 0, h - c, c, c); set(br, w - c, h - c, c, c);
      set(t, c, 0, w - 2 * c, c); set(b, c, h - c, w - 2 * c, c);
      set(l, 0, c, c, h - 2 * c); set(rr, w - c, c, c, h - 2 * c);
    }
    destroy() { this.el.remove(); }
  }

  /**
   * Filtro de la lupa: canto con lente abombada (depthEffect) y aberración cromática (rojo y azul se cruzan
   * en las diagonales). Los mapas se generan a la medida de la lente pulsada y se estiran a su tamaño vivo.
   */
  class LensFilter {
    constructor() {
      this.id = `lbw-lens-${++uid}`;
      this.key = '';
      this.K = 1;
      this.w = -1;
      this.h = -1;
      this.amount = -1;
      const f = (this.el = svgEl('filter', {
        id: this.id, x: 0, y: 0, width: 1, height: 1,
        filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB',
      }, defs()));
      const iso = {
        r: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
        g: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
        b: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0',
      };
      this.maps = [];
      this.disps = [];
      ['r', 'g', 'b'].forEach((ch) => {
        this.maps.push(svgEl('feImage', { preserveAspectRatio: 'none', x: 0, y: 0, width: 1, height: 1, result: `m${ch}` }, f));
        this.disps.push(svgEl('feDisplacementMap', { in: 'SourceGraphic', in2: `m${ch}`, scale: 0, xChannelSelector: 'R', yChannelSelector: 'G', result: `d${ch}` }, f));
        svgEl('feColorMatrix', { in: `d${ch}`, type: 'matrix', values: iso[ch], result: `c${ch}` }, f);
      });
      svgEl('feBlend', { in: 'cr', in2: 'cg', mode: 'screen', result: 'rg' }, f);
      svgEl('feBlend', { in: 'rg', in2: 'cb', mode: 'screen' }, f);
    }
    build(w, h, band, dispersion, depth) {
      w = Math.max(2, Math.round(w));
      h = Math.max(2, Math.round(h));
      const key = `${w}|${h}|${band}|${dispersion}|${depth}`;
      if (key === this.key) return;
      this.key = key;
      this.K = 1 + dispersion;
      const r = Math.min(w, h) / 2, hw = w / 2, hh = h / 2;
      const canvases = [newCanvas(w, h), newCanvas(w, h), newCanvas(w, h)];
      const imgs = canvases.map((c) => c.getContext('2d').createImageData(w, h));
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const px = x + 0.5 - hw, py = y + 0.5 - hh;
          const s = rimSample(px, py, hw, hh, r, Math.min(band, r), depth);
          const i = (y * w + x) * 4;
          const I = dispersion * (px * py) / (hw * hh);
          const f = [1 + I, 1, 1 - I];
          for (let k = 0; k < 3; k++) {
            const d = imgs[k].data;
            d[i] = s ? enc((s[0] * f[k]) / this.K) : 128;
            d[i + 1] = s ? enc((s[1] * f[k]) / this.K) : 128;
            d[i + 2] = 128;
            d[i + 3] = 255;
          }
        }
      }
      canvases.forEach((c, k) => {
        c.getContext('2d').putImageData(imgs[k], 0, 0);
        this.maps[k].setAttribute('href', c.toDataURL('image/png'));
      });
      this.amount = -1;
    }
    update(w, h, amount) {
      if (w !== this.w || h !== this.h) {
        this.w = w;
        this.h = h;
        for (const el of [this.el, ...this.maps]) { el.setAttribute('width', w); el.setAttribute('height', h); }
      }
      const a = Math.round(amount * 100) / 100;
      if (a !== this.amount) {
        this.amount = a;
        this.disps.forEach((d) => d.setAttribute('scale', 2 * a * this.K));
      }
    }
    destroy() { this.el.remove(); }
  }

  /* ───────────────────────── Estilo del cristal ───────────────────────── */

  /** LiquidGlassStyle: mismos valores por defecto que la librería nativa. */
  const GlassStyle = {
    Dark: {
      blur: 3, saturation: 1.5, refractionHeight: 24, refractionAmount: 24,
      surface: 'rgba(18,18,18,0.40)', rim: 'rgba(232,232,232,0.18)', rimWidth: 0.8,
      darkRimAlpha: 0.19, darkRimWidth: 1.6, fallback: 'rgba(28,28,30,0.92)',
    },
    Light: {
      blur: 3, saturation: 1.5, refractionHeight: 24, refractionAmount: 24,
      surface: 'rgba(251,251,251,0.40)', rim: 'rgba(255,255,255,0.44)', rimWidth: 0.8,
      darkRimAlpha: 0.19, darkRimWidth: 1.6, fallback: 'rgba(245,245,247,0.94)',
    },
  };

  /** Escribe estilos solo cuando cambian. */
  function put(el, prop, value) {
    const cache = el.__lbw || (el.__lbw = {});
    if (cache[prop] === value) return;
    cache[prop] = value;
    el.style[prop] = value;
  }

  function backdrop(blurRadius, saturation, filterId) {
    const parts = [];
    const s = sigma(blurRadius);
    if (s > 0.05) parts.push(`blur(${s.toFixed(2)}px)`);
    if (saturation !== 1) parts.push(`saturate(${saturation})`);
    if (filterId && support.refraction) parts.push(`url(#${filterId})`);
    return parts.length ? parts.join(' ') : 'none';
  }

  /** Pinta la superficie de cristal de `liquidGlass` (fondo, filos y, si se puede, refracción). */
  function paintGlass(el, style, filter, tint) {
    const surface = parseColor(style.surface);
    const fill = tint ? over(parseColor(tint), surface) : surface;
    if (support.blur) {
      put(el, backdropProp, backdrop(style.blur, style.saturation, filter && filter.id));
      put(el, 'backgroundColor', css(fill));
    } else {
      const fb = parseColor(style.fallback);
      put(el, 'backgroundColor', css(tint ? over(alphaOf(parseColor(tint), 1), fb) : fb));
    }
    const rim = parseColor(style.rim);
    el.style.setProperty('--lbw-rim', css(rim));
    el.style.setProperty('--lbw-rim-end', css(alphaOf(rim, rim[3] * 0.6)));
    el.style.setProperty('--lbw-rim-w', `${style.rimWidth}px`);
    el.style.setProperty('--lbw-drim', `rgba(0,0,0,${style.darkRimAlpha})`);
    el.style.setProperty('--lbw-drim-w', `${style.darkRimWidth}px`);
  }

  /* ───────────────────────── Tacto ───────────────────────── */

  const S_GLOW = spring(0.5, 300);

  /**
   * GlassGlow: al tocar, la pieza se aclara un 8 % y una luz radial del 15 % sigue al dedo; entra y sale con
   * spring(0.5, 300). No consume eventos. `offset` alimenta el estiramiento elástico.
   */
  class Glow {
    constructor(anchor) {
      this.anchor = anchor || null;
      this.press = new Anim(0);
      this.fx = new Anim(0, 0.5);
      this.fy = new Anim(0, 0.5);
      this.sx = 0;
      this.sy = 0;
      this.enabled = () => true;
    }
    get p() { return this.press.value; }
    get offset() { return { x: this.fx.value - this.sx, y: this.fy.value - this.sy }; }
    bind(el) {
      let id = null;
      let rect = null;
      const local = (e) => ({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      const down = (e) => {
        if (id !== null || !this.enabled() || (e.pointerType === 'mouse' && e.button !== 0)) return;
        id = e.pointerId;
        rect = el.getBoundingClientRect();
        const p = local(e);
        this.sx = p.x;
        this.sy = p.y;
        this.press.animateTo(1, S_GLOW);
        this.fx.snapTo(p.x);
        this.fy.snapTo(p.y);
      };
      const move = (e) => {
        if (e.pointerId !== id) return;
        const p = local(e);
        this.fx.snapTo(p.x);
        this.fy.snapTo(p.y);
      };
      const up = (e) => {
        if (e.pointerId !== id) return;
        id = null;
        this.press.animateTo(0, S_GLOW);
        this.fx.animateTo(this.sx, S_GLOW);
        this.fy.animateTo(this.sy, S_GLOW);
      };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
    }
    paint(layer, w, h) {
      const p = this.p;
      if (p <= 0.001) { put(layer, 'opacity', '0'); return; }
      let c = this.anchor ? this.anchor(w, h) : { x: this.fx.value, y: this.fy.value };
      c = { x: clamp(c.x, 0, w), y: clamp(c.y, 0, h) };
      const radius = Math.min(w, h) * 1.5;
      put(layer, 'background',
        `radial-gradient(circle ${radius.toFixed(1)}px at ${c.x.toFixed(1)}px ${c.y.toFixed(1)}px, ` +
        'rgba(255,255,255,.15) 0%, rgba(255,255,255,.15) 50%, rgba(255,255,255,0) 100%), rgba(255,255,255,.08)');
      put(layer, 'opacity', p.toFixed(3));
    }
  }

  /** elasticStretch: se infla 4 dp y sigue al dedo con resistencia (tanh), alargándose hacia el arrastre. */
  function elastic(glow, w, h, strength = 1) {
    if (w <= 0 || h <= 0) return '';
    const p = glow.p;
    const o = glow.offset;
    if (p <= 0.0005 && Math.abs(o.x) < 0.05 && Math.abs(o.y) < 0.05) return '';
    const inflate = lerp(1, 1 + (strength * 4) / h, p);
    const limit = Math.min(w, h), maxD = Math.max(w, h);
    const tx = strength * limit * Math.tanh((0.05 * o.x) / limit);
    const ty = strength * limit * Math.tanh((0.05 * o.y) / limit);
    const pull = (strength * 4) / h;
    const a = Math.atan2(o.y, o.x);
    const sx = inflate + pull * Math.abs((Math.cos(a) * o.x) / maxD) * Math.min(w / h, 1);
    const sy = inflate + pull * Math.abs((Math.sin(a) * o.y) / maxD) * Math.min(h / w, 1);
    return ` translate(${tx.toFixed(2)}px,${ty.toFixed(2)}px) scale(${sx.toFixed(4)},${sy.toFixed(4)})`;
  }

  /**
   * LensDrag: el indicador arrastrable. Valor continuo (pestaña bajo la lente) que persigue al dedo con
   * spring(1, 1000), presión y escala con sus muelles, y velocidad medida para deformar la lente.
   */
  class LensDrag {
    constructor(initial, lastIndex, pressedScale) {
      this.lastIndex = lastIndex;
      this.pressedScale = pressedScale;
      this.value = new Anim(initial);
      this.vel = new Anim(0, 0.05);
      this.pressA = new Anim(0);
      this.sx = new Anim(1);
      this.sy = new Anim(1);
      this.samples = [];
      this.token = 0;
    }
    get span() { return Math.max(1, this.lastIndex); }
    press() {
      this.token++;
      this.samples = [];
      this.pressA.animateTo(1, spring(1, 1000));
      this.sx.animateTo(this.pressedScale, spring(0.6, 250));
      this.sy.animateTo(this.pressedScale, spring(0.7, 250));
    }
    /** Suelta el cristal cuando el valor ya casi ha llegado a su destino, para que la lupa se vea viajar. */
    async release() {
      const token = ++this.token;
      const cancelled = () => token !== this.token;
      if (!(await nextFrame(cancelled))) return;
      const near = this.span * 0.025;
      if (Math.abs(this.value.value - this.value.target) >= near) {
        const ok = await waitUntil(() => Math.abs(this.value.value - this.value.target) < near, cancelled);
        if (!ok) return;
      }
      this.pressA.animateTo(0, spring(1, 1000));
      this.sx.animateTo(1, spring(0.6, 250));
      this.sy.animateTo(1, spring(0.7, 250));
    }
    follow(target) {
      const t = clamp(target, 0, this.lastIndex);
      this.value.animateTo(t, spring(1, 1000), () => this.trackVelocity());
    }
    /** Viaje programático (al tocar otra pestaña): presiona, viaja y suelta. */
    travelTo(target) {
      this.press();
      const t = clamp(target, 0, this.lastIndex);
      this.value.animateTo(t, spring(1, 1000)).then((done) => {
        if (done && this.vel.value !== 0) this.vel.animateTo(0, spring(0.5, 300));
      });
      this.release();
    }
    trackVelocity() {
      const t = now();
      this.samples.push([t, this.value.value]);
      while (this.samples.length > 2 && t - this.samples[0][0] > 100) this.samples.shift();
      const first = this.samples[0];
      const dt = (t - first[0]) / 1000;
      const v = dt > 0 ? (this.value.value - first[1]) / dt : 0;
      this.vel.animateTo(v / this.span, spring(0.5, 300));
    }
  }

  /* ───────────────────────── Barra ───────────────────────── */

  const PRESSED_SCALE = 78 / 56;
  const LENS_ZOOM = 1.2;

  function iconNode(icon) {
    const wrap = document.createElement('span');
    wrap.className = 'lbw-ico';
    if (icon instanceof Element) wrap.appendChild(icon.cloneNode(true));
    else if (icon) wrap.innerHTML = icon;
    const svg = wrap.querySelector('svg');
    if (svg) { svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false'); }
    return wrap;
  }

  function roundRectPath(x, y, w, h) {
    const r = Math.min(w, h) / 2;
    const f = (n) => n.toFixed(2);
    return `M${f(x + r)} ${f(y)}H${f(x + w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w)} ${f(y + r)}V${f(y + h - r)}` +
      `A${f(r)} ${f(r)} 0 0 1 ${f(x + w - r)} ${f(y + h)}H${f(x + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y + h - r)}` +
      `V${f(y + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)}Z`;
  }

  class Bar {
    constructor(host, options) {
      if (!host) throw new Error('LiquidBar: falta el elemento contenedor');
      const o = (this.o = Object.assign({
        items: [],
        selectedIndex: 0,
        onSelect: null,
        action: null,
        detachAction: false,
        actionSpacing: 10,
        rowHeight: 68,
        fold: null,
        unfoldOnSelect: true,
        ariaLabel: null,
      }, options || {}));
      o.colors = Object.assign({ accent: '#0A84FF', content: 'rgba(255,255,255,0.82)', indicator: 'rgba(128,128,128,0.55)' }, o.colors || {});
      o.glass = Object.assign({}, GlassStyle.Dark, o.glass || {});
      this.host = host;
      this.items = o.items.slice();
      this.n = this.items.length;
      this.lastTab = Math.max(0, this.n - 1);
      this.detached = !!(o.action && o.detachAction);
      this.cellsCount = this.n + (o.action && !this.detached ? 1 : 0);
      this.selected = clamp(o.selectedIndex | 0, -1, this.n - 1);
      this.current = this.selected;
      this.folded = false;
      this.width = 0;
      this.tabWidth = 1;
      this.bounces = [];

      this.fold_ = new Anim(0);
      this.visible = new Anim(this.selected >= 0 ? 1 : 0);
      this.pull = new Anim(0, 0.5);
      this.drag = new LensDrag(Math.max(0, this.selected), this.lastTab, PRESSED_SCALE);
      this.selectedGlow = new Glow();
      this.actionGlow = new Glow();
      this.groupGlow = new Glow((w, h) => ({ x: (this.drag.value.value + 0.5) * this.tabWidth + this.rowShift, y: h / 2 }));
      this.rowShift = 0;

      this._build();
      this._bindFold();

      this._frame = () => this.render();
      frameHooks.add(this._frame);
      this._ro = new ResizeObserver(() => { this.width = host.clientWidth; kick(); });
      this._ro.observe(host);
      this.width = host.clientWidth;
      this.bounces.forEach((b) => this._bounce(b));
      kick();
    }

    /* — construcción — */

    _cell(item, i, interactive) {
      const tag = interactive ? (item.href ? 'a' : 'button') : 'span';
      const cell = document.createElement(tag);
      cell.className = 'lbw-cell';
      if (interactive) {
        if (item.href) cell.href = item.href; else cell.type = 'button';
        cell.setAttribute('aria-label', item.label);
        if (item.title !== false) cell.title = item.label;
      }
      const ico = iconNode(item.icon);
      const lab = document.createElement('span');
      lab.className = 'lbw-lab';
      lab.textContent = item.label;
      cell.append(ico, lab);
      const bounce = { el: ico, anim: new Anim(1), index: i };
      this.bounces.push(bounce);
      return cell;
    }

    _build() {
      const o = this.o, host = this.host;
      host.classList.add('lbw');
      host.textContent = '';
      host.style.height = `${o.rowHeight}px`;
      host.style.setProperty('--lbw-accent', o.colors.accent);
      host.style.setProperty('--lbw-content', o.colors.content);
      if (o.ariaLabel) host.setAttribute('aria-label', o.ariaLabel);

      this.capFilter = support.refraction ? new RimFilter(o.glass.refractionHeight, o.glass.refractionAmount) : null;
      this.actFilter = support.refraction && o.action ? new RimFilter(o.glass.refractionHeight, o.glass.refractionAmount) : null;
      this.lensFilter = support.refraction ? new LensFilter() : null;

      const div = (cls, parent) => { const d = document.createElement('div'); d.className = cls; if (parent) parent.appendChild(d); return d; };

      // 0 · cristal de la cápsula (y del círculo izquierdo al plegar)
      this.surface = div('lbw-glass lbw-surface', host);
      this.surfaceGlow = div('lbw-glow', this.surface);
      paintGlass(this.surface, o.glass, this.capFilter);

      // 1 · pestañas visibles
      this.group = div('lbw-group', host);
      this.row = div('lbw-row', this.group);
      this.rowGlow = div('lbw-glow', this.row);
      this.cells = this.items.map((item, i) => {
        const c = this._cell(item, i, true);
        c.addEventListener('click', (e) => { e.preventDefault(); this._tap(i); });
        this.row.appendChild(c);
        return c;
      });
      if (o.action && !this.detached) {
        const c = this._cell(o.action, -1, true);
        c.classList.add('lbw-cell-action');
        if (o.action.iconTint) c.style.color = o.action.iconTint;
        c.addEventListener('click', (e) => { if (!o.action.href) e.preventDefault(); o.action.onClick && o.action.onClick(e); });
        this.row.appendChild(c);
      }

      // la lupa: hermana de la cápsula (no hija) para que su backdrop-filter vea la página y la cápsula
      this.lens = div('lbw-lens', host);
      this.lens.setAttribute('aria-hidden', 'true');
      this.lensContent = div('lbw-lens-c', this.lens);
      this.clone = div('lbw-clone', this.lensContent);
      this.cloneCells = this.items.map((item, i) => { const c = this._cell(item, i, false); this.clone.appendChild(c); return c; });
      if (o.action && !this.detached) {
        const c = this._cell(o.action, -1, false);
        this.clone.appendChild(c);
        this.cloneCells.push(c);
      }

      // 2 · la pestaña activa sola, plegada
      this.single = document.createElement('button');
      this.single.type = 'button';
      this.single.className = 'lbw-btn lbw-single';
      this.single.setAttribute('aria-label', 'Mostrar pestañas');
      this.single.setAttribute('aria-expanded', 'false');
      this.singleIco = iconNode(null);
      this.singleLab = document.createElement('span');
      this.singleLab.className = 'lbw-lab';
      this.single.append(this.singleIco, this.singleLab);
      this.singleBounce = { el: this.singleIco, anim: new Anim(1), index: -2 };
      this.bounces.push(this.singleBounce);
      this._fillSingle();
      this.single.addEventListener('click', () => this.unfold());
      host.appendChild(this.single);
      this.selectedGlow.bind(this.single);
      this.selectedGlow.enabled = () => this.folded;

      // 3 · 4 · la acción en su propio círculo
      if (o.action) {
        this.actGlass = div('lbw-glass lbw-act-glass', host);
        this.actGlassGlow = div('lbw-glow', this.actGlass);
        paintGlass(this.actGlass, o.glass, this.actFilter, o.action.tint);
        const a = o.action;
        const ctl = (this.actCtl = document.createElement(a.href ? 'a' : 'button'));
        if (a.href) ctl.href = a.href; else ctl.type = 'button';
        ctl.className = 'lbw-btn lbw-act';
        ctl.setAttribute('aria-label', a.label);
        ctl.title = a.label;
        if (a.iconTint) ctl.style.color = a.iconTint;
        this.actIco = iconNode(a.icon);
        ctl.appendChild(this.actIco);
        if (!this.detached) {
          this.actLab = document.createElement('span');
          this.actLab.className = 'lbw-lab';
          this.actLab.textContent = a.label;
          ctl.appendChild(this.actLab);
        } else ctl.classList.add('lbw-act-solo');
        this.bounces.push({ el: this.actIco, anim: new Anim(1), index: -3 });
        ctl.addEventListener('click', (e) => { if (!a.href) e.preventDefault(); a.onClick && a.onClick(e); });
        host.appendChild(ctl);
        this.actionGlow.bind(ctl);
        this.actionGlow.enabled = () => this.folded || this.detached;
      }

      // la lente se arrastra
      this._bindLens();
      this.groupGlow.bind(this.lens);
      this._onFocus = () => this.unfold();
      host.addEventListener('focusin', this._onFocus);
      this._syncA11y();
    }

    _fillSingle() {
      const item = this.items[this.selected];
      this.singleIco.textContent = '';
      if (item) this.singleIco.appendChild(iconNode(item.icon).firstChild || document.createTextNode(''));
      this.singleLab.textContent = item ? item.label : '';
      this.single.setAttribute('aria-label', item ? `Mostrar pestañas (${item.label})` : 'Mostrar pestañas');
    }

    _bindLens() {
      const lens = this.lens;
      let id = null;
      let lastX = 0;
      lens.addEventListener('pointerdown', (e) => {
        if (this.folded || id !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
        e.preventDefault();
        id = e.pointerId;
        lastX = e.clientX;
        try { lens.setPointerCapture(id); } catch (_) { /* sin captura */ }
        this.drag.press();
      });
      lens.addEventListener('pointermove', (e) => {
        if (e.pointerId !== id) return;
        const dx = e.clientX - lastX;
        lastX = e.clientX;
        if (dx !== 0) {
          this.drag.follow(this.drag.value.target + dx / this.tabWidth);
          this.pull.snapTo(this.pull.value + dx);
        }
      });
      const end = (e) => {
        if (e.pointerId !== id) return;
        id = null;
        this._release();
        this.drag.release();
      };
      lens.addEventListener('pointerup', end);
      lens.addEventListener('pointercancel', end);
      lens.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    /** onRelease de LiquidTabGroup. */
    _release() {
      const target = clamp(Math.round(this.drag.value.target), 0, this.lastTab);
      if (target === this.current) this._emit(target);
      const changed = target !== this.current;
      this.current = target;
      this.drag.travelTo(target);
      this.pull.animateTo(0, spring(1, 300));
      if (changed) this._currentChanged(target);
    }

    _currentChanged(i) {
      this.drag.travelTo(i);
      if (i !== this.selected) this._emit(i);
    }

    _tap(i) {
      this._emit(i);
    }

    /** El usuario elige una pestaña (onSelect). */
    _emit(i) {
      this._setSelected(i);
      if (this.o.unfoldOnSelect) this.unfold();
      if (typeof this.o.onSelect === 'function') this.o.onSelect(i, this.items[i]);
    }

    _setSelected(i) {
      i = clamp(i | 0, -1, this.n - 1);
      if (i !== this.selected) {
        this.selected = i;
        this._fillSingle();
        this.bounces.forEach((b) => { if (b.index === i || b.index === -2) this._bounce(b); });
        this.visible.animateTo(i >= 0 ? 1 : 0, tween(220, FastOutSlowIn));
        this._syncA11y();
      }
      if (i >= 0 && i !== this.current) {
        this.current = i;
        this._currentChanged(i);
      }
      kick();
    }

    /** Cambio programático (sin onSelect): scroll-spy, rutas… */
    setSelected(i) { this._setSelected(i); }
    get selectedIndex() { return this.selected; }

    /* — plegado — */

    fold() {
      if (this.folded || !this.n) return;
      this.folded = true;
      this.fold_.animateTo(1, tween(Motion.FoldMs, Motion.FoldEasing));
      this.bounces.forEach((b) => this._bounce(b));
      this._syncA11y();
    }

    unfold() {
      if (!this.folded) return;
      this.folded = false;
      this._run = 0;
      this.fold_.animateTo(0, tween(Motion.UnfoldMs, Motion.UnfoldEasing));
      this.bounces.forEach((b) => this._bounce(b));
      this._syncA11y();
    }

    get isFolded() { return this.folded; }

    _bindFold() {
      const cfg = this.o.fold;
      if (!cfg) return;
      const mode = cfg.mode || 'top';
      const target = cfg.target || window;
      const foldPx = cfg.threshold != null ? cfg.threshold : Motion.FoldThreshold;
      const unfoldPx = cfg.unfoldThreshold != null ? cfg.unfoldThreshold : Motion.UnfoldThreshold;
      const read = () => (target === window ? window.scrollY : target.scrollTop);
      let last = read();
      this._run = 0;
      this._onScroll = () => {
        const y = read();
        const dy = y - last;
        last = y;
        if (dy === 0) return;
        if (y <= 0.5) { this.unfold(); this._run = 0; return; }
        if (mode === 'direction') {
          // LiquidFoldMode.ByDirection: se pliega al bajar 50 dp y se abre al subir 8 dp.
          this._run = this._run === 0 || (this._run > 0) === (dy > 0) ? this._run + dy : dy;
          if (!this.folded && this._run >= foldPx) { this.fold(); this._run = 0; }
          else if (this.folded && this._run <= -unfoldPx) { this.unfold(); this._run = 0; }
        } else if (!this.folded) {
          // LiquidFoldMode.ExpandedAtTop: se pliega en cuanto la página se mueve; se abre arriba del todo.
          this.fold();
        }
      };
      target.addEventListener('scroll', this._onScroll, { passive: true });
      this._scrollTarget = target;
    }

    _syncA11y() {
      const folded = this.folded;
      this.group.toggleAttribute('inert', folded);
      this.group.setAttribute('aria-hidden', folded ? 'true' : 'false');
      this.single.tabIndex = folded ? 0 : -1;
      this.single.setAttribute('aria-hidden', folded ? 'false' : 'true');
      if (this.actCtl) {
        const live = folded || this.detached;
        this.actCtl.tabIndex = live ? 0 : -1;
        this.actCtl.setAttribute('aria-hidden', live ? 'false' : 'true');
      }
      this.cells.forEach((c, i) => {
        if (i === this.selected) c.setAttribute('aria-current', 'page');
        else c.removeAttribute('aria-current');
      });
      this.cloneCells.forEach((c, i) => c.classList.toggle('is-sel', i === this.selected));
      this.cells.forEach((c, i) => c.classList.toggle('is-sel', i === this.selected));
    }

    /** glyphBounce: encoge a 0,8 en 90 ms y vuelve con spring(0.4, 520). */
    _bounce(b) {
      b.anim.animateTo(0.8, tween(90, FastOutSlowIn)).then((ok) => {
        if (ok) b.anim.animateTo(1, spring(0.4, 520));
      });
    }

    /* — dibujo — */

    render() {
      const o = this.o, W = this.width;
      if (!W) return;
      const H = o.rowHeight;
      const n = this.n, cells = Math.max(1, this.cellsCount);
      const circle = Math.min(H, W), inset = 4, inner = H - 8;
      const openWidth = this.detached ? Math.max(circle, W - circle - o.actionSpacing) : W;
      const tabWidth = (this.tabWidth = (openWidth - 2 * inset) / cells);
      const p = this.fold_.value, pc = clamp01(p);
      const navWidth = clamp(Math.round(lerp(openWidth, circle, p)), circle, openWidth);
      const sel = this.selected;
      const selX = Math.round(lerp(inset + tabWidth * (sel + 0.5) - circle / 2, 0, p));
      const actionX = this.detached ? W - circle : Math.round(lerp(inset + tabWidth * (cells - 0.5) - circle / 2, W - circle, p));

      // iconos con rebote
      for (const b of this.bounces) put(b.el, 'transform', b.anim.value === 1 ? '' : `scale(${b.anim.value.toFixed(4)})`);

      // 0 · cápsula
      put(this.surface, 'width', `${navWidth}px`);
      put(this.surface, 'height', `${H}px`);
      put(this.surface, 'transform', elastic(this.selectedGlow, navWidth, H).trim());
      if (this.capFilter) this.capFilter.update(navWidth, H);
      this.selectedGlow.paint(this.surfaceGlow, navWidth, H);

      // 1 · pestañas, recortadas por la cápsula que encoge
      const groupAlpha = clamp01(1 - pc * 3);
      put(this.group, 'width', `${openWidth}px`);
      put(this.group, 'opacity', groupAlpha.toFixed(3));
      put(this.group, 'clipPath', pc > 0 ? `inset(0 ${(openWidth - lerp(openWidth, H, pc)).toFixed(1)}px 0 0 round ${H / 2}px)` : 'none');
      const f = clamp(this.pull.value / openWidth, -1, 1);
      const rowShift = (this.rowShift = 4 * Math.sign(f) * EaseOut(Math.abs(f)));
      put(this.row, 'transform', rowShift ? `translateX(${rowShift.toFixed(2)}px)` : '');

      // la lupa
      const d = this.drag;
      const lp = clamp01(d.pressA.value);
      const v = d.vel.value / 10;
      const sx = d.sx.value / (1 - clamp(v * 0.75, -0.2, 0.2));
      const sy = d.sy.value * (1 - clamp(v * 0.25, -0.2, 0.2));
      const lw = Math.max(1, Math.round(tabWidth * sx));
      const lh = Math.max(1, Math.round(inner * sy));
      const lx = inset + d.value.value * tabWidth + rowShift + (tabWidth - lw) / 2;
      const ly = inset + (inner - lh) / 2;
      const lensAlpha = n ? this.visible.value * groupAlpha : 0;

      // El indicador tapa la pestaña de debajo (en nativo su cristal no refracta las pestañas): se abre un hueco.
      put(this.row, 'clipPath', lensAlpha > 0.02
        ? `path(evenodd, "M-4000 -4000H8000V8000H-4000Z ${roundRectPath(lx - rowShift, ly, lw, lh)}")`
        : 'none');

      put(this.lens, 'display', lensAlpha > 0.001 ? '' : 'none');
      put(this.lens, 'opacity', lensAlpha.toFixed(3));
      put(this.lens, 'width', `${lw}px`);
      put(this.lens, 'height', `${lh}px`);
      put(this.lens, 'transform', `translate(${lx.toFixed(2)}px,${ly.toFixed(2)}px)`);
      put(this.lens, 'pointerEvents', this.folded ? 'none' : 'auto');

      const indicator = parseColor(o.colors.indicator);
      if (support.blur) {
        if (this.lensFilter) {
          this.lensFilter.build(tabWidth * PRESSED_SCALE, inner * PRESSED_SCALE, 10, 0.5, true);
          this.lensFilter.update(lw, lh, 14 * lp);
        }
        const refr = this.lensFilter && lp > 0.002;
        put(this.lens, backdropProp, backdrop(12 * (1 - lp), 1.5, refr ? this.lensFilter.id : null));
        const top = alphaOf(indicator, indicator[3] * (1 - lp));
        const under = [0, 0, 0, 0.03 * lp];
        put(this.lens, 'backgroundColor', css(under[3] > 0 ? over(top, under) : top));
        put(this.lensContent, 'filter', refr ? `url(#${this.lensFilter.id})` : 'none');
      } else {
        put(this.lens, 'backgroundColor', css(indicator));
      }
      const rimA = 0.16 + 0.34 * lp;
      put(this.lens, 'boxShadow', lp > 0.002
        ? `0 4px ${(2 * sigma(24)).toFixed(1)}px rgba(0,0,0,${(0.1 * lp).toFixed(3)}), inset 0 ${(8 * lp).toFixed(2)}px ${(2 * sigma(8 * lp)).toFixed(2)}px rgba(0,0,0,${(0.15 * lp).toFixed(3)})`
        : 'none');
      this.lens.style.setProperty('--lbw-rim', `rgba(255,255,255,${rimA.toFixed(3)})`);
      this.lens.style.setProperty('--lbw-rim-end', `rgba(255,255,255,${(rimA * 0.6).toFixed(3)})`);

      // copia teñida de las pestañas que la lente deja ver, ampliada ×1,2 al pulsar
      put(this.clone, 'width', `${openWidth}px`);
      put(this.clone, 'height', `${inner}px`);
      put(this.clone, 'transform', `translate(${(rowShift - lx).toFixed(2)}px,${(inset - ly).toFixed(2)}px)`);
      const zoom = lerp(1, LENS_ZOOM, d.pressA.value);
      for (const c of this.cloneCells) put(c, 'transform', zoom === 1 ? '' : `scale(${zoom.toFixed(4)})`);

      this.groupGlow.paint(this.rowGlow, openWidth, H);

      // 2 · la pestaña activa plegada
      const singleOn = sel >= 0;
      put(this.single, 'display', singleOn ? '' : 'none');
      if (singleOn) {
        put(this.single, 'width', `${circle}px`);
        put(this.single, 'height', `${H}px`);
        put(this.single, 'opacity', pc.toFixed(3));
        put(this.single, 'transform', `translate(${selX}px,0)${elastic(this.selectedGlow, circle, H)}`);
        put(this.single, 'pointerEvents', this.folded ? 'auto' : 'none');
        this._foldingCell(this.singleIco, this.singleLab, H, 1 - pc);
      }

      // 3 · 4 · la acción
      if (this.actCtl) {
        const actionAlpha = this.detached ? 1 : pc;
        const tr = `translate(${actionX}px,0)${elastic(this.actionGlow, circle, H)}`;
        for (const el of [this.actGlass, this.actCtl]) {
          put(el, 'width', `${circle}px`);
          put(el, 'height', `${H}px`);
          put(el, 'opacity', actionAlpha.toFixed(3));
          put(el, 'transform', tr);
        }
        put(this.actCtl, 'pointerEvents', this.folded || this.detached ? 'auto' : 'none');
        if (this.actFilter) this.actFilter.update(circle, H);
        this.actionGlow.paint(this.actGlassGlow, circle, H);
        if (!this.detached) this._foldingCell(this.actIco, this.actLab, H, 1 - pc);
      }
    }

    /** FoldingCell: icono centrado que sube para dejar sitio a su etiqueta cuando `f` llega a 1. */
    _foldingCell(ico, lab, H, f) {
      const slot = 32, gap = 2, labH = 12;
      const centred = (H - slot) / 2;
      const stacked = (H - slot - gap - labH) / 2;
      const top = Math.round(lerp(centred, stacked, f));
      put(ico, 'top', `${top}px`);
      put(lab, 'top', `${top + slot + gap}px`);
      put(lab, 'opacity', f.toFixed(3));
    }

    destroy() {
      frameHooks.delete(this._frame);
      this._ro.disconnect();
      if (this._scrollTarget) this._scrollTarget.removeEventListener('scroll', this._onScroll);
      this.host.removeEventListener('focusin', this._onFocus);
      [this.capFilter, this.actFilter, this.lensFilter].forEach((f) => f && f.destroy());
      this.host.textContent = '';
      this.host.classList.remove('lbw');
    }
  }

  /* ───────────────────────── Píldora (LiquidPillBar) ───────────────────────── */

  /** Medidas de LiquidPillDefaults: pestaña de 48, relleno de 12, icono de 24, etiqueta a 7 del icono. */
  const PILL = { tabH: 48, pad: 8, gap: 2, padX: 12, minPadX: 4, icon: 24, labelGap: 7 };
  const S_TRAVEL = spring(0.62, 420);   // viaje de la lente entre pestañas (se pasa un poco y vuelve)
  const S_STRETCH = spring(0.5, 420);   // anchura de la lente
  const S_EXPAND = spring(0.75, 500);   // expandHorizontally de la etiqueta
  const S_SHRINK = spring(0.9, 500);    // shrinkHorizontally
  const S_FADE = spring(1, 400);        // fadeIn/fadeOut por defecto de Compose
  const S_TINT = spring(1, 1500);       // animateColorAsState por defecto
  const S_POP = spring(0.35, 1500);     // «pop» del icono al activarse
  const S_SQUEEZE = spring(0.6, 800);   // pestaña pulsada a 0,95

  /**
   * Barra fina en píldora, port de `LiquidPillBar`: pestañas de icono; la activa se expande en cápsula de
   * acento con su etiqueta. La cápsula es una lente: viaja entre pestañas con un muelle que se pasa un poco y
   * se estira con la velocidad; mantenida pulsada crece ×1,18/×1,3, se aclara a cristal y refracta (con
   * aberración cromática) el fondo y una copia teñida y ampliada ×1,12 de las pestañas; se arrastra y al
   * soltar se asienta en la más cercana. La barra se ajusta a su contenido.
   *
   * Extras de la web: `vertical: true` (riel lateral de escritorio: solo iconos, la lente viaja en vertical) y
   * `maxWidth` (si no cabe, estrecha el relleno de las pestañas hasta 4 px antes de salirse).
   */
  class Pill {
    constructor(host, options) {
      if (!host) throw new Error('LiquidBar: falta el elemento contenedor');
      const o = (this.o = Object.assign({ items: [], selectedIndex: 0, onSelect: null, ariaLabel: null, vertical: false, maxWidth: 0 }, options || {}));
      this.host = host;
      this.vert = !!o.vertical;
      this.items = o.items.map((it) => Object.assign({}, it));
      this.n = this.items.length;
      this.selected = clamp(o.selectedIndex | 0, 0, Math.max(0, this.n - 1));
      this.setColors(o.colors);
      o.glass = Object.assign({}, GlassStyle.Dark, o.glass || {});

      this.natural = this.items.map(() => 0);      // anchura natural de cada etiqueta (px)
      this.lefts = this.items.map(() => 0);        // posición de cada pestaña a lo largo del eje
      this.widths = this.items.map(() => 0);       // longitud de cada pestaña a lo largo del eje
      this.padX = PILL.padX;
      const on = (i) => (i === this.selected && !this.vert ? 1 : 0);
      this.expand = this.items.map((_, i) => new Anim(on(i)));
      this.fade = this.items.map((_, i) => new Anim(on(i)));
      this.tint = this.items.map((_, i) => new Anim(i === this.selected ? 1 : 0));
      this.pop = this.items.map(() => new Anim(1));
      this.squeeze = this.items.map(() => new Anim(1));

      // La lente: centro y longitud (px, a lo largo del eje, en coordenadas de la fila) y presión.
      this.x = new Anim(0, 0.5);
      this.w = new Anim(0, 0.5);
      this.press = new Anim(0);
      this.holding = false;
      this.dragging = false;
      this.released = -1;          // pestaña donde se soltó, hasta que la app confirma (o 400 ms)
      this.releasedTimer = 0;
      this.measured = false;
      this.glow = new Glow();

      this._build();
      this._measure();
      this._frame = () => this._tick();
      frameHooks.add(this._frame);
      if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(() => { this._measure(); kick(); });
      kick();
    }

    setColors(c) {
      const o = this.o;
      o.colors = Object.assign({ accent: '#0A84FF', onAccent: '#FFFFFF', content: 'rgba(255,255,255,0.72)' }, o.colors || {}, c || {});
      this.cAccent = parseColor(o.colors.accent);
      this.cOn = parseColor(o.colors.onAccent);
      this.cContent = parseColor(o.colors.content);
      kick();
    }

    /** Anchura máxima disponible (px): si la barra no cabe, se compactan las pestañas. */
    setMaxWidth(px) { this.o.maxWidth = px || 0; kick(); }

    _build() {
      const o = this.o, host = this.host;
      host.classList.add('lbw', 'lbp');
      if (this.vert) host.classList.add('lbp-v');
      host.textContent = '';
      if (o.ariaLabel) host.setAttribute('aria-label', o.ariaLabel);
      const div = (cls, parent) => { const d = document.createElement('div'); d.className = cls; if (parent) parent.appendChild(d); return d; };

      this.filter = support.refraction ? new RimFilter(o.glass.refractionHeight, o.glass.refractionAmount) : null;
      this.lensFilter = support.refraction ? new LensFilter() : null;

      // El cristal de la píldora, sin hijos con contenido: la lente lo «ve» a través de su backdrop-filter.
      this.surface = div('lbw-glass lbp-surface', host);
      this.surfaceGlow = div('lbw-glow', this.surface);
      paintGlass(this.surface, o.glass, this.filter);

      this.row = div('lbp-row', host);
      const makeTab = (item, i, interactive) => {
        const tab = document.createElement(interactive ? (item.href ? 'a' : 'button') : 'span');
        tab.className = 'lbp-tab';
        if (interactive) {
          if (item.href) tab.href = item.href; else tab.type = 'button';
          tab.setAttribute('aria-label', item.label);
          if (this.vert) tab.title = item.label;
        }
        const ico = iconNode(item.icon);
        ico.className = 'lbp-ico';
        const wrap = document.createElement('span');
        wrap.className = 'lbp-labw';
        const lab = document.createElement('span');
        lab.className = 'lbp-lab';
        lab.textContent = item.label;
        wrap.appendChild(lab);
        tab.append(ico, wrap);
        return { tab, ico, wrap, lab };
      };
      this.tabs = this.items.map((item, i) => {
        const t = makeTab(item, i, true);
        t.tab.addEventListener('click', (e) => { if (!item.href) e.preventDefault(); if (i !== this.selected) this._emit(i); });
        t.tab.addEventListener('pointerdown', () => this.squeeze[i].animateTo(0.95, S_SQUEEZE));
        const up = () => this.squeeze[i].animateTo(1, S_SQUEEZE);
        ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => t.tab.addEventListener(ev, up));
        this.row.appendChild(t.tab);
        return t;
      });

      // La lente: hermana de la píldora para que su backdrop-filter vea la página y el cristal de la píldora.
      this.lens = div('lbw-lens lbp-lens', host);
      this.lens.setAttribute('aria-hidden', 'true');
      this.lensContent = div('lbw-lens-c', this.lens);
      this.clone = div('lbp-clone', this.lensContent);
      this.cloneTabs = this.items.map((item, i) => { const t = makeTab(item, i, false); this.clone.appendChild(t.tab); return t; });
      // Zona táctil de la lente: el hueco de su pestaña, no el dibujo ampliado (como en nativo).
      this.hit = div('lbp-hit', host);
      this.hit.setAttribute('aria-hidden', 'true');

      // Medidor de etiquetas con los mismos estilos (hereda la tipografía que la web ponga a .lbp-lab).
      this.meter = document.createElement('span');
      this.meter.className = 'lbp-lab lbp-meter';
      host.appendChild(this.meter);

      this.glow.bind(host);
      this._bindLens();
      this._syncA11y();
    }

    _measure() {
      if (this.vert) return;
      this.items.forEach((it, i) => {
        this.meter.textContent = it.label;
        this.natural[i] = this.meter.getBoundingClientRect().width;
      });
      this.meter.textContent = '';
    }

    _bindLens() {
      const lens = this.hit, vert = this.vert;
      let id = null;
      let last = 0;
      const coord = (e) => (vert ? e.clientY : e.clientX);
      const end = (e) => {
        if (e.pointerId !== id) return;
        id = null;
        // Siempre se suelta (también si el gesto se cancela): una lente «arrastrándose» no volvería a su sitio.
        this.dragging = false;
        kick();
        // Cancelado (otro elemento se queda el dedo, scroll del sistema…): sin selección, vuelve a su pestaña.
        if (e.type !== 'pointerup') return;
        const target = this._nearest(this.x.value);
        this.released = target;
        clearTimeout(this.releasedTimer);
        this.releasedTimer = setTimeout(() => { this.released = -1; kick(); }, 400);
        // Siempre avisa, también al soltar sobre la pestaña activa (como la nativa).
        this._emit(target, true);
      };
      lens.addEventListener('pointerdown', (e) => {
        if (id !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
        e.preventDefault();
        id = e.pointerId;
        last = coord(e);
        try { lens.setPointerCapture(id); } catch (_) { /* sin captura */ }
        this.dragging = true;
        kick();
      });
      lens.addEventListener('pointermove', (e) => {
        if (e.pointerId !== id) return;
        const c = coord(e), d = c - last;
        last = c;
        if (!d) return;
        const min = this.lefts[0] || 0;
        const max = (this.lefts[this.n - 1] || 0) + (this.widths[this.n - 1] || 0);
        this.x.snapTo(clamp(this.x.value + d, min, max));
        const h = this._nearest(this.x.value);
        if (this.w.target !== this.widths[h]) this.w.animateTo(this.widths[h], S_STRETCH);
      });
      lens.addEventListener('pointerup', end);
      lens.addEventListener('pointercancel', end);
      lens.addEventListener('lostpointercapture', end);
      lens.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    _nearest(c) {
      let best = 0, bd = Infinity;
      for (let i = 0; i < this.n; i++) {
        const d = Math.abs(this.lefts[i] + this.widths[i] / 2 - c);
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }

    /** El usuario elige (toque o lente). `always`: avisar aunque sea la activa. */
    _emit(i, always) {
      const changed = i !== this.selected;
      this._setSelected(i);
      if ((changed || always) && typeof this.o.onSelect === 'function') this.o.onSelect(i, this.items[i]);
    }

    _setSelected(i) {
      i = clamp(i | 0, 0, Math.max(0, this.n - 1));
      if (i === this.selected) return;
      const prev = this.selected;
      this.selected = i;
      this.released = -1;
      if (!this.vert) {
        this.expand[prev].animateTo(0, S_SHRINK);
        this.fade[prev].animateTo(0, S_FADE);
        this.expand[i].animateTo(1, S_EXPAND);
        this.fade[i].animateTo(1, S_FADE);
      }
      this.tint[prev].animateTo(0, S_TINT);
      this.tint[i].animateTo(1, S_TINT);
      this.pop[i].snapTo(0.6).then(() => this.pop[i].animateTo(1, S_POP));
      this._syncA11y();
      kick();
    }

    /** Cambio programático (rutas, la app confirma…), sin onSelect. */
    setSelected(i) { this._setSelected(i); }
    get selectedIndex() { return this.selected; }

    /** Cambia la etiqueta de una pestaña (p. ej. «Chat · 3») sin rehacer la barra. */
    setLabel(i, label) {
      const it = this.items[i];
      if (!it || it.label === label) return;
      it.label = label;
      this.tabs[i].lab.textContent = label;
      this.tabs[i].tab.setAttribute('aria-label', label);
      if (this.vert) this.tabs[i].tab.title = label;
      this.cloneTabs[i].lab.textContent = label;
      this._measure();
      kick();
    }

    _syncA11y() {
      this.tabs.forEach((t, i) => {
        if (i === this.selected) t.tab.setAttribute('aria-current', 'page');
        else t.tab.removeAttribute('aria-current');
      });
    }

    /** Disposición (la Row/Column de Compose con la etiqueta que se despliega). Devuelve la longitud total. */
    _layout() {
      const P = PILL, n = this.n;
      if (this.vert) {
        this.padX = P.padX;
        for (let i = 0; i < n; i++) { this.lefts[i] = i * (P.tabH + P.gap); this.widths[i] = P.tabH; }
        return n * P.tabH + (n - 1) * P.gap;
      }
      const labs = this.items.map((_, i) => (P.labelGap + this.natural[i]) * Math.max(0, this.expand[i].value));
      const fixed = labs.reduce((a, b) => a + b, 0) + n * P.icon + (n - 1) * P.gap + 2 * P.pad;
      let padX = P.padX;
      const max = this.o.maxWidth;
      if (max > 0 && fixed + 2 * n * padX > max) padX = clamp((max - fixed) / (2 * n), P.minPadX, P.padX);
      this.padX = padX;
      let left = 0;
      for (let i = 0; i < n; i++) {
        this.lefts[i] = left;
        this.widths[i] = 2 * padX + P.icon + labs[i];
        left += this.widths[i] + (i < n - 1 ? P.gap : 0);
      }
      return left;
    }

    /** Un único dueño de la posición de la lente: sin arrastre va SIEMPRE a su pestaña (collectLatest). */
    _tick() {
      if (!this.n) return;
      this._layout();
      const ti = this.released >= 0 ? this.released : this.selected;
      const cx = this.lefts[ti] + this.widths[ti] / 2, tw = this.widths[ti];
      if (!this.dragging && tw > 0) {
        if (!this.measured) { this.x.snapTo(cx); this.w.snapTo(tw); this.measured = true; }
        else {
          if (Math.abs(this.x.target - cx) > 0.25 || (!this.x.isRunning && Math.abs(this.x.value - cx) > 0.25)) this.x.animateTo(cx, S_TRAVEL);
          if (Math.abs(this.w.target - tw) > 0.25 || (!this.w.isRunning && Math.abs(this.w.value - tw) > 0.25)) this.w.animateTo(tw, S_STRETCH);
        }
      }
      // «Pulsada» mientras se arrastra o mientras viaja lejos de su pestaña; quieta nunca se queda en lupa.
      const holding = this.dragging || (this.measured && this.x.isRunning && Math.abs(this.x.value - cx) > 8);
      if (holding !== this.holding) {
        this.holding = holding;
        this.press.animateTo(holding ? 1 : 0, holding ? spring(1, 1000) : spring(1, 600));
      }
      this.render();
    }

    render() {
      const P = PILL, vert = this.vert;
      const len = this._layout();
      const along = len + 2 * P.pad, cross = P.tabH + 2 * P.pad;
      const W = vert ? cross : along, H = vert ? along : cross;
      const f2 = (v) => `${v.toFixed(2)}px`;
      put(this.host, 'width', f2(W));
      put(this.host, 'height', f2(H));
      put(this.surface, 'width', f2(W));
      put(this.surface, 'height', f2(H));
      if (this.filter) this.filter.update(W, H);
      this.glow.paint(this.surfaceGlow, W, H);

      const p = clamp01(this.press.value);
      const accent = this.cAccent;
      const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)];

      put(this.row, 'width', f2(W - 2 * P.pad));
      put(this.row, 'height', f2(H - 2 * P.pad));
      for (let i = 0; i < this.n; i++) {
        const t = this.tabs[i], c = this.cloneTabs[i];
        const labW = vert ? 0 : (P.labelGap + this.natural[i]) * Math.max(0, this.expand[i].value);
        const color = css(mix(this.cContent, this.cOn, clamp01(this.tint[i].value)));
        const sq = this.squeeze[i].value, pop = this.pop[i].value;
        const alpha = clamp01(this.fade[i].value).toFixed(3);
        for (const [el, clone] of [[t, false], [c, true]]) {
          put(el.tab, vert ? 'top' : 'left', f2(this.lefts[i]));
          put(el.tab, vert ? 'height' : 'width', f2(this.widths[i]));
          put(el.tab, 'paddingLeft', f2(this.padX));
          put(el.tab, 'paddingRight', f2(this.padX));
          put(el.wrap, 'width', f2(labW));
          put(el.wrap, 'opacity', alpha);
          put(el.ico, 'transform', pop === 1 ? '' : `scale(${pop.toFixed(4)})`);
          // Pulsada, la copia se tiñe entera de acento; en reposo es igual que la fila de verdad.
          put(el.tab, 'color', clone && p > 0.01 ? css(accent) : color);
          if (!clone) put(el.tab, 'transform', sq === 1 ? '' : `scale(${sq.toFixed(4)})`);
        }
      }

      if (!this.measured) { put(this.lens, 'display', 'none'); put(this.hit, 'display', 'none'); return; }
      put(this.hit, 'display', '');
      // Lente: crece al pulsar y se estira con la velocidad del viaje (larga y fina al acelerar).
      const v = Math.min(Math.abs(this.x.velocity) / 5000, 0.22);
      const gAlong = Math.max(1, this.w.value * lerp(1, 1.18, p) * (1 + v));
      const gCross = Math.max(1, P.tabH * lerp(1, 1.3, p) * (1 - v * 0.45));
      const gw = vert ? gCross : gAlong, gh = vert ? gAlong : gCross;
      const lx = vert ? P.pad + (P.tabH - gw) / 2 : P.pad + this.x.value - gw / 2;
      const ly = vert ? P.pad + this.x.value - gh / 2 : P.pad + (P.tabH - gh) / 2;
      put(this.lens, 'display', '');
      put(this.lens, 'width', f2(gw));
      put(this.lens, 'height', f2(gh));
      put(this.lens, 'transform', `translate(${f2(lx)},${f2(ly)})`);
      const hw = vert ? P.tabH : this.w.value, hh = vert ? this.w.value : P.tabH;
      const hx = vert ? P.pad : P.pad + this.x.value - this.w.value / 2, hy = vert ? P.pad + this.x.value - this.w.value / 2 : P.pad;
      put(this.hit, 'width', f2(hw));
      put(this.hit, 'height', f2(hh));
      put(this.hit, 'transform', `translate(${f2(hx)},${f2(hy)})`);

      // La lente no refracta las pestañas de verdad (en nativo su fondo es la página + el cristal): hueco en la fila.
      put(this.row, 'clipPath', `path(evenodd, "M-4000 -4000H8000V8000H-4000Z ${roundRectPath(lx - P.pad, ly - P.pad, gw, gh)}")`);

      if (support.blur) {
        if (this.lensFilter) {
          const b = Math.max(16, Math.round((this.w.target * 1.18) / 8) * 8); // mapas a la medida de la lente pulsada, por tramos
          if (vert) this.lensFilter.build(P.tabH * 1.3, b, 10, 0.5, true);
          else this.lensFilter.build(b, P.tabH * 1.3, 10, 0.5, true);
          this.lensFilter.update(gw, gh, 14 * p);
        }
        const refr = this.lensFilter && p > 0.002;
        put(this.lens, backdropProp, backdrop(3 * (1 - p), 1.6, refr ? this.lensFilter.id : null));
        put(this.lens, 'backgroundColor', css(alphaOf(accent, accent[3] * (1 - 0.82 * p))));
        put(this.lensContent, 'filter', refr ? `url(#${this.lensFilter.id})` : 'none');
      } else {
        put(this.lens, 'backgroundColor', css(accent));
      }
      const rimA = 0.18 + 0.32 * p;
      this.lens.style.setProperty('--lbw-rim', `rgba(255,255,255,${rimA.toFixed(3)})`);
      this.lens.style.setProperty('--lbw-rim-end', `rgba(255,255,255,${(rimA * 0.6).toFixed(3)})`);
      put(this.lens, 'boxShadow', p > 0.002
        ? `0 4px ${(2 * sigma(24)).toFixed(1)}px rgba(0,0,0,${(0.1 * p).toFixed(3)}), inset 0 ${(8 * p).toFixed(2)}px ${(2 * sigma(8 * p)).toFixed(2)}px rgba(0,0,0,${(0.15 * p).toFixed(3)})`
        : 'none');

      // Copia de las pestañas alineada con la fila y ampliada ×1,12 alrededor de la lente al pulsar.
      const zoom = lerp(1, 1.12, p);
      put(this.clone, 'width', f2(W - 2 * P.pad));
      put(this.clone, 'height', f2(H - 2 * P.pad));
      put(this.clone, 'transformOrigin', vert ? `50% ${f2(this.x.value)}` : `${f2(this.x.value)} 50%`);
      put(this.clone, 'transform', `translate(${f2(P.pad - lx)},${f2(P.pad - ly)})${zoom === 1 ? '' : ` scale(${zoom.toFixed(4)})`}`);
    }

    destroy() {
      frameHooks.delete(this._frame);
      clearTimeout(this.releasedTimer);
      [this.filter, this.lensFilter].forEach((f) => f && f.destroy());
      this.host.textContent = '';
      this.host.classList.remove('lbw', 'lbp', 'lbp-v');
      this.host.style.width = '';
      this.host.style.height = '';
    }
  }

  /**
   * `Modifier.liquidGlass` para cualquier elemento redondeado que flote sobre el contenido (botones, avisos,
   * menús). Devuelve una función para retirarlo.
   */
  function liquidGlass(el, style, opts) {
    const s = Object.assign({}, GlassStyle.Dark, style || {});
    const radius = opts && opts.radius != null ? opts.radius : null;
    const filter = support.refraction ? new RimFilter(s.refractionHeight, s.refractionAmount, radius) : null;
    el.classList.add('lbw-glass', 'lbw-glass-el');
    paintGlass(el, s, filter, opts && opts.tint);
    const ro = new ResizeObserver(() => { if (filter) filter.update(el.offsetWidth, el.offsetHeight); });
    ro.observe(el);
    if (filter) filter.update(el.offsetWidth, el.offsetHeight);
    return () => { ro.disconnect(); if (filter) filter.destroy(); el.classList.remove('lbw-glass', 'lbw-glass-el'); };
  }

  return {
    create: (host, options) => new Bar(host, options),
    createPill: (host, options) => new Pill(host, options),
    liquidGlass,
    GlassStyle,
    Motion,
    support,
    spring,
    springEasing,
    version: '1.2.0',
    /**
     * Motor compartido para las piezas de cristal de liquidui.js (interruptor, deslizador, isla, hoja…).
     * No es API para las webs: úsalo solo desde componentes del repo liquidbar.
     */
    core: {
      clamp, clamp01, lerp, Anim, spring, tween, springEasing, FastOutSlowIn, EaseOut,
      kick, waitUntil, nextFrame,
      onFrame(fn) { frameHooks.add(fn); kick(); return () => frameHooks.delete(fn); },
      parseColor, css, alphaOf, over, put, sigma, support, backdropProp, backdrop, paintGlass,
      GlassStyle, RimFilter, LensFilter, Glow, elastic, iconNode, roundRectPath,
      svgEl, defs, rimSample, enc, newCanvas, nextId: () => ++uid,
    },
  };
});
