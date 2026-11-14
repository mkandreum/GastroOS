/**
 * LiquidUI para React: componentes y hooks sobre liquidbar.js + liquidui.js (cargados como <script> antes de la app,
 * con liquidbar.css y liquidui.css). Copia este archivo tal cual a cada web (src/lib/LiquidUI.tsx) y no lo edites
 * allí: los cambios se hacen en el repo liquidbar (web/react/LiquidUI.tsx) y se vuelven a copiar.
 *
 * Mismos muelles, cristal y lupa que la versión Android (io.github.mkandreum.liquidbar.ui).
 */
import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { LiquidUI?: any }
}

const ui = (): any => (typeof window !== "undefined" ? window.LiquidUI : undefined);
/** ¿Está cargada la librería? (si no, los componentes caen a controles normales). */
export const liquidReady = (): boolean => !!ui();

/** Último valor de una prop en una ref, para callbacks que viven más que un render. */
function useLatest<T>(v: T) {
  const r = useRef(v);
  r.current = v;
  return r;
}

export interface GlassStyle {
  surface?: string; fallback?: string; rim?: string; blur?: number; saturation?: number;
  refractionHeight?: number; refractionAmount?: number;
}

/* ───────────── 2 · Interruptor líquido ───────────── */

export function LiquidToggle(props: {
  checked: boolean; onChange: (v: boolean) => void; accent?: string; off?: string; label?: string;
  disabled?: boolean; className?: string; id?: string;
}) {
  const { checked, accent, off, label, disabled, className, id } = props;
  const ref = useRef<HTMLButtonElement>(null);
  const ctl = useRef<any>(null);
  const onChange = useLatest(props.onChange);
  useEffect(() => {
    if (!ui() || !ref.current) return;
    ctl.current = ui().toggle(ref.current, { checked, accent, off, label, onChange: (v: boolean) => onChange.current(v) });
    return () => { ctl.current?.destroy(); ctl.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accent, off, label]);
  useEffect(() => { if (ctl.current && ctl.current.checked !== checked) ctl.current.setChecked(checked); }, [checked]);
  if (!ui()) {
    return <input type="checkbox" role="switch" checked={checked} disabled={disabled} aria-label={label} className={className} id={id} onChange={(e) => props.onChange(e.target.checked)} />;
  }
  return <button ref={ref} type="button" id={id} className={className} disabled={disabled} style={disabled ? { opacity: 0.5, pointerEvents: "none" } : undefined} />;
}

/* ───────────── 1 · Selector segmentado líquido ───────────── */

export function LiquidSegmented(props: {
  items: string[]; selected: number; onSelect: (i: number) => void;
  accent?: string; onAccent?: string; content?: string; height?: number; glass?: GlassStyle;
  className?: string; style?: React.CSSProperties;
}) {
  const { items, selected, accent, onAccent, content, height, glass, className, style } = props;
  const ref = useRef<HTMLDivElement>(null);
  const ctl = useRef<any>(null);
  const onSelect = useLatest(props.onSelect);
  const key = items.join("\u0001");
  useEffect(() => {
    if (!ui() || !ref.current) return;
    ctl.current = ui().segmented(ref.current, { items, selectedIndex: selected, accent, onAccent, content, height, glass, onSelect: (i: number) => onSelect.current(i) });
    return () => { ctl.current?.destroy(); ctl.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, accent, onAccent, content, height]);
  useEffect(() => { if (ctl.current && ctl.current.selectedIndex !== selected) ctl.current.setSelected(selected); }, [selected]);
  if (!ui()) {
    return (
      <div role="tablist" className={className} style={{ display: "flex", gap: 4, ...style }}>
        {items.map((it, i) => <button key={it} type="button" role="tab" aria-selected={i === selected} onClick={() => props.onSelect(i)}>{it}</button>)}
      </div>
    );
  }
  return <div ref={ref} className={className} style={style} />;
}

/* ───────────── 3 · Deslizador de cristal ───────────── */

export function LiquidSlider(props: {
  value: number; min: number; max: number; step?: number; onInput?: (v: number) => void; onChange?: (v: number) => void;
  ticks?: number | string[]; accent?: string; track?: string; format?: (v: number) => string; label?: string;
  className?: string; style?: React.CSSProperties;
}) {
  const { value, min, max, step, ticks, accent, track, label, className, style } = props;
  const ref = useRef<HTMLDivElement>(null);
  const ctl = useRef<any>(null);
  const onInput = useLatest(props.onInput);
  const onChange = useLatest(props.onChange);
  const format = useLatest(props.format);
  useEffect(() => {
    if (!ui() || !ref.current) return;
    ctl.current = ui().slider(ref.current, {
      min, max, step: step ?? 1, value, ticks: ticks ?? 0, accent, track, label,
      format: (v: number) => (format.current ? format.current(v) : String(v)),
      onInput: (v: number) => onInput.current?.(v), onChange: (v: number) => onChange.current?.(v),
    });
    return () => { ctl.current?.destroy(); ctl.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [min, max, step, accent, track, Array.isArray(ticks) ? ticks.join("|") : ticks]);
  useEffect(() => { if (ctl.current && ctl.current.value !== value) ctl.current.setValue(value); }, [value]);
  if (!ui()) {
    return <input type="range" min={min} max={max} step={step ?? 1} value={value} aria-label={label} className={className} style={style}
      onChange={(e) => { const v = Number(e.target.value); props.onInput?.(v); props.onChange?.(v); }} />;
  }
  return <div ref={ref} className={className} style={style} />;
}

/* ───────────── 4 · Botón de cristal ───────────── */

/** Convierte el elemento de la ref en cristal líquido (brillo, estiramiento y tinte al pulsar). */
export function useGlassButton(ref: React.RefObject<HTMLElement | null>, opts: { tint?: string; glass?: GlassStyle; radius?: number | null; strength?: number } = {}, deps: unknown[] = []) {
  const { tint, radius, strength } = opts;
  useEffect(() => {
    if (!ui() || !ref.current) return;
    const c = ui().glassButton(ref.current, { tint, glass: opts.glass, radius, strength });
    return () => c.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tint, radius, strength, ...deps]);
}

/* ───────────── 5 · Chip de cristal ───────────── */

export function LiquidChip(props: { children: React.ReactNode; delay?: number; tint?: string; glass?: GlassStyle; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!ui() || !ref.current) return;
    const c = ui().glassChip(ref.current, { delay: props.delay, tint: props.tint, glass: props.glass });
    return () => c.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <span ref={ref} className={className(props.className, "lui-chip-r")} style={props.style}>{props.children}</span>;
}

/* ───────────── 6 · Insignia que salta ───────────── */

export function LiquidBadge(props: { value: number | boolean; color?: string; max?: number; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLSpanElement>(null);
  const ctl = useRef<any>(null);
  useEffect(() => {
    if (!ui() || !ref.current) return;
    ctl.current = ui().badge(ref.current, { value: props.value, color: props.color, max: props.max });
    return () => { ctl.current?.destroy(); ctl.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.color]);
  useEffect(() => { if (ctl.current && ctl.current.value !== props.value) ctl.current.set(props.value); }, [props.value]);
  if (!ui()) return props.value ? <span className={props.className} style={props.style}>{props.value === true ? "" : String(props.value)}</span> : null;
  return <span ref={ref} className={props.className} style={props.style} aria-label={props.value ? String(props.value) : undefined} />;
}

/* ───────────── 7 · Isla líquida ───────────── */

export interface IslandMessage { title: string; text?: string; icon?: string; accent?: string; duration?: number; onTap?: () => void }
/** Muestra un estado vivo en la isla de arriba (si la librería no está, no hace nada y devuelve false). */
export function showIsland(m: IslandMessage, glass?: GlassStyle): boolean {
  if (!ui()) return false;
  ui().island({ glass }).show(m);
  return true;
}
export function hideIsland() { if (ui()) ui().island().hide(); }

/* ───────────── 8 · Abanico de burbujas ───────────── */

export interface FanItem { label: string; icon: string; onSelect: () => void }
/** Mantener pulsado el botón de la ref abre el abanico; un toque normal sigue siendo su click. */
export function useFan(ref: React.RefObject<HTMLElement | null>, items: FanItem[], opts: { angles?: [number, number]; radius?: number; glass?: GlassStyle } = {}, deps: unknown[] = []) {
  const latest = useLatest(items);
  const key = items.map((i) => i.label).join("|");
  useEffect(() => {
    if (!ui() || !ref.current || !items.length) return;
    const c = ui().fan(ref.current, {
      items: items.map((it, i) => ({ label: it.label, icon: it.icon, onSelect: () => latest.current[i]?.onSelect() })),
      angles: opts.angles, radius: opts.radius, glass: opts.glass,
    });
    return () => c.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, opts.radius, opts.angles?.join(","), ...deps]);
}

/* ───────────── 9 · Lupa para gráficas ───────────── */

export interface ChartPoint { value: string; label?: string; y?: number; key?: unknown }
/** Mantén pulsado sobre el contenedor de la ref: lupa que amplía el dato y burbuja con su valor. */
export function useChartLens(ref: React.RefObject<HTMLElement | null>, valueAt: (x: number, rect: DOMRect) => ChartPoint | null, opts: { zoom?: number; size?: number; glass?: GlassStyle } = {}, deps: unknown[] = []) {
  const latest = useLatest(valueAt);
  useEffect(() => {
    if (!ui() || !ref.current) return;
    const c = ui().chartLens(ref.current, { zoom: opts.zoom, size: opts.size, glass: opts.glass, valueAt: (x: number, r: DOMRect) => latest.current(x, r) });
    return () => c.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.zoom, opts.size, ...deps]);
}

/* ───────────── 10 · Buscar que se transforma ───────────── */

export function LiquidSearch(props: {
  placeholder?: string; onInput?: (q: string) => void; onSubmit?: (q: string) => void; onOpen?: () => void; onClose?: () => void;
  width?: number | (() => number); size?: number; glass?: GlassStyle; className?: string; style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cbs = useLatest(props);
  useEffect(() => {
    if (!ui() || !ref.current) return;
    const c = ui().searchMorph(ref.current, {
      placeholder: props.placeholder, size: props.size, glass: props.glass,
      width: typeof props.width === "function" ? () => (cbs.current.width as () => number)() : props.width,
      onInput: (q: string) => cbs.current.onInput?.(q), onSubmit: (q: string) => cbs.current.onSubmit?.(q),
      onOpen: () => cbs.current.onOpen?.(), onClose: () => cbs.current.onClose?.(),
    });
    return () => c.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.placeholder, props.size]);
  return <div ref={ref} className={props.className} style={props.style} />;
}

/* ───────────── 11 · Menú de pulsación larga ───────────── */

export interface MenuItem { label: string; icon?: string; destructive?: boolean; onSelect: () => void }
/** Mantén pulsado el elemento de la ref: se eleva sobre el fondo desenfocado y salen las opciones en cristal. */
export function useContextMenu(ref: React.RefObject<HTMLElement | null>, items: MenuItem[], opts: { glass?: GlassStyle; hold?: number } = {}) {
  const latest = useLatest(items);
  const ctl = useRef<any>(null);
  useEffect(() => {
    if (!ui() || !ref.current) return;
    ctl.current = ui().contextMenu(ref.current, { items: latest.current, glass: opts.glass, hold: opts.hold });
    return () => { ctl.current?.destroy(); ctl.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Las opciones se leen al abrir: siempre las del último render.
  if (ctl.current) ctl.current.o.items = items.map((it) => ({ ...it, onSelect: () => it.onSelect() }));
}

/**
 * Lo mismo sin hook, para filas dentro de un map: `<div ref={menuRef([...])}>`. El menú se crea una vez por
 * elemento y sus opciones se actualizan en cada render.
 */
export function menuRef(items: MenuItem[], opts: { glass?: GlassStyle; hold?: number } = {}) {
  return (el: HTMLElement | null) => {
    if (!el || !ui()) return;
    const host = el as HTMLElement & { __lmenu?: any };
    if (!host.__lmenu) host.__lmenu = ui().contextMenu(el, { items: [], glass: opts.glass, hold: opts.hold });
    host.__lmenu.o.items = items.map((it) => ({ ...it, onSelect: () => it.onSelect() }));
  };
}

/* ───────────── 12 · Tirar para recargar con gota ───────────── */

/** Arriba del todo, tirar hacia abajo llama a onRefresh (gota de cristal mientras dura la promesa). */
export function usePullRefresh(onRefresh: () => Promise<unknown> | void, opts: { scroller?: HTMLElement | Window | null; glass?: GlassStyle; enabled?: boolean } = {}) {
  const latest = useLatest(onRefresh);
  const enabled = opts.enabled !== false;
  useEffect(() => {
    if (!ui() || !enabled) return;
    const c = ui().pullRefresh({ scroller: opts.scroller || window, glass: opts.glass, onRefresh: () => Promise.resolve(latest.current()) });
    return () => c.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.scroller, enabled]);
}

/* ───────────── 13 · Hoja inferior de cristal ───────────── */

/**
 * Hoja de cristal controlada: mientras `open`, el contenido React se pinta dentro de la hoja (portal).
 * Bajarla del todo llama a onClose.
 */
export function LiquidSheet(props: { open: boolean; onClose: () => void; title?: string; detents?: number[]; glass?: GlassStyle; children: React.ReactNode }) {
  const holder = useRef<HTMLDivElement | null>(null);
  const ctl = useRef<any>(null);
  const onClose = useLatest(props.onClose);
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!ui()) return;
    holder.current = document.createElement("div");
    ctl.current = ui().sheet({ title: props.title, detents: props.detents, glass: props.glass, content: holder.current, onClose: () => onClose.current() });
    force();
    return () => { ctl.current?.destroy(); ctl.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.title, props.detents?.join(",")]);
  useEffect(() => {
    const c = ctl.current;
    if (!c) return;
    if (props.open && !c.isOpen) c.open();
    else if (!props.open && c.isOpen) c.close();
  }, [props.open]);
  if (!ui()) return props.open ? <div role="dialog">{props.children}</div> : null;
  return holder.current ? ReactDOMPortal(props.children, holder.current) : null;
}

function ReactDOMPortal(children: React.ReactNode, el: HTMLElement) { return createPortal(children, el); }

function className(...c: Array<string | undefined>) { return c.filter(Boolean).join(" "); }

/** Iconos sencillos (SVG en línea, currentColor) para burbujas y menús. */
export const icons = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4 4-6 8-6s7.2 2 8 6"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.8a3.5 3.5 0 0 1 0 6.4M18.5 14.8c1.7.8 2.7 2.5 3 5.2"/></svg>',
  qr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10"/></svg>',
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 2-1.6L22 7H6"/></svg>',
  swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/></svg>',
  timer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
};
