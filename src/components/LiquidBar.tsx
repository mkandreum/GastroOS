/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LiquidBar para web: port del estilo «cápsula con plegado» de
 * github.com/mkandreum/liquidbar (Jetpack Compose) a React + CSS/SVG.
 *
 * Se conserva la física de la librería:
 *  - cristal: desenfoque 4 px, saturación ×1,5, canto de 24 px que refracta hacia dentro,
 *    filo de luz y contorno oscuro;
 *  - lente: viaja con muelle (0.62, 420), se estira con la velocidad, crece al pulsar
 *    (×78/56 de alto), refracta con aberración cromática y se puede arrastrar entre pestañas;
 *  - plegado: se recoge en un círculo sobre la pestaña activa al bajar 50 px y se abre
 *    al subir 8 px; la acción vive siempre en su propio círculo (detachAction).
 *
 * La refracción usa `backdrop-filter: url(#filtro)` con un mapa de desplazamiento SVG,
 * que hoy solo pinta Chromium. En el resto se ve el mismo cristal sin el canto refractado
 * (equivalente al `fallback` de la librería en Android < 13).
 */

import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";

export interface LiquidBarItem {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number | boolean;
}

export interface LiquidBarAction {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  badge?: number | boolean;
  /** Tiñe el círculo con el acento (como `tint` en la librería). */
  tinted?: boolean;
}

interface LiquidBarProps {
  items: LiquidBarItem[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  action?: LiquidBarAction;
  /** Elemento cuyo scroll pliega la barra. Por defecto, la ventana. */
  foldOnScroll?: boolean;
  ariaLabel?: string;
  id?: string;
  className?: string;
}

/** dampingRatio + stiffness (convención de Compose) → damping de `motion`. */
const spring = (dampingRatio: number, stiffness: number) => ({
  stiffness,
  damping: 2 * dampingRatio * Math.sqrt(stiffness),
  mass: 1
});

const TRAVEL = spring(0.62, 420);
const FOLLOW = spring(1, 1000);
const SCALE_X = spring(0.6, 250);
const SCALE_Y = spring(0.7, 250);
const FOLD_PX = 50;
const UNFOLD_PX = 8;
const REST_H = 56;
const PRESSED_SCALE = 78 / 56;

const supportsSvgBackdrop =
  typeof window !== "undefined" &&
  typeof CSS !== "undefined" &&
  CSS.supports?.("backdrop-filter", "blur(1px)") &&
  /Chrome|Chromium|Edg\//.test(navigator.userAgent) &&
  !/Firefox/.test(navigator.userAgent);

/**
 * Mapa de desplazamiento de una píldora: en la franja del canto empuja el muestreo hacia
 * dentro siguiendo la normal, con el perfil circular (1 − √(1 − t²)) del shader AGSL original.
 */
function buildDisplacementMap(width: number, height: number, rim: number): string {
  const w = Math.max(2, Math.round(width));
  const h = Math.max(2, Math.round(height));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const image = ctx.createImageData(w, h);
  const radius = Math.min(w, h) / 2;
  const band = Math.min(rim, radius);
  const halfW = w / 2 - radius;
  const halfH = h / 2 - radius;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - w / 2;
      const py = y + 0.5 - h / 2;
      // Distancia firmada a un rectángulo redondeado (negativa dentro).
      const qx = Math.abs(px) - halfW;
      const qy = Math.abs(py) - halfH;
      const ox = Math.max(qx, 0);
      const oy = Math.max(qy, 0);
      const outside = Math.hypot(ox, oy);
      const dist = outside + Math.min(Math.max(qx, qy), 0) - radius;
      let dx = 0;
      let dy = 0;
      if (dist < 0 && dist > -band) {
        const t = 1 + dist / band; // 0 al empezar la franja, 1 en el filo
        const strength = 1 - Math.sqrt(Math.max(0, 1 - t * t));
        // Normal hacia fuera; muestreamos hacia dentro.
        let nx: number;
        let ny: number;
        if (outside > 0.0001) {
          nx = (ox / outside) * Math.sign(px || 1);
          ny = (oy / outside) * Math.sign(py || 1);
        } else if (qx > qy) {
          nx = Math.sign(px || 1);
          ny = 0;
        } else {
          nx = 0;
          ny = Math.sign(py || 1);
        }
        dx = -nx * strength;
        dy = -ny * strength;
      }
      const i = (y * w + x) * 4;
      image.data[i] = Math.round(128 + dx * 127);
      image.data[i + 1] = Math.round(128 + dy * 127);
      image.data[i + 2] = 128;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

/** Filtro SVG de refracción. Con `dispersion` separa rojo y azul (aberración cromática). */
function RefractionFilter({ id, width, height, rim, amount, dispersion = 0 }: {
  id: string; width: number; height: number; rim: number; amount: number; dispersion?: number;
}) {
  const href = useMemo(
    () => (supportsSvgBackdrop && width > 4 && height > 4 ? buildDisplacementMap(width, height, rim) : ""),
    [width, height, rim]
  );
  if (!href) return null;
  const w = Math.round(width);
  const h = Math.round(height);
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <filter id={id} x="0" y="0" width={w} height={h} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
        <feImage href={href} x="0" y="0" width={w} height={h} result="map" preserveAspectRatio="none" />
        {dispersion > 0 ? (
          <>
            <feDisplacementMap in="SourceGraphic" in2="map" scale={amount * 2 * (1 + 0.28 * dispersion)} xChannelSelector="R" yChannelSelector="G" result="dr" />
            <feColorMatrix in="dr" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
            <feDisplacementMap in="SourceGraphic" in2="map" scale={amount * 2} xChannelSelector="R" yChannelSelector="G" result="dg" />
            <feColorMatrix in="dg" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
            <feDisplacementMap in="SourceGraphic" in2="map" scale={amount * 2 * (1 - 0.28 * dispersion)} xChannelSelector="R" yChannelSelector="G" result="db" />
            <feColorMatrix in="db" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
            <feBlend in="r" in2="g" mode="screen" result="rg" />
            <feBlend in="rg" in2="b" mode="screen" />
          </>
        ) : (
          <feDisplacementMap in="SourceGraphic" in2="map" scale={amount * 2} xChannelSelector="R" yChannelSelector="G" />
        )}
      </filter>
    </svg>
  );
}

function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => {
      const next = { width: node.offsetWidth, height: node.offsetHeight };
      setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

function Badge({ value }: { value?: number | boolean }) {
  if (!value) return null;
  return (
    <span className={`lb-badge ${value === true ? "lb-badge-dot" : ""}`} aria-hidden={value === true}>
      {value === true ? "" : value > 99 ? "99+" : value}
    </span>
  );
}

/** Brillo radial que sigue al dedo (GlassGlow). */
function useGlow() {
  const onPointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--lb-gx", `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty("--lb-gy", `${event.clientY - rect.top}px`);
  }, []);
  return { onPointerMove };
}

