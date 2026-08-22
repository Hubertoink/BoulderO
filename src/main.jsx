import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import {
  IconAdjustmentsHorizontal,
  IconArrowsMaximize,
  IconBookmark,
  IconCalendarEvent,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCompass,
  IconClock,
  IconCurrentLocation,
  IconDownload,
  IconDots,
  IconEye,
  IconFlag,
  IconLock,
  IconMapPin,
  IconMedal,
  IconMessageCircle,
  IconLogin2,
  IconLogout,
  IconPhoto,
  IconPlus,
  IconSearch,
  IconSparkles,
  IconTrophy,
  IconTrash,
  IconUserCircle,
  IconUserCheck,
  IconUserPlus,
  IconUsers,
  IconWorld,
  IconX,
} from '@tabler/icons-react'
import 'leaflet/dist/leaflet.css'
import './styles.css'
import { initialSpots, mannheimCenter } from './data/spots'
import { AuditView, RegisteredUsersDialog } from './features/admin/AuthAudit.tsx'
import { GroupsView } from './features/groups/GroupsView.jsx'
import {
  AdminSpotsView,
  BadgesView,
  FeedView,
  FriendsView,
  JournalComposer,
  JournalEntryDialog,
  JournalView,
  LegalDialog,
  Lightbox,
  MapView,
  MessageDialog,
  NotificationSettingsView,
  PasswordDialog,
  PlannedVisitDialog,
  ProfileView,
  RankBadge,
  SignInDialog,
  SpotCorrectionDialog,
  SpotSuggestionDialog,
  optimizePhoto,
} from './AppViews.jsx'
import { disablePushNotifications, registerServiceWorker, updateAppBadge } from './shared/pushNotifications.js'

const navItems = [
  { id: 'map', label: 'Karte', icon: IconMapPin },
  { id: 'journal', label: 'Tagebuch', icon: IconBookmark },
  { id: 'social', label: 'Feed', icon: IconMessageCircle },
  { id: 'friends', label: 'Community', icon: IconUsers },
  { id: 'profile', label: 'Profil', icon: IconUserCircle },
]

const appViews = new Set(['map', 'journal', 'social', 'friends', 'groups', 'profile', 'notifications', 'badges', 'connections', 'admin', 'audit'])

function viewFromLocation() {
  const segment = window.location.pathname.split('/').filter(Boolean)[0]
  return appViews.has(segment) ? segment : 'map'
}

function pathForView(view) {
  return view === 'map' ? '/' : `/${view}`
}

