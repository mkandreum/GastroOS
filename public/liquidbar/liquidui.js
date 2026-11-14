/*!
 * LiquidUI web v1.0.0 — piezas de cristal líquido para móvil, sobre el motor de liquidbar.js (≥ 1.2.0).
 * Carga primero liquidbar.js y liquidbar.css; después liquidui.js y liquidui.css.
 *
 * Fase 1: segmented · toggle · slider · glassButton · glassChip · badge
 * Fase 2: island · fan · chartLens · searchMorph · contextMenu · pullRefresh · sheet
 *
 * Mismos muelles que la barra (dampingRatio, stiffness de Compose), mismo cristal (LiquidGlassStyle) y la
 * misma lupa: crece al pulsar, refracta el canto con arcoíris y, en las lentes que lo necesitan, amplía lo
 * que hay debajo. Refracción y aumento solo en Chromium; en Safari/Firefox, cristal desenfocado.
 * Cada pieza devuelve un controlador con `destroy()`.
 */
(function (root, factory) {
  const L = root.LiquidBar || (typeof require === 'function' ? require('./liquidbar.js') : null);
  const api = factory(L);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LiquidUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (LiquidBar) {
  'use strict';
  if (!LiquidBar || !LiquidBar.core) throw new Error('LiquidUI necesita liquidbar.js 1.2.0 o posterior cargado antes');
  const C = LiquidBar.core;
  const { clamp, clamp01, lerp, Anim, spring, tween, FastOutSlowIn, put, css, parseColor, alphaOf, sigma, support } = C;

  /* ───────────── utilidades ───────────── */

  const f2 = (v) => `${v.toFixed(2)}px`;
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)];
  const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };
  const haptic = (ms = 8) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (_) { /* sin vibración */ } };
  const style = (s) => Object.assign({}, C.GlassStyle.Dark, s || {});
  const rimVars = (node, a) => {
    node.style.setProperty('--lbw-rim', `rgba(255,255,255,${a.toFixed(3)})`);
    node.style.setProperty('--lbw-rim-end', `rgba(255,255,255,${(a * 0.6).toFixed(3)})`);
  };
  const lensShadow = (p) => (p > 0.002
    ? `0 4px ${(2 * sigma(24)).toFixed(1)}px rgba(0,0,0,${(0.12 * p).toFixed(3)}), inset 0 ${(8 * p).toFixed(2)}px ${(2 * sigma(8 * p)).toFixed(2)}px rgba(0,0,0,${(0.15 * p).toFixed(3)})`
    : 'none');
  const S = {
    travel: spring(0.62, 420), stretch: spring(0.5, 420), follow: spring(1, 1000), press: spring(1, 1000),
    release: spring(1, 600), scaleX: spring(0.6, 250), scaleY: spring(0.7, 250), pop: spring(0.4, 520),
    glow: spring(0.5, 300), toggle: spring(0.6, 500), sheet: spring(0.75, 300), drop: spring(0.45, 300),
  };

  /** Bucle de dibujo de una pieza: `render()` en cada fotograma mientras algo se anima. */
  class Piece {
    constructor() { this._off = C.onFrame(() => { if (!this.dead) this.render(); }); }
    render() {}
    destroy() { this.dead = true; this._off(); }
  }

  /**
   * Lupa que AMPLÍA lo de debajo además de refractar el canto (dispersion + depthEffect). Para backdrop-filter
   * y filter. Mapas generados a la medida de la lente pulsada; al pulsar, la escala sube de 0 a 1.
   */
  class MagnifyFilter {
    constructor() {
      this.id = `lui-mag-${C.nextId()}`;
      this.key = '';
      this.M = 1;
      const f = (this.el = C.svgEl('filter', {
        id: this.id, x: 0, y: 0, width: 1, height: 1,
        filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB',
      }, C.defs()));
      const iso = { r: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', g: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0', b: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0' };
      this.maps = [];
      this.disps = [];
      ['r', 'g', 'b'].forEach((ch) => {
        this.maps.push(C.svgEl('feImage', { preserveAspectRatio: 'none', x: 0, y: 0, width: 1, height: 1, result: `m${ch}` }, f));
        this.disps.push(C.svgEl('feDisplacementMap', { in: 'SourceGraphic', in2: `m${ch}`, scale: 0, xChannelSelector: 'R', yChannelSelector: 'G', result: `d${ch}` }, f));
        C.svgEl('feColorMatrix', { in: `d${ch}`, type: 'matrix', values: iso[ch], result: `c${ch}` }, f);
      });
      C.svgEl('feBlend', { in: 'cr', in2: 'cg', mode: 'screen', result: 'rg' }, f);
      C.svgEl('feBlend', { in: 'rg', in2: 'cb', mode: 'screen' }, f);
      this.w = this.h = this.s = -1;
    }
    /** zoom: aumento en el centro; band/amount: franja y desvío del canto (px); dispersion: arcoíris. */
    build(w, h, { zoom = 1.5, band = 10, amount = 14, dispersion = 0.5, radius = null } = {}) {
      w = Math.max(4, Math.round(w)); h = Math.max(4, Math.round(h));
      const key = `${w}|${h}|${zoom}|${band}|${amount}|${dispersion}|${radius}`;
      if (key === this.key) return;
      this.key = key;
      const hw = w / 2, hh = h / 2, r = Math.min(radius == null ? Math.min(hw, hh) : radius, Math.min(hw, hh));
      const k = 1 - 1 / zoom;
      const vals = [new Float32Array(w * h * 2), new Float32Array(w * h * 2), new Float32Array(w * h * 2)];
      let M = 0.0001;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const px = x + 0.5 - hw, py = y + 0.5 - hh, i = (y * w + x) * 2;
          const inside = C.rimSample(px, py, hw, hh, r, 1e9, false) !== null || Math.abs(px) < hw - r || Math.abs(py) < hh - r;
          if (!inside) continue;
          const rim = C.rimSample(px, py, hw, hh, r, Math.min(band, r), true);
          const I = dispersion * (px * py) / (hw * hh);
          const f = [1 + I, 1, 1 - I];
          for (let c = 0; c < 3; c++) {
            const dx = -px * k + (rim ? rim[0] * amount * f[c] : 0);
            const dy = -py * k + (rim ? rim[1] * amount * f[c] : 0);
            vals[c][i] = dx; vals[c][i + 1] = dy;
            M = Math.max(M, Math.abs(dx), Math.abs(dy));
          }
        }
      }
      this.M = M;
      vals.forEach((v, c) => {
        const cv = C.newCanvas(w, h), ctx = cv.getContext('2d'), img = ctx.createImageData(w, h);
        for (let j = 0; j < w * h; j++) {
          img.data[j * 4] = C.enc(v[j * 2] / M); img.data[j * 4 + 1] = C.enc(v[j * 2 + 1] / M);
          img.data[j * 4 + 2] = 128; img.data[j * 4 + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        this.maps[c].setAttribute('href', cv.toDataURL('image/png'));
      });
      this.s = -1;
    }
    /** Tamaño vivo de la lente y presión (0 → sin efecto, 1 → aumento y canto completos). */
    update(w, h, p) {
      if (w !== this.w || h !== this.h) {
        this.w = w; this.h = h;
        for (const e of [this.el, ...this.maps]) { e.setAttribute('width', w); e.setAttribute('height', h); }
      }
      const s = Math.round(2 * this.M * clamp01(p) * 100) / 100;
      if (s !== this.s) { this.s = s; this.disps.forEach((d) => d.setAttribute('scale', s)); }
    }
    destroy() { this.el.remove(); }
  }

  /** Pinta una lente: cuerpo (backdrop con aumento), relleno, filos y sombras según la presión. */
  function paintLens(node, filter, p, { fill, blur = 0, sat = 1.5 }) {
    if (support.blur) {
      const useF = filter && support.refraction && p > 0.002;
      put(node, C.backdropProp, C.backdrop(blur * (1 - p), sat, useF ? filter.id : null));
    }
    put(node, 'backgroundColor', css(fill));
    put(node, 'boxShadow', lensShadow(p));
    rimVars(node, 0.18 + 0.34 * p);
  }

  /** Arrastre de un dedo con captura; `move(dx, dy, e)`, `end(moved, e)` (también si se cancela). */
  function drag(target, { down, move, end, slop = 4, button = true }) {
    let id = null, sx = 0, sy = 0, lx = 0, ly = 0, moved = false;
    const onDown = (e) => {
      if (id !== null || (button && e.pointerType === 'mouse' && e.button !== 0)) return;
      if (down && down(e) === false) return;
      id = e.pointerId; sx = lx = e.clientX; sy = ly = e.clientY; moved = false;
      try { target.setPointerCapture(id); } catch (_) { /* sin captura */ }
    };
    const onMove = (e) => {
      if (e.pointerId !== id) return;
      if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) > slop) moved = true;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      if (move) move(dx, dy, e, moved);
    };
    const onEnd = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      if (end) end(moved, e, e.type === 'pointerup');
    };
    target.addEventListener('pointerdown', onDown);
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onEnd);
    target.addEventListener('pointercancel', onEnd);
    target.addEventListener('lostpointercapture', onEnd);
    return () => {
      target.removeEventListener('pointerdown', onDown);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onEnd);
      target.removeEventListener('pointercancel', onEnd);
      target.removeEventListener('lostpointercapture', onEnd);
    };
  }

  /** Pulsación larga: llama a `fire(e)` si el dedo se queda quieto `ms`. Devuelve una función para quitarla. */
  function longPress(target, ms, fire, { slop = 10 } = {}) {
    let t = 0, sx = 0, sy = 0, id = null;
    const cancel = () => { clearTimeout(t); id = null; };
    const down = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      id = e.pointerId; sx = e.clientX; sy = e.clientY;
      clearTimeout(t);
      t = setTimeout(() => { if (id !== null) { id = null; fire(e); } }, ms);
    };
    const mv = (e) => { if (e.pointerId === id && Math.hypot(e.clientX - sx, e.clientY - sy) > slop) cancel(); };
    target.addEventListener('pointerdown', down);
    target.addEventListener('pointermove', mv);
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => target.addEventListener(ev, cancel));
    const ctx = (e) => e.preventDefault();
    target.addEventListener('contextmenu', ctx);
    return () => {
      cancel();
      target.removeEventListener('pointerdown', down);
      target.removeEventListener('pointermove', mv);
      ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => target.removeEventListener(ev, cancel));
      target.removeEventListener('contextmenu', ctx);
    };
  }

  /** Copia los estilos calculados de un árbol a su clon (para sacarlo de su contenedor sin que cambie). */
  function copyStyles(src, dst) {
    const cs = getComputedStyle(src);
    for (let i = 0; i < cs.length; i++) { const k = cs[i]; dst.style.setProperty(k, cs.getPropertyValue(k)); }
    for (let i = 0; i < src.children.length && i < dst.children.length; i++) copyStyles(src.children[i], dst.children[i]);
  }

  /* ═════════════ 1 · Selector segmentado líquido ═════════════ */

  /**
   * La pestaña activa de la píldora como selector: lente de acento que viaja con spring(0.62, 420), se estira
   * con la velocidad y, al arrastrarla, crece ×1,15 · ×1,35 y se vuelve lupa con las etiquetas ampliadas ×1,12.
   */
  class Segmented extends Piece {
    constructor(host, o) {
      super();
      this.o = o = Object.assign({ items: [], selectedIndex: 0, height: 40, pad: 3 }, o);
      this.host = host;
      this.items = o.items.map((it) => (typeof it === 'string' ? { label: it } : it));
      this.n = this.items.length;
      this.sel = clamp(o.selectedIndex | 0, 0, this.n - 1);
      this.cAccent = parseColor(o.accent || '#0A84FF');
      this.cOn = parseColor(o.onAccent || '#FFFFFF');
      this.cContent = parseColor(o.content || 'rgba(255,255,255,0.78)');
      host.classList.add('lui-seg');
      host.textContent = '';
      host.setAttribute('role', 'tablist');
      put(host, 'height', `${o.height}px`);
      this.glass = el('div', 'lbw-glass lui-seg-glass', host);
      this.rim = support.refraction ? new C.RimFilter(12, 12) : null;
      C.paintGlass(this.glass, style(o.glass), this.rim);
      this.row = el('div', 'lui-seg-row', host);
      const make = (it, i, real) => {
        const b = el(real ? 'button' : 'span', 'lui-seg-item');
        if (real) { b.type = 'button'; b.setAttribute('role', 'tab'); }
        if (it.icon) b.appendChild(C.iconNode(it.icon));
        el('span', 'lui-seg-lab', b).textContent = it.label;
        return b;
      };
      this.btns = this.items.map((it, i) => {
        const b = make(it, i, true);
        b.addEventListener('click', () => this._emit(i));
        this.row.appendChild(b);
        return b;
      });
      this.lens = el('div', 'lbw-lens lui-seg-lens', host);
      this.lens.setAttribute('aria-hidden', 'true');
      this.lensC = el('div', 'lbw-lens-c', this.lens);
      this.clone = el('div', 'lui-seg-row lui-seg-clone', this.lensC);
      this.items.forEach((it, i) => this.clone.appendChild(make(it, i, false)));
      this.hit = el('div', 'lui-seg-hit', host);
      this.mag = support.refraction ? new MagnifyFilter() : null;
      this.x = new Anim(0, 0.25);
      this.press = new Anim(0);
      this.dragging = false;
      this.placed = false;
      this._undrag = drag(this.hit, {
        down: () => { this.dragging = true; C.kick(); },
        move: (dx) => { this.x.snapTo(clamp(this.x.value + dx, this.segW / 2, this.W - 2 * o.pad - this.segW / 2)); },
        end: (moved, e, up) => {
          this.dragging = false;
          if (up) this._emit(clamp(Math.floor(this.x.value / this.segW), 0, this.n - 1), true);
          C.kick();
        },
      });
      this._ro = new ResizeObserver(() => C.kick());
      this._ro.observe(host);
      this._sync();
      C.kick();
    }
    _emit(i, always) {
      const changed = i !== this.sel;
      this.sel = i;
      this._sync();
      if (changed) haptic();
      if ((changed || always) && this.o.onSelect) this.o.onSelect(i, this.items[i]);
      C.kick();
    }
    setSelected(i) { this.sel = clamp(i | 0, 0, this.n - 1); this._sync(); C.kick(); }
    get selectedIndex() { return this.sel; }
    _sync() { this.btns.forEach((b, i) => b.setAttribute('aria-selected', i === this.sel ? 'true' : 'false')); }
    render() {
      const o = this.o, W = (this.W = this.host.clientWidth), H = o.height, pad = o.pad;
      if (!W || !this.n) return;
      const segW = (this.segW = (W - 2 * pad) / this.n), segH = H - 2 * pad;
      put(this.glass, 'width', f2(W)); put(this.glass, 'height', f2(H));
      if (this.rim) this.rim.update(W, H);
      const cx = segW * (this.sel + 0.5);
      if (!this.placed) { this.x.snapTo(cx); this.placed = true; }
      else if (!this.dragging && Math.abs(this.x.target - cx) > 0.25) this.x.animateTo(cx, S.travel);
      const holding = this.dragging || (this.x.isRunning && Math.abs(this.x.value - cx) > 8);
      if (holding !== this.holding) { this.holding = holding; this.press.animateTo(holding ? 1 : 0, holding ? S.press : S.release); }
      const p = clamp01(this.press.value);
      const v = Math.min(Math.abs(this.x.velocity) / 5000, 0.22);
      const lw = segW * lerp(1, 1.15, p) * (1 + v), lh = segH * lerp(1, 1.35, p) * (1 - 0.45 * v);
      const lx = pad + this.x.value - lw / 2, ly = pad + (segH - lh) / 2;
      for (const r of [this.row, this.clone]) { put(r, 'width', f2(W - 2 * pad)); put(r, 'height', f2(segH)); }
      put(this.row, 'transform', `translate(${f2(pad)},${f2(pad)})`);
      put(this.row, 'clipPath', `path(evenodd, "M-4000 -4000H8000V8000H-4000Z ${C.roundRectPath(lx - pad, ly - pad, lw, lh)}")`);
      this.btns.forEach((b) => put(b, 'color', css(this.cContent)));
      put(this.lens, 'width', f2(lw)); put(this.lens, 'height', f2(lh));
      put(this.lens, 'transform', `translate(${f2(lx)},${f2(ly)})`);
      if (this.mag) { this.mag.build(segW * 1.15, segH * 1.35, { zoom: 1.12, band: 8, amount: 10 }); this.mag.update(lw, lh, p); }
      paintLens(this.lens, this.mag, p, { fill: alphaOf(this.cAccent, this.cAccent[3] * (1 - 0.82 * p)), blur: 3 });
      put(this.lensC, 'filter', this.mag && support.refraction && p > 0.002 ? `url(#${this.mag.id})` : 'none');
      put(this.clone, 'color', css(mix(this.cOn, this.cAccent, p)));
      put(this.clone, 'transform', `translate(${f2(pad - lx)},${f2(pad - ly)})`);
      put(this.hit, 'width', f2(segW)); put(this.hit, 'height', f2(segH));
      put(this.hit, 'transform', `translate(${f2(pad + this.x.value - segW / 2)},${f2(pad)})`);
    }
    destroy() { super.destroy(); this._undrag(); this._ro.disconnect(); [this.rim, this.mag].forEach((f) => f && f.destroy()); this.host.textContent = ''; }
  }

  /* ═════════════ 2 · Interruptor líquido ═════════════ */

  /**
   * Interruptor de 64×28. Al pulsar, la bolita blanca crece ×1,5 por encima del raíl y se vuelve una lupa que
   * amplía el raíl; se arrastra, se estira con la velocidad y rebota al llegar con spring(0.6, 500).
   */
  class Toggle extends Piece {
    constructor(host, o) {
      super();
      this.o = o = Object.assign({ checked: false, accent: '#34C759', off: 'rgba(120,120,128,0.36)' }, o);
      this.host = host;
      this.checked = !!o.checked;
      this.cOn = parseColor(o.accent); this.cOff = parseColor(o.off);
      host.classList.add('lui-toggle');
      host.textContent = '';
      if (host.tagName !== 'BUTTON') host.tabIndex = 0;
      host.setAttribute('role', 'switch');
      if (o.label) host.setAttribute('aria-label', o.label);
      this.track = el('span', 'lui-tg-track', host);
      this.thumb = el('span', 'lbw-lens lui-tg-thumb', host);
      this.mag = support.refraction ? new MagnifyFilter() : null;
      this.pos = new Anim(this.checked ? 1 : 0);
      this.press = new Anim(0);
      this.sx = new Anim(1); this.sy = new Anim(1);
      let start = 0;
      this._undrag = drag(host, {
        down: () => { start = this.pos.value; this._press(true); },
        move: (dx, dy, e, moved) => { if (moved) this.pos.snapTo(clamp(this.pos.value + dx / 22, 0, 1)); },
        end: (moved, e, up) => {
          const to = !up ? this.checked : moved ? this.pos.value > 0.5 : !this.checked;
          this._set(to, true);
        },
      });
      this._key = (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); this._set(!this.checked, true); } };
      host.addEventListener('keydown', this._key);
      this._aria();
      C.kick();
    }
    _press(on) {
      this.press.animateTo(on ? 1 : 0, on ? S.press : S.release);
      this.sx.animateTo(on ? 1.5 : 1, S.scaleX);
      this.sy.animateTo(on ? 1.5 : 1, S.scaleY);
    }
    _set(v, user) {
      const changed = v !== this.checked;
      this.checked = v;
      this._aria();
      const target = v ? 1 : 0;
      this.pos.animateTo(target, S.toggle);
      // Suelta la lupa cuando la bolita casi ha llegado (como LensDrag.release).
      const tok = (this._tok = (this._tok || 0) + 1);
      C.waitUntil(() => Math.abs(this.pos.value - target) < 0.08, () => tok !== this._tok).then((ok) => { if (ok) this._press(false); });
      if (changed) { haptic(10); if (user && this.o.onChange) this.o.onChange(v); }
    }
    setChecked(v) { this._set(!!v, false); }
    _aria() { this.host.setAttribute('aria-checked', this.checked ? 'true' : 'false'); }
    render() {
      const W = 64, H = 28, tw = 38, th = 24, inset = 2;
      const p = clamp01(this.press.value), pos = this.pos.value;
      const v = clamp(this.pos.velocity / 12, -0.2, 0.2);
      const w = tw * this.sx.value * (1 + Math.abs(v)), h = th * this.sy.value * (1 - 0.4 * Math.abs(v));
      const cx = inset + tw / 2 + pos * (W - 2 * inset - tw), cy = H / 2;
      put(this.track, 'backgroundColor', css(mix(this.cOff, this.cOn, clamp01(pos))));
      put(this.thumb, 'width', f2(w)); put(this.thumb, 'height', f2(h));
      put(this.thumb, 'transform', `translate(${f2(cx - w / 2)},${f2(cy - h / 2)})`);
      if (this.mag) { this.mag.build(tw * 1.5, th * 1.5, { zoom: 1.35, band: 8, amount: 9 }); this.mag.update(w, h, p); }
      paintLens(this.thumb, this.mag, p, { fill: [255, 255, 255, 1 - 0.9 * p], blur: 0, sat: 1.3 });
      put(this.thumb, 'boxShadow', p > 0.002 ? lensShadow(p) : '0 2px 6px rgba(0,0,0,.18), 0 0 0 .5px rgba(0,0,0,.04)');
    }
    destroy() { super.destroy(); this._undrag(); this.host.removeEventListener('keydown', this._key); if (this.mag) this.mag.destroy(); this.host.textContent = ''; }
  }

  /* ═════════════ 3 · Deslizador de cristal ═════════════ */

  /**
   * Deslizador: la bolita es una lente que, mientras arrastras, crece a 58×38, amplía ×1,6 el raíl y sus marcas y
   * enseña el valor en una burbuja. Toque en el raíl: la bolita viaja con spring(0.62, 420).
   */
  class Slider extends Piece {
    constructor(host, o) {
      super();
      this.o = o = Object.assign({ min: 0, max: 100, step: 1, value: 0, ticks: 0, accent: '#0A84FF', track: 'rgba(120,120,128,0.32)', format: (v) => String(v) }, o);
      this.host = host;
      host.classList.add('lui-slider');
      host.textContent = '';
      host.tabIndex = 0;
      host.setAttribute('role', 'slider');
      if (o.label) host.setAttribute('aria-label', o.label);
      host.setAttribute('aria-valuemin', o.min); host.setAttribute('aria-valuemax', o.max);
      this.trackEl = el('div', 'lui-sl-track', host);
      put(this.trackEl, 'backgroundColor', o.track);
      this.fill = el('div', 'lui-sl-fill', this.trackEl);
      put(this.fill, 'backgroundColor', o.accent);
      this.ticksEl = el('div', 'lui-sl-ticks', host);
      const nt = Array.isArray(o.ticks) ? o.ticks.length : o.ticks;
      for (let i = 0; i < nt; i++) {
        const t = el('span', 'lui-sl-tick', this.ticksEl);
        put(t, 'left', `${(i / Math.max(1, nt - 1)) * 100}%`);
        if (Array.isArray(o.ticks)) el('em', '', t).textContent = o.ticks[i];
      }
      this.thumb = el('div', 'lbw-lens lui-sl-thumb', host);
      this.bubble = el('div', 'lbw-glass lui-sl-bubble', host);
      this.bubbleTxt = el('span', '', this.bubble);
      C.paintGlass(this.bubble, style(o.glass), null);
      this.mag = support.refraction ? new MagnifyFilter() : null;
      this.value = this._snap(o.value);
      this.f = new Anim(this._frac(this.value), 0.0005);
      this.press = new Anim(0);
      this.sx = new Anim(1); this.sy = new Anim(1);
      const fracAt = (e) => { const r = this.trackEl.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1); };
      this._undrag = drag(host, {
        down: (e) => { this._press(true); this.f.animateTo(fracAt(e), S.travel); this._update(fracAt(e), false); },
        move: (dx, dy, e) => { const fr = fracAt(e); this.f.animateTo(fr, S.follow); this._update(fr, false); },
        end: () => { this._press(false); this.f.animateTo(this._frac(this.value), S.travel); if (o.onChange) o.onChange(this.value); },
      });
      this._key = (e) => {
        const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
        if (!d) return;
        e.preventDefault();
        this._update(this._frac(this.value + d * o.step), true);
        this.f.animateTo(this._frac(this.value), S.travel);
      };
      host.addEventListener('keydown', this._key);
      this._aria();
      C.kick();
    }
    _frac(v) { return (v - this.o.min) / (this.o.max - this.o.min || 1); }
    _snap(v) { const o = this.o; return clamp(Math.round((v - o.min) / o.step) * o.step + o.min, o.min, o.max); }
    _update(fr, commit) {
      const v = this._snap(this.o.min + fr * (this.o.max - this.o.min));
      if (v !== this.value) { this.value = v; this._aria(); if (this.o.step >= (this.o.max - this.o.min) / 40) haptic(4); if (this.o.onInput) this.o.onInput(v); }
      if (commit && this.o.onChange) this.o.onChange(v);
    }
    _press(on) {
      this.press.animateTo(on ? 1 : 0, on ? S.press : S.release);
      this.sx.animateTo(on ? 58 / 28 : 1, S.scaleX);
      this.sy.animateTo(on ? 38 / 28 : 1, S.scaleY);
    }
    setValue(v) { this.value = this._snap(v); this._aria(); this.f.animateTo(this._frac(this.value), S.travel); }
    _aria() { this.host.setAttribute('aria-valuenow', this.value); this.host.setAttribute('aria-valuetext', this.o.format(this.value)); }
    render() {
      const W = this.host.clientWidth, H = 44;
      if (!W) return;
      const pad = 14, tw = W - 2 * pad, fr = clamp01(this.f.value), p = clamp01(this.press.value);
      put(this.trackEl, 'width', f2(tw)); put(this.trackEl, 'left', f2(pad));
      put(this.ticksEl, 'width', f2(tw)); put(this.ticksEl, 'left', f2(pad));
      put(this.fill, 'width', f2(tw * fr));
      const v = clamp(this.f.velocity / 8, -0.2, 0.2);
      const w = 28 * this.sx.value * (1 + Math.abs(v)), h = 28 * this.sy.value * (1 - 0.4 * Math.abs(v));
      const cx = pad + tw * fr, cy = H / 2;
      put(this.thumb, 'width', f2(w)); put(this.thumb, 'height', f2(h));
      put(this.thumb, 'transform', `translate(${f2(cx - w / 2)},${f2(cy - h / 2)})`);
      if (this.mag) { this.mag.build(58, 38, { zoom: 1.6, band: 9, amount: 11 }); this.mag.update(w, h, p); }
      paintLens(this.thumb, this.mag, p, { fill: [255, 255, 255, 1 - 0.92 * p], blur: 0, sat: 1.4 });
      put(this.thumb, 'boxShadow', p > 0.002 ? lensShadow(p) : '0 2px 8px rgba(0,0,0,.22), 0 0 0 .5px rgba(0,0,0,.05)');
      this.bubbleTxt.textContent = this.o.format(this.value);
      const bw = this.bubble.offsetWidth || 40;
      put(this.bubble, 'opacity', p.toFixed(3));
      put(this.bubble, 'transform', `translate(${f2(cx - bw / 2)},${f2(-30 - 8 * p)}) scale(${lerp(0.6, 1, p).toFixed(3)})`);
    }
    destroy() { super.destroy(); this._undrag(); this.host.removeEventListener('keydown', this._key); if (this.mag) this.mag.destroy(); this.host.textContent = ''; }
  }

  /* ═════════════ 4 · Botón de cristal ═════════════ */

  /**
   * Convierte un botón en cristal líquido: canto refractado, brillo bajo el dedo (GlassGlow) y estiramiento
   * elástico al pulsar y arrastrar, con el acento como tinte que sube al pulsar.
   */
  class GlassButton extends Piece {
    constructor(node, o) {
      super();
      this.o = o = Object.assign({ strength: 1 }, o);
      this.node = node;
      this.s = style(o.glass);
      node.classList.add('lui-gbtn');
      this.rim = support.refraction ? new C.RimFilter(Math.min(this.s.refractionHeight, 16), Math.min(this.s.refractionAmount, 16), o.radius) : null;
      this.glowEl = el('span', 'lbw-glow', node);
      this.glow = new C.Glow();
      this.glow.bind(node);
      this.tint = o.tint ? parseColor(o.tint) : null;
      this.lastP = -1;
      C.kick();
    }
    render() {
      const n = this.node, w = n.offsetWidth, h = n.offsetHeight;
      if (this.rim) this.rim.update(w, h);
      const p = this.glow.p;
      if (Math.abs(p - this.lastP) > 0.01 || this.lastP < 0) {
        this.lastP = p;
        C.paintGlass(n, this.s, this.rim, this.tint ? css(alphaOf(this.tint, this.tint[3] * lerp(0.16, 0.34, p))) : null);
      }
      put(n, 'transform', C.elastic(this.glow, w, h, this.o.strength).trim());
      this.glow.paint(this.glowEl, w, h);
    }
    destroy() { super.destroy(); if (this.rim) this.rim.destroy(); this.glowEl.remove(); this.node.classList.remove('lui-gbtn'); }
  }

  /* ═════════════ 5 · Chips de cristal sobre fotos ═════════════ */

  /** Etiqueta de cristal (canto de 10 px) que entra con un «pop» spring(0.5, 420), escalonable con `delay`. */
  function glassChip(node, o = {}) {
    const s = style(Object.assign({ refractionHeight: 10, refractionAmount: 10, blur: 6 }, o.glass));
    node.classList.add('lui-chip');
    const off = LiquidBar.liquidGlass(node, s, { tint: o.tint });
    if (o.pop !== false) {
      const a = new Anim(0.6);
      put(node, 'opacity', '0');
      const stop = C.onFrame(() => {
        put(node, 'transform', `scale(${a.value.toFixed(4)})`);
        put(node, 'opacity', clamp01((a.value - 0.6) / 0.3).toFixed(3));
      });
      setTimeout(() => a.animateTo(1, spring(0.5, 420)).then((ok) => { if (ok) { stop(); put(node, 'transform', ''); put(node, 'opacity', '1'); } }), o.delay || 0);
      return { destroy() { stop(); off(); } };
    }
    return { destroy: off };
  }

  /* ═════════════ 6 · Insignia que salta ═════════════ */

  /**
   * Contador que aparece con spring(0.4, 520) como el icono de la barra; al cambiar se aplasta y suelta una
   * gotita que sube y se desvanece.
   */
  class Badge extends Piece {
    constructor(node, o) {
      super();
      this.o = o = Object.assign({ value: 0, max: 99, color: '#FF3B30' }, o);
      this.node = node;
      node.classList.add('lui-badge');
      put(node, 'backgroundColor', o.color);
      this.txt = el('span', 'lui-badge-txt', node);
      this.scale = new Anim(o.value ? 1 : 0, 0.002);
      this.squash = new Anim(1);
      this.drops = [];
      this.value = o.value;
      this._text();
      C.kick();
    }
    _text() { const v = this.value; this.txt.textContent = v === true ? '' : v > this.o.max ? `${this.o.max}+` : String(v); this.node.classList.toggle('lui-badge-dot', this.value === true); }
    set(v) {
      const prev = this.value;
      this.value = v;
      if (!v) { this.scale.animateTo(0, spring(0.8, 600)); return; }
      this._text();
      if (!prev) { this.scale.snapTo(0); this.scale.animateTo(1, S.pop); return; }
      if (v === prev) return;
      this.squash.snapTo(1.28);
      this.squash.animateTo(1, S.pop);
      // gotita que se separa
      const d = el('span', 'lui-badge-drop', this.node.parentNode || document.body);
      put(d, 'backgroundColor', this.o.color);
      const a = new Anim(0);
      const r = this.node.getBoundingClientRect(), pr = (this.node.offsetParent || document.body).getBoundingClientRect();
      const drop = { d, a, x: r.left - pr.left + r.width / 2, y: r.top - pr.top + r.height / 2 };
      this.drops.push(drop);
      a.animateTo(1, spring(0.7, 220)).then(() => { d.remove(); this.drops = this.drops.filter((x) => x !== drop); });
    }
    render() {
      const s = Math.max(0, this.scale.value), q = this.squash.value;
      put(this.node, 'transform', s === 1 && q === 1 ? '' : `scale(${(s * q).toFixed(4)},${(s * (2 - q)).toFixed(4)})`);
      put(this.node, 'visibility', s <= 0.001 ? 'hidden' : 'visible');
      for (const { d, a, x, y } of this.drops) {
        const t = a.value;
        put(d, 'transform', `translate(${f2(x - 4)},${f2(y - 4 - 22 * t)}) scale(${lerp(0.9, 0.3, t).toFixed(3)})`);
        put(d, 'opacity', (1 - t).toFixed(3));
      }
    }
  }

  /* ═════════════ 7 · Isla líquida ═════════════ */

  /**
   * Píldora arriba que muestra un estado vivo. Crece con muelles desfasados: primero el ancho
   * (spring 0.62, 380) y 70 ms después el alto (spring 0.7, 300); al irse, al revés.
   */
  class Island extends Piece {
    constructor(o) {
      super();
      this.o = o = Object.assign({ glass: null, top: 10 }, o);
      this.node = el('div', 'lbw-glass lui-island', document.body);
      this.node.setAttribute('role', 'status');
      this.node.setAttribute('aria-live', 'polite');
      put(this.node, 'top', `calc(env(safe-area-inset-top, 0px) + ${o.top}px)`);
      this.s = style(o.glass);
      this.rim = support.refraction ? new C.RimFilter(14, 14) : null;
      C.paintGlass(this.node, this.s, this.rim);
      this.content = el('div', 'lui-island-c', this.node);
      this.icon = el('span', 'lui-island-ico', this.content);
      const txt = el('div', 'lui-island-t', this.content);
      this.title = el('strong', '', txt);
      this.text = el('span', '', txt);
      this.meter = el('div', 'lui-island-c lui-island-meter', document.body);
      this.w = new Anim(36, 0.25); this.h = new Anim(36, 0.25); this.y = new Anim(-70, 0.25); this.fade = new Anim(0);
      this.node.addEventListener('click', () => { if (this.cur && this.cur.onTap) this.cur.onTap(); });
      this.glow = new C.Glow();
      this.glowEl = el('span', 'lbw-glow', this.node);
      this.glow.bind(this.node);
      put(this.node, 'visibility', 'hidden');
    }
    /** show({ title, text?, icon?, accent?, duration? (ms, 0 = fija), onTap? }) */
    show(m) {
      clearTimeout(this.timer);
      this.cur = m;
      this.icon.innerHTML = '';
      if (m.icon) this.icon.appendChild(C.iconNode(m.icon));
      put(this.icon, 'color', m.accent || '#30D158');
      put(this.icon, 'display', m.icon ? '' : 'none');
      this.title.textContent = m.title || '';
      this.text.textContent = m.text || '';
      this.meter.innerHTML = this.content.innerHTML;
      const tw = Math.min(window.innerWidth - 24, Math.ceil(this.meter.getBoundingClientRect().width) + 28);
      const th = m.text ? 60 : 40;
      put(this.node, 'visibility', 'visible');
      this.y.animateTo(0, spring(0.6, 400));
      this.w.animateTo(tw, spring(0.62, 380));
      setTimeout(() => { if (this.cur === m) this.h.animateTo(th, spring(0.7, 300)); }, 70);
      setTimeout(() => { if (this.cur === m) this.fade.animateTo(1, spring(1, 400)); }, 140);
      haptic(12);
      const dur = m.duration == null ? 3200 : m.duration;
      if (dur > 0) this.timer = setTimeout(() => this.hide(), dur);
      C.kick();
    }
    hide() {
      clearTimeout(this.timer);
      const m = (this.cur = null);
      this.fade.animateTo(0, spring(1, 600));
      this.h.animateTo(36, spring(0.8, 360));
      setTimeout(() => { if (this.cur === m) this.w.animateTo(36, spring(0.8, 360)); }, 90);
      setTimeout(() => { if (this.cur === m) this.y.animateTo(-70, spring(0.9, 300)).then((ok) => { if (ok && !this.cur) put(this.node, 'visibility', 'hidden'); }); }, 220);
    }
    render() {
      const w = this.w.value, h = this.h.value;
      put(this.node, 'width', f2(w)); put(this.node, 'height', f2(h));
      put(this.node, 'transform', `translate(-50%,${f2(this.y.value)})${C.elastic(this.glow, w, h, 0.6)}`);
      if (this.rim) this.rim.update(w, h);
      put(this.content, 'opacity', clamp01(this.fade.value).toFixed(3));
      this.glow.paint(this.glowEl, w, h);
    }
  }
  let islandSingleton = null;
  const island = (o) => islandSingleton || (islandSingleton = new Island(o));

  /* ═════════════ 8 · Abanico de burbujas ═════════════ */

  /**
   * Mantén pulsado el botón (+): salen burbujas de cristal en arco, escalonadas 30 ms con spring(0.55, 380).
   * Arrastra el dedo hasta una: se hincha ×1,25 y se vuelve lupa; suelta para elegirla. Toque normal = click.
   */
  class Fan extends Piece {
    constructor(button, o) {
      super();
      this.o = o = Object.assign({ items: [], radius: 104, angles: [180, 270], size: 54, hold: 280 }, o);
      this.button = button;
      this.layer = el('div', 'lui-fan-layer', document.body);
      this.dim = el('div', 'lui-fan-dim', this.layer);
      this.bubbles = o.items.map((it) => {
        const b = el('div', 'lbw-lens lui-fan-bubble', this.layer);
        b.appendChild(C.iconNode(it.icon));
        const lab = el('div', 'lbw-glass lui-fan-label', this.layer);
        lab.textContent = it.label;
        C.paintGlass(lab, style(o.glass), null);
        const t = new Anim(0, 0.002), hov = new Anim(0);
        const mag = support.refraction ? new MagnifyFilter() : null;
        return { it, b, lab, t, hov, mag };
      });
      this.s = style(o.glass);
      this.open = new Anim(0);
      this.active = false;
      this.hover = -1;
      this._unlp = longPress(button, o.hold, (e) => this._openAt());
      this._move = (e) => { if (this.active) this._hoverAt(e.clientX, e.clientY); };
      this._up = (e) => { if (!this.active) return; this._close(e.type === 'pointerup' ? this.hover : -1); };
      button.addEventListener('pointermove', this._move);
      button.addEventListener('pointerup', this._up);
      button.addEventListener('pointercancel', this._up);
      this._click = (e) => { if (this.swallow) { e.preventDefault(); e.stopImmediatePropagation(); this.swallow = false; } };
      button.addEventListener('click', this._click, true);
      put(this.layer, 'display', 'none');
    }
    _openAt() {
      const r = this.button.getBoundingClientRect();
      this.cx = r.left + r.width / 2; this.cy = r.top + r.height / 2;
      this.active = true; this.swallow = true;
      put(this.layer, 'display', '');
      this.open.animateTo(1, spring(1, 500));
      this.bubbles.forEach((bb, i) => setTimeout(() => { if (this.active) bb.t.animateTo(1, spring(0.55, 380)); }, i * 30));
      haptic(14);
      C.kick();
    }
    _pos(i) {
      const o = this.o, n = this.bubbles.length;
      const a = ((o.angles[0] + (n === 1 ? 0.5 : i / (n - 1)) * (o.angles[1] - o.angles[0])) * Math.PI) / 180;
      return { x: this.cx + Math.cos(a) * o.radius, y: this.cy + Math.sin(a) * o.radius };
    }
    _hoverAt(x, y) {
      let best = -1, bd = this.o.size * 0.9;
      this.bubbles.forEach((bb, i) => { const p = this._pos(i), d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = i; } });
      if (best !== this.hover) {
        if (this.hover >= 0) this.bubbles[this.hover].hov.animateTo(0, spring(0.6, 420));
        if (best >= 0) { this.bubbles[best].hov.animateTo(1, spring(0.5, 400)); haptic(6); }
        this.hover = best;
      }
    }
    _close(pick) {
      this.active = false;
      if (pick >= 0) { const it = this.bubbles[pick].it; haptic(12); setTimeout(() => (it.onSelect || this.o.onSelect || (() => {}))(it, pick), 60); }
      this.open.animateTo(0, spring(1, 500));
      const n = this.bubbles.length;
      this.bubbles.forEach((bb, i) => setTimeout(() => {
        bb.hov.animateTo(0, spring(0.8, 500));
        bb.t.animateTo(0, spring(0.8, 420)).then((ok) => { if (ok && !this.active && i === 0) put(this.layer, 'display', 'none'); });
      }, (n - 1 - i) * 22));
      this.hover = -1;
      setTimeout(() => { this.swallow = false; }, 400);
    }
    render() {
      if (this.layer.style.display === 'none') return;
      put(this.dim, 'opacity', (0.28 * clamp01(this.open.value)).toFixed(3));
      const sz = this.o.size;
      this.bubbles.forEach((bb, i) => {
        const t = bb.t.value, hv = clamp01(bb.hov.value), p = this._pos(i);
        const x = lerp(this.cx, p.x, t), y = lerp(this.cy, p.y, t);
        const s = Math.max(0.01, lerp(0.3, 1, t) * lerp(1, 1.25, hv)), d = sz * s;
        put(bb.b, 'width', f2(d)); put(bb.b, 'height', f2(d));
        put(bb.b, 'transform', `translate(${f2(x - d / 2)},${f2(y - d / 2)})`);
        put(bb.b, 'opacity', clamp01(t * 1.6).toFixed(3));
        if (bb.mag) { bb.mag.build(sz * 1.25, sz * 1.25, { zoom: 1.3, band: 10, amount: 12 }); bb.mag.update(d, d, hv); }
        if (support.blur) put(bb.b, C.backdropProp, C.backdrop(6 * (1 - hv), 1.6, bb.mag && hv > 0.002 && support.refraction ? bb.mag.id : null));
        put(bb.b, 'backgroundColor', css(parseColor(this.s.surface)));
        rimVars(bb.b, 0.22 + 0.3 * hv);
        put(bb.b, 'boxShadow', `0 6px 20px rgba(0,0,0,${(0.18 + 0.1 * hv).toFixed(3)})${hv > 0.01 ? `, inset 0 ${(6 * hv).toFixed(1)}px ${(10 * hv).toFixed(1)}px rgba(0,0,0,${(0.12 * hv).toFixed(3)})` : ''}`);
        const lw = bb.lab.offsetWidth;
        put(bb.lab, 'opacity', (clamp01(t) * hv).toFixed(3));
        put(bb.lab, 'transform', `translate(${f2(x - lw / 2)},${f2(y - d / 2 - 30 - 4 * hv)})`);
      });
    }
    destroy() {
      super.destroy(); this._unlp();
      this.button.removeEventListener('pointermove', this._move);
      this.button.removeEventListener('pointerup', this._up);
      this.button.removeEventListener('pointercancel', this._up);
      this.button.removeEventListener('click', this._click, true);
      this.bubbles.forEach((bb) => bb.mag && bb.mag.destroy());
      this.layer.remove();
    }
  }

  /* ═════════════ 9 · Lupa para gráficas ═════════════ */

  /**
   * Mantén pulsado sobre una gráfica: una lupa de 104 px amplía ×1,8 el punto y una burbuja enseña su valor.
   * `valueAt(x, rect)` devuelve { label, value, y? } (y en px dentro del contenedor centra la lupa en el dato).
   */
  class ChartLens extends Piece {
    constructor(container, o) {
      super();
      this.o = o = Object.assign({ size: 104, zoom: 1.8, hold: 220 }, o);
      this.c = container;
      container.classList.add('lui-chart');
      this.lens = el('div', 'lbw-lens lui-chart-lens', document.body);
      this.bubble = el('div', 'lbw-glass lui-chart-bubble', document.body);
      C.paintGlass(this.bubble, style(o.glass), null);
      this.mag = support.refraction ? new MagnifyFilter() : null;
      this.x = new Anim(0, 0.2); this.y = new Anim(0, 0.2); this.p = new Anim(0);
      this.active = false;
      this._unlp = longPress(container, o.hold, (e) => { this.active = true; this._at(e, true); this.p.animateTo(1, spring(0.6, 380)); haptic(10); });
      this._mv = (e) => { if (this.active) this._at(e, false); };
      this._end = () => { if (!this.active) return; this.active = false; this.p.animateTo(0, spring(1, 500)); };
      this._tm = (e) => { if (this.active) e.preventDefault(); };
      container.addEventListener('pointermove', this._mv);
      ['pointerup', 'pointercancel'].forEach((ev) => container.addEventListener(ev, this._end));
      container.addEventListener('touchmove', this._tm, { passive: false });
      put(this.lens, 'display', 'none');
    }
    _at(e, snap) {
      const r = this.c.getBoundingClientRect();
      const x = clamp(e.clientX, r.left, r.right);
      const info = this.o.valueAt ? this.o.valueAt(x - r.left, r) : null;
      const y = info && info.y != null ? r.top + info.y : e.clientY;
      this.info = info;
      if (snap) { this.x.snapTo(x); this.y.snapTo(y); } else { this.x.animateTo(x, spring(0.8, 700)); this.y.animateTo(y, spring(0.8, 700)); }
      if (info && info.key !== this.lastKey) { this.lastKey = info.key; haptic(3); }
      C.kick();
    }
    render() {
      const p = clamp01(this.p.value);
      put(this.lens, 'display', p > 0.002 ? '' : 'none');
      put(this.bubble, 'display', p > 0.002 ? '' : 'none');
      if (p <= 0.002) return;
      const d = this.o.size * lerp(0.4, 1, p);
      put(this.lens, 'width', f2(d)); put(this.lens, 'height', f2(d));
      put(this.lens, 'transform', `translate(${f2(this.x.value - d / 2)},${f2(this.y.value - d / 2)})`);
      if (this.mag) { this.mag.build(this.o.size, this.o.size, { zoom: this.o.zoom, band: 12, amount: 14 }); this.mag.update(d, d, p); }
      paintLens(this.lens, this.mag, p, { fill: [255, 255, 255, 0.04 * p], blur: 0, sat: 1.15 });
      const i = this.info;
      this.bubble.innerHTML = i ? `<strong>${i.value ?? ''}</strong>${i.label ? `<span>${i.label}</span>` : ''}` : '';
      const bw = this.bubble.offsetWidth;
      put(this.bubble, 'opacity', p.toFixed(3));
      put(this.bubble, 'transform', `translate(${f2(clamp(this.x.value - bw / 2, 8, window.innerWidth - bw - 8))},${f2(this.y.value - d / 2 - 46)})`);
    }
    destroy() {
      super.destroy(); this._unlp();
      this.c.removeEventListener('pointermove', this._mv);
      ['pointerup', 'pointercancel'].forEach((ev) => this.c.removeEventListener(ev, this._end));
      this.c.removeEventListener('touchmove', this._tm);
      if (this.mag) this.mag.destroy();
      this.lens.remove(); this.bubble.remove();
    }
  }

  /* ═════════════ 10 · Buscar que se transforma ═════════════ */

  /**
   * Círculo de buscar que se estira con spring(0.7, 300) hasta campo de texto de cristal (y vuelve).
   * Pensado para el círculo a la derecha de la barra: en `onOpen` pliega la barra (bar.fold()).
   */
  class SearchMorph extends Piece {
    constructor(host, o) {
      super();
      this.o = o = Object.assign({ placeholder: 'Buscar', size: 56, width: null }, o);
      this.host = host;
      host.classList.add('lui-search');
      host.textContent = '';
      this.s = style(o.glass);
      this.rim = support.refraction ? new C.RimFilter(this.s.refractionHeight, this.s.refractionAmount) : null;
      this.glass = el('div', 'lbw-glass lui-search-glass', host);
      C.paintGlass(this.glass, this.s, this.rim);
      this.btn = el('button', 'lui-search-btn', host);
      this.btn.type = 'button';
      this.btn.setAttribute('aria-label', o.placeholder);
      this.btn.appendChild(C.iconNode(o.icon || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'));
      this.input = el('input', 'lui-search-input', host);
      this.input.type = 'search';
      this.input.placeholder = o.placeholder;
      this.input.setAttribute('aria-label', o.placeholder);
      this.x = el('button', 'lui-search-x', host);
      this.x.type = 'button';
      this.x.setAttribute('aria-label', 'Cerrar búsqueda');
      this.x.appendChild(C.iconNode('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>'));
      this.w = new Anim(o.size, 0.25); this.t = new Anim(0);
      this.glow = new C.Glow(); this.glowEl = el('span', 'lbw-glow', this.glass); this.glow.bind(this.btn);
      this.btn.addEventListener('click', () => (this.isOpen ? this.o.onSubmit && this.o.onSubmit(this.input.value) : this.open()));
      this.x.addEventListener('click', () => this.close());
      this.input.addEventListener('input', () => o.onInput && o.onInput(this.input.value));
      this.input.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); if (e.key === 'Enter' && o.onSubmit) o.onSubmit(this.input.value); });
      put(host, 'height', `${o.size}px`);
      this.isOpen = false;
      C.kick();
    }
    open() {
      if (this.isOpen) return;
      this.isOpen = true;
      const target = this.o.width ? (typeof this.o.width === 'function' ? this.o.width() : this.o.width) : (this.host.parentElement ? this.host.parentElement.clientWidth : 320);
      this.w.animateTo(Math.max(this.o.size, target), spring(0.7, 300));
      this.t.animateTo(1, spring(1, 420));
      setTimeout(() => this.input.focus({ preventScroll: true }), 120);
      if (this.o.onOpen) this.o.onOpen();
      haptic();
    }
    close() {
      if (!this.isOpen) return;
      this.isOpen = false;
      this.input.blur();
      this.t.animateTo(0, spring(1, 600));
      this.w.animateTo(this.o.size, spring(0.72, 320));
      if (this.o.onClose) this.o.onClose();
    }
    render() {
      const w = this.w.value, h = this.o.size, t = clamp01(this.t.value);
      put(this.host, 'width', f2(w));
      put(this.glass, 'width', f2(w)); put(this.glass, 'height', f2(h));
      put(this.glass, 'transform', C.elastic(this.glow, w, h, 0.8).trim());
      if (this.rim) this.rim.update(w, h);
      this.glow.paint(this.glowEl, w, h);
      put(this.input, 'opacity', t.toFixed(3));
      put(this.input, 'width', f2(Math.max(0, w - h - 44)));
      put(this.input, 'pointerEvents', t > 0.5 ? 'auto' : 'none');
      put(this.x, 'opacity', t.toFixed(3));
      put(this.x, 'pointerEvents', t > 0.5 ? 'auto' : 'none');
      put(this.x, 'transform', `scale(${lerp(0.5, 1, t).toFixed(3)})`);
    }
    destroy() { super.destroy(); if (this.rim) this.rim.destroy(); this.host.textContent = ''; }
  }

  /* ═════════════ 11 · Menú de pulsación larga ═════════════ */

  /**
   * Mantén pulsada una tarjeta: se eleva ×1,03 con sombra, el fondo se desenfoca y las opciones salen como
   * píldoras de cristal en cascada (35 ms, spring 0.6, 420). Toca fuera para cerrar.
   */
  class ContextMenu {
    constructor(target, o) {
      this.o = o = Object.assign({ items: [], hold: 380 }, o);
      this.target = target;
      this._unlp = longPress(target, o.hold, () => this.open());
    }
    open() {
      if (this.layer) return;
      const o = this.o, r = this.target.getBoundingClientRect();
      haptic(16);
      const layer = (this.layer = el('div', 'lui-cm-layer', document.body));
      const back = el('div', 'lui-cm-back', layer);
      const ghost = this.target.cloneNode(true);
      copyStyles(this.target, ghost);
      ghost.classList.add('lui-cm-ghost');
      ghost.removeAttribute('id');
      Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: '0' });
      layer.appendChild(ghost);
      this.target.style.visibility = 'hidden';
      const menu = el('div', 'lui-cm-menu', layer);
      const below = r.bottom + 12 + o.items.length * 52 < window.innerHeight;
      Object.assign(menu.style, { left: `${clamp(r.left, 12, window.innerWidth - 232)}px`, top: below ? `${r.bottom + 12}px` : 'auto', bottom: below ? 'auto' : `${window.innerHeight - r.top + 12}px` });
      const pills = o.items.map((it, i) => {
        const b = el('button', `lbw-glass lui-cm-item${it.destructive ? ' is-danger' : ''}`, menu);
        b.type = 'button';
        if (it.icon) b.appendChild(C.iconNode(it.icon));
        el('span', '', b).textContent = it.label;
        C.paintGlass(b, style(o.glass), null);
        b.addEventListener('click', (e) => { e.stopPropagation(); this.close(); (it.onSelect || o.onSelect || (() => {}))(it, i); });
        return { b, a: new Anim(0) };
      });
      const lift = new Anim(0), fade = new Anim(0);
      this.anim = { lift, fade, pills, ghost, back, below };
      this._stop = C.onFrame(() => {
        const L = clamp01(lift.value), F = clamp01(fade.value);
        put(back, 'opacity', F.toFixed(3));
        put(ghost, 'transform', `scale(${lerp(1, 1.03, lift.value).toFixed(4)})`);
        put(ghost, 'boxShadow', `0 ${(18 * L).toFixed(1)}px ${(40 * L).toFixed(1)}px rgba(0,0,0,${(0.28 * L).toFixed(3)})`);
        pills.forEach(({ b, a }) => {
          const t = a.value;
          put(b, 'opacity', clamp01(t).toFixed(3));
          put(b, 'transform', `translateY(${f2((below ? -10 : 10) * (1 - t))}) scale(${lerp(0.8, 1, t).toFixed(4)})`);
        });
      });
      lift.animateTo(1, spring(0.55, 420));
      fade.animateTo(1, spring(1, 400));
      pills.forEach((pp, i) => setTimeout(() => pp.a.animateTo(1, spring(0.6, 420)), 40 + i * 35));
      back.addEventListener('click', () => this.close());
      ghost.addEventListener('click', () => this.close());
      this._esc = (e) => { if (e.key === 'Escape') this.close(); };
      document.addEventListener('keydown', this._esc);
      setTimeout(() => pills[0] && pills[0].b.focus({ preventScroll: true }), 60);
    }
    close() {
      if (!this.layer || this.closing) return;
      this.closing = true;
      const { lift, fade, pills } = this.anim, layer = this.layer;
      pills.forEach(({ a }) => a.animateTo(0, spring(0.9, 600)));
      fade.animateTo(0, spring(1, 500));
      lift.animateTo(0, spring(0.8, 420)).then(() => {
        this._stop(); layer.remove(); this.target.style.visibility = '';
        this.layer = null; this.closing = false;
      });
      document.removeEventListener('keydown', this._esc);
    }
    destroy() { this._unlp(); if (this.layer) { this._stop(); this.layer.remove(); this.target.style.visibility = ''; } }
  }

  /* ═════════════ 12 · Tirar para recargar con gota ═════════════ */

  /**
   * Arriba del todo, tira hacia abajo: una gota de cristal cuelga, se estira con resistencia (tanh) y la flecha
   * gira; al soltar pasado el umbral cae con rebote (spring 0.45, 300) y gira mientras `onRefresh()` trabaja.
   */
  class PullRefresh extends Piece {
    constructor(o) {
      super();
      this.o = o = Object.assign({ scroller: window, threshold: 72, top: 8, onRefresh: () => Promise.resolve() }, o);
      this.drop = el('div', 'lbw-lens lui-pull', document.body);
      this.arrow = el('span', 'lui-pull-ico', this.drop);
      this.arrow.appendChild(C.iconNode('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg>'));
      this.s = style(o.glass);
      put(this.drop, 'top', `calc(env(safe-area-inset-top, 0px) + ${o.top}px)`);
      this.d = new Anim(0, 0.25); this.spin = 0; this.busy = false;
      const sc = o.scroller, top = () => (sc === window ? window.scrollY : sc.scrollTop) <= 0;
      let y0 = null, pulling = false;
      this._ts = (e) => { if (this.busy || !top() || e.touches.length !== 1) { y0 = null; return; } y0 = e.touches[0].clientY; pulling = false; };
      this._tm = (e) => {
        if (y0 == null) return;
        const dy = e.touches[0].clientY - y0;
        if (dy <= 0 || !top()) { if (pulling) this.d.snapTo(0); pulling = false; return; }
        pulling = true;
        if (e.cancelable) e.preventDefault();
        const d = 130 * Math.tanh(dy / 260);
        const was = this.d.value >= o.threshold;
        this.d.snapTo(d);
        if (!was && d >= o.threshold) haptic(10);
      };
      this._te = () => {
        if (y0 == null) return;
        y0 = null;
        if (!pulling) return;
        pulling = false;
        if (this.d.value >= o.threshold) this.refresh(); else this.d.animateTo(0, spring(0.8, 400));
      };
      const t = sc === window ? window : sc;
      t.addEventListener('touchstart', this._ts, { passive: true });
      t.addEventListener('touchmove', this._tm, { passive: false });
      t.addEventListener('touchend', this._te);
      t.addEventListener('touchcancel', this._te);
      this._t = t;
    }
    async refresh() {
      if (this.busy) return;
      this.busy = true;
      this.d.animateTo(64, S.drop);
      const t0 = performance.now();
      const spinStop = C.onFrame(() => { this.spin = ((performance.now() - t0) / 1000) * 360; C.kick(); });
      try { await this.o.onRefresh(); } catch (_) { /* la app enseña su error */ }
      spinStop();
      this.spin = 0;
      this.d.animateTo(0, spring(0.8, 380)).then(() => { this.busy = false; });
    }
    render() {
      const d = this.d.value, th = this.o.threshold;
      const k = clamp01(d / th);
      put(this.drop, 'display', d > 0.5 ? '' : 'none');
      if (d <= 0.5) return;
      const size = 40;
      const stretch = this.busy ? 0 : clamp(d / 420, 0, 0.18);
      put(this.drop, 'transform', `translate(-50%,${f2(d - size)}) scale(${(1 - stretch * 0.6).toFixed(4)},${(1 + stretch).toFixed(4)})`);
      put(this.drop, 'opacity', clamp01(d / 30).toFixed(3));
      if (support.blur) put(this.drop, C.backdropProp, C.backdrop(4, 1.6, null));
      const sf = parseColor(this.s.surface);
      put(this.drop, 'backgroundColor', css(alphaOf(sf, Math.max(sf[3], 0.62))));
      rimVars(this.drop, 0.3 + 0.25 * k);
      put(this.drop, 'boxShadow', '0 8px 22px rgba(0,0,0,.35), 0 0 0 .5px rgba(255,255,255,.12)');
      put(this.arrow, 'transform', this.busy ? `rotate(${this.spin.toFixed(1)}deg)` : `rotate(${(k * 180).toFixed(1)}deg) scale(${lerp(0.7, 1, k).toFixed(3)})`);
      this.arrow.classList.toggle('is-busy', this.busy);
    }
    destroy() {
      super.destroy();
      this._t.removeEventListener('touchstart', this._ts);
      this._t.removeEventListener('touchmove', this._tm);
      this._t.removeEventListener('touchend', this._te);
      this._t.removeEventListener('touchcancel', this._te);
      this.drop.remove();
    }
  }

  /* ═════════════ 13 · Hoja inferior de cristal ═════════════ */

  /**
   * Panel propio (no un diálogo del sistema) de cristal con canto que refracta, asa que se estira con la
   * velocidad y alturas fijas (`detents`, fracciones de la pantalla) con spring(0.75, 300). Bajar del todo cierra.
   */
  class Sheet extends Piece {
    constructor(o) {
      super();
      this.o = o = Object.assign({ detents: [0.45, 0.9], initial: 0, title: '', glass: null, dim: true }, o);
      this.layer = el('div', 'lui-sheet-layer', document.body);
      this.back = el('div', 'lui-sheet-back', this.layer);
      this.node = el('div', 'lbw-glass lui-sheet', this.layer);
      this.node.setAttribute('role', 'dialog');
      this.node.setAttribute('aria-modal', 'true');
      if (o.title) this.node.setAttribute('aria-label', o.title);
      this.s = style(Object.assign({ blur: 12 }, o.glass));
      this.rim = support.refraction ? new C.RimFilter(this.s.refractionHeight, this.s.refractionAmount, 28) : null;
      C.paintGlass(this.node, this.s, this.rim);
      this.head = el('div', 'lui-sheet-head', this.node);
      this.grab = el('span', 'lui-sheet-grab', this.head);
      if (o.title) el('div', 'lui-sheet-title', this.head).textContent = o.title;
      this.body = el('div', 'lui-sheet-body', this.node);
      if (o.content instanceof Element) this.body.appendChild(o.content);
      else if (typeof o.content === 'function') o.content(this.body);
      else if (o.content) this.body.innerHTML = o.content;
      this.y = new Anim(1, 0.0005); this.fade = new Anim(0);
      this.idx = o.initial;
      let fromBody = false;
      const vh = () => window.innerHeight;
      const startDrag = (e, body) => { fromBody = body; return body ? this.body.scrollTop <= 0 : true; };
      const dragOpts = (body) => ({
        down: (e) => startDrag(e, body),
        move: (dx, dy, e, moved) => {
          if (fromBody && dy < 0 && this.y.value <= 1 - this.o.detents[this.o.detents.length - 1] + 0.001) return;
          if (!moved) return;
          if (fromBody && e.cancelable) e.preventDefault();
          const top = 1 - this.o.detents[this.o.detents.length - 1];
          let y = this.y.value + dy / vh();
          if (y < top) y = top - (top - y) * 0.3; // resistencia por arriba
          this.y.snapTo(y);
          this.vel = dy;
        },
        end: (moved, e, up) => {
          if (!moved) return;
          const v = this.vel || 0, cur = 1 - this.y.value;
          const ds = this.o.detents;
          let best = 0, bd = Infinity;
          ds.forEach((d, i) => { const dd = Math.abs(d - cur - v * 0.004); if (dd < bd) { bd = dd; best = i; } });
          if (cur < ds[0] * 0.6 || (v > 18 && best === 0 && cur < ds[0])) this.close();
          else this.setDetent(best);
        },
      });
      this._u1 = drag(this.head, dragOpts(false));
      this._u2 = drag(this.body, Object.assign(dragOpts(true), { slop: 8 }));
      this.back.addEventListener('click', () => this.close());
      this._esc = (e) => { if (e.key === 'Escape' && this.isOpen) this.close(); };
      document.addEventListener('keydown', this._esc);
      put(this.layer, 'display', 'none');
      this.isOpen = false;
    }
    open(i = this.o.initial) {
      put(this.layer, 'display', '');
      this.isOpen = true;
      this.setDetent(i);
      this.fade.animateTo(1, spring(1, 400));
      haptic(8);
      return this;
    }
    setDetent(i) { this.idx = clamp(i, 0, this.o.detents.length - 1); this.y.animateTo(1 - this.o.detents[this.idx], S.sheet); C.kick(); }
    close() {
      if (!this.isOpen) return;
      this.isOpen = false;
      this.fade.animateTo(0, spring(1, 500));
      this.y.animateTo(1, spring(0.9, 320)).then((ok) => { if (ok && !this.isOpen) { put(this.layer, 'display', 'none'); if (this.o.onClose) this.o.onClose(); } });
    }
    render() {
      if (this.layer.style.display === 'none') return;
      const vh = window.innerHeight, max = this.o.detents[this.o.detents.length - 1];
      const H = Math.round(vh * max) + 60;
      put(this.node, 'height', `${H}px`);
      put(this.node, 'transform', `translateY(${f2(this.y.value * vh - (vh - H) - 0)})`);
      put(this.node, 'top', `${vh - H}px`);
      put(this.body, 'height', `${Math.round(vh * (1 - this.y.value)) - 56}px`);
      if (this.rim) this.rim.update(this.node.offsetWidth, H);
      put(this.back, 'opacity', this.o.dim ? (0.35 * clamp01(this.fade.value)).toFixed(3) : '0');
      const v = clamp(Math.abs(this.y.velocity) * 0.04, 0, 1);
      put(this.grab, 'width', f2(36 + 18 * v));
    }
    destroy() { super.destroy(); this._u1(); this._u2(); document.removeEventListener('keydown', this._esc); if (this.rim) this.rim.destroy(); this.layer.remove(); }
  }

  return {
    version: '1.0.0',
    segmented: (host, o) => new Segmented(host, o),
    toggle: (host, o) => new Toggle(host, o),
    slider: (host, o) => new Slider(host, o),
    glassButton: (node, o) => new GlassButton(node, o),
    glassChip,
    badge: (node, o) => new Badge(node, o),
    island,
    fan: (button, o) => new Fan(button, o),
    chartLens: (container, o) => new ChartLens(container, o),
    searchMorph: (host, o) => new SearchMorph(host, o),
    contextMenu: (target, o) => new ContextMenu(target, o),
    pullRefresh: (o) => new PullRefresh(o),
    sheet: (o) => new Sheet(o),
    MagnifyFilter,
  };
});
