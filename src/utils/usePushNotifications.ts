/**
 * usePushNotifications
 * Hook that registers the Service Worker, requests notification permission,
 * subscribes to Web Push, and sends the subscription to the server.
 * Should be used in the Camarero (waiter) view.
 */

import { useState, useEffect, useCallback } from "react";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return new Uint8Array([...rawData].map(char => char.charCodeAt(0)));
}

export type PushStatus = "idle" | "requesting" | "subscribed" | "denied" | "unsupported" | "error";

interface UsePushNotificationsOptions {
  role?: string;
  authToken?: string | null;
}

export function usePushNotifications({ role = "camarero", authToken }: UsePushNotificationsOptions = {}) {
  const [status, setStatus] = useState<PushStatus>("idle");
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);

  const doSubscribe = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported");
      return;
    }

    setStatus("requesting");

    try {
      let permission = Notification.permission;
      if (permission === "default") {
        permission = await Notification.requestPermission();
      }
      if (permission !== "granted") {
        setStatus("denied");
        return;
      }

      const keyRes = await fetch("/api/push/vapid-public-key");
      const { publicKey } = await keyRes.json();
      if (!publicKey) {
        setStatus("error");
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

      await fetch("/api/push/subscribe", {
        method: "POST",
        headers,
        body: JSON.stringify({ subscription: sub.toJSON(), role }),
      });

      setSubscription(sub);
      setStatus("subscribed");
      console.log("[WebPush] Suscripción activa.");
    } catch (err) {
      console.error("[WebPush] Error al suscribirse:", err);
      setStatus("error");
    }
  }, [role, authToken]);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported");
      return;
    }
    navigator.serviceWorker.register("/sw.js", { scope: "/" })
      .then(reg => {
        console.log("[SW] Registered:", reg.scope);
        return reg.pushManager.getSubscription();
      })
      .then(existing => {
        if (existing) {
          setSubscription(existing);
          setStatus("subscribed");
        } else if (Notification.permission === "granted") {
          return doSubscribe();
        }
      })
      .catch(err => {
        console.error("[SW] Registration error:", err);
        setStatus("error");
      });
  }, []);

  const subscribe = useCallback(async () => {
    await doSubscribe();
  }, [doSubscribe]);

  const unsubscribe = useCallback(async () => {
    if (!subscription) return;
    try {
      await fetch("/api/push/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      await subscription.unsubscribe();
      setSubscription(null);
      setStatus("idle");
    } catch (err) {
      console.error("[WebPush] Error al cancelar suscripción:", err);
    }
  }, [subscription]);

  return { status, subscription, subscribe, unsubscribe };
}
