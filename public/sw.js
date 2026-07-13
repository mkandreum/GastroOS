// GastroOS Service Worker - Web Push Notifications
// Este SW debe estar en la raíz del dominio para poder controlar toda la app

const APP_NAME = "GastroOS";

// Handle push events from server
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: APP_NAME, body: event.data ? event.data.text() : "Nueva notificación" };
  }

  const title = data.title || APP_NAME;
  const options = {
    body: data.body || "",
    icon: data.icon || "/favicon.ico",
    badge: "/favicon.ico",
    tag: data.tag || "gastro-notification",
    renotify: true,
    requireInteraction: data.requireInteraction || false,
    silent: false,
    vibrate: data.vibrate || [200, 100, 200],
    data: {
      url: data.url || "/",
      type: data.type || "general",
      tableId: data.tableId || null,
      timestamp: Date.now(),
    },
    actions: data.actions || [],
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Handle notification click - focus/open the app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const notifData = event.notification.data || {};
  const targetUrl = notifData.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // If a window is already open, focus it
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.postMessage({ type: "NOTIFICATION_CLICK", data: notifData });
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// SW install & activate - take control immediately
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});
