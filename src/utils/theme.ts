export type ThemeId = "papel" | "noche";

export const THEMES: Array<{ id: ThemeId; name: string; blurb: string }> = [
  { id: "papel", name: "Papel y tinta", blurb: "Carta impresa: tomate, crema y serif de cartel." },
  { id: "noche", name: "Noche", blurb: "Negro, rótulos condensados y ámbar. La foto del plato manda." }
];

const KEY = "gastro_theme";
const CHROME: Record<ThemeId, string> = { papel: "#F2EBDD", noche: "#0B0B0B" };

export function isTheme(value: unknown): value is ThemeId {
  return value === "papel" || value === "noche";
}

/** Tema guardado en este navegador: evita el parpadeo hasta que responde el servidor. */
export function cachedTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(KEY);
    return isTheme(saved) ? saved : "papel";
  } catch {
    return "papel";
  }
}

export function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", CHROME[theme]);
  try { localStorage.setItem(KEY, theme); } catch { /* almacenamiento no disponible */ }
  window.dispatchEvent(new CustomEvent("gastro-theme", { detail: theme }));
}