function App() {
  const [spots, setSpots] = useState(initialSpots)
  const [activeView, setActiveView] = useState(viewFromLocation)
  const [selectedId, setSelectedId] = useState(initialSpots[0].id)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [toast, setToast] = useState('')
  const [currentUser, setCurrentUser] = useState(null)
  const [journalVisits, setJournalVisits] = useState([])
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerSpotId, setComposerSpotId] = useState(null)
  const [composerPlan, setComposerPlan] = useState(null)
  const [isPickingSpot, setIsPickingSpot] = useState(false)
  const [composerSurface, setComposerSurface] = useState('dialog')
  const [selectedEntry, setSelectedEntry] = useState(null)
  const [progress, setProgress] = useState(null)
  const [authConfiguration, setAuthConfiguration] = useState(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [resetToken, setResetToken] = useState(null)
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false)
  const [welcomeOpen, setWelcomeOpen] = useState(() => viewFromLocation() === 'map')
  const [messageUser, setMessageUser] = useState(null)
  const [lightboxImage, setLightboxImage] = useState(null)
  const [friendSummary, setFriendSummary] = useState({ unread_messages: 0, pending_requests: 0 })
  const [feedSummary, setFeedSummary] = useState({ unread_feed: 0 })
  const [notificationSummary, setNotificationSummary] = useState({ unread_count: 0, unread_feed: 0, unread_plans: 0, unread_messages: 0, unread_friendships: 0, unread_friend_requests: 0, unread_friend_acceptances: 0, unread_friends: 0, unread_groups: 0, unread_group_invitations: 0 })
  const [feedAuthorFilter, setFeedAuthorFilter] = useState(null)
  const [feedPlanFocus, setFeedPlanFocus] = useState(null)
  const [spotSuggestions, setSpotSuggestions] = useState([])
  const [spotCorrectionReports, setSpotCorrectionReports] = useState([])
  const [authAudit, setAuthAudit] = useState([])
  const [adminStats, setAdminStats] = useState(null)
  const [adminUsers, setAdminUsers] = useState([])
  const [adminUsersTotal, setAdminUsersTotal] = useState(0)
  const [adminUsersOpen, setAdminUsersOpen] = useState(false)
  const [adminUsersLoading, setAdminUsersLoading] = useState(false)
  const [suggestionDialogOpen, setSuggestionDialogOpen] = useState(false)
  const [planDialogSpotId, setPlanDialogSpotId] = useState(null)
  const [planRefreshKey, setPlanRefreshKey] = useState(0)
  const [correctionDialogSpotId, setCorrectionDialogSpotId] = useState(null)
  const [legalDialog, setLegalDialog] = useState(null)

  function navigate(view, { replace = false } = {}) {
    if (!appViews.has(view)) return
    setComposerOpen(false)
    setComposerSpotId(null)
    setComposerPlan(null)
    setPlanDialogSpotId(null)
    setComposerSurface('dialog')
    const current = window.history.state
    const position = current?.position ?? 0
    const nextState = { boulderO: true, view, position: replace ? position : position + 1 }
    const path = pathForView(view)
    if (window.location.pathname !== path || window.location.search) window.history[replace ? 'replaceState' : 'pushState'](nextState, '', path)
    else if (!current?.boulderO || current.view !== view) window.history.replaceState(nextState, '', path)
    setActiveView(view)
  }

  function goBack(fallback = 'profile') {
    if (window.history.state?.boulderO && window.history.state.position > 0) window.history.back()
    else navigate(fallback, { replace: true })
  }

  async function openNotificationTarget(targetUrl) {
    const target = new URL(targetUrl, window.location.origin)
    const view = target.pathname.split('/').filter(Boolean)[0] || 'map'
    navigate(appViews.has(view) ? view : 'map')
    window.history.replaceState(window.history.state, '', `${target.pathname}${target.search}`)
    const messageUserId = target.searchParams.get('message')
    if (view === 'friends' && messageUserId) {
      const response = await fetch('/api/social/friends')
      if (!response.ok) return
      const payload = await response.json()
      const friend = payload.friends.find((user) => user.id === messageUserId)
      if (friend) setMessageUser(friend)
    }
  }

  useEffect(() => {
    const initialView = viewFromLocation()
    if (!window.history.state?.boulderO) window.history.replaceState({ boulderO: true, view: initialView, position: 0 }, '', `${pathForView(initialView)}${window.location.search}`)
    function onPopState() {
      setComposerOpen(false)
      setComposerSpotId(null)
      setComposerPlan(null)
      setPlanDialogSpotId(null)
      setComposerSurface('dialog')
      setSelectedEntry(null)
      setMessageUser(null)
      setLightboxImage(null)
      if (new URLSearchParams(window.location.search).has('entry')) setFeedAuthorFilter(null)
      setActiveView(viewFromLocation())
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    if (window.CSS?.supports?.('height: 100dvh')) return undefined
    const viewport = window.visualViewport
    function updateViewportHeight() {
      const height = `${Math.round(viewport?.height || window.innerHeight)}px`
      document.documentElement.style.setProperty('--app-viewport-height', height)
      document.documentElement.style.setProperty('--dialog-viewport-height', height)
    }
    updateViewportHeight()
    viewport?.addEventListener('resize', updateViewportHeight)
    window.addEventListener('resize', updateViewportHeight)
    return () => {
      viewport?.removeEventListener('resize', updateViewportHeight)
      window.removeEventListener('resize', updateViewportHeight)
    }
  }, [])

  useEffect(() => {
    const className = 'map-view-open'
    const mapIsOpen = activeView === 'map'
    document.documentElement.classList.toggle(className, mapIsOpen)
    document.body.classList.toggle(className, mapIsOpen)
    if (mapIsOpen) window.scrollTo(0, 0)
    return () => {
      document.documentElement.classList.remove(className)
      document.body.classList.remove(className)
    }
  }, [activeView])

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search)
    const verificationToken = parameters.get('verifyEmail')
    const passwordToken = parameters.get('resetPassword')
    if (!verificationToken && !passwordToken) return
    window.history.replaceState(window.history.state, '', window.location.pathname)
    if (passwordToken) { setResetToken(passwordToken); setAuthOpen(true); return }
    fetch('/api/account/verify-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: verificationToken }) })
      .then((response) => { if (!response.ok) throw new Error(); showToast('E-Mail bestätigt. Du kannst dich jetzt anmelden.') })
      .catch(() => showToast('Der Bestätigungslink ist ungültig oder abgelaufen.'))
  }, [])

  const visitTotal = spots.reduce((sum, spot) => sum + spot.visits, 0)
  const uniqueVisited = spots.filter((spot) => spot.visits > 0).length

  function showToast(message) {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
  }

  async function loadPrivateData() {
    const [spotResponse, visitResponse, progressResponse] = await Promise.all([fetch('/api/spots'), fetch('/api/visits'), fetch('/api/progress')])
    if (!spotResponse.ok || !visitResponse.ok || !progressResponse.ok) throw new Error('Deine Daten konnten nicht geladen werden.')
    const { spots: apiSpots } = await spotResponse.json()
    const { visits } = await visitResponse.json()
    setProgress(await progressResponse.json())
    const countBySpot = visits.reduce((counts, visit) => ({ ...counts, [visit.spot_id]: (counts[visit.spot_id] ?? 0) + 1 }), {})
    const lastVisitBySpot = visits.reduce((dates, visit) => {
      if (!dates[visit.spot_id] || new Date(visit.visited_at) > new Date(dates[visit.spot_id])) dates[visit.spot_id] = visit.visited_at
      return dates
    }, {})
    setJournalVisits(visits)
    setSpots(apiSpots.map((spot) => {
      const fallback = initialSpots.find((item) => item.id === spot.id) ?? {}
      return { ...fallback, ...spot, position: [Number(spot.latitude), Number(spot.longitude)], open: spot.opening_hours, size: spot.area_sqm ?? fallback.size ?? '', visits: countBySpot[spot.id] ?? 0, last_visit_at: lastVisitBySpot[spot.id] ?? null }
    }))
  }

  async function loadSpotSuggestions(user = currentUser) {
    if (user?.role !== 'superadmin') { setSpotSuggestions([]); return }
    const response = await fetch('/api/admin/spot-suggestions')
    if (response.ok) setSpotSuggestions((await response.json()).suggestions)
  }

  async function loadFeedSummary() {
    const response = await fetch('/api/social/feed/summary')
    if (response.ok) setFeedSummary(await response.json())
  }
  async function loadNotificationSummary() {
    const response = await fetch('/api/notifications/summary')
    if (response.ok) setNotificationSummary(await response.json())
  }
  async function markNotificationTypesRead(types) {
    const response = await fetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ types }) })
    if (response.ok) await Promise.all([loadNotificationSummary(), loadFeedSummary()])
  }
  async function markFeedSectionRead(section) {
    const types = section === 'plans'
      ? ['plan_created', 'plan_rsvp', 'plan_updated', 'plan_cancelled', 'plan_reminder']
      : ['entry_comment', 'entry_like']
    await markNotificationTypesRead(types)
  }
  async function loadSpotCorrectionReports(user = currentUser) {
    if (user?.role !== 'superadmin') { setSpotCorrectionReports([]); return }
    const response = await fetch('/api/admin/spot-corrections')
    if (response.ok) setSpotCorrectionReports((await response.json()).reports)
  }
  async function loadAuthAudit(user = currentUser) {
    if (user?.role !== 'superadmin') { setAuthAudit([]); setAdminStats(null); return }
    const response = await fetch('/api/admin/auth-audit')
    if (response.ok) {
      const payload = await response.json()
      setAuthAudit(payload.events)
      setAdminStats(payload.stats)
    }
  }

  async function openRegisteredUsers() {
    setAdminUsersOpen(true)
    setAdminUsersLoading(true)
    try {
      const response = await fetch('/api/admin/users')
      if (!response.ok) throw new Error()
      const payload = await response.json()
      setAdminUsers(payload.users)
      setAdminUsersTotal(payload.total)
    } catch {
      setAdminUsers([])
      showToast('Die Nutzerliste konnte nicht geladen werden.')
    } finally {
      setAdminUsersLoading(false)
    }
  }

  useEffect(() => {
    const mapDialogOpen = (composerOpen && composerSurface === 'map') || Boolean(planDialogSpotId)
    if (!mapDialogOpen) return undefined
    document.documentElement.classList.add('map-dialog-open')
    document.body.classList.add('map-dialog-open')
    return () => {
      document.documentElement.classList.remove('map-dialog-open')
      document.body.classList.remove('map-dialog-open')
    }
  }, [composerOpen, composerSurface, planDialogSpotId])

  useEffect(() => {
    let activeDialog = null
    let returnFocus = null

    function getActiveDialog() {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]')
      return dialogs[dialogs.length - 1] ?? null
    }

    function syncDialogState() {
      const nextDialog = getActiveDialog()
      const dialogChanged = nextDialog !== activeDialog
      document.documentElement.classList.toggle('modal-open', Boolean(nextDialog))
      document.body.classList.toggle('modal-open', Boolean(nextDialog))

      if (dialogChanged && nextDialog) {
        returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const closeButton = nextDialog.querySelector('button[aria-label*="schließen" i]')
        closeButton?.focus({ preventScroll: true })
      } else if (dialogChanged && !nextDialog) {
        returnFocus?.focus({ preventScroll: true })
        returnFocus = null
      }

      activeDialog = nextDialog
    }

    function handleKeyDown(event) {
      const dialog = getActiveDialog()
      if (!dialog) return
      if (event.key === 'Escape') {
        dialog.querySelector('button[aria-label*="schließen" i]')?.click()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = [...dialog.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
        .filter((element) => !element.hasAttribute('hidden'))
      if (!focusable.length) return
      const currentIndex = focusable.indexOf(document.activeElement)
      if (event.shiftKey && (currentIndex <= 0 || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        focusable[focusable.length - 1].focus()
      } else if (!event.shiftKey && currentIndex === focusable.length - 1) {
        event.preventDefault()
        focusable[0].focus()
      }
    }

    const observer = new MutationObserver(syncDialogState)
    observer.observe(document.getElementById('root'), { childList: true, subtree: true })
    document.addEventListener('keydown', handleKeyDown)
    syncDialogState()
    return () => {
      observer.disconnect()
      document.removeEventListener('keydown', handleKeyDown)
      document.documentElement.classList.remove('modal-open')
      document.body.classList.remove('modal-open')
    }
  }, [])

  async function refreshSession() {
    const response = await fetch('/api/me')
    if (!response.ok) return
    const { user } = await response.json()
    setCurrentUser(user)
    await loadPrivateData()
    await loadSpotSuggestions(user)
    await loadSpotCorrectionReports(user)
    await loadAuthAudit(user)
    const summaryResponse = await fetch('/api/social/friends/summary')
    if (summaryResponse.ok) setFriendSummary(await summaryResponse.json())
    await Promise.all([loadFeedSummary(), loadNotificationSummary()])
  }

  useEffect(() => {
    fetch('/api/auth/configuration').then((response) => response.ok ? response.json() : null).then(setAuthConfiguration).catch(() => undefined)
    refreshSession().catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!currentUser) return undefined
    async function refreshFriendSummary() {
      const [response] = await Promise.all([fetch('/api/social/friends/summary'), loadFeedSummary(), loadNotificationSummary()])
      if (response.ok) setFriendSummary(await response.json())
    }
    refreshFriendSummary()
    const interval = window.setInterval(refreshFriendSummary, 15000)
    window.addEventListener('focus', refreshFriendSummary)
    return () => { window.clearInterval(interval); window.removeEventListener('focus', refreshFriendSummary) }
  }, [currentUser?.id])

  useEffect(() => {
    void registerServiceWorker().catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!currentUser) return
    const badgeEnabled = window.localStorage.getItem(`bouldero-app-badge-enabled:${currentUser.id}`) !== 'false'
    void updateAppBadge(notificationSummary.unread_count, badgeEnabled).catch(() => undefined)
  }, [currentUser?.id, notificationSummary.unread_count])

  async function signInDemo(profileId) {
    const csrfResponse = await fetch('/api/auth/csrf')
    const { csrfToken } = await csrfResponse.json()
    await fetch('/api/auth/callback/demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrfToken, callbackUrl: window.location.origin, profile: profileId }),
      redirect: 'manual',
    })
    await refreshSession()
    setAuthOpen(false)
    showToast('Demo-Profil ist aktiv')
  }

  async function signInMember(email, password) {
    const csrfResponse = await fetch('/api/auth/csrf')
    const { csrfToken } = await csrfResponse.json()
    const signInResponse = await fetch('/api/auth/callback/member', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrfToken, callbackUrl: window.location.origin, email, password }), redirect: 'manual' })
    if (signInResponse.status === 429) {
      const payload = await signInResponse.json().catch(() => ({}))
      const minutes = Math.max(1, Math.ceil(Number(payload.retry_after_seconds ?? signInResponse.headers.get('Retry-After') ?? 60) / 60))
      throw new Error(`Zu viele Anmeldeversuche. Bitte warte ${minutes} Minute${minutes === 1 ? '' : 'n'}.`)
    }
    const response = await fetch('/api/me')
    if (!response.ok) throw new Error('E-Mail oder Passwort sind nicht korrekt.')
    const { user } = await response.json(); setCurrentUser(user); await loadPrivateData(); await loadSpotSuggestions(user); await loadSpotCorrectionReports(user); await loadAuthAudit(user); await Promise.all([loadFeedSummary(), loadNotificationSummary()]); setAuthOpen(false); showToast('Willkommen bei BoulderO')
  }

  async function registerMember(name, username, email, password) {
    const response = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, username, email, password }) })
    if (!response.ok) { const payload = await response.json().catch(() => ({})); if (payload.error === 'email_delivery_failed') return { deliveryFailed: true }; throw new Error(payload.error === 'email_taken' ? 'Diese E-Mail-Adresse ist bereits registriert.' : payload.error === 'username_taken' ? 'Dieser @Name wurde gerade vergeben. Bitte wähle einen anderen.' : payload.error === 'email_not_configured' ? 'Die E-Mail-Registrierung wird gerade eingerichtet.' : 'Konto konnte nicht erstellt werden.') }
  }

  async function requestPasswordReset(email) {
    const response = await fetch('/api/account/password-reset/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
    if (!response.ok) throw new Error('Der Reset-Link konnte nicht gesendet werden.')
  }

  async function resendVerification(email) {
    const response = await fetch('/api/account/verification/resend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
    if (!response.ok) throw new Error('Die Bestätigungs-E-Mail konnte nicht gesendet werden.')
  }

  async function resetPassword(token, password) {
    const response = await fetch('/api/account/password-reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) })
    if (!response.ok) throw new Error('Der Reset-Link ist ungültig oder abgelaufen.')
    setResetToken(null)
  }

  async function changePassword(currentPassword, password) {
    const response = await fetch('/api/me/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword, password }) })
    if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error === 'current_password_incorrect' ? 'Das aktuelle Passwort ist nicht korrekt.' : 'Passwort konnte nicht geändert werden.') }
    setPasswordDialogOpen(false)
    showToast('Passwort wurde geändert')
  }

  async function signOut() {
    if (currentUser) await disablePushNotifications(currentUser.id).catch(() => undefined)
    const csrfResponse = await fetch('/api/auth/csrf')
    const { csrfToken } = await csrfResponse.json()
    await fetch('/api/auth/signout', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrfToken, callbackUrl: window.location.origin }), redirect: 'manual' })
    setCurrentUser(null)
    setJournalVisits([])
    setProgress(null)
    setSpots(initialSpots)
    setSpotSuggestions([])
    setSpotCorrectionReports([])
    setFriendSummary({ unread_messages: 0, pending_requests: 0 })
    setFeedSummary({ unread_feed: 0 })
    setNotificationSummary({ unread_count: 0 })
    void updateAppBadge(0, false).catch(() => undefined)
    showToast('Du bist abgemeldet')
  }

  async function deleteAccount() {
    const response = await fetch('/api/me', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: 'LOESCHEN' }) })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload.error === 'account_deletion_not_available' ? 'Dieses geschützte Konto kann nicht in der App gelöscht werden.' : 'Das Konto konnte nicht gelöscht werden.')
    }
    setCurrentUser(null)
    setJournalVisits([])
    setProgress(null)
    setSpots(initialSpots)
    setSpotSuggestions([])
    setSpotCorrectionReports([])
    setFriendSummary({ unread_messages: 0, pending_requests: 0 })
    setFeedSummary({ unread_feed: 0, unread_plans: 0 })
    setNotificationSummary({ unread_count: 0 })
    void updateAppBadge(0, false).catch(() => undefined)
    setSelectedEntry(null)
    setActiveView('map')
    showToast('Dein Konto wurde gelöscht')
  }

  function openComposer(spotId = null) {
    if (!currentUser) {
      navigate('profile')
      showToast('Melde dich an, um Besuche dauerhaft zu speichern')
      return
    }
    setPlanDialogSpotId(null)
    setComposerPlan(null)
    setComposerSpotId(spotId)
    setComposerSurface(spotId ? 'map' : 'dialog')
    setComposerOpen(true)
  }

  function openPlan(spotId) {
    if (!currentUser) { setAuthOpen(true); showToast('Melde dich an, um einen Besuch zu planen'); return }
    setComposerOpen(false)
    setComposerSpotId(null)
    setComposerSurface('dialog')
    setPlanDialogSpotId(spotId)
  }

  function openCorrection(spotId) {
    if (!currentUser) { setAuthOpen(true); showToast('Melde dich an, um einen Datenfehler zu melden'); return }
    setComposerOpen(false)
    setPlanDialogSpotId(null)
    setCorrectionDialogSpotId(spotId)
  }

  function selectSpot(id) {
    setSelectedId(id)
    if (isPickingSpot) {
      setComposerSpotId(id)
      setIsPickingSpot(false)
      setComposerSurface('map')
      setComposerOpen(true)
    }
  }

  function openSpotOnMap(id) {
    setSelectedId(id)
    setFilter('all')
    setQuery('')
    navigate('map')
  }

  function chooseSpotOnMap() {
    setComposerOpen(false)
    setIsPickingSpot(true)
    setFilter('all')
    setQuery('')
    navigate('map')
  }

  function closeComposer() {
    setComposerOpen(false)
    setComposerSpotId(null)
    setComposerPlan(null)
    setComposerSurface('dialog')
  }

  function openPlannedVisitJournal(plan) {
    const spot = spots.find((item) => item.id === plan.spot_id)
    if (!spot) return showToast('Die zugehörige Halle ist nicht mehr verfügbar')
    setPlanDialogSpotId(null)
    setComposerPlan(plan)
    setComposerSpotId(plan.spot_id)
    setComposerSurface('dialog')
    setComposerOpen(true)
  }

  async function markPlanMissed(plan) {
    const response = await fetch(`/api/planned-visits/${plan.id}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Nicht stattgefunden' }) })
    if (!response.ok) throw new Error('Die Planung konnte nicht als nicht stattgefunden markiert werden.')
    showToast('Planung als nicht stattgefunden markiert')
  }

  async function createJournalEntry(entry) {
    const response = await fetch('/api/visits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spotId: entry.spotId, visitedAt: entry.visitedAt, startedAt: entry.startedAt, endedAt: entry.endedAt, body: entry.body, visibility: entry.visibility }) })
    if (!response.ok) throw new Error('Der Besuch konnte nicht gespeichert werden.')
    const { journalEntry } = await response.json()
    if (entry.files.length) {
      const formData = new FormData()
      entry.files.forEach((file) => formData.append('photos', file))
      const upload = await fetch(`/api/journal/${journalEntry.id}/photos`, { method: 'POST', body: formData })
      if (!upload.ok) throw new Error('Der Text wurde gespeichert, aber mindestens ein Foto konnte nicht hochgeladen werden.')
    }
    if (entry.plannedVisitId) {
      const completion = await fetch(`/api/planned-visits/${entry.plannedVisitId}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ journalEntryId: journalEntry.id }) })
      if (!completion.ok) throw new Error('Der Besuch wurde gespeichert, aber die Planung konnte nicht abgeschlossen werden.')
    }
    await loadPrivateData()
    showToast(entry.visibility === 'private' ? 'Privater Tagebucheintrag gespeichert' : 'Geteilter Tagebucheintrag gespeichert')
  }

  async function updateJournalEntry(id, patch) {
    const response = await fetch(`/api/journal/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: patch.body, visibility: patch.visibility, visitedAt: patch.visitedAt }) })
    if (!response.ok) throw new Error('Der Eintrag konnte nicht aktualisiert werden.')
    for (const mediaId of patch.removedMediaIds) {
      const removeResponse = await fetch(`/api/media/${mediaId}`, { method: 'DELETE' })
      if (!removeResponse.ok) throw new Error('Ein Foto konnte nicht entfernt werden.')
    }
    if (patch.files.length) {
      const formData = new FormData()
      patch.files.forEach((file) => formData.append('photos', file))
      const upload = await fetch(`/api/journal/${id}/photos`, { method: 'POST', body: formData })
      if (!upload.ok) throw new Error('Der Eintrag wurde gespeichert, aber ein Foto konnte nicht hochgeladen werden.')
    }
    await loadPrivateData()
    showToast('Tagebucheintrag aktualisiert')
  }

  async function deleteJournalEntry(entry) {
    const response = await fetch(`/api/visits/${entry.id}`, { method: 'DELETE' })
    if (!response.ok) throw new Error('Der Eintrag konnte nicht gelöscht werden.')
    await loadPrivateData()
    setSelectedEntry(null)
    showToast('Tagebucheintrag gelöscht')
  }

  async function deletePhoto(id) {
    const response = await fetch(`/api/media/${id}`, { method: 'DELETE' })
    if (!response.ok) throw new Error('Das Foto konnte nicht entfernt werden.')
    await loadPrivateData()
    setSelectedEntry((entry) => entry ? { ...entry, media: entry.media.filter((media) => media.id !== id) } : null)
    showToast('Foto entfernt')
  }

  async function uploadAvatar(file) {
    if (!file) return
    const formData = new FormData()
    formData.append('avatar', await optimizePhoto(file))
    const response = await fetch('/api/me/avatar', { method: 'POST', body: formData })
    if (!response.ok) throw new Error('Profilfoto konnte nicht hochgeladen werden.')
    const { user } = await response.json()
    setCurrentUser(user)
    showToast('Profilfoto aktualisiert')
  }

  async function toggleFollow(user) {
    const response = await fetch(`/api/follows/${user.id}`, { method: user.following ? 'DELETE' : 'POST' })
    if (!response.ok) throw new Error('Die Verbindung konnte nicht geändert werden.')
    showToast(user.following ? `Du folgst ${user.name} nicht mehr` : `Du folgst jetzt ${user.name}`)
  }

  async function createSpot(input, imageFile = null) {
    const response = await fetch('/api/admin/spots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload.error === 'superadmin_required' ? 'Dir fehlen die Verwaltungsrechte.' : 'Bitte prüfe die Eingaben.')
    }
    const { spot } = await response.json()
    if (imageFile) {
      const formData = new FormData()
      formData.append('image', await optimizePhoto(imageFile))
      const uploadResponse = await fetch(`/api/admin/spots/${spot.id}/image`, { method: 'POST', body: formData })
      if (!uploadResponse.ok) throw new Error('Die Halle wurde angelegt, aber das Bild konnte nicht hochgeladen werden.')
    }
    await loadPrivateData()
    setSelectedId(spot.id)
    showToast(`${spot.name} wurde angelegt`)
  }

  async function previewSpotImport(file) {
    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch('/api/admin/spots/import/preview', { method: 'POST', body: formData })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      if (payload.error === 'csv_headers_invalid') throw new Error(`Diese Spalten fehlen: ${payload.missing.join(', ')}`)
      if (payload.error === 'csv_limit_exceeded') throw new Error('Pro Import sind höchstens 500 Hallen möglich.')
      if (payload.error === 'xlsx_invalid') throw new Error('Die Excel-Datei konnte nicht gelesen werden. Bitte verwende eine gültige .xlsx-Datei.')
      throw new Error('Die Datei konnte nicht analysiert werden. Bitte prüfe die Vorlage und die Koordinaten.')
    }
    return response.json()
  }

  async function applySpotImport(file, decisions) {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('decisions', JSON.stringify(decisions))
    const response = await fetch('/api/admin/spots/import/apply', { method: 'POST', body: formData })
    if (!response.ok) throw new Error('Die ausgewählten Hallen konnten nicht angewendet werden. Bitte prüfe die Auswahl.')
    const { created, updated, skipped } = await response.json()
    await loadPrivateData()
    showToast(`${created} angelegt, ${updated} aktualisiert, ${skipped} übersprungen`)
  }

  async function updateSpot(id, input, imageFile = null) {
    const response = await fetch(`/api/admin/spots/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
    if (!response.ok) throw new Error('Die Änderungen konnten nicht gespeichert werden.')
    if (imageFile) {
      const formData = new FormData()
      formData.append('image', await optimizePhoto(imageFile))
      const uploadResponse = await fetch(`/api/admin/spots/${id}/image`, { method: 'POST', body: formData })
      if (!uploadResponse.ok) throw new Error('Die Hallendaten wurden gespeichert, aber das Bild konnte nicht hochgeladen werden.')
    }
    await loadPrivateData()
    showToast('Halle aktualisiert')
  }

  async function deleteSpot(id) {
    const response = await fetch(`/api/admin/spots/${id}`, { method: 'DELETE' })
    if (!response.ok) throw new Error('Die Halle konnte nicht gelöscht werden.')
    await loadPrivateData()
    showToast('Halle von der Karte entfernt')
  }

  async function exportSpots(includeArchived = false) {
    const response = await fetch(`/api/admin/spots/export?includeArchived=${includeArchived}`)
    if (!response.ok) throw new Error('Der Hallenexport konnte nicht erstellt werden.')
    const downloadUrl = URL.createObjectURL(await response.blob())
    const anchor = document.createElement('a')
    anchor.href = downloadUrl
    anchor.download = includeArchived ? 'bouldero-hallen-export-inklusive-archiv.zip' : 'bouldero-hallen-export-aktiv.zip'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(downloadUrl)
  }

  async function submitSpotSuggestion(input) {
    const response = await fetch('/api/spot-suggestions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
    if (!response.ok) throw new Error('Bitte prüfe Name, Adresse und optionale Koordinaten.')
    showToast('Dein Hallenvorschlag wurde zur Prüfung gesendet')
  }

  async function createPlannedVisit(input) {
    const response = await fetch('/api/planned-visits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
    if (!response.ok) throw new Error('Bitte prüfe Datum und Uhrzeit.')
    setPlanRefreshKey((current) => current + 1)
    showToast('Geplanter Besuch wurde im Feed veröffentlicht')
  }

  async function submitSpotCorrection(spotId, input) {
    const response = await fetch(`/api/spots/${spotId}/corrections`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
    if (!response.ok) throw new Error('Der Hinweis konnte nicht gesendet werden.')
    showToast('Danke, dein Hinweis wird geprüft')
  }

  async function resolveSpotCorrection(id, decision) {
    const response = await fetch(`/api/admin/spot-corrections/${id}/${decision}`, { method: 'POST' })
    if (!response.ok) throw new Error('Der Hinweis konnte nicht verarbeitet werden.')
    await loadSpotCorrectionReports()
    showToast(decision === 'resolve' ? 'Hinweis als erledigt markiert' : 'Hinweis verworfen')
  }

  async function approveSpotSuggestion(id, input) {
    const response = await fetch(`/api/admin/spot-suggestions/${id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
    if (!response.ok) throw new Error('Bitte prüfe die Pflichtangaben für die Veröffentlichung.')
    await Promise.all([loadPrivateData(), loadSpotSuggestions()])
    showToast('Hallenvorschlag veröffentlicht')
  }

  async function rejectSpotSuggestion(id) {
    const response = await fetch(`/api/admin/spot-suggestions/${id}/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
    if (!response.ok) throw new Error('Der Hallenvorschlag konnte nicht abgelehnt werden.')
    await loadSpotSuggestions()
    showToast('Hallenvorschlag abgelehnt')
  }

  return (
    <div className={`app-shell${activeView === 'map' ? ' app-shell--map' : ''}`}>
      <header className="app-header">
        <button className="brand" onClick={() => navigate('map')} aria-label="Zur Karte"><img className="brand-logo" src="/BoulderO_Logo.ico" alt="" /><span>Boulder<span>O</span></span></button>
        <div className="header-progress"><span><b>{uniqueVisited}</b>/10 Hallen</span><i><em style={{ width: `${uniqueVisited * 10}%` }} /></i></div>
        {currentUser ? <button className="profile-chip" onClick={() => navigate('profile')} aria-label="Profil öffnen"><span className="profile-chip__image">{currentUser.image ? <img src={`/api/avatars/${currentUser.id}`} alt="" /> : currentUser.name.split(' ').map((name) => name[0]).join('').slice(0, 2)}</span><RankBadge progress={progress} /></button> : <button className="header-login" onClick={() => setAuthOpen(true)}><IconLogin2 size={18} />Anmelden</button>}
      </header>
      {!currentUser && welcomeOpen && <section className="welcome-screen"><div className="welcome-card"><img src="/BoulderO_Logo.ico" alt="BoulderO" /><h1>BoulderO</h1><p>Entdecke Hallen, halte Besuche fest und teile deine Boulderreise mit Freundinnen und Freunden.</p><div><button className="visit-button" onClick={() => setAuthOpen(true)}>Konto erstellen oder anmelden</button><button className="text-back" onClick={() => setWelcomeOpen(false)}>Karte entdecken</button></div></div><div className="welcome-legal-links"><button type="button" onClick={() => setLegalDialog('privacy')}>Datenschutz</button><button type="button" onClick={() => setLegalDialog('imprint')}>Impressum</button></div></section>}
      {activeView === 'map' && <MapView spots={spots} currentUser={currentUser} selectedId={selectedId} lastVisitedSpotId={journalVisits[0]?.spot_id} onSelectSpot={selectSpot} onVisit={openComposer} onPlan={openPlan} onReport={openCorrection} onOpenUserFeed={currentUser ? (user) => { setFeedAuthorFilter(user); navigate('social') } : null} onOpenPlanFeed={(plan) => { setFeedAuthorFilter(null); setFeedPlanFocus(plan); navigate('social') }} onOpenMessage={setMessageUser} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} isPickingSpot={isPickingSpot} onCancelPicker={() => setIsPickingSpot(false)} onMessage={showToast} />}
      {activeView === 'journal' && <JournalView spots={spots} currentUser={currentUser} journalVisits={journalVisits} onSignIn={() => setAuthOpen(true)} onOpenComposer={() => openComposer()} onOpenEntry={setSelectedEntry} onOpenImage={(src, alt) => setLightboxImage({ src, alt })} onLogPlan={openPlannedVisitJournal} onMarkPlanMissed={markPlanMissed} onOpenPlan={(plan) => { setFeedAuthorFilter(null); setFeedPlanFocus(plan); navigate('social') }} />}
      {activeView === 'profile' && <ProfileView spots={spots} currentUser={currentUser} onSignIn={() => setAuthOpen(true)} onSignOut={signOut} onDeleteAccount={deleteAccount} progress={progress} onOpenBadges={() => navigate('badges')} onOpenNotifications={() => navigate('notifications')} notificationCount={notificationSummary.unread_count} onOpenAdmin={() => navigate('admin')} onOpenAudit={() => { navigate('audit'); loadAuthAudit() }} onChangePassword={() => setPasswordDialogOpen(true)} onSuggestSpot={() => setSuggestionDialogOpen(true)} onOpenPrivacy={() => setLegalDialog('privacy')} onOpenImprint={() => setLegalDialog('imprint')} pendingSuggestionCount={spotSuggestions.length} pendingCorrectionCount={spotCorrectionReports.length} onUploadAvatar={uploadAvatar} />}
      {activeView === 'notifications' && currentUser && <NotificationSettingsView currentUser={currentUser} onBack={() => goBack('profile')} onUnreadChange={() => void loadNotificationSummary()} onOpenTarget={openNotificationTarget} onMessage={showToast} />}
      {activeView === 'badges' && <BadgesView progress={progress} onBack={() => goBack('profile')} />}
      {activeView === 'admin' && currentUser?.role === 'superadmin' && <AdminSpotsView spots={spots} suggestions={spotSuggestions} correctionReports={spotCorrectionReports} onCreate={createSpot} onPreviewImport={previewSpotImport} onApplyImport={applySpotImport} onUpdate={updateSpot} onDelete={deleteSpot} onApproveSuggestion={approveSpotSuggestion} onRejectSuggestion={rejectSpotSuggestion} onResolveCorrection={resolveSpotCorrection} onExport={exportSpots} onBack={() => goBack('profile')} />}
      {activeView === 'audit' && currentUser?.role === 'superadmin' && <AuditView events={authAudit} stats={adminStats} onBack={() => goBack('profile')} onOpenUsers={openRegisteredUsers} />}
      {activeView === 'social' && <FeedView onOpenImage={(src, alt) => setLightboxImage({ src, alt })} authorFilter={feedAuthorFilter} onClearAuthorFilter={() => setFeedAuthorFilter(null)} notificationCounts={notificationSummary} onSectionRead={markFeedSectionRead} spots={spots} onLogPlan={openPlannedVisitJournal} planFocus={feedPlanFocus} onPlanFocusConsumed={() => setFeedPlanFocus(null)} planRefreshKey={planRefreshKey} />}
      {(activeView === 'friends' || activeView === 'connections') && <FriendsView onOpenMessages={setMessageUser} onSummaryChange={setFriendSummary} onOpenGroups={() => navigate('groups')} onOpenUserFeed={(user) => { setFeedAuthorFilter(user); navigate('social') }} onOpenImage={(src, alt) => setLightboxImage({ src, alt })} notificationCounts={notificationSummary} onNotificationsRead={markNotificationTypesRead} />}
      {activeView === 'groups' && currentUser && <GroupsView spots={spots} onOpenFriends={() => navigate('friends')} onOpenSpot={openSpotOnMap} onOpenUserFeed={(user) => { setFeedAuthorFilter(user); navigate('social') }} onSummaryChange={setFriendSummary} notificationCounts={notificationSummary} onNotificationsRead={loadNotificationSummary} />}
      <nav className="bottom-nav" aria-label="Hauptnavigation">
        {navItems.map(({ id, label, icon: Icon }) => { const communityNotifications = Number(notificationSummary.unread_friends) + Number(notificationSummary.unread_groups); const feedNotifications = Number(notificationSummary.unread_feed) + Number(notificationSummary.unread_plans); const active = id === 'friends' ? ['friends', 'groups', 'connections'].includes(activeView) : activeView === id; return <button key={id} className={active ? 'is-active' : ''} onClick={() => navigate(id)}><span className="nav-icon"><Icon size={20} />{id === 'friends' && communityNotifications > 0 && <b className="nav-badge">{communityNotifications > 9 ? '9+' : communityNotifications}</b>}{id === 'social' && feedNotifications > 0 && <b className="nav-badge">{feedNotifications > 9 ? '9+' : feedNotifications}</b>}</span><span>{label}</span></button> })}
      </nav>
      {toast && <div className="toast"><IconCheck size={17} />{toast}</div>}
      {composerOpen && <JournalComposer key={composerPlan?.id ?? composerSpotId ?? 'new'} spot={spots.find((spot) => spot.id === composerSpotId)} onClose={closeComposer} onSave={createJournalEntry} onChooseOnMap={chooseSpotOnMap} surface={composerSurface} plannedVisit={composerPlan} />}
      {planDialogSpotId && <PlannedVisitDialog spot={spots.find((spot) => spot.id === planDialogSpotId)} onSave={createPlannedVisit} onClose={() => setPlanDialogSpotId(null)} surface="map" />}
      {correctionDialogSpotId && <SpotCorrectionDialog spot={spots.find((spot) => spot.id === correctionDialogSpotId)} onSave={submitSpotCorrection} onClose={() => setCorrectionDialogSpotId(null)} />}
      {selectedEntry && <JournalEntryDialog entry={selectedEntry} onClose={() => setSelectedEntry(null)} onUpdate={updateJournalEntry} onDelete={deleteJournalEntry} />}
      {authOpen && <SignInDialog configuration={authConfiguration} resetToken={resetToken} onClose={() => { setAuthOpen(false); setResetToken(null) }} onDemoSignIn={signInDemo} onMemberSignIn={signInMember} onRegister={registerMember} onRequestPasswordReset={requestPasswordReset} onResendVerification={resendVerification} onResetPassword={resetPassword} onOpenPrivacy={() => { setAuthOpen(false); setLegalDialog('privacy') }} onOpenImprint={() => { setAuthOpen(false); setLegalDialog('imprint') }} />}
      {passwordDialogOpen && <PasswordDialog onClose={() => setPasswordDialogOpen(false)} onSave={changePassword} />}
      {adminUsersOpen && <RegisteredUsersDialog users={adminUsers} total={adminUsersTotal} loading={adminUsersLoading} onClose={() => setAdminUsersOpen(false)} />}
      {suggestionDialogOpen && <SpotSuggestionDialog onSubmit={submitSpotSuggestion} onClose={() => setSuggestionDialogOpen(false)} />}
      {legalDialog && <LegalDialog kind={legalDialog} onClose={() => setLegalDialog(null)} />}
      {messageUser && <MessageDialog user={messageUser} onClose={() => setMessageUser(null)} onRead={async () => { const response = await fetch('/api/social/friends/summary'); if (response.ok) setFriendSummary(await response.json()); await loadNotificationSummary() }} />}
      {lightboxImage && <Lightbox image={lightboxImage} onClose={() => setLightboxImage(null)} />}
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
