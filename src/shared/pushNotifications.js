function base64UrlToUint8Array(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const binary = window.atob(base64)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export function supportsPushNotifications() {
  return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return null
  return navigator.serviceWorker.register('/sw.js')
}

export async function enablePushNotifications({ userId, publicKey, contentPreviewEnabled = false, badgeEnabled = true }) {
  if (!supportsPushNotifications()) throw new Error('Push-Benachrichtigungen werden auf diesem Gerät nicht unterstützt.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Benachrichtigungen wurden nicht erlaubt.')
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToUint8Array(publicKey),
  })
  const response = await fetch('/api/push-subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...subscription.toJSON(), contentPreviewEnabled, badgeEnabled }),
  })
  if (!response.ok) throw new Error('Push-Benachrichtigungen konnten nicht eingerichtet werden.')
  const payload = await response.json()
  window.localStorage.setItem(`bouldero-push-subscription:${userId}`, payload.subscription.id)
  return payload.subscription
}

export async function disablePushNotifications(userId) {
  const key = `bouldero-push-subscription:${userId}`
  const subscriptionId = window.localStorage.getItem(key)
  if (subscriptionId) await fetch(`/api/push-subscriptions/${subscriptionId}`, { method: 'DELETE' })
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  await subscription?.unsubscribe()
  window.localStorage.removeItem(key)
}

export async function updatePushDeviceSettings(userId, settings) {
  const subscriptionId = window.localStorage.getItem(`bouldero-push-subscription:${userId}`)
  if (!subscriptionId) return null
  const response = await fetch(`/api/push-subscriptions/${subscriptionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  if (!response.ok) throw new Error('Geräteeinstellungen konnten nicht gespeichert werden.')
  return (await response.json()).subscription
}

export async function updateAppBadge(count, enabled = true) {
  if (!('setAppBadge' in navigator)) return
  if (enabled && count > 0) await navigator.setAppBadge(count)
  else if ('clearAppBadge' in navigator) await navigator.clearAppBadge()
}
