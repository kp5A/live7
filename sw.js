// Live Smart Student Assistant - Service Worker v2
// Background notifications + scheduled alarms

const SCHEDULED_NOTIFICATIONS = new Map(); // lectureId -> timeoutId

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle clicking on desktop/phone notifications
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const action = event.action;

  // Handle snooze action
  if (action === 'snooze') {
    // Re-schedule notification for 5 minutes later
    const snoozeMs = 5 * 60 * 1000;
    setTimeout(() => {
      self.registration.showNotification(event.notification.title, {
        body: event.notification.body + ' (تذكير بعد التأجيل)',
        icon: data.icon || '/favicon.svg',
        badge: '/favicon.svg',
        tag: data.tag || 'lecture-due',
        data: data,
        vibrate: [250, 100, 250, 100, 250],
        requireInteraction: true,
        renotify: true,
        actions: [
          { action: 'start', title: '🚀 ابدأ مذاكرة' },
          { action: 'snooze', title: '⏰ أجّل 5 دقائق' }
        ]
      });
    }, snoozeMs);
    return;
  }

  // Default: open/focus the app
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({
            type: 'NAVIGATE_TO_LECTURE',
            subjectId: data.subjectId,
            lectureId: data.lectureId,
            autoStart: true
          });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(data.url || '/');
      }
    })
  );
});

// Message handler for scheduling and immediate notifications
self.addEventListener('message', (event) => {
  if (!event.data) return;

  const { type } = event.data;

  // Immediate notification
  if (type === 'SHOW_NOTIFICATION') {
    const { title, options } = event.data;
    self.registration.showNotification(title, {
      ...options,
      actions: [
        { action: 'start', title: '🚀 ابدأ مذاكرة' },
        { action: 'snooze', title: '⏰ أجّل 5 دقائق' }
      ]
    });
  }

  // Schedule a future notification
  if (type === 'SCHEDULE_NOTIFICATION') {
    const { lectureId, title, body, scheduledTime, data: notifData } = event.data;

    // Cancel any existing scheduled notification for this lecture
    if (SCHEDULED_NOTIFICATIONS.has(lectureId)) {
      clearTimeout(SCHEDULED_NOTIFICATIONS.get(lectureId));
      SCHEDULED_NOTIFICATIONS.delete(lectureId);
    }

    const now = Date.now();
    const targetTime = new Date(scheduledTime).getTime();
    const delay = targetTime - now;

    if (delay <= 0) {
      // Already past due - fire immediately
      self.registration.showNotification(title, {
        body,
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        tag: `lecture-${lectureId}`,
        data: notifData || {},
        vibrate: [250, 100, 250, 100, 250],
        requireInteraction: true,
        renotify: true,
        actions: [
          { action: 'start', title: '🚀 ابدأ مذاكرة' },
          { action: 'snooze', title: '⏰ أجّل 5 دقائق' }
        ]
      });
      return;
    }

    // Schedule for future (setTimeout works in SW as long as browser process is alive)
    const timeoutId = setTimeout(() => {
      self.registration.showNotification(title, {
        body,
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        tag: `lecture-${lectureId}`,
        data: notifData || {},
        vibrate: [250, 100, 250, 100, 250],
        requireInteraction: true,
        renotify: true,
        actions: [
          { action: 'start', title: '🚀 ابدأ مذاكرة' },
          { action: 'snooze', title: '⏰ أجّل 5 دقائق' }
        ]
      });
      SCHEDULED_NOTIFICATIONS.delete(lectureId);

      // Also notify all open clients
      self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(client => {
          client.postMessage({
            type: 'LECTURE_DUE_ALARM',
            lectureId: lectureId,
            subjectId: notifData?.subjectId
          });
        });
      });
    }, delay);

    SCHEDULED_NOTIFICATIONS.set(lectureId, timeoutId);
  }

  // Cancel a scheduled notification
  if (type === 'CANCEL_NOTIFICATION') {
    const { lectureId } = event.data;
    if (SCHEDULED_NOTIFICATIONS.has(lectureId)) {
      clearTimeout(SCHEDULED_NOTIFICATIONS.get(lectureId));
      SCHEDULED_NOTIFICATIONS.delete(lectureId);
    }
  }

  // Schedule multiple notifications at once (bulk sync on startup)
  if (type === 'SYNC_ALL_NOTIFICATIONS') {
    const { lectures } = event.data;

    // Clear all existing
    SCHEDULED_NOTIFICATIONS.forEach((tid) => clearTimeout(tid));
    SCHEDULED_NOTIFICATIONS.clear();

    const now = Date.now();

    (lectures || []).forEach(({ lectureId, title, body, scheduledTime, data: notifData }) => {
      const targetTime = new Date(scheduledTime).getTime();
      const delay = targetTime - now;

      if (delay > 0 && delay < 86400000 * 7) {
        // Only schedule within the next 7 days
        const timeoutId = setTimeout(() => {
          self.registration.showNotification(title, {
            body,
            icon: '/favicon.svg',
            badge: '/favicon.svg',
            tag: `lecture-${lectureId}`,
            data: notifData || {},
            vibrate: [250, 100, 250, 100, 250],
            requireInteraction: true,
            renotify: true,
            actions: [
              { action: 'start', title: '🚀 ابدأ مذاكرة' },
              { action: 'snooze', title: '⏰ أجّل 5 دقائق' }
            ]
          });
          SCHEDULED_NOTIFICATIONS.delete(lectureId);

          self.clients.matchAll({ type: 'window' }).then(clients => {
            clients.forEach(client => {
              client.postMessage({
                type: 'LECTURE_DUE_ALARM',
                lectureId: lectureId,
                subjectId: notifData?.subjectId
              });
            });
          });
        }, delay);

        SCHEDULED_NOTIFICATIONS.set(lectureId, timeoutId);
      }
    });
  }
});

// Keep the SW alive periodically (self-ping every 20 seconds for active scheduled tasks)
setInterval(() => {
  if (SCHEDULED_NOTIFICATIONS.size > 0) {
    // Lightweight keep-alive: just access clients
    self.clients.matchAll({ type: 'window' }).then(() => {});
  }
}, 20000);
