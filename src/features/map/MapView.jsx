import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { IconAdjustmentsHorizontal, IconCalendarEvent, IconCheck, IconChevronDown, IconChevronRight, IconCurrentLocation, IconFlag, IconMapPin, IconMessageCircle, IconSearch, IconX } from '@tabler/icons-react'
import 'leaflet/dist/leaflet.css'
import { mannheimCenter } from '../../data/spots'
import { formatFeedDate, formatPlanDate, useOutsideDismiss } from '../../shared/viewHelpers.ts'
import { formatOpeningHoursLines } from '../../shared/openingHours.ts'
import { formatSpotArea, spotAreaSquareMeters } from '../../shared/spotArea.ts'
import { matchesSpotSearch, spotSearchMeta, spotSearchRank } from '../../shared/spotSearch.ts'

const mapViewStorageKey = 'bouldero.map-view'

function savedMapView() {
  try {
    const view = JSON.parse(window.localStorage.getItem(mapViewStorageKey))
    if (Number.isFinite(view?.latitude) && Number.isFinite(view?.longitude) && Number.isFinite(view?.zoom)
      && view.latitude >= -90 && view.latitude <= 90 && view.longitude >= -180 && view.longitude <= 180
      && view.zoom >= 1 && view.zoom <= 22) return view
  } catch {
    // Ignore unavailable or malformed local storage.
  }
  return null
}
export function markerIcon(visited, selected, animateSelection = false) {
  return L.divIcon({
    className: 'spot-marker-wrapper',
    html: `<span class="spot-marker ${visited ? 'is-visited' : ''} ${selected ? 'is-selected' : ''} ${animateSelection ? 'is-selection-animated' : ''}">${visited ? '<span>✓</span>' : ''}</span>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  })
}

function userLocationIcon() {
  return L.divIcon({
    className: 'user-location-wrapper',
    html: '<span class="user-location-marker"><span></span></span>',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })
}

function escapeMarkerText(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
}

const activityIconCache = new Map()
const planIconCache = new Map()
function activityIcon(activity, index, offset, isPreview) {
  const cacheKey = [activity.id, index, offset.x, offset.y, isPreview, activity.user_name, activity.user_image, activity.body, activity.media?.[0]?.id].join('|')
  const cached = activityIconCache.get(cacheKey)
  if (cached) return cached
  const initials = activity.user_name.split(' ').map((part) => part[0]).join('').slice(0, 2)
  const description = (activity.body || `war bei ${activity.spot_name}`).replace(/\s+/g, ' ').slice(0, 150)
  const imageId = activity.media?.find((media) => !String(media.contentType ?? '').startsWith('video/'))?.id
  const preview = isPreview ? `<span class="map-activity-preview${imageId ? ' has-photo' : ' is-text-only'}">${imageId ? `<img src="/api/media/${imageId}" alt="" />` : ''}<span><b>${escapeMarkerText(activity.user_name)}</b><small>${escapeMarkerText(description)}</small></span></span>` : ''
  const avatar = activity.user_image ? `<img src="/api/avatars/${encodeURIComponent(activity.user_id)}" alt="" onerror="this.remove()" />` : ''
  const icon = L.divIcon({
    className: 'map-activity-wrapper',
    html: `<span class="map-activity-stage"><span class="map-activity-offset" style="--activity-offset-x:${offset.x}px;--activity-offset-y:${offset.y}px"><span class="map-activity-marker" style="--activity-delay:${(index % 6) * -0.55}s"><span class="map-activity-avatar">${escapeMarkerText(initials)}${avatar}</span>${preview}</span></span></span>`,
    iconSize: [120, 120],
    iconAnchor: [60, 60],
  })
  if (activityIconCache.size > 300) activityIconCache.clear()
  activityIconCache.set(cacheKey, icon)
  return icon
}

function planMapIcon(plan, offset, showAttendees) {
  const cacheKey = [
    plan.id,
    plan.starts_at,
    offset.x,
    offset.y,
    showAttendees,
    ...(plan.attendees ?? []).map((person) => [person.user_id, person.user_name, person.user_image, person.response].join(':')),
  ].join('|')
  const cached = planIconCache.get(cacheKey)
  if (cached) return cached
  const day = new Intl.DateTimeFormat('de-DE', { day: '2-digit' }).format(new Date(plan.starts_at))
  const attendees = showAttendees ? (plan.attendees ?? []).slice(0, 6) : []
  const attendeeIcons = attendees.map((person, index) => {
    const angle = ((Math.PI * 2 * index) / attendees.length) - Math.PI / 2
    const initials = person.user_name.split(' ').map((part) => part[0]).join('').slice(0, 2)
    const avatar = person.user_image ? `<img src="/api/avatars/${encodeURIComponent(person.user_id)}" alt="" onerror="this.remove()" />` : ''
    const responseClass = person.response === 'going' ? 'is-going' : 'is-interested'
    return `<span class="map-plan-attendee ${responseClass}" style="--plan-attendee-x:${(Math.cos(angle) * 26).toFixed(1)}px;--plan-attendee-y:${(Math.sin(angle) * 26).toFixed(1)}px;--plan-attendee-delay:${(index * -.42).toFixed(2)}s"><span class="map-plan-attendee__float">${escapeMarkerText(initials)}${avatar}</span></span>`
  }).join('')
  const overflow = showAttendees && (plan.attendees?.length ?? 0) > attendees.length ? `<span class="map-plan-attendee map-plan-attendee--more">+${plan.attendees.length - attendees.length}</span>` : ''
  return L.divIcon({
    className: 'map-plan-wrapper',
    html: `<span class="map-plan-stage"><span class="map-plan-offset" style="--plan-offset-x:${offset.x}px;--plan-offset-y:${offset.y}px"><span class="map-plan-marker"><small>${day}</small>${attendeeIcons}${overflow}</span></span></span>`,
    iconSize: [130, 130],
    iconAnchor: [65, 65],
  })
  if (planIconCache.size > 300) planIconCache.clear()
  planIconCache.set(cacheKey, icon)
  return icon
}

function FocusMap({ spot, request }) {
  const map = useMap()
  const handledRequest = useRef(0)
  useEffect(() => {
    if (!spot || request <= 0 || request <= handledRequest.current) return
    handledRequest.current = request
    map.flyTo(spot.position, 14, { duration: 0.45 })
  }, [spot, request, map])
  return null
}

function CenterMap({ spot, request }) {
  const map = useMap()
  const handledRequest = useRef(request)
  useEffect(() => {
    if (!spot || request <= handledRequest.current) return
    handledRequest.current = request
    map.panTo(spot.position, { animate: true, duration: .45 })
  }, [spot, request, map])
  return null
}

function FocusLocation({ location, request }) {
  const map = useMap()
  useEffect(() => {
    if (location && request > 0) map.flyTo(location, 14, { duration: .45 })
  }, [location, request, map])
  return null
}

function MapActivityViewport({ onChange }) {
  const map = useMap()
  useEffect(() => {
    let timer = null
    function update() {
      const bounds = map.getBounds()
      const nextBounds = {
        west: Number(bounds.getWest().toFixed(4)),
        south: Number(bounds.getSouth().toFixed(4)),
        east: Number(bounds.getEast().toFixed(4)),
        north: Number(bounds.getNorth().toFixed(4)),
        zoom: map.getZoom(),
      }
      onChange((current) => current && Object.entries(nextBounds).every(([key, value]) => current[key] === value) ? current : nextBounds)
    }
    function scheduleUpdate() {
      window.clearTimeout(timer)
      timer = window.setTimeout(update, 180)
    }
    update()
    map.on('moveend', scheduleUpdate)
    map.on('zoomend', scheduleUpdate)
    return () => {
      window.clearTimeout(timer)
      map.off('moveend', scheduleUpdate)
      map.off('zoomend', scheduleUpdate)
    }
  }, [map, onChange])
  return null
}

function MapViewportPersistence() {
  const map = useMap()
  useEffect(() => {
    function save() {
      const center = map.getCenter()
      try {
        window.localStorage.setItem(mapViewStorageKey, JSON.stringify({
          latitude: Number(center.lat.toFixed(6)),
          longitude: Number(center.lng.toFixed(6)),
          zoom: map.getZoom(),
        }))
      } catch {
        // The map remains usable if storage is unavailable.
      }
    }
    map.on('moveend', save)
    return () => map.off('moveend', save)
  }, [map])
  return null
}

function MapViewportResize() {
  const map = useMap()
  useEffect(() => {
    let frame = null
    function update() {
      if (frame) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => map.invalidateSize({ pan: false, debounceMoveend: true }))
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(map.getContainer())
    window.addEventListener('resize', update)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [map])
  return null
}

function MapActivityLayer({ activities }) {
  const map = useMap()
  const [zoom, setZoom] = useState(() => map.getZoom())
  const [previewIndex, setPreviewIndex] = useState(0)
  useEffect(() => {
    const updateZoom = () => setZoom(map.getZoom())
    map.on('zoomend', updateZoom)
    return () => map.off('zoomend', updateZoom)
  }, [map])
  const markers = useMemo(() => {
    const visible = activities.filter((activity) => Number.isFinite(Number(activity.latitude)) && Number.isFinite(Number(activity.longitude)))
    const totals = new Map()
    visible.forEach((activity) => totals.set(activity.spot_id, (totals.get(activity.spot_id) ?? 0) + 1))
    const counts = new Map()
    return visible.map((activity) => {
      const index = counts.get(activity.spot_id) ?? 0
      counts.set(activity.spot_id, index + 1)
      const ringIndex = Math.floor(index / 6)
      const indexOnRing = index % 6
      const countOnRing = Math.min(6, totals.get(activity.spot_id) - ringIndex * 6)
      const angle = (Math.PI * 2 * indexOnRing) / Math.max(countOnRing, 1) - Math.PI / 2 + ringIndex * .38
      const radius = 38 + ringIndex * 24
      return { activity, index, position: [Number(activity.latitude), Number(activity.longitude)], offset: { x: Number((Math.cos(angle) * radius).toFixed(1)), y: Number((Math.sin(angle) * radius).toFixed(1)) } }
    })
  }, [activities])
  useEffect(() => {
    setPreviewIndex(0)
    if (markers.length < 2) return undefined
    const timer = window.setInterval(() => setPreviewIndex((current) => current + 1), 3000)
    return () => window.clearInterval(timer)
  }, [markers.length])
  const previewId = markers.length ? markers[previewIndex % markers.length].activity.id : null
  if (zoom < 10) return null
  return markers.map(({ activity, index, position, offset }) => <Marker key={activity.id} position={position} icon={activityIcon(activity, index, offset, activity.id === previewId)} zIndexOffset={activity.id === previewId ? 700 : 400} interactive={false} />)
}

function MapPlanLayer({ plans, onSelect, showAttendees }) {
  const map = useMap()
  const [zoom, setZoom] = useState(() => map.getZoom())
  useEffect(() => {
    const updateZoom = () => setZoom(map.getZoom())
    map.on('zoomend', updateZoom)
    return () => map.off('zoomend', updateZoom)
  }, [map])
  const markers = useMemo(() => {
    const totals = new Map()
    plans.forEach((plan) => totals.set(plan.spot_id, (totals.get(plan.spot_id) ?? 0) + 1))
    const counts = new Map()
    return plans.map((plan) => {
      const index = counts.get(plan.spot_id) ?? 0
      counts.set(plan.spot_id, index + 1)
      const total = totals.get(plan.spot_id) ?? 1
      const ringIndex = Math.floor(index / 5)
      const indexOnRing = index % 5
      const countOnRing = Math.min(5, total - ringIndex * 5)
      const angle = (Math.PI * 2 * indexOnRing) / Math.max(countOnRing, 1) - Math.PI / 2 + ringIndex * .38
      const radius = total === 1 ? 0 : 34 + ringIndex * 26
      return { plan, position: [Number(plan.latitude), Number(plan.longitude)], offset: { x: Number((Math.cos(angle) * radius).toFixed(1)), y: Number((Math.sin(angle) * radius).toFixed(1)) } }
    })
  }, [plans])
  const showPlanAttendees = showAttendees && zoom >= 10
  return markers.map(({ plan, position, offset }) => <Marker key={plan.id} position={position} icon={planMapIcon(plan, offset, showPlanAttendees)} zIndexOffset={600} eventHandlers={{ click: (event) => { if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent); onSelect(plan) } }} />)
}

function MobileMapDismiss({ onDismiss }) {
  useMapEvents({
    click: () => {
      if (window.matchMedia('(max-width: 560px)').matches) onDismiss()
    },
  })
  return null
}

function BoulderMap({ spots, selectedSpot, onSelect, onDismiss, userLocation, locationFocusRequest, spotFocusRequest: externalSpotFocusRequest, spotCenterRequest, activities, plans, showVisitMarkers, onSelectPlan, onActivityBoundsChange }) {
  const [initialView] = useState(savedMapView)
  const [spotFocusRequest, setSpotFocusRequest] = useState(0)
  const [animatedSpotId, setAnimatedSpotId] = useState(null)
  const animationTimer = useRef(null)
  useEffect(() => () => window.clearTimeout(animationTimer.current), [])
  function animateSpotSelection(spotId) {
    window.clearTimeout(animationTimer.current)
    setAnimatedSpotId(spotId)
    animationTimer.current = window.setTimeout(() => setAnimatedSpotId(null), 280)
  }
  return (
    <div className="map-frame">
      <MapContainer center={initialView ? [initialView.latitude, initialView.longitude] : mannheimCenter} zoom={initialView?.zoom ?? 13} zoomControl={false} scrollWheelZoom className="map-canvas">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FocusMap spot={selectedSpot} request={spotFocusRequest} />
        <FocusMap spot={selectedSpot} request={externalSpotFocusRequest} />
        <CenterMap spot={selectedSpot} request={spotCenterRequest} />
        <FocusLocation location={userLocation} request={locationFocusRequest} />
        <MapViewportResize />
        <MapViewportPersistence />
        <MobileMapDismiss onDismiss={onDismiss} />
        <MapActivityViewport onChange={onActivityBoundsChange} />
        {userLocation && <Marker position={userLocation} icon={userLocationIcon()} interactive={false} />}
        <MapActivityLayer activities={activities} />
        {spots.map((spot) => (
          <Marker
            key={spot.id}
            position={spot.position}
            icon={markerIcon(spot.visits > 0, selectedSpot?.id === spot.id, animatedSpotId === spot.id)}
            eventHandlers={{ click: (event) => {
              if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent)
              animateSpotSelection(spot.id)
              if (selectedSpot?.id === spot.id) setSpotFocusRequest((current) => current + 1)
              else onSelect(spot.id)
            } }}
          />
        ))}
        <MapPlanLayer plans={plans} onSelect={onSelectPlan} showAttendees={showVisitMarkers} />
      </MapContainer>
      <div className="map-key" aria-label="Kartenlegende">
        <span><i className="key-dot key-dot--visited">✓</i>Besucht</span>
        {activities.length > 0 && <span><i className="key-dot key-dot--activity" />Aktuelle Feed-Besuche</span>}
        {plans.length > 0 && <span><i className="key-dot key-dot--plan" />Geplante Besuche</span>}
      </div>
    </div>
  )
}

function SpotVisitors({ spotId, onOpenUserFeed }) {
  const [visitors, setVisitors] = useState([])
  const [open, setOpen] = useState(false)
  const visitorRef = useOutsideDismiss(open, () => setOpen(false))
  useEffect(() => {
    if (!onOpenUserFeed) { setVisitors([]); return undefined }
    let cancelled = false
    fetch(`/api/social/spots/${spotId}/visitors`, { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : { visitors: [] })
      .then((payload) => { if (!cancelled) setVisitors(payload.visitors) })
      .catch(() => { if (!cancelled) setVisitors([]) })
    return () => { cancelled = true }
  }, [spotId, onOpenUserFeed])
  if (!visitors.length) return null
  return <div className="spot-visitors" ref={visitorRef}><div className="spot-visitors__heading"><span>Schon dort gewesen</span><button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>{visitors.slice(0, 5).map((visitor, index) => <span className="spot-visitors__avatar" style={{ zIndex: 5 - index }} key={visitor.id}>{visitor.image ? <img src={`/api/avatars/${visitor.id}`} alt="" /> : visitor.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span>)}{visitors.length > 5 && <b>+{visitors.length - 5}</b>}</button></div>{open && <div className="spot-visitors__popover">{visitors.map((visitor) => <button type="button" key={visitor.id} onClick={() => { setOpen(false); onOpenUserFeed(visitor) }}><span className="person-avatar">{visitor.image ? <img src={`/api/avatars/${visitor.id}`} alt="" /> : visitor.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><span><b>{visitor.name}</b><small>@{visitor.username} · zuletzt {formatFeedDate(visitor.last_visited_at)}</small></span><IconChevronRight size={16} /></button>)}</div>}</div>
}

function SpotPlans({ plans, onOpenPlanFeed }) {
  const [open, setOpen] = useState(false)
  const ref = useOutsideDismiss(open, () => setOpen(false))
  if (!plans.length) return null
  return <div className="spot-plans" ref={ref}><button type="button" className="spot-plans__toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={`${plans.length} geplante Besuche anzeigen`} title="Geplante Besuche"><IconCalendarEvent size={17} /><b>{plans.length}</b></button>{open && <div className="spot-plans__popover">{plans.map((plan) => <button type="button" key={plan.id} onClick={() => { setOpen(false); onOpenPlanFeed?.(plan) }}><span className="person-avatar">{plan.user_image ? <img src={`/api/avatars/${plan.user_id}`} alt="" /> : plan.user_name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><span><b>{plan.user_name}</b><small>{formatPlanDate(plan.starts_at)}</small></span><IconChevronRight size={16} /></button>)}</div>}</div>
}

function SpotSheet({ spot, plans, onClose, onVisit, onPlan, onReport, onCenter, hideOnMobile, onOpenUserFeed, onOpenPlanFeed }) {
  const [detailsOpen, setDetailsOpen] = useState(() => typeof window === 'undefined' || !window.matchMedia('(max-width: 560px)').matches)
  const visited = spot.visits > 0
  const lastVisitDate = spot.last_visit_at ? new Date(`${String(spot.last_visit_at).slice(0, 10)}T00:00:00`) : null
  const daysSinceLastVisit = lastVisitDate ? Math.floor((Date.now() - lastVisitDate.getTime()) / 86400000) : 0
  const visitLabel = lastVisitDate && daysSinceLastVisit > 14
    ? `besucht am ${new Intl.DateTimeFormat('de-DE').format(lastVisitDate)}`
    : 'besucht'
  const websiteLabel = (() => {
    if (!spot.website) return 'Keine Website'
    try { return new URL(spot.website).hostname.replace(/^www\./, '') } catch { return spot.website }
  })()
  useEffect(() => {
    setDetailsOpen(typeof window === 'undefined' || !window.matchMedia('(max-width: 560px)').matches)
  }, [spot.id])
  return (
    <aside className={`spot-sheet${hideOnMobile ? ' spot-sheet--mobile-hidden' : ''}`} style={spot.image_url ? { '--spot-image': `url("${spot.image_url}")` } : undefined}>
      <div className="spot-sheet__topline">
        <div className="spot-sheet__topline-actions"><SpotPlans plans={plans} onOpenPlanFeed={onOpenPlanFeed} />{visited && <span className="visited-label"><IconCheck size={14} /> {visitLabel}</span>}<button type="button" className="icon-button ui-icon-button spot-sheet__close" onClick={onClose} aria-label="Hallenkarte schließen" title="Schließen"><IconX size={18} /></button></div>
      </div>
      <div className="spot-sheet__title-row">
        <div>
          <h2>{spot.name}</h2>
          <button type="button" className="spot-sheet__address" onClick={onCenter} title="Marker auf der Karte anzeigen">{spot.address}</button>
        </div>
      </div>
      <button type="button" className="spot-details-toggle" onClick={() => setDetailsOpen((value) => !value)} aria-expanded={detailsOpen} aria-controls={`spot-details-${spot.id}`}>
        Infos <IconChevronDown size={18} />
      </button>
      <div className={`spot-details${detailsOpen ? ' is-open' : ''}`} id={`spot-details-${spot.id}`} aria-hidden={!detailsOpen}>
        <div className="spot-details__content">
          <div className="spot-meta">
            <span className="spot-meta__opening"><b>Öffnungszeiten</b>{formatOpeningHoursLines(spot.opening_hours ?? spot.open).map((line) => <small key={line}>{line}</small>)}</span>
            <span><b>Area</b>{formatSpotArea(spot.area_sqm ?? spot.size)}</span>
            <span><b>URL</b>{spot.website ? <a className="spot-website-link" href={spot.website} target="_blank" rel="noreferrer" title={spot.website}>{websiteLabel}</a> : websiteLabel}</span>
            <span><b>Deine Besuche</b>{spot.visits}</span>
          </div>
          <SpotVisitors spotId={spot.id} onOpenUserFeed={onOpenUserFeed} />
        </div>
      </div>
      <button className={`visit-button ${visited ? 'is-visited' : ''}`} onClick={() => onVisit(spot.id)}>
        <IconCheck size={19} />
        {visited ? 'Weiteren Besuch eintragen' : 'Ersten Besuch eintragen'}
      </button>
      <div className="spot-sheet__secondary-actions"><button type="button" className="spot-sheet__plan" onClick={() => onPlan(spot.id)}><IconCalendarEvent size={17} />Besuch planen</button><button type="button" className="spot-sheet__report" onClick={() => onReport(spot.id)} aria-label="Datenfehler melden" title="Datenfehler melden"><IconFlag size={17} /></button></div>
    </aside>
  )
}


function MapPlanAttendeeCount({ planId, response, count, onOpenUserFeed }) {
  const [people, setPeople] = useState([])
  const [open, setOpen] = useState(false)
  const ref = useOutsideDismiss(open, () => setOpen(false))
  const label = response === 'going' ? 'Dabei' : 'Interessiert'
  async function toggle() {
    if (!open) {
      const result = await fetch(`/api/planned-visits/${planId}/rsvps`)
      if (result.ok) setPeople((await result.json()).rsvps.filter((person) => person.response === response))
    }
    setOpen((value) => !value)
  }
  return <div className="spot-visitors map-plan-attendee-count" ref={ref}><button type="button" onClick={toggle} aria-expanded={open}><b>{label}</b>{count}</button>{open && <div className="spot-visitors__popover">{people.length ? people.map((person) => <button type="button" key={person.id} onClick={() => { setOpen(false); onOpenUserFeed?.(person) }}><span className="person-avatar">{person.image ? <img src={`/api/avatars/${person.id}`} alt="" /> : person.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><span><b>{person.name}</b><small>@{person.username} · {label}</small></span><IconChevronRight size={16} /></button>) : <p>Noch niemand {response === 'going' ? 'dabei.' : 'interessiert.'}</p>}</div>}</div>
}

function MapPlanSheet({ plan, onClose, onRsvp, onOpenPlanFeed, onOpenMessage, onOpenUserFeed }) {
  const start = formatPlanDate(plan.starts_at)
  return <aside className="spot-sheet map-plan-sheet"><div className="spot-sheet__topline"><span className="eyebrow">Geplant</span><button type="button" className="icon-button ui-icon-button" onClick={onClose} aria-label="Planung schließen"><IconX size={18} /></button></div><div className="map-plan-sheet__author"><span className="person-avatar">{plan.user_image ? <img src={`/api/avatars/${plan.user_id}`} alt="" /> : plan.user_name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><span><b>{plan.user_name}</b><small>plant einen Besuch</small></span>{!plan.is_owner && <button type="button" className="map-plan-sheet__message" onClick={() => onOpenMessage?.({ id: plan.user_id, name: plan.user_name, image: plan.user_image })} aria-label={`${plan.user_name} schreiben`} title="Nachricht schreiben"><IconMessageCircle size={17} /></button>}</div><h2>{plan.spot_name}</h2><p>{plan.district} · {plan.address}</p><div className="spot-meta"><span><b>Wann</b>{start}</span><MapPlanAttendeeCount planId={plan.id} response="going" count={plan.going_count} onOpenUserFeed={onOpenUserFeed} /><MapPlanAttendeeCount planId={plan.id} response="interested" count={plan.interested_count} onOpenUserFeed={onOpenUserFeed} /></div>{plan.note && <p className="map-plan-sheet__note">{plan.note}</p>}{plan.is_owner ? <div className="map-plan-sheet__own-actions"><span className="map-plan-sheet__response">Deine Planung</span><button type="button" className="journal-plan-open" onClick={() => onOpenPlanFeed?.(plan)} aria-label={`${plan.spot_name} im Planungsfeed öffnen`} title="Im Planungsfeed öffnen"><IconChevronRight size={18} /></button></div> : <div className="map-plan-sheet__actions"><button type="button" className={plan.my_response === 'interested' ? 'is-active' : ''} onClick={() => onRsvp(plan, plan.my_response === 'interested' ? null : 'interested')}>Interessiert</button><button type="button" className={plan.my_response === 'going' ? 'is-active' : ''} onClick={() => onRsvp(plan, plan.my_response === 'going' ? null : 'going')}>{plan.my_response === 'going' ? 'Zugesagt' : 'Zusagen'}</button></div>}</aside>
}

export function MapView({ spots, currentUser, selectedId, spotFocusRequest = 0, lastVisitedSpotId, onSelectSpot, onVisit, onPlan, onReport, onOpenUserFeed, onOpenPlanFeed, onOpenMessage, query, setQuery, filter, setFilter, isPickingSpot, onCancelPicker, onMessage }) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [userLocation, setUserLocation] = useState(null)
  const [locationFocusRequest, setLocationFocusRequest] = useState(0)
  const [spotCenterRequest, setSpotCenterRequest] = useState(0)
  const [activityBounds, setActivityBounds] = useState(null)
  const [activities, setActivities] = useState([])
  const [mapPlans, setMapPlans] = useState([])
  const [selectedMapPlan, setSelectedMapPlan] = useState(null)
  const [showPlanned, setShowPlanned] = useState(false)
  const [showVisitMarkers, setShowVisitMarkers] = useState(true)

  function requestUserLocation() {
    if (!navigator.geolocation) { onMessage('Standort wird von diesem Browser nicht unterstützt'); return }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { setUserLocation([coords.latitude, coords.longitude]); setLocationFocusRequest((value) => value + 1); onMessage('Dein Standort wird auf der Karte angezeigt') },
      () => onMessage('Standort konnte nicht bestimmt werden. Prüfe die Browserfreigabe.'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }
  useEffect(() => {
    const requestedSpotId = new URLSearchParams(window.location.search).get('spot')
    const spotToFocus = spots.find((spot) => spot.id === requestedSpotId)
    if (spotToFocus) onSelectSpot(spotToFocus.id)
    if (!navigator.geolocation || !navigator.permissions?.query) return undefined
    let cancelled = false
    navigator.permissions.query({ name: 'geolocation' }).then((permission) => {
      if (cancelled || permission.state !== 'granted') return
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => { if (!cancelled) setUserLocation([coords.latitude, coords.longitude]) },
        () => undefined,
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
      )
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [spots])
  useEffect(() => {
    if (!currentUser || !showVisitMarkers || !activityBounds || activityBounds.zoom < 10) {
      setActivities([])
      return undefined
    }
    const params = new URLSearchParams(['west', 'south', 'east', 'north'].map((key) => [key, String(activityBounds[key])]))
    let cancelled = false
    const controller = new AbortController()
    async function loadActivities() {
      const response = await fetch(`/api/social/map-activity?${params}`, { signal: controller.signal, cache: 'no-store' })
      if (!response.ok) throw new Error('Kartenaktivitäten konnten nicht geladen werden.')
      const payload = await response.json()
      if (!cancelled) setActivities((current) => {
        const existing = new Map(current.map((activity) => [activity.id, activity]))
        const next = payload.activities.map((activity) => {
          const previous = existing.get(activity.id)
          const sameMedia = previous?.media?.length === activity.media?.length && previous?.media?.every((media, index) => media.id === activity.media[index].id)
          return previous && previous.body === activity.body && previous.user_name === activity.user_name && previous.user_image === activity.user_image && sameMedia ? previous : activity
        })
        return current.length === next.length && current.every((activity, index) => activity === next[index]) ? current : next
      })
    }
    loadActivities().catch((error) => { if (error.name !== 'AbortError' && !cancelled) setActivities([]) })
    const interval = window.setInterval(() => loadActivities().catch((error) => { if (error.name !== 'AbortError' && !cancelled) setActivities([]) }), 60000)
    return () => { cancelled = true; controller.abort(); window.clearInterval(interval) }
  }, [activityBounds, currentUser?.id, showVisitMarkers])
  useEffect(() => {
    if (!currentUser) {
      setMapPlans([])
      return undefined
    }
    // While the planning volume is still small, keep upcoming plans available across the map.
    const params = new URLSearchParams({ global: 'true' })
    const controller = new AbortController()
    let cancelled = false
    async function loadPlans() {
      const response = await fetch(`/api/social/map-plans?${params}`, { signal: controller.signal, cache: 'no-store' })
      if (!response.ok) throw new Error('Kartenplanungen konnten nicht geladen werden.')
      const payload = await response.json()
      if (!cancelled) setMapPlans(payload.plannedVisits)
    }
    loadPlans().catch((error) => { if (error.name !== 'AbortError' && !cancelled) setMapPlans([]) })
    const interval = window.setInterval(() => loadPlans().catch((error) => { if (error.name !== 'AbortError' && !cancelled) setMapPlans([]) }), 60000)
    return () => { cancelled = true; controller.abort(); window.clearInterval(interval) }
  }, [currentUser?.id])
  async function updateMapPlanRsvp(plan, choice) {
    const response = await fetch(`/api/planned-visits/${plan.id}/rsvp`, choice ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response: choice }) } : { method: 'DELETE' })
    if (!response.ok) { onMessage('Deine Zusage konnte nicht aktualisiert werden.'); return }
    setSelectedMapPlan((current) => {
      if (current?.id !== plan.id) return current
      const wasGoing = current.my_response === 'going' ? 1 : 0
      const wasInterested = current.my_response === 'interested' ? 1 : 0
      return { ...current, my_response: choice, going_count: Number(current.going_count) - wasGoing + (choice === 'going' ? 1 : 0), interested_count: Number(current.interested_count) - wasInterested + (choice === 'interested' ? 1 : 0) }
    })
    setMapPlans((current) => current.map((item) => {
      if (item.id !== plan.id) return item
      const wasGoing = item.my_response === 'going' ? 1 : 0
      const wasInterested = item.my_response === 'interested' ? 1 : 0
      return { ...item, my_response: choice, going_count: Number(item.going_count) - wasGoing + (choice === 'going' ? 1 : 0), interested_count: Number(item.interested_count) - wasInterested + (choice === 'interested' ? 1 : 0) }
    }))
    onMessage(choice === 'going' ? 'Zusage gespeichert' : choice === 'interested' ? 'Interesse gespeichert' : 'Rückmeldung entfernt')
  }
  const hallFilter = filter === 'planned' ? 'all' : filter
  const matchingSpots = useMemo(() => {
    return spots.filter((spot) => {
      const matchesSearch = matchesSpotSearch(spot, query)
      const area = spotAreaSquareMeters(spot.area_sqm ?? spot.size)
      const matchesFilter = hallFilter === 'all'
        || (hallFilter === 'visited' && spot.visits > 0)
        || (hallFilter === 'large' && area !== null && area >= 1000)
        || (hallFilter === 'small' && area !== null && area < 750)
        || (hallFilter === 'late' && /22:30|23:00/.test(spot.opening_hours ?? spot.open ?? ''))
      return matchesSearch && matchesFilter
    }).sort((first, second) => spotSearchRank(first, query) - spotSearchRank(second, query) || first.name.localeCompare(second.name, 'de-DE'))
  }, [spots, query, hallFilter])

  const visibleSpots = matchingSpots
  const selectedSpot = selectedId ? spots.find((spot) => spot.id === selectedId) ?? null : null
  const plannedSpotIds = useMemo(() => new Set(mapPlans.map((plan) => String(plan.spot_id))), [mapPlans])

  return (
    <main className="view map-view">
      <div className="map-toolbar">
        <div className="search-control">
          <label className="search-field">
            <IconSearch size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hallen in Mannheim suchen" aria-expanded={Boolean(query)} aria-controls="search-results" />
            {query && <button type="button" onClick={() => setQuery('')} aria-label="Suche löschen"><IconX size={16} /></button>}
          </label>
          {query && <div className={`search-results${matchingSpots.length >= 4 ? ' search-results--scrollable' : ''}`} id="search-results" role="listbox">
            {matchingSpots.length ? matchingSpots.map((spot) => <button type="button" role="option" key={spot.id} onClick={() => { setSelectedMapPlan(null); onSelectSpot(spot.id); setQuery('') }}><IconMapPin size={17} /><span><b>{spot.name}</b><small>{spotSearchMeta(spot)}</small></span></button>) : <p>Keine Hallen gefunden.</p>}
          </div>}
        </div>
        <button type="button" className="toolbar-filter ui-icon-button" aria-label="Filter öffnen" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)}><IconAdjustmentsHorizontal size={19} /></button>
        <button type="button" className="toolbar-location ui-icon-button" aria-label="Meinen Standort anzeigen" onClick={requestUserLocation}><IconCurrentLocation size={19} /></button>
        {filtersOpen && <div className="filter-menu" aria-label="Kartenfilter"><span className="eyebrow">Hallen filtern</span>{[
          ['all', 'Alle Hallen'], ['visited', 'Besucht'], ['large', 'Große Hallen'], ['small', 'Kompakt'], ['late', 'Bis spät geöffnet'],
        ].map(([id, label]) => <button type="button" key={id} className={hallFilter === id ? 'is-active' : ''} onClick={() => { setFilter(id); setFiltersOpen(false) }}>{label}{hallFilter === id && <IconCheck size={15} />}</button>)}<span className="eyebrow">Auf Karte zeigen</span><button type="button" className={showPlanned ? 'is-active' : ''} onClick={() => setShowPlanned((value) => !value)}>Geplante Besuche{showPlanned && <IconCheck size={15} />}</button><button type="button" className={showVisitMarkers ? 'is-active' : ''} onClick={() => setShowVisitMarkers((value) => !value)}>Besuchsmarker{showVisitMarkers && <IconCheck size={15} />}</button></div>}
      </div>
      <div className="filter-row">
        {[
          ['all', 'Alle Hallen'],
          ['visited', 'Besucht'],
        ].map(([id, label]) => (
          <button key={id} className={`filter-chip ${hallFilter === id ? 'is-active' : ''}`} onClick={() => setFilter(id)}>{label}</button>
        ))}
        <button type="button" className={`filter-chip filter-chip--planned ${showPlanned ? 'is-active' : ''}`} onClick={() => setShowPlanned((value) => !value)}>Geplant</button>
        <button type="button" className={`filter-chip filter-chip--activity ${showVisitMarkers ? 'is-active' : ''}`} onClick={() => setShowVisitMarkers((value) => !value)}>Besuche</button>
        <span className="result-count">{visibleSpots.length} Orte{showPlanned ? ` · ${mapPlans.length} Planungen` : ''}</span>
      </div>
      {isPickingSpot && <div className="map-picker-notice"><IconMapPin size={18} /><span><b>Halle auf der Karte auswählen</b>Tippe auf einen Marker, um den Besuch einzutragen.</span><button type="button" onClick={onCancelPicker}>Abbrechen</button></div>}
      <BoulderMap spots={visibleSpots} selectedSpot={selectedSpot} onSelect={(spotId) => { setSelectedMapPlan(null); onSelectSpot(spotId) }} onSelectPlan={(plan) => { setSelectedMapPlan(plan); onSelectSpot(null) }} onDismiss={() => { if (!isPickingSpot) { setSelectedMapPlan(null); onSelectSpot(null) } }} userLocation={userLocation} locationFocusRequest={locationFocusRequest} spotFocusRequest={spotFocusRequest} spotCenterRequest={spotCenterRequest} activities={showVisitMarkers ? activities.filter((activity) => !showPlanned || !plannedSpotIds.has(String(activity.spot_id))) : []} plans={showPlanned ? mapPlans : []} showVisitMarkers={showVisitMarkers} onActivityBoundsChange={setActivityBounds} />
      {selectedSpot && <SpotSheet spot={selectedSpot} plans={mapPlans.filter((plan) => String(plan.spot_id) === String(selectedSpot.id))} onClose={() => onSelectSpot(null)} onVisit={onVisit} onPlan={onPlan} onReport={onReport} onCenter={() => setSpotCenterRequest((value) => value + 1)} onOpenUserFeed={onOpenUserFeed} onOpenPlanFeed={onOpenPlanFeed} hideOnMobile={Boolean(query)} />}
      {selectedMapPlan && <MapPlanSheet plan={selectedMapPlan} onClose={() => setSelectedMapPlan(null)} onRsvp={updateMapPlanRsvp} onOpenPlanFeed={onOpenPlanFeed} onOpenMessage={onOpenMessage} onOpenUserFeed={onOpenUserFeed} />}
    </main>
  )
}