export default function LiquidBar({
  items, selectedKey, onSelect, action, foldOnScroll = true, ariaLabel = "Navegación", id, className = ""
}: LiquidBarProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const reduceMotion = useReducedMotion();
  const [capsuleRef, capsuleSize] = useSize<HTMLDivElement>();
  const [actionRef, actionSize] = useSize<HTMLButtonElement>();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [folded, setFolded] = useState(false);
  const [pressing, setPressing] = useState(false);
  const [hotIndex, setHotIndex] = useState<number | null>(null);
  const [lensBox, setLensBox] = useState({ width: 64 });
  const dragging = useRef<{ pointerId: number; startX: number; moved: boolean } | null>(null);
  const glow = useGlow();

  const selectedIndex = Math.max(0, items.findIndex((item) => item.key === selectedKey));
  const hasSelection = items.some((item) => item.key === selectedKey);

  // Centro de la lente (px dentro de la cápsula) y presión 0 → 1.
  const target = useMotionValue(0);
  const x = useSpring(target, pressing ? FOLLOW : TRAVEL);
  const pressure = useSpring(0, FOLLOW);
  const scaleX = useSpring(1, SCALE_X);
  const scaleY = useSpring(1, SCALE_Y);
  const velocity = useMotionValue(0);

  // Estiramiento por velocidad: más ancha y más baja al acelerar.
  useEffect(() => x.on("change", () => {
    const v = Math.max(-0.2, Math.min(0.2, x.getVelocity() / 5000));
    velocity.set(Math.abs(v));
  }), [x, velocity]);
  const stretchX = useTransform([scaleX, velocity], ([s, v]: number[]) => s / (1 - 0.75 * v));
  const stretchY = useTransform([scaleY, velocity], ([s, v]: number[]) => s * (1 - 0.25 * v));
  const lensLeft = useTransform(x, (value) => value - lensBox.width / 2);

  const centerOf = useCallback((index: number) => {
    const node = tabRefs.current[index];
    return node ? node.offsetLeft + node.offsetWidth / 2 : 0;
  }, []);

  // Colocar la lente sobre la pestaña activa (y recolocar al cambiar tamaños).
  const placed = useRef(false);
  useLayoutEffect(() => {
    if (folded || capsuleSize.width === 0) return;
    const node = tabRefs.current[selectedIndex];
    if (!node) return;
    setLensBox((prev) => (prev.width === node.offsetWidth ? prev : { width: node.offsetWidth }));
    const center = centerOf(selectedIndex);
    if (!placed.current || reduceMotion) {
      target.jump(center);
      x.jump(center);
      placed.current = true;
    } else if (!dragging.current) {
      target.set(center);
    }
  }, [selectedIndex, capsuleSize.width, folded, items.length, centerOf, target, x, reduceMotion]);

  useEffect(() => {
    if (reduceMotion) {
      pressure.jump(pressing ? 1 : 0);
      scaleX.jump(1);
      scaleY.jump(1);
      return;
    }
    pressure.set(pressing ? 1 : 0);
    scaleX.set(pressing ? 1.18 : 1);
    scaleY.set(pressing ? PRESSED_SCALE : 1);
  }, [pressing, pressure, scaleX, scaleY, reduceMotion]);

  // Plegado por dirección de scroll.
  useEffect(() => {
    if (!foldOnScroll) return;
    let last = window.scrollY;
    let anchor = last;
    const onScroll = () => {
      const now = window.scrollY;
      const goingDown = now > last;
      if (goingDown !== (last > anchor)) anchor = last;
      if (now <= 4) setFolded(false);
      else if (goingDown && now - anchor > FOLD_PX) setFolded(true);
      else if (!goingDown && anchor - now > UNFOLD_PX) setFolded(false);
      last = now;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [foldOnScroll]);

  // Abierta siempre que cambie la pestaña.
  useEffect(() => { setFolded(false); }, [selectedKey]);

  const nearestIndex = useCallback((clientX: number) => {
    const capsule = capsuleRef.current;
    if (!capsule) return selectedIndex;
    const local = clientX - capsule.getBoundingClientRect().left;
    let best = 0;
    let bestDistance = Infinity;
    items.forEach((_, index) => {
      const distance = Math.abs(centerOf(index) - local);
      if (distance < bestDistance) { best = index; bestDistance = distance; }
    });
    return best;
  }, [capsuleRef, centerOf, items, selectedIndex]);

  const clampCenter = useCallback((clientX: number) => {
    const capsule = capsuleRef.current;
    if (!capsule) return 0;
    const local = clientX - capsule.getBoundingClientRect().left;
    return Math.max(centerOf(0), Math.min(centerOf(items.length - 1), local));
  }, [capsuleRef, centerOf, items.length]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (folded || (event.pointerType === "mouse" && event.button !== 0)) return;
    dragging.current = { pointerId: event.pointerId, startX: event.clientX, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPressing(true);
    setHotIndex(nearestIndex(event.clientX));
    target.set(clampCenter(event.clientX));
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    glow.onPointerMove(event);
    const drag = dragging.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - drag.startX) > 4) drag.moved = true;
    target.set(clampCenter(event.clientX));
    setHotIndex(nearestIndex(event.clientX));
  };

  const finishDrag = (event: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    const drag = dragging.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragging.current = null;
    setPressing(false);
    setHotIndex(null);
    const index = commit ? nearestIndex(event.clientX) : selectedIndex;
    target.set(centerOf(index));
    if (commit && items[index] && items[index].key !== selectedKey) onSelect(items[index].key);
  };

  // Rebote del icono al activarse: encoge a 0,8 en 90 ms y vuelve con spring(0.4, 520).
  const iconRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    const node = iconRefs.current[selectedIndex];
    if (!node || reduceMotion) return;
    const controls = animate(node, { scale: [1, 0.8] }, { duration: 0.09 });
    controls.then(() => animate(node, { scale: 1 }, { type: "spring", ...spring(0.4, 520) }));
    return () => controls.stop();
  }, [selectedIndex, reduceMotion]);

  const capsuleFilter = `lb-rim-${uid}`;
  const lensFilter = `lb-lens-${uid}`;
  const actionFilter = `lb-act-${uid}`;
  const ActiveIcon = items[selectedIndex]?.icon;
  const ActionIcon = action?.icon;

  const glassStyle = (filterId: string, ready: boolean): React.CSSProperties =>
    supportsSvgBackdrop && ready
      ? ({ ["--lb-backdrop" as string]: `url(#${filterId}) blur(4px) saturate(1.5)` } as React.CSSProperties)
      : {};

  return (
    <nav className={`lb-root ${className}`} aria-label={ariaLabel} id={id} data-folded={folded || undefined}>
      <RefractionFilter id={capsuleFilter} width={capsuleSize.width} height={capsuleSize.height} rim={24} amount={24} />
      <RefractionFilter id={lensFilter} width={lensBox.width} height={REST_H} rim={10} amount={12} dispersion={0.4} />
      {action && <RefractionFilter id={actionFilter} width={actionSize.width} height={actionSize.height} rim={24} amount={24} />}

      {items.length > 0 && (
      <div className="lb-wrap">
      <motion.div
        layout={!reduceMotion}
        transition={{ type: "spring", ...spring(folded ? 0.55 : 0.74, 260) }}
        ref={capsuleRef}
        className="lb-capsule lb-glass"
        style={{ ...glassStyle(capsuleFilter, capsuleSize.width > 0), borderRadius: 999 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => finishDrag(event, true)}
        onPointerCancel={(event) => finishDrag(event, false)}
      >
        {folded ? (
          <motion.button
            layout="position"
            type="button"
            className="lb-fold"
            onClick={() => setFolded(false)}
            aria-label={`Abrir navegación (${items[selectedIndex]?.label ?? ""})`}
            aria-expanded={false}
          >
            {ActiveIcon && <ActiveIcon className="lb-icon" />}
          </motion.button>
        ) : (
          <>
            {items.map((item, index) => {
              const Icon = item.icon;
              const active = item.key === selectedKey;
              const hot = pressing && hotIndex === index;
              return (
                <button
                  key={item.key}
                  ref={(node) => { tabRefs.current[index] = node; }}
                  type="button"
                  className="lb-tab"
                  aria-current={active ? "page" : undefined}
                  data-hot={hot || undefined}
                  title={item.label}
                  // El puntero se resuelve en la cápsula (arrastre de la lente); aquí solo el teclado.
                  onClick={(event) => { if (event.detail === 0) onSelect(item.key); }}
                >
                  <span className="lb-icon-wrap" ref={(node) => { iconRefs.current[index] = node; }}>
                    <Icon className="lb-icon" />
                    <Badge value={item.badge} />
                  </span>
                  <span className="lb-label">{item.label}</span>
                </button>
              );
            })}
          </>
        )}
      </motion.div>
      {/* La lente va encima de la cápsula y fuera de ella: así refracta el cristal y los iconos que pisa. */}
      {!folded && hasSelection && (
        <motion.span
          aria-hidden="true"
          className="lb-lens"
          data-pressed={pressing || undefined}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.18, delay: 0.12 }}
          style={{
            left: lensLeft,
            width: lensBox.width,
            scaleX: stretchX,
            scaleY: stretchY,
            ["--lb-p" as string]: pressure,
            ...(supportsSvgBackdrop ? { ["--lb-lens-backdrop" as string]: `url(#${lensFilter})` } : {})
          }}
        />
      )}
      </div>
      )}

      {action && ActionIcon && (
        <motion.button
          layout={!reduceMotion}
          transition={{ type: "spring", ...spring(0.74, 260) }}
          whileTap={reduceMotion ? undefined : { scale: 1.08 }}
          ref={actionRef}
          type="button"
          className={`lb-action lb-glass ${action.tinted ? "lb-tinted" : ""}`}
          style={{ ...glassStyle(actionFilter, actionSize.width > 0), borderRadius: 999 }}
          onClick={action.onClick}
          onPointerMove={glow.onPointerMove}
          aria-label={action.label}
          title={action.label}
        >
          <ActionIcon className="lb-icon" />
          <Badge value={action.badge} />
        </motion.button>
      )}
    </nav>
  );
}
