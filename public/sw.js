self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data?.json() ?? {}
  } catch {
    payload = { title: 'BoulderO', body: 'Du hast eine neue Benachrichtigung.' }
  }
  const title = payload.title || 'BoulderO'
  const options = {
    body: payload.body || 'Du hast eine neue Benachrichtigung.',
    icon: '/BoulderO_Logo.ico',
    badge: '/BoulderO_Logo.ico',
    tag: payload.tag || `bouldero-${payload.targetUrl || 'notification'}`,
    renotify: false,
    data: { targetUrl: payload.targetUrl || '/notifications' },
  }
  const tasks = [self.registration.showNotification(title, options)]
  if (payload.showBadge && 'setAppBadge' in self.navigator) {
    tasks.push(self.navigator.setAppBadge(Number(payload.badgeCount) || 1))
  }
  event.waitUntil(Promise.all(tasks))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = new URL(event.notification.data?.targetUrl || '/notifications', self.location.origin).href
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const client = windows.find((windowClient) => new URL(windowClient.url).origin === self.location.origin)
    if (client) {
      try {
        const navigatedClient = await client.navigate(targetUrl)
        if (navigatedClient) return navigatedClient.focus()
        await client.focus()
      } catch {
        // Some mobile browsers cannot navigate an existing background tab from a push event.
      }
    }
    return self.clients.openWindow(targetUrl)
  })())
})
