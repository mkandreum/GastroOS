import { useEffect, useRef, useCallback } from "react";

type SSEEventHandler = (data: any) => void;

export function useSSE(handlers: Record<string, SSEEventHandler>) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout>;
    let mounted = true;

    function connect() {
      if (!mounted) return;
      eventSource = new EventSource("/api/events");

      eventSource.onopen = () => {
        console.log("[SSE] Connected");
      };

      Object.keys(handlersRef.current).forEach((event) => {
        eventSource?.addEventListener(event, (e) => {
          try {
            const data = JSON.parse(e.data);
            handlersRef.current[event]?.(data);
          } catch { /* ignore parse errors */ }
        });
      });

      eventSource.onerror = () => {
        eventSource?.close();
        if (mounted) {
          reconnectTimeout = setTimeout(connect, 5000);
        }
      };
    }

    connect();

    return () => {
      mounted = false;
      clearTimeout(reconnectTimeout);
      eventSource?.close();
    };
  }, []);
}
