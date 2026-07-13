import { useEffect, useRef } from "react";

export function useFocusTrap(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active || !ref.current) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const container = ref.current;

    const focusableSelector =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

    function getFocusableElements() {
      return container.querySelectorAll<HTMLElement>(focusableSelector);
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        const closeBtn = container.querySelector('[data-close-modal]') as HTMLButtonElement | null;
        closeBtn?.click();
        return;
      }

      if (e.key !== "Tab") return;

      const focusables = getFocusableElements();
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    container.addEventListener("keydown", handleKeyDown);

    const focusables = getFocusableElements();
    if (focusables.length > 0) {
      setTimeout(() => focusables[0].focus(), 50);
    }

    return () => {
      container.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [active]);

  return ref;
}
