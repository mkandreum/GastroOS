import { useEffect, useRef } from "react";

type SSEEventHandler = (data: any) => void;

export function useSSE(handlers: Record<string, SSEEventHandler>) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (!token) return;

    let eventSource: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let mounted = true;

    function connect() {
      if (!mounted) return;
      eventSource = new EventSource(`/api/events?token=${encodeURIComponent(token!)}`);

      eventSource.onopen = () => {
        attempt = 0;
      };

      for (const event of Object.keys(handlersRef.current)) {
        eventSource.addEventListener(event, (message) => {
          try {
            handlersRef.current[event]?.(JSON.parse((message as MessageEvent).data));
          } catch {
            // Ignorar eventos mal formados sin romper la conexión.
          }
        });
      }

      eventSource.onerror = () => {
        eventSource?.close();
        if (!mounted) return;
        attempt = Math.min(attempt + 1, 6);
        const delay = Math.min(30000, 1000 * 2 ** attempt);
        reconnectTimeout = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      mounted = false;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      eventSource?.close();
    };
  }, []);
}
