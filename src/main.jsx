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

const navItems = [
  { id: 'map', label: 'Karte', icon: IconMapPin },
  { id: 'journal', label: 'Tagebuch', icon: IconBookmark },
  { id: 'social', label: 'Feed', icon: IconMessageCircle },
  { id: 'friends', label: 'Freunde', icon: IconUsers },
  { id: 'profile', label: 'Profil', icon: IconUserCircle },
]

const appViews = new Set(['map', 'journal', 'social', 'friends', 'profile', 'badges', 'connections', 'admin', 'audit'])

function viewFromLocation() {
  const segment = window.location.pathname.split('/').filter(Boolean)[0]
  return appViews.has(segment) ? segment : 'map'
}

function pathForView(view) {
  return view === 'map' ? '/' : `/${view}`
}

function markerIcon(visited, selected) {
  return L.divIcon({
    className: 'spot-marker-wrapper',
    html: `<span class="spot-marker ${visited ? 'is-visited' : ''} ${selected ? 'is-selected' : ''}">${visited ? '<span>✓</span>' : ''}</span>`,
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

function activityIcon(activity, index, isPreview) {
  const cacheKey = [activity.id, index, isPreview, activity.user_name, activity.user_image, activity.body, activity.media?.[0]?.id].join('|')
  const cached = activityIconCache.get(cacheKey)
  if (cached) return cached
  const initials = activity.user_name.split(' ').map((part) => part[0]).join('').slice(0, 2)
  const description = (activity.body || `war bei ${activity.spot_name}`).replace(/\s+/g, ' ').slice(0, 118)
  const imageId = activity.media?.[0]?.id
  const preview = isPreview ? `<span class="map-activity-preview">${imageId ? `<img src="/api/media/${imageId}" alt="" />` : ''}<span><b>${escapeMarkerText(activity.user_name)}</b><small>${escapeMarkerText(description)}</small></span></span>` : ''
  const avatar = activity.user_image ? `<img src="/api/avatars/${encodeURIComponent(activity.user_id)}" alt="" onerror="this.remove()" />` : ''
  const icon = L.divIcon({
    className: 'map-activity-wrapper',
    html: `<span class="map-activity-marker" style="--activity-delay:${(index % 6) * -0.55}s"><span class="map-activity-avatar">${escapeMarkerText(initials)}${avatar}</span>${preview}</span>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  })
  if (activityIconCache.size > 300) activityIconCache.clear()
  activityIconCache.set(cacheKey, icon)
  return icon
}

function FocusMap({ spot }) {
  const map = useMap()
  useEffect(() => {
    if (spot) map.flyTo(spot.position, 14, { duration: 0.45 })
  }, [spot, map])
  return null
}

function FocusLocation({ location }) {
  const map = useMap()
  useEffect(() => {
    if (location) map.flyTo(location, 14, { duration: .45 })
  }, [location, map])
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

function MapActivityLayer({ activities, onSelect }) {
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
      const basePoint = map.project([Number(activity.latitude), Number(activity.longitude)], zoom)
      const position = map.unproject(basePoint.add([Math.cos(angle) * radius, Math.sin(angle) * radius]), zoom)
      return { activity, index, position }
    })
  }, [activities, map, zoom])
  useEffect(() => {
    setPreviewIndex(0)
    if (markers.length < 2) return undefined
    const timer = window.setInterval(() => setPreviewIndex((current) => current + 1), 3000)
    return () => window.clearInterval(timer)
  }, [markers.length])
  const previewId = markers.length ? markers[previewIndex % markers.length].activity.id : null
  if (zoom < 10) return null
  return markers.map(({ activity, index, position }) => <Marker key={activity.id} position={position} icon={activityIcon(activity, index, activity.id === previewId)} zIndexOffset={activity.id === previewId ? 700 : 400} eventHandlers={{ click: (event) => { if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent); onSelect(activity.spot_id) } }} />)
}

function MobileMapDismiss({ onDismiss }) {
  useMapEvents({
    click: () => {
      if (window.matchMedia('(max-width: 560px)').matches) onDismiss()
    },
  })
  return null
}

function BoulderMap({ spots, selectedSpot, onSelect, onDismiss, userLocation, activities, onActivityBoundsChange }) {
  return (
    <div className="map-frame">
      <MapContainer center={mannheimCenter} zoom={13} zoomControl={false} scrollWheelZoom className="map-canvas">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FocusMap spot={selectedSpot} />
        <FocusLocation location={userLocation} />
        <MapViewportResize />
        <MobileMapDismiss onDismiss={onDismiss} />
        <MapActivityViewport onChange={onActivityBoundsChange} />
        {userLocation && <Marker position={userLocation} icon={userLocationIcon()} interactive={false} />}
        <MapActivityLayer activities={activities} onSelect={onSelect} />
        {spots.map((spot) => (
          <Marker
            key={spot.id}
            position={spot.position}
            icon={markerIcon(spot.visits > 0, selectedSpot?.id === spot.id)}
            eventHandlers={{ click: (event) => { if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent); onSelect(spot.id) } }}
          />
        ))}
      </MapContainer>
      <div className="map-key" aria-label="Kartenlegende">
        <span><i className="key-dot key-dot--open" />Noch offen</span>
        <span><i className="key-dot key-dot--visited">✓</i>Besucht</span>
        {activities.length > 0 && <span><i className="key-dot key-dot--activity" />Aktuelle Feed-Besuche</span>}
      </div>
      <div className="map-credits">Testdaten · Mannheim</div>
    </div>
  )
}

function SpotSheet({ spot, onVisit, onPlan, onReport, hideOnMobile }) {
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
  return (
    <aside className={`spot-sheet${hideOnMobile ? ' spot-sheet--mobile-hidden' : ''}`} style={spot.image_url ? { '--spot-image': `url("${spot.image_url}")` } : undefined}>
      <div className="spot-sheet__topline">
        <span className="eyebrow">{spot.district} · {spot.distance}</span>
        {visited && <span className="visited-label"><IconCheck size={14} /> {visitLabel}</span>}
      </div>
      <div className="spot-sheet__title-row">
        <div>
          <h2>{spot.name}</h2>
          <p>{spot.address}</p>
        </div>
      </div>
      <div className="spot-meta">
        <span><b>Heute</b>{spot.open}</span>
        <span><b>URL</b>{spot.website ? <a className="spot-website-link" href={spot.website} target="_blank" rel="noreferrer" title={spot.website}>{websiteLabel}</a> : websiteLabel}</span>
        <span><b>Deine Besuche</b>{spot.visits}</span>
      </div>
      <button className={`visit-button ${visited ? 'is-visited' : ''}`} onClick={() => onVisit(spot.id)}>
        <IconCheck size={19} />
        {visited ? 'Weiteren Besuch eintragen' : 'Ersten Besuch eintragen'}
      </button>
      <div className="spot-sheet__secondary-actions"><button type="button" className="spot-sheet__plan" onClick={() => onPlan(spot.id)}><IconCalendarEvent size={17} />Besuch planen</button><button type="button" className="spot-sheet__report" onClick={() => onReport(spot.id)} aria-label="Datenfehler melden" title="Datenfehler melden"><IconFlag size={17} /></button></div>
    </aside>
  )
}

function MapView({ spots, currentUser, selectedId, lastVisitedSpotId, onSelectSpot, onVisit, onPlan, onReport, query, setQuery, filter, setFilter, isPickingSpot, onCancelPicker, onMessage }) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [userLocation, setUserLocation] = useState(null)
  const [activityBounds, setActivityBounds] = useState(null)
  const [activities, setActivities] = useState([])

  function requestUserLocation() {
    if (!navigator.geolocation) { onMessage('Standort wird von diesem Browser nicht unterstützt'); return }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { setUserLocation([coords.latitude, coords.longitude]); onMessage('Dein Standort wird auf der Karte angezeigt') },
      () => onMessage('Standort konnte nicht bestimmt werden. Prüfe die Browserfreigabe.'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }
  useEffect(() => {
    const lastVisitedSpot = spots.find((spot) => spot.id === lastVisitedSpotId)
    if (lastVisitedSpot) onSelectSpot(lastVisitedSpot.id)
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
  }, [lastVisitedSpotId, spots])
  useEffect(() => {
    if (!currentUser || !activityBounds || activityBounds.zoom < 10) {
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
  }, [activityBounds, currentUser?.id])
  const visibleSpots = useMemo(() => {
    return spots.filter((spot) => {
      const matchesSearch = `${spot.name} ${spot.district}`.toLowerCase().includes(query.toLowerCase())
      const area = Number(spot.area_sqm ?? String(spot.size ?? '').replace(/[^0-9]/g, ''))
      const matchesFilter = filter === 'all'
        || (filter === 'visited' && spot.visits > 0)
        || (filter === 'open' && spot.visits === 0)
        || (filter === 'large' && area >= 1000)
        || (filter === 'small' && area < 750)
        || (filter === 'late' && /22:30|23:00/.test(spot.opening_hours ?? spot.open ?? ''))
      return matchesSearch && matchesFilter
    })
  }, [spots, query, filter])

  const selectedSpot = selectedId ? spots.find((spot) => spot.id === selectedId) ?? null : null

  return (
    <main className="view map-view">
      <div className="map-toolbar">
        <div className="search-control">
          <label className="search-field">
            <IconSearch size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hallen in Mannheim suchen" aria-expanded={Boolean(query)} aria-controls="search-results" />
            {query && <button type="button" onClick={() => setQuery('')} aria-label="Suche löschen"><IconX size={16} /></button>}
          </label>
          {query && <div className="search-results" id="search-results" role="listbox">
            {visibleSpots.length ? visibleSpots.slice(0, 6).map((spot) => <button type="button" role="option" key={spot.id} onClick={() => { onSelectSpot(spot.id); setQuery('') }}><IconMapPin size={17} /><span><b>{spot.name}</b><small>{spot.district} · {spot.distance}</small></span></button>) : <p>Keine Hallen gefunden.</p>}
          </div>}
        </div>
        <button type="button" className="toolbar-filter ui-icon-button" aria-label="Filter öffnen" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)}><IconAdjustmentsHorizontal size={19} /></button>
        <button type="button" className="toolbar-location ui-icon-button" aria-label="Meinen Standort anzeigen" onClick={requestUserLocation}><IconCurrentLocation size={19} /></button>
        {filtersOpen && <div className="filter-menu" aria-label="Kartenfilter"><span className="eyebrow">Karte filtern</span>{[
          ['all', 'Alle Hallen'], ['visited', 'Besucht'], ['open', 'Noch offen'], ['large', 'Große Hallen'], ['small', 'Kompakt'], ['late', 'Bis spät geöffnet'],
        ].map(([id, label]) => <button type="button" key={id} className={filter === id ? 'is-active' : ''} onClick={() => { setFilter(id); setFiltersOpen(false) }}>{label}{filter === id && <IconCheck size={15} />}</button>)}</div>}
      </div>
      <div className="filter-row">
        {[
          ['all', 'Alle Hallen'],
          ['visited', 'Besucht'],
          ['open', 'Noch offen'],
        ].map(([id, label]) => (
          <button key={id} className={`filter-chip ${filter === id ? 'is-active' : ''}`} onClick={() => setFilter(id)}>{label}</button>
        ))}
        <span className="result-count">{visibleSpots.length} Orte</span>
      </div>
      {isPickingSpot && <div className="map-picker-notice"><IconMapPin size={18} /><span><b>Halle auf der Karte auswählen</b>Tippe auf einen Marker, um den Besuch einzutragen.</span><button type="button" onClick={onCancelPicker}>Abbrechen</button></div>}
      <BoulderMap spots={visibleSpots} selectedSpot={selectedSpot} onSelect={onSelectSpot} onDismiss={() => { if (!isPickingSpot) onSelectSpot(null) }} userLocation={userLocation} activities={activities} onActivityBoundsChange={setActivityBounds} />
      {selectedSpot && <SpotSheet spot={selectedSpot} onVisit={onVisit} onPlan={onPlan} onReport={onReport} hideOnMobile={Boolean(query)} />}
    </main>
  )
}

function formatJournalDate(value) {
  const date = new Date(value)
  return {
    day: new Intl.DateTimeFormat('de-DE', { day: '2-digit' }).format(date),
    month: new Intl.DateTimeFormat('de-DE', { month: 'short' }).format(date).replace('.', '').toUpperCase(),
  }
}

async function optimizePhoto(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size <= 1_500_000) return file
  try {
    const source = URL.createObjectURL(file)
    const image = new Image()
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = source })
    const scale = Math.min(1, 1920 / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(image.width * scale)
    canvas.height = Math.round(image.height * scale)
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', .84))
    URL.revokeObjectURL(source)
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }) : file
  } catch {
    return file
  }
}

const visibilityOptions = [
  { value: 'private', label: 'Privat', description: 'Nur du', icon: IconLock },
  { value: 'followers', label: 'Freunde & Follower', description: 'Dein Netzwerk', icon: IconUsers },
  { value: 'public', label: 'Community', description: 'Alle in BoulderO', icon: IconWorld },
]

function VisibilityPicker({ value, onChange }) {
  return <fieldset className="visibility-picker"><legend>Teilen mit</legend><div role="radiogroup" aria-label="Sichtbarkeit des Eintrags">{visibilityOptions.map(({ value: optionValue, label, description, icon: Icon }) => <button key={optionValue} type="button" role="radio" aria-checked={value === optionValue} className={value === optionValue ? 'is-selected' : ''} onClick={() => onChange(optionValue)}><Icon size={20} /><span>{label}</span><small>{description}</small></button>)}</div></fieldset>
}

function JournalComposer({ spot, onClose, onSave, onChooseOnMap, surface }) {
  const [visitedAt, setVisitedAt] = useState(new Date().toISOString().slice(0, 10))
  const [timesOpen, setTimesOpen] = useState(false)
  const [startedAt, setStartedAt] = useState('')
  const [endedAt, setEndedAt] = useState('')
  const [body, setBody] = useState('')
  const [visibility, setVisibility] = useState('followers')
  const [files, setFiles] = useState([])
  const fileInput = useRef(null)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    setIsSaving(true)
    setError('')
    try {
      if (!spot) throw new Error('Wähle zuerst eine Halle auf der Karte aus.')
      await onSave({ spotId: spot.id, visitedAt, startedAt, endedAt, body, files: files.map((item) => item.file), visibility })
      onClose()
    } catch (saveError) {
      setError(saveError.message || 'Der Eintrag konnte nicht gespeichert werden.')
    } finally {
      setIsSaving(false)
    }
  }

  async function addPhotos(event) {
    const incoming = [...event.target.files].slice(0, 6 - files.length)
    const optimized = await Promise.all(incoming.map(optimizePhoto))
    setFiles((current) => [...current, ...optimized.map((file) => ({ file, preview: URL.createObjectURL(file) }))].slice(0, 6))
    event.target.value = ''
  }

  function removePhoto(index) {
    setFiles((current) => {
      URL.revokeObjectURL(current[index].preview)
      return current.filter((_, currentIndex) => currentIndex !== index)
    })
  }

  return (
    <div className={`composer-backdrop ${surface === 'map' ? 'composer-backdrop--map' : ''}`} role="presentation">
      <form className={`journal-composer ${surface === 'map' ? 'journal-composer--map' : ''}`} onSubmit={submit}>
        <div className="composer-header"><div><span className="eyebrow">Tagebucheintrag</span><h2>Besuch festhalten</h2></div><button type="button" className="icon-button ui-icon-button" onClick={onClose} aria-label="Schließen"><IconX size={19} /></button></div>
        <div className="form-field"><span>Halle</span>{spot ? <div className="chosen-spot"><IconMapPin size={18} /><span><b>{spot.name}</b><small>{spot.district} · {spot.address}</small></span><button type="button" onClick={onChooseOnMap}>Ändern</button></div> : <button type="button" className="choose-spot" onClick={onChooseOnMap}><IconMapPin size={18} />Halle auf Karte auswählen</button>}</div>
        <label className="form-field"><span>Datum</span><input type="date" value={visitedAt} onChange={(event) => setVisitedAt(event.target.value)} required /></label>
        <section className="visit-time-picker"><button type="button" className={timesOpen ? 'is-open' : ''} onClick={() => setTimesOpen((value) => !value)}><IconClock size={18} /><span>Uhrzeit hinzufügen <small>optional</small></span><IconChevronRight size={17} /></button>{timesOpen && <div className="visit-time-picker__fields"><label className="form-field"><span>Von</span><input type="time" value={startedAt} onChange={(event) => setStartedAt(event.target.value)} /></label><label className="form-field"><span>Bis</span><input type="time" value={endedAt} onChange={(event) => setEndedAt(event.target.value)} /></label></div>}</section>
        <label className="form-field"><span>Erfahrungsbericht</span><textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength="4000" placeholder="Wie war deine Session? Was möchtest du später noch wissen?" /></label>
        <div className="photo-field"><div className="photo-selection">{files.map((item, index) => <figure key={item.preview}><img src={item.preview} alt={`Ausgewähltes Foto ${index + 1}`} /><button type="button" onClick={() => removePhoto(index)} aria-label={`Foto ${index + 1} entfernen`}><IconX size={15} /></button></figure>)}</div><label className="photo-picker"><IconPhoto size={19} /><span>{files.length ? `${files.length} Foto${files.length > 1 ? 's' : ''} ausgewählt` : 'Fotos hinzufügen'}</span><input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple onChange={addPhotos} /></label>{files.length > 0 && files.length < 6 && <button type="button" className="add-photo" onClick={() => fileInput.current?.click()}><IconPlus size={16} />Weiteres Foto</button>}</div>
        <VisibilityPicker value={visibility} onChange={setVisibility} />
        {error && <p className="form-error">{error}</p>}
        <button className="visit-button" disabled={isSaving || !spot}>{isSaving ? 'Wird gespeichert …' : visibility === 'private' ? 'Privaten Eintrag speichern' : 'Eintrag speichern'}</button>
      </form>
    </div>
  )
}

function PlannedVisitDialog({ spot, onSave, onClose, surface = 'dialog' }) {
  const initial = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const [date, setDate] = useState(initial.toISOString().slice(0, 10))
  const [time, setTime] = useState('18:00')
  const [endTime, setEndTime] = useState('')
  const [note, setNote] = useState('')
  const [visibility, setVisibility] = useState('followers')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const startsAt = new Date(`${date}T${time}:00`).toISOString()
      const endsAt = endTime ? new Date(`${date}T${endTime}:00`).toISOString() : null
      await onSave({ spotId: spot.id, startsAt, endsAt, note, visibility })
      onClose()
    } catch (saveError) { setError(saveError.message || 'Der geplante Besuch konnte nicht gespeichert werden.') } finally { setSaving(false) }
  }
  return <div className={`composer-backdrop ${surface === 'map' ? 'composer-backdrop--map' : ''}`}><section className={`journal-composer ${surface === 'map' ? 'journal-composer--map' : ''}`} role="dialog" aria-modal="true" aria-label="Besuch planen"><div className="composer-header"><div><h2>Besuch planen</h2></div><button type="button" className="icon-button ui-icon-button" onClick={onClose} aria-label="Schließen"><IconX size={19} /></button></div><div className="chosen-spot"><IconMapPin size={18} /><span><b>{spot.name}</b><small>{spot.district} · {spot.address}</small></span></div><form onSubmit={submit}><div className="admin-form-grid"><label className="form-field"><span>Datum</span><input required type="date" value={date} min={new Date().toISOString().slice(0, 10)} onChange={(event) => setDate(event.target.value)} /></label><label className="form-field"><span>Beginn</span><input required type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label></div><label className="form-field"><span>Ende <small>optional</small></span><input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label><label className="form-field"><span>Notiz</span><textarea value={note} maxLength="2000" onChange={(event) => setNote(event.target.value)} placeholder="Zum Beispiel: Ich möchte neue Leute zum Bouldern treffen." /></label><VisibilityPicker value={visibility} onChange={setVisibility} />{error && <p className="form-error">{error}</p>}<button className="visit-button" disabled={saving}>{saving ? 'Wird geplant …' : 'Besuch planen'}</button></form></section></div>
}

function SpotCorrectionDialog({ spot, onSave, onClose }) {
  const [category, setCategory] = useState('coordinates')
  const [note, setNote] = useState('')
  const [latitude, setLatitude] = useState(String(spot.latitude ?? ''))
  const [longitude, setLongitude] = useState(String(spot.longitude ?? ''))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault(); setSaving(true); setError('')
    try { await onSave(spot.id, { category, note, suggestedLatitude: category === 'coordinates' && latitude !== '' ? Number(latitude) : null, suggestedLongitude: category === 'coordinates' && longitude !== '' ? Number(longitude) : null }); onClose() } catch (saveError) { setError(saveError.message || 'Die Meldung konnte nicht gesendet werden.') } finally { setSaving(false) }
  }
  return <div className="composer-backdrop"><section className="journal-composer" role="dialog" aria-modal="true" aria-label="Datenfehler melden"><div className="composer-header"><div><span className="eyebrow">BoulderO Community</span><h2>Datenfehler melden</h2></div><button type="button" className="icon-button ui-icon-button" onClick={onClose} aria-label="Schließen"><IconX size={19} /></button></div><p className="auth-copy"><b>{spot.name}</b><br />Die Verwaltung prüft deinen Hinweis vor einer Änderung.</p><form onSubmit={submit}><label className="form-field"><span>Was stimmt nicht?</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="coordinates">Position auf der Karte</option><option value="address">Adresse</option><option value="opening_hours">Öffnungszeiten</option><option value="website">Website</option><option value="other">Etwas anderes</option></select></label>{category === 'coordinates' && <div className="admin-form-grid"><label className="form-field"><span>Richtiger Breitengrad</span><input required type="number" step="any" value={latitude} onChange={(event) => setLatitude(event.target.value)} /></label><label className="form-field"><span>Richtiger Längengrad</span><input required type="number" step="any" value={longitude} onChange={(event) => setLongitude(event.target.value)} /></label></div>}<label className="form-field"><span>Hinweis *</span><textarea required minLength="3" value={note} maxLength="2000" onChange={(event) => setNote(event.target.value)} placeholder="Was ist nicht korrekt und wie sollte es aussehen?" /></label>{error && <p className="form-error">{error}</p>}<button className="visit-button" disabled={saving}>{saving ? 'Wird gesendet …' : 'Hinweis senden'}</button></form></section></div>
}

function visibilityLabel(value) {
  return ({ private: 'Privat', friends: 'Freunde', followers: 'Follower', public: 'Community' })[value] ?? 'Privat'
}

function JournalEntryDialog({ entry, onClose, onUpdate, onDeletePhoto }) {
  const [body, setBody] = useState(entry.body ?? '')
  const [visibility, setVisibility] = useState(entry.visibility ?? 'private')
  const [media, setMedia] = useState(entry.media ?? [])
  const [removedMediaIds, setRemovedMediaIds] = useState([])
  const [newFiles, setNewFiles] = useState([])
  const [saving, setSaving] = useState(false)
  const fileInput = useRef(null)

  async function save() {
    setSaving(true)
    try { await onUpdate(entry.journal_entry_id, { body, visibility, removedMediaIds, files: newFiles.map((item) => item.file) }); onClose() } finally { setSaving(false) }
  }

  async function addPhotos(event) {
    const incoming = [...event.target.files].slice(0, 6 - media.length - newFiles.length)
    const optimized = await Promise.all(incoming.map(optimizePhoto))
    setNewFiles((current) => [...current, ...optimized.map((file) => ({ file, preview: URL.createObjectURL(file) }))].slice(0, 6 - media.length))
    event.target.value = ''
  }

  function removeExistingPhoto(id) {
    setMedia((current) => current.filter((item) => item.id !== id))
    setRemovedMediaIds((current) => [...current, id])
  }

  function removeNewPhoto(index) {
    setNewFiles((current) => {
      URL.revokeObjectURL(current[index].preview)
      return current.filter((_, currentIndex) => currentIndex !== index)
    })
  }

  return <div className="composer-backdrop"><section className="journal-composer entry-dialog" role="dialog" aria-modal="true" aria-label="Tagebucheintrag">
    <div className="composer-header"><div><span className="eyebrow">{formatJournalDate(entry.visited_at).day} {formatJournalDate(entry.visited_at).month} · {visibilityLabel(entry.visibility)}</span><h2>{entry.spot_name}</h2><p>{entry.district}</p></div><button className="icon-button ui-icon-button" onClick={onClose} aria-label="Schließen"><IconX size={19} /></button></div>
    <label className="form-field"><span>Dein Erfahrungsbericht</span><textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength="4000" /></label>
    {(media.length > 0 || newFiles.length > 0) && <div className="entry-photo-grid">{media.map((item) => <figure key={item.id}><img src={`/api/media/${item.id}`} alt={`Foto von ${entry.spot_name}`} /><button type="button" onClick={() => removeExistingPhoto(item.id)} aria-label="Foto im Entwurf entfernen"><IconX size={15} /></button></figure>)}{newFiles.map((item, index) => <figure key={item.preview}><img src={item.preview} alt="Neues Foto im Entwurf" /><button type="button" onClick={() => removeNewPhoto(index)} aria-label="Neues Foto entfernen"><IconX size={15} /></button></figure>)}</div>}
    {media.length + newFiles.length < 6 && <label className="add-entry-photo"><IconPlus size={17} />Foto hinzufügen<input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple onChange={addPhotos} /></label>}
    <VisibilityPicker value={visibility} onChange={setVisibility} />
    <p className="field-help">Änderungen an Fotos werden erst mit „Änderungen speichern“ übernommen.</p><button className="visit-button" disabled={saving} onClick={save}>{saving ? 'Wird gespeichert …' : 'Änderungen speichern'}</button>
  </section></div>
}

function JournalFilterDialog({ halls, filters, onApply, onClose }) {
  const [draft, setDraft] = useState(filters)
  return <div className="composer-backdrop"><section className="journal-composer filter-dialog" role="dialog" aria-modal="true" aria-label="Tagebuch filtern"><div className="composer-header"><div><span className="eyebrow">Tagebuch</span><h2>Einträge filtern</h2></div><button className="icon-button ui-icon-button" onClick={onClose}><IconX size={19} /></button></div><label className="form-field"><span>Boulderhalle</span><select value={draft.hall} onChange={(event) => setDraft({ ...draft, hall: event.target.value })}><option value="all">Alle Hallen</option>{halls.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><div className="filter-date-row"><label className="form-field"><span>Von</span><input type="date" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label><label className="form-field"><span>Bis</span><input type="date" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label></div><label className="form-field"><span>Eintragstyp</span><select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })}><option value="all">Alle Einträge</option><option value="photos">Mit Fotos</option><option value="shared">Geteilt</option></select></label><div className="filter-dialog__actions"><button type="button" className="text-back" onClick={() => setDraft({ hall: 'all', from: '', to: '', type: 'all' })}>Zurücksetzen</button><button className="journal-add" onClick={() => { onApply(draft); onClose() }}>Anwenden</button></div></section></div>
}

function JournalView({ currentUser, journalVisits, onSignIn, onOpenComposer, onOpenEntry, onOpenImage }) {
  const [filters, setFilters] = useState({ hall: 'all', from: '', to: '', type: 'all' })
  const [filtersOpen, setFiltersOpen] = useState(false)
  if (!currentUser) {
    return (
      <main className="view content-view empty-state">
        <span className="eyebrow">Dein privater Raum</span><h1>Dein Boulder-Tagebuch</h1>
        <p>Halte Sessions, Erfahrungen und Fotos bei dir — sichtbar nur für dich, bis du später etwas bewusst teilst.</p>
        <button className="visit-button" onClick={onSignIn}><IconLogin2 size={19} />Anmelden</button>
      </main>
    )
  }
  const uniqueHallCount = new Set(journalVisits.map((visit) => visit.spot_id)).size
  const visitTotal = journalVisits.length
  const halls = [...new Map(journalVisits.map((visit) => [visit.spot_id, visit.spot_name])).entries()]
  const visibleVisits = journalVisits.filter((visit) => (filters.type !== 'photos' || visit.media?.length > 0) && (filters.type !== 'shared' || visit.visibility !== 'private') && (filters.hall === 'all' || visit.spot_id === filters.hall) && (!filters.from || visit.visited_at >= filters.from) && (!filters.to || visit.visited_at <= filters.to))
  return (
    <main className="view content-view journal-view">
      <div className="journal-content">
      <div className="page-intro page-intro--action">
        <div>
        <h1>Tagebuch</h1>
        </div>
        <button className="journal-add" onClick={onOpenComposer}><IconPlus size={18} />Eintrag</button>
      </div>
      <section className="journal-summary">
        <div><strong>{visitTotal}</strong><span>Besuche</span></div>
        <div><strong>{uniqueHallCount}</strong><span>Hallen</span></div>
        <div><strong>4</strong><span>Wochen aktiv</span></div>
      </section>
      <section className="journal-list" aria-label="Letzte Besuche">
        <div className="section-heading"><h2>Deine Einträge</h2><div className="journal-list-actions"><span>{visibleVisits.length} von {visitTotal}</span><button className="ui-icon-button" onClick={() => setFiltersOpen(true)} aria-label="Einträge filtern"><IconAdjustmentsHorizontal size={18} /></button></div></div>
        {!journalVisits.length && <p className="journal-empty">Noch kein Eintrag. Halte deine nächste Session direkt hier fest.</p>}
        {!visibleVisits.length && journalVisits.length > 0 && <p className="journal-empty">Für diesen Filter gibt es noch keine Einträge.</p>}
        {visibleVisits.map((visit) => {
          const date = formatJournalDate(visit.visited_at)
          return <button type="button" className="journal-entry" key={visit.id} onClick={() => onOpenEntry(visit)}>
            <div className="journal-entry__date"><b>{date.day}</b><span>{date.month}</span></div>
            <div className="journal-entry__main"><h3>{visit.spot_name}</h3><small className="entry-meta">{visit.district} · {visibilityLabel(visit.visibility)}</small>{visit.body && <p className="journal-entry__body">{visit.body}</p>}{visit.media?.length > 0 && <div className="journal-entry__photos">{visit.media.map((media) => <img key={media.id} onClick={(event) => { event.stopPropagation(); onOpenImage(`/api/media/${media.id}`, `Foto von ${visit.spot_name}`) }} src={`/api/media/${media.id}`} alt="Tagebucheintrag" />)}</div>}</div>
            <IconChevronRight size={19} />
          </button>
        })}
      </section>
      </div>
      {filtersOpen && <JournalFilterDialog halls={halls} filters={filters} onApply={setFilters} onClose={() => setFiltersOpen(false)} />}
    </main>
  )
}

function RankBadge({ progress, uniqueSpots }) {
  const badge = uniqueSpots === undefined
    ? [...(progress?.badges ?? [])].reverse().find((item) => item.unlocked)
    : [{ threshold: 50, name: 'Boulder-Veteran' }, { threshold: 25, name: 'Deutschland-Crusher' }, { threshold: 10, name: 'Boulder-Scout' }, { threshold: 5, name: 'Hallen-Hopper' }, { threshold: 1, name: 'Erster Griff' }].find((item) => uniqueSpots >= item.threshold)
  return badge ? <span className={`rank-badge rank-badge--${badge.threshold}`} title={badge.name}><IconMedal size={15} /></span> : null
}

function ProfileAvatar({ user, progress, onUpload }) {
  const input = useRef(null)
  return <div className="profile-avatar-control"><button type="button" className="avatar profile-avatar" onClick={() => input.current?.click()} aria-label="Profilfoto ändern"><span className="profile-avatar__image">{user.image ? <img src={`/api/avatars/${user.id}`} alt="Dein Profil" /> : user.name.split(' ').map((name) => name[0]).join('').slice(0, 2)}</span><RankBadge progress={progress} /></button><input ref={input} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => onUpload(event.target.files[0])} /><span>Profilfoto ändern</span></div>
}

function ProfileView({ spots, currentUser, onSignIn, onSignOut, onOpenBadges, onOpenAdmin, onOpenAudit, onChangePassword, onSuggestSpot, onOpenPrivacy, onOpenImprint, pendingSuggestionCount, pendingCorrectionCount, progress, onUploadAvatar }) {
  if (!currentUser) {
    return (
      <main className="view content-view empty-state profile-empty">
        <h1>Dein Fortschritt gehört dir.</h1>
        <p>Mit einem Konto werden Besuche, Fotos und persönliche Notizen dauerhaft und privat gespeichert.</p>
        <button className="visit-button" onClick={onSignIn}><IconLogin2 size={19} />Anmelden</button>
      </main>
    )
  }
  const visited = spots.filter((spot) => spot.visits > 0).length
  const total = spots.reduce((sum, spot) => sum + spot.visits, 0)
  const badges = progress?.badges ?? []
  const currentRank = [...badges].reverse().find((badge) => badge.unlocked)
  const nextRank = badges.find((badge) => !badge.unlocked)
  const uniqueSpots = progress?.unique_spots ?? visited
  return (
    <main className="view content-view profile-view">
      <div className="profile-content">
        <section className="profile-hero">
          <div className="profile-hero__shade" />
          <div className="profile-hero__content">
            <ProfileAvatar user={currentUser} progress={progress} onUpload={onUploadAvatar} />
            <h1>{currentUser.name}</h1>
            <p>@{currentUser.username ?? 'boulderfan'} · Mannheim</p>
          </div>
        </section>
        <section className="rank-card">
          <div className="rank-card__icon"><IconTrophy size={22} /></div>
          <div><span className="eyebrow">Dein Rang</span><h2>{currentRank?.name ?? 'Boulder-Neuling'}</h2><p>{nextRank ? `Noch ${Math.max(0, nextRank.threshold - uniqueSpots)} neue Hallen bis zum ${nextRank.name}.` : 'Alle Ränge freigeschaltet.'}</p></div>
        </section>
        <section className="progress-section">
          <div className="section-heading"><h2>Fortschritt in Mannheim</h2><span>{visited} / 10</span></div>
          <div className="progress-bar"><span style={{ width: `${visited * 10}%` }} /></div>
          <div className="profile-stats"><div><strong>{visited}</strong><span>Hallen entdeckt</span></div><div><strong>{total}</strong><span>Besuche</span></div><div><strong>{progress?.follower_count ?? 0}</strong><span>Follower</span></div></div>
        </section>
        <section className="profile-actions">
          <button onClick={onOpenBadges}><IconSparkles size={18} /><span><b>Abzeichen ansehen</b><small>Deine Meilensteine und nächsten Ziele</small></span><IconChevronRight size={18} /></button>
          <button onClick={onSuggestSpot}><IconMapPin size={18} /><span><b>Halle melden</b><small>Schlage eine Boulderhalle zur Prüfung vor</small></span><IconChevronRight size={18} /></button>
          {currentUser.role === 'superadmin' && <button onClick={onOpenAdmin}><IconAdjustmentsHorizontal size={18} /><span><b>Hallen verwalten</b><small>{spots.length} Hallen · {pendingSuggestionCount + pendingCorrectionCount} Hinweis{pendingSuggestionCount + pendingCorrectionCount === 1 ? '' : 'e'} offen</small></span>{pendingSuggestionCount + pendingCorrectionCount > 0 && <b className="admin-count-badge">{pendingSuggestionCount + pendingCorrectionCount > 99 ? '99+' : pendingSuggestionCount + pendingCorrectionCount}</b>}<IconChevronRight size={18} /></button>}
          {currentUser.role === 'superadmin' && <button onClick={onOpenAudit}><IconLock size={18} /><span><b>Registrierungen & Anmeldungen</b><small>Audit der letzten Kontoereignisse</small></span><IconChevronRight size={18} /></button>}
          {currentUser.role === 'member' && <button onClick={onChangePassword}><IconLock size={18} /><span><b>Passwort ändern</b><small>Dein Konto sicher halten</small></span><IconChevronRight size={18} /></button>}
          <button className="profile-actions__logout" onClick={onSignOut}><IconLogout size={18} />Abmelden</button>
          <div className="profile-legal-links"><button type="button" onClick={onOpenPrivacy}>Datenschutz</button><button type="button" onClick={onOpenImprint}>Impressum</button></div>
        </section>
      </div>
    </main>
  )
}

function LegalDialog({ kind, onClose }) {
  const privacy = kind === 'privacy'
  return <div className="composer-backdrop legal-backdrop"><section className="journal-composer legal-dialog" role="dialog" aria-modal="true" aria-label={privacy ? 'Datenschutzerklärung' : 'Impressum'}><div className="composer-header"><div><span className="eyebrow">BoulderO</span><h2>{privacy ? 'Datenschutzerklärung' : 'Impressum'}</h2></div><button type="button" className="icon-button ui-icon-button" onClick={onClose} aria-label="Schließen"><IconX size={19} /></button></div>{privacy ? <div className="legal-content"><p>Stand: 18. August 2026</p><h3>Verantwortlicher</h3><p>Nikolas Häfner<br />Paul-Gerhardt-Straße 5<br />68169 Mannheim<br /><a href="mailto:hubertoink@outlook.de">hubertoink@outlook.de</a></p><h3>Welche Daten wir verarbeiten</h3><p>Bei der Registrierung verarbeiten wir Name, Benutzername, E-Mail-Adresse und ein nur gehasht gespeichertes Passwort. Wenn du BoulderO nutzt, kommen je nach Funktion Profilbild, Besuche, Tagebucheinträge, Fotos, soziale Verbindungen, Nachrichten und Hallenvorschläge hinzu.</p><h3>Zweck und Rechtsgrundlage</h3><p>Wir verarbeiten diese Daten, um dein Konto bereitzustellen, die von dir gewählten Funktionen auszuführen und BoulderO sicher zu betreiben. Rechtsgrundlage ist in der Regel die Vertragserfüllung nach Art. 6 Abs. 1 lit. b DSGVO sowie unser berechtigtes Interesse an Sicherheit und Missbrauchsschutz nach Art. 6 Abs. 1 lit. f DSGVO.</p><h3>Hosting, E-Mail und Karte</h3><p>BoulderO wird bei Mittwald gehostet. Bestätigungs- und Passwort-E-Mails werden über das BoulderO-Postfach versendet. Für die Karte werden Kacheln von OpenStreetMap geladen; dabei erhält OpenStreetMap technisch bedingt deine IP-Adresse und die angeforderten Kartendaten. Die optionale Straßensuche übermittelt deinen Suchbegriff an den Geocoding-Dienst Nominatim von OpenStreetMap.</p><h3>Speicherdauer</h3><p>Kontodaten und von dir erstellte Inhalte speichern wir grundsätzlich für die Dauer deines Kontos. Danach löschen oder anonymisieren wir sie, sofern keine gesetzlichen Aufbewahrungspflichten entgegenstehen.</p><h3>Deine Rechte</h3><p>Du kannst Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch verlangen. Außerdem kannst du dich bei einer Datenschutz-Aufsichtsbehörde beschweren. Für Anliegen genügt eine E-Mail an die oben genannte Adresse.</p></div> : <div className="legal-content"><p><strong>Angaben gemäß § 5 DDG</strong></p><p>Nikolas Häfner<br />Paul-Gerhardt-Straße 5<br />68169 Mannheim</p><h3>Kontakt</h3><p><a href="mailto:hubertoink@outlook.de">hubertoink@outlook.de</a></p><h3>Verantwortlich für den Inhalt</h3><p>Nikolas Häfner<br />Paul-Gerhardt-Straße 5<br />68169 Mannheim</p></div>}</section></div>
}

function BadgesView({ progress, onBack }) {
  const badges = progress?.badges ?? []
  return <main className="view content-view compact-view"><div className="page-intro"><h1>Abzeichen</h1></div><section className="badge-grid">{badges.map((badge) => <article className={`badge-card ${badge.unlocked ? 'is-unlocked' : ''}`} key={badge.id}>{badge.unlocked ? <IconMedal size={25} /> : <IconLock size={22} />}<div><span className="eyebrow">{badge.unlocked ? 'Freigeschaltet' : `Noch ${Math.max(0, badge.threshold - (progress?.unique_spots ?? 0))} Hallen`}</span><h2>{badge.name}</h2><p>{badge.threshold} unterschiedliche Hallen</p></div></article>)}</section><button className="text-back" onClick={onBack}>Zurück zum Profil</button></main>
}

function downloadHallTemplate() {
  const csv = 'name,district,address,latitude,longitude,opening_hours,area_sqm,website,image_url\nBeispiel Boulderhalle,Jungbusch,Beispielstraße 12,49.4964,8.4548,Mo–Fr 10:00–22:00,850,https://example.com,https://images.example.com/halle.jpg\n'
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'bouldero-hallen-import-vorlage.csv'
  link.click()
  URL.revokeObjectURL(url)
}

function SuggestionMapCanvas({ latitude, longitude, onChange, expanded = false }) {
  const hasPosition = latitude !== '' && longitude !== '' && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))
  const position = hasPosition ? [Number(latitude), Number(longitude)] : mannheimCenter
  function Focus() {
    const map = useMap()
    useEffect(() => {
      const timeout = window.setTimeout(() => map.invalidateSize(), 0)
      if (hasPosition) map.setView(position, 15, { animate: false })
      return () => window.clearTimeout(timeout)
    }, [map, latitude, longitude])
    return null
  }
  function PickPosition() {
    useMapEvents({ click: (event) => onChange(event.latlng.lat.toFixed(6), event.latlng.lng.toFixed(6)) })
    return hasPosition ? <Marker position={position} draggable icon={markerIcon(false, true)} eventHandlers={{ dragend: (event) => { const next = event.target.getLatLng(); onChange(next.lat.toFixed(6), next.lng.toFixed(6)) } }} /> : null
  }
  return <MapContainer center={position} zoom={hasPosition ? 15 : 13} scrollWheelZoom touchZoom zoomControl={expanded} attributionControl={false} className={expanded ? 'location-picker-map' : undefined}><TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" /><Focus /><PickPosition /></MapContainer>
}

function LocationPickerDialog({ latitude, longitude, onChange, onClose }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  async function search(event) {
    event?.preventDefault()
    if (query.trim().length < 3) return setError('Bitte gib mindestens drei Zeichen ein.')
    setSearching(true)
    setError('')
    try {
      const response = await fetch(`/api/geocoding/search?q=${encodeURIComponent(query.trim())}`)
      if (!response.ok) throw new Error('Die Suche ist gerade nicht verfügbar.')
      setResults((await response.json()).results)
    } catch (searchError) { setError(searchError.message) } finally { setSearching(false) }
  }
  function useCurrentLocation() {
    if (!navigator.geolocation) return setError('Dein Browser unterstützt keine Standortbestimmung.')
    setError('')
    navigator.geolocation.getCurrentPosition(
      (position) => onChange(position.coords.latitude.toFixed(6), position.coords.longitude.toFixed(6)),
      () => setError('Dein Standort konnte nicht bestimmt werden. Prüfe die Browserfreigabe.'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }
  return <div className="composer-backdrop location-picker-backdrop"><section className="location-picker-dialog" role="dialog" aria-modal="true" aria-label="Position auf Karte auswählen"><div className="composer-header"><div><h2>Position auswählen</h2></div><button type="button" className="icon-button ui-icon-button" onClick={onClose} aria-label="Karte schließen"><IconX size={19} /></button></div><div className="location-search"><label><IconSearch size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') search(event) }} placeholder="Straße, Ort oder Adresse suchen" /></label><button type="button" onClick={search} disabled={searching}>{searching ? 'Sucht …' : 'Suchen'}</button><button type="button" className="ui-icon-button" onClick={useCurrentLocation} aria-label="Eigenen Standort verwenden" title="Eigenen Standort verwenden"><IconCurrentLocation size={19} /></button></div>{error && <p className="form-error">{error}</p>}{results.length > 0 && <div className="location-search-results">{results.map((result) => <button key={`${result.latitude}-${result.longitude}`} type="button" onClick={() => { onChange(result.latitude, result.longitude); setResults([]) }}><IconMapPin size={17} /><span>{result.label}</span></button>)}</div>}<div className="location-picker-map-wrap"><SuggestionMapCanvas latitude={latitude} longitude={longitude} onChange={onChange} expanded /></div></section></div>
}

function SuggestionCoordinatePicker({ latitude, longitude, onChange }) {
  const [expanded, setExpanded] = useState(false)
  const hasPosition = latitude !== '' && longitude !== '' && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))
  return <section className="coordinate-picker coordinate-picker--selectable"><div className="coordinate-picker__heading"><span className="form-field__label">Position auf der Karte</span><button type="button" className="ui-icon-button" onClick={() => setExpanded(true)} aria-label="Karte vergrößern" title="Karte vergrößern"><IconArrowsMaximize size={18} /></button></div><SuggestionMapCanvas latitude={latitude} longitude={longitude} onChange={onChange} /><small>{hasPosition ? 'Punkt gesetzt. Du kannst den Pin ziehen oder einen neuen Punkt auf der Karte wählen.' : 'Klicke auf die Karte, um den Standort der Halle zu setzen.'}</small>{expanded && <LocationPickerDialog latitude={latitude} longitude={longitude} onChange={onChange} onClose={() => setExpanded(false)} />}</section>
}

function SpotEditDialog({ spot, reports = [], onSave, onResolveReport, onClose }) {
  const hasUploadedImage = spot.image_url?.startsWith('/api/spot-images/')
  const [draft, setDraft] = useState({ name: spot.name, district: spot.district, address: spot.address, website: spot.website ?? '', imageUrl: hasUploadedImage ? undefined : spot.image_url ?? '', openingHours: spot.opening_hours ?? '', areaSqm: spot.area_sqm ?? '', latitude: spot.latitude, longitude: spot.longitude })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [imageFile, setImageFile] = useState(null)
  function update(field, value) { setDraft((current) => ({ ...current, [field]: value })) }
  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSave({ ...draft, areaSqm: draft.areaSqm === '' ? null : Number(draft.areaSqm), latitude: Number(draft.latitude), longitude: Number(draft.longitude) }, imageFile)
      onClose()
    } catch (saveError) { setError(saveError.message || 'Die Halle konnte nicht gespeichert werden.') } finally { setSaving(false) }
  }
  return <div className="composer-backdrop"><section className="journal-composer admin-edit-dialog" role="dialog" aria-modal="true" aria-label={`${spot.name} bearbeiten`}><div className="composer-header"><div><span className="eyebrow">Halle bearbeiten</span><h2>{spot.name}</h2></div><button type="button" className="icon-button ui-icon-button" onClick={onClose}><IconX size={19} /></button></div>{reports.length > 0 && <section className="correction-review-panel"><span className="eyebrow">Community-Hinweise · {reports.length}</span>{reports.map((report) => <article key={report.id}><p><b>{({ coordinates: 'Position', address: 'Adresse', opening_hours: 'Öffnungszeiten', website: 'Website', other: 'Sonstiges' })[report.category]}</b> · von {report.reporter_name}</p><p>{report.note}</p>{report.suggested_latitude !== null && <small>Vorschlag: {report.suggested_latitude}, {report.suggested_longitude}</small>}<div><button type="button" onClick={() => onResolveReport(report.id, 'resolve')}>Erledigt</button><button type="button" onClick={() => onResolveReport(report.id, 'dismiss')}>Verwerfen</button></div></article>)}</section>}<form onSubmit={submit}><div className="admin-form-grid"><label className="form-field"><span>Name *</span><input required value={draft.name} onChange={(event) => update('name', event.target.value)} /></label><label className="form-field"><span>Stadtteil *</span><input required value={draft.district} onChange={(event) => update('district', event.target.value)} /></label></div><label className="form-field"><span>Adresse *</span><input required value={draft.address} onChange={(event) => update('address', event.target.value)} /></label><div className="admin-form-grid"><label className="form-field"><span>Breitengrad *</span><input required type="number" step="any" value={draft.latitude} onChange={(event) => update('latitude', event.target.value)} /></label><label className="form-field"><span>Längengrad *</span><input required type="number" step="any" value={draft.longitude} onChange={(event) => update('longitude', event.target.value)} /></label></div><SuggestionCoordinatePicker latitude={draft.latitude} longitude={draft.longitude} onChange={(latitude, longitude) => setDraft((current) => ({ ...current, latitude, longitude }))} /><div className="admin-form-grid"><label className="form-field"><span>Öffnungszeiten</span><input value={draft.openingHours} onChange={(event) => update('openingHours', event.target.value)} /></label><label className="form-field"><span>Fläche in m²</span><input type="number" min="0" value={draft.areaSqm} onChange={(event) => update('areaSqm', event.target.value)} /></label></div><label className="form-field"><span>Website</span><input type="url" value={draft.website} onChange={(event) => update('website', event.target.value)} /></label><label className="form-field"><span>Bild hochladen</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setImageFile(event.target.files[0] ?? null)} /><small>{imageFile ? `${imageFile.name} ersetzt das bestehende Bild.` : hasUploadedImage ? 'Vorhandenes Upload-Bild bleibt erhalten.' : 'JPEG, PNG oder WebP, maximal 10 MB.'}</small></label>{hasUploadedImage ? null : <label className="form-field"><span>Bild-URL</span><input type="url" value={draft.imageUrl ?? ''} onChange={(event) => update('imageUrl', event.target.value)} /><small>Feld leeren, um die Bild-URL zu entfernen.</small></label>}{error && <p className="form-error">{error}</p>}<button className="visit-button" disabled={saving}>{saving ? 'Wird gespeichert …' : 'Änderungen speichern'}</button></form></section></div>
}

function SpotCreateDialog({ onCreate, onClose }) {
  const [form, setForm] = useState({ name: '', district: '', address: '', website: '', imageUrl: '', openingHours: '', areaSqm: '', latitude: '', longitude: '' })
  const [imageFile, setImageFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function update(field, value) { setForm((current) => ({ ...current, [field]: value })) }
  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onCreate({ ...form, areaSqm: form.areaSqm ? Number(form.areaSqm) : null, latitude: Number(form.latitude), longitude: Number(form.longitude) }, imageFile)
      onClose()
    } catch (saveError) { setError(saveError.message || 'Die Halle konnte nicht angelegt werden.') } finally { setSaving(false) }
  }
  return <div className="composer-backdrop"><section className="journal-composer admin-edit-dialog" role="dialog" aria-modal="true" aria-label="Halle anlegen"><div className="composer-header"><div><span className="eyebrow">Neue Boulderhalle</span><h2>Halle anlegen</h2></div><button type="button" className="icon-button ui-icon-button" onClick={onClose}><IconX size={19} /></button></div><form onSubmit={submit}><div className="admin-form-grid"><label className="form-field"><span>Name *</span><input required value={form.name} onChange={(event) => update('name', event.target.value)} /></label><label className="form-field"><span>Stadtteil *</span><input required value={form.district} onChange={(event) => update('district', event.target.value)} /></label></div><label className="form-field"><span>Adresse *</span><input required value={form.address} onChange={(event) => update('address', event.target.value)} /></label><div className="admin-form-grid"><label className="form-field"><span>Breitengrad *</span><input required type="number" step="any" value={form.latitude} onChange={(event) => update('latitude', event.target.value)} /></label><label className="form-field"><span>Längengrad *</span><input required type="number" step="any" value={form.longitude} onChange={(event) => update('longitude', event.target.value)} /></label></div><div className="admin-form-grid"><label className="form-field"><span>Öffnungszeiten</span><input value={form.openingHours} onChange={(event) => update('openingHours', event.target.value)} /></label><label className="form-field"><span>Fläche in m²</span><input type="number" min="0" value={form.areaSqm} onChange={(event) => update('areaSqm', event.target.value)} /></label></div><label className="form-field"><span>Website</span><input type="url" value={form.website} onChange={(event) => update('website', event.target.value)} /></label><label className="form-field"><span>Bild hochladen</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setImageFile(event.target.files[0] ?? null)} /><small>{imageFile ? `${imageFile.name} wird nach dem Speichern verknüpft.` : 'JPEG, PNG oder WebP, maximal 10 MB.'}</small></label><label className="form-field"><span>Oder Bild-URL</span><input type="url" value={form.imageUrl} onChange={(event) => update('imageUrl', event.target.value)} /><small>Praktisch für den CSV-Massenimport.</small></label>{error && <p className="form-error">{error}</p>}<button className="visit-button" disabled={saving}><IconPlus size={18} />{saving ? 'Wird gespeichert …' : 'Boulderhalle anlegen'}</button></form></section></div>
}

function SpotSuggestionDialog({ onSubmit, onClose }) {
  const [form, setForm] = useState({ name: '', district: '', address: '', website: '', latitude: '', longitude: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function update(field, value) { setForm((current) => ({ ...current, [field]: value })) }
  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSubmit({ ...form, latitude: form.latitude === '' ? null : Number(form.latitude), longitude: form.longitude === '' ? null : Number(form.longitude) })
      onClose()
    } catch (submitError) { setError(submitError.message || 'Der Hallenvorschlag konnte nicht gesendet werden.') } finally { setSaving(false) }
  }
  return <div className="composer-backdrop"><section className="journal-composer admin-edit-dialog" role="dialog" aria-modal="true" aria-label="Halle melden"><div className="composer-header"><div><h2>Halle melden</h2></div><button type="button" className="icon-button ui-icon-button" onClick={onClose} aria-label="Schließen"><IconX size={19} /></button></div><p className="auth-copy">Dein Vorschlag wird vor der Veröffentlichung durch die Verwaltung geprüft.</p><form onSubmit={submit}><div className="admin-form-grid"><label className="form-field"><span>Name *</span><input required value={form.name} onChange={(event) => update('name', event.target.value)} /></label><label className="form-field"><span>Stadtteil</span><input value={form.district} onChange={(event) => update('district', event.target.value)} /></label></div><label className="form-field"><span>Adresse *</span><input required value={form.address} onChange={(event) => update('address', event.target.value)} /></label><label className="form-field"><span>Website</span><input type="url" value={form.website} onChange={(event) => update('website', event.target.value)} placeholder="https://…" /></label><div className="admin-form-grid"><label className="form-field"><span>Breitengrad</span><input type="number" step="any" value={form.latitude} onChange={(event) => update('latitude', event.target.value)} /></label><label className="form-field"><span>Längengrad</span><input type="number" step="any" value={form.longitude} onChange={(event) => update('longitude', event.target.value)} /></label></div><SuggestionCoordinatePicker latitude={form.latitude} longitude={form.longitude} onChange={(latitude, longitude) => setForm((current) => ({ ...current, latitude, longitude }))} /><label className="form-field"><span>Hinweis für die Verwaltung</span><textarea value={form.notes} maxLength="2000" onChange={(event) => update('notes', event.target.value)} placeholder="Zum Beispiel Öffnungszeiten oder ein Hinweis zur Lage" /></label>{error && <p className="form-error">{error}</p>}<button className="visit-button" disabled={saving}>{saving ? 'Wird gesendet …' : 'Hallenvorschlag senden'}</button></form></section></div>
}

function SpotSuggestionReviewDialog({ suggestion, onApprove, onReject, onClose }) {
  const [draft, setDraft] = useState({ name: suggestion.name, district: suggestion.district ?? '', address: suggestion.address, website: suggestion.website ?? '', imageUrl: '', openingHours: '', areaSqm: '', latitude: suggestion.latitude ?? '', longitude: suggestion.longitude ?? '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function update(field, value) { setDraft((current) => ({ ...current, [field]: value })) }
  async function approve(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try { await onApprove(suggestion.id, { ...draft, areaSqm: draft.areaSqm === '' ? null : Number(draft.areaSqm), latitude: Number(draft.latitude), longitude: Number(draft.longitude) }); onClose() } catch (saveError) { setError(saveError.message || 'Der Vorschlag konnte nicht freigegeben werden.') } finally { setSaving(false) }
  }
  async function reject() {
    if (!window.confirm(`„${suggestion.name}“ ablehnen?`)) return
    setSaving(true)
    setError('')
    try { await onReject(suggestion.id); onClose() } catch (rejectError) { setError(rejectError.message || 'Der Vorschlag konnte nicht abgelehnt werden.') } finally { setSaving(false) }
  }
  return <div className="composer-backdrop"><section className="journal-composer admin-edit-dialog" role="dialog" aria-modal="true" aria-label={`${suggestion.name} prüfen`}><div className="composer-header"><div><span className="eyebrow">Hallenvorschlag prüfen</span><h2>{suggestion.name}</h2></div><button type="button" className="icon-button ui-icon-button" onClick={onClose} aria-label="Schließen"><IconX size={19} /></button></div><p className="suggestion-meta">Gemeldet von {suggestion.submitted_by_name} · {suggestion.submitted_by_email}</p>{suggestion.notes && <p className="suggestion-note"><b>Hinweis:</b> {suggestion.notes}</p>}<form onSubmit={approve}><div className="admin-form-grid"><label className="form-field"><span>Name *</span><input required value={draft.name} onChange={(event) => update('name', event.target.value)} /></label><label className="form-field"><span>Stadtteil *</span><input required value={draft.district} onChange={(event) => update('district', event.target.value)} /></label></div><label className="form-field"><span>Adresse *</span><input required value={draft.address} onChange={(event) => update('address', event.target.value)} /></label><div className="admin-form-grid"><label className="form-field"><span>Breitengrad *</span><input required type="number" step="any" value={draft.latitude} onChange={(event) => update('latitude', event.target.value)} /></label><label className="form-field"><span>Längengrad *</span><input required type="number" step="any" value={draft.longitude} onChange={(event) => update('longitude', event.target.value)} /></label></div><div className="admin-form-grid"><label className="form-field"><span>Öffnungszeiten</span><input value={draft.openingHours} onChange={(event) => update('openingHours', event.target.value)} /></label><label className="form-field"><span>Fläche in m²</span><input type="number" min="0" value={draft.areaSqm} onChange={(event) => update('areaSqm', event.target.value)} /></label></div><label className="form-field"><span>Website</span><input type="url" value={draft.website} onChange={(event) => update('website', event.target.value)} /></label>{error && <p className="form-error">{error}</p>}<div className="suggestion-review-actions"><button type="button" className="danger" disabled={saving} onClick={reject}>Ablehnen</button><button className="visit-button" disabled={saving}>{saving ? 'Wird geprüft …' : 'Freigeben und veröffentlichen'}</button></div></form></section></div>
}

function LegacyAdminSpotsView({ spots, onCreate, onImport, onUpdate, onDelete, onBack }) {
  const [form, setForm] = useState({ name: '', district: '', address: '', website: '', imageUrl: '', openingHours: '', areaSqm: '', latitude: '', longitude: '' })
  const [imageFile, setImageFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [editingSpot, setEditingSpot] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const csvInput = useRef(null)
  const imageInput = useRef(null)
  function update(field, value) { setForm((current) => ({ ...current, [field]: value })) }
  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onCreate({ ...form, areaSqm: form.areaSqm ? Number(form.areaSqm) : null, latitude: Number(form.latitude), longitude: Number(form.longitude) }, imageFile)
      setForm({ name: '', district: '', address: '', website: '', imageUrl: '', openingHours: '', areaSqm: '', latitude: '', longitude: '' })
      setImageFile(null)
      if (imageInput.current) imageInput.current.value = ''
    } catch (submitError) {
      setError(submitError.message || 'Die Halle konnte nicht angelegt werden.')
    } finally {
      setSaving(false)
    }
  }
  async function importCsv(event) {
    const [file] = event.target.files
    if (!file) return
    setImporting(true)
    setError('')
    try { await onImport(file) } catch (importError) { setError(importError.message || 'Der Import konnte nicht verarbeitet werden.') } finally {
      setImporting(false)
      event.target.value = ''
    }
  }
  const filteredSpots = spots.filter((spot) => `${spot.name} ${spot.district} ${spot.address}`.toLowerCase().includes(filter.trim().toLowerCase()))
  async function removeSpot(spot) {
    if (!window.confirm(`„${spot.name}“ aus der Karte entfernen?`)) return
    setDeletingId(spot.id)
    try { await onDelete(spot.id) } catch (deleteError) { setError(deleteError.message || 'Die Halle konnte nicht gelöscht werden.') } finally { setDeletingId(null) }
  }
  return <main className="view content-view compact-view admin-view"><div className="page-intro"><h1>Hallen anlegen</h1><p>Neue Boulderhallen werden nach dem Speichern direkt auf der Karte veröffentlicht.</p></div><section className="admin-surface"><form onSubmit={submit}><div className="admin-form-grid"><label className="form-field"><span>Name *</span><input required value={form.name} onChange={(event) => update('name', event.target.value)} /></label><label className="form-field"><span>Stadtteil *</span><input required value={form.district} onChange={(event) => update('district', event.target.value)} /></label></div><label className="form-field"><span>Adresse *</span><input required value={form.address} onChange={(event) => update('address', event.target.value)} /></label><div className="admin-form-grid"><label className="form-field"><span>Breitengrad *</span><input required type="number" step="any" value={form.latitude} onChange={(event) => update('latitude', event.target.value)} /></label><label className="form-field"><span>Längengrad *</span><input required type="number" step="any" value={form.longitude} onChange={(event) => update('longitude', event.target.value)} /></label></div><div className="admin-form-grid"><label className="form-field"><span>Öffnungszeiten</span><input value={form.openingHours} onChange={(event) => update('openingHours', event.target.value)} placeholder="z. B. Mo–Fr 10:00–22:00" /></label><label className="form-field"><span>Fläche in m²</span><input type="number" min="0" value={form.areaSqm} onChange={(event) => update('areaSqm', event.target.value)} /></label></div><label className="form-field"><span>Website</span><input type="url" value={form.website} onChange={(event) => update('website', event.target.value)} placeholder="https://…" /></label><label className="form-field"><span>Bild hochladen</span><input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setImageFile(event.target.files[0] ?? null)} /><small>{imageFile ? `${imageFile.name} wird nach dem Speichern verknüpft.` : 'JPEG, PNG oder WebP, maximal 10 MB.'}</small></label><label className="form-field"><span>Oder Bild-URL</span><input type="url" value={form.imageUrl} onChange={(event) => update('imageUrl', event.target.value)} placeholder="https://…/halle.jpg" /><small>Praktisch für den CSV-Massenimport.</small></label>{error && <p className="form-error">{error}</p>}<button className="visit-button" disabled={saving}><IconPlus size={18} />{saving ? 'Wird gespeichert …' : 'Boulderhalle anlegen'}</button></form></section><section className="admin-import"><div><span className="eyebrow">Mehrere Hallen</span><h2>CSV importieren</h2><p>Maximal 500 Hallen; Pflichtspalten: name, district, address, latitude und longitude. image_url ist optional.</p></div><div className="admin-import__actions"><button type="button" className="text-back" onClick={downloadHallTemplate}><IconDownload size={16} />Vorlage herunterladen</button><label className="visit-button"><IconPlus size={18} />{importing ? 'Import wird verarbeitet …' : 'CSV auswählen'}<input ref={csvInput} type="file" accept=".csv,text/csv" onChange={importCsv} disabled={importing} /></label></div></section><section className="admin-list"><div className="section-heading"><h2>Aktive Hallen</h2><span>{filteredSpots.length} / {spots.length}</span></div><label className="admin-filter"><IconSearch size={17} /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Nach Name, Stadtteil oder Adresse filtern" /></label><div className="admin-table-wrap"><table><thead><tr><th>Halle</th><th>Stadtteil</th><th>Adresse</th><th>Quelle</th><th aria-label="Aktionen" /></tr></thead><tbody>{filteredSpots.map((spot) => <tr key={spot.id}><td>{spot.name}</td><td>{spot.district}</td><td>{spot.address}</td><td>{spot.source === 'admin' ? 'manuell' : spot.source === 'admin-import' ? 'CSV' : 'Import'}</td><td><div className="admin-row-actions"><button type="button" onClick={() => setEditingSpot(spot)}>Bearbeiten</button><button type="button" className="danger" disabled={deletingId === spot.id} onClick={() => removeSpot(spot)}>{deletingId === spot.id ? 'Löscht …' : 'Löschen'}</button></div></td></tr>)}</tbody></table></div>{!filteredSpots.length && <p className="journal-empty">Keine Hallen für diesen Filter.</p>}</section><button className="text-back" onClick={onBack}>Zurück zum Profil</button>{editingSpot && <SpotEditDialog spot={editingSpot} onSave={(input) => onUpdate(editingSpot.id, input)} onClose={() => setEditingSpot(null)} />}</main>
}

function AuthAuditSection({ events, stats }) {
  return <section className="admin-audit"><div className="section-heading"><div><span className="eyebrow">Kontosicherheit</span><h2>Registrierungen & Anmeldungen</h2></div><span>{events.length}</span></div><p>Erfolgreiche Registrierungen und Anmeldungen der letzten 100 Ereignisse.</p><div className="admin-kpis" aria-label="BoulderO Kennzahlen"><div><strong>{stats?.registered_users ?? '–'}</strong><span>Registrierte Nutzer</span></div><div><strong>{stats?.journal_entries ?? '–'}</strong><span>Beiträge</span></div><div><strong>{stats?.active_spots ?? '–'}</strong><span>Aktive Hallen</span></div></div><div className="admin-table-wrap"><table><thead><tr><th>Zeitpunkt</th><th>Ereignis</th><th>Konto</th><th>E-Mail</th></tr></thead><tbody>{events.length ? events.map((event) => <tr key={event.id}><td>{new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(event.created_at))}</td><td><span className={`audit-event audit-event--${event.event_type}`}>{event.event_type === 'registration' ? 'Registrierung' : 'Anmeldung'}</span></td><td>{event.user_name}</td><td>{event.user_email}</td></tr>) : <tr><td colSpan="4">Noch keine Ereignisse seit der Aktivierung des Audits.</td></tr>}</tbody></table></div></section>
}

function AuditView({ events, stats, onBack }) {
  return <main className="view content-view compact-view admin-view"><div className="admin-page-content"><div className="page-intro"><span className="eyebrow">BoulderO Verwaltung</span><h1>Kontosicherheit</h1><p>Überblick über erfolgreiche Registrierungen und Anmeldungen.</p></div><AuthAuditSection events={events} stats={stats} /><button className="text-back" onClick={onBack}>Zurück zum Profil</button></div></main>
}

function CsvImportReview({ preview, decisions, onDecisionChange, onBulk, onApply, onClose, applying }) {
  const [filter, setFilter] = useState('all')
  const rows = preview.rows.filter((row) => filter === 'all' || (filter === 'new' && row.input && !row.candidates.length) || (filter === 'matches' && row.candidates.length) || (filter === 'invalid' && row.error))
  const counts = {
    new: preview.rows.filter((row) => row.input && !row.candidates.length).length,
    matches: preview.rows.filter((row) => row.candidates.length).length,
    invalid: preview.rows.filter((row) => row.error).length,
  }
  const selected = Object.values(decisions).filter((decision) => decision.action !== 'skip').length
  return <section className="import-review"><div className="section-heading"><div><span className="eyebrow">CSV-Prüfung</span><h2>{preview.rows.length} Zeilen analysiert</h2></div><button type="button" className="text-back" onClick={onClose} disabled={applying}>Verwerfen</button></div><p>Treffer werden über gleichen Namen oder einen Abstand von höchstens 150 m vorgeschlagen. Erst mit „Auswahl anwenden“ werden Daten geändert.</p><div className="import-review__summary"><span>{counts.new} neu</span><span>{counts.matches} mögliche Treffer</span><span>{counts.invalid} ungültig</span><span>{selected} ausgewählt</span></div><div className="import-review__bulk"><button type="button" onClick={() => onBulk('create-new')} disabled={applying || !counts.new}>Alle neuen anlegen</button><button type="button" onClick={() => onBulk('update-matches')} disabled={applying || !counts.matches}>Treffer aktualisieren</button><button type="button" onClick={() => onBulk('skip-all')} disabled={applying}>Alle überspringen</button></div><div className="import-review__filters" role="tablist" aria-label="CSV-Zeilen filtern">{[['all', 'Alle'], ['new', 'Neu'], ['matches', 'Treffer'], ['invalid', 'Ungültig']].map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div><div className="admin-table-wrap"><table className="import-review__table"><thead><tr><th>Zeile</th><th>CSV-Halle</th><th>Prüfergebnis</th><th>Aktion</th></tr></thead><tbody>{rows.map((row) => { const decision = decisions[row.rowNumber] ?? { action: 'skip' }; const value = decision.action === 'update' ? `update:${decision.targetId}` : decision.action; return <tr key={row.rowNumber} className={row.error ? 'is-invalid' : row.candidates.length ? 'has-match' : ''}><td>{row.rowNumber}</td><td>{row.input ? <><b>{row.input.name}</b><small>{row.input.address} · {row.input.district}</small></> : 'Nicht lesbar'}</td><td>{row.error ? <span className="import-review__error">{row.error}</span> : row.candidates.length ? <div className="import-review__matches">{row.candidates.map((candidate) => <span key={candidate.id}><b>{candidate.name}</b> · {candidate.distance_m} m{candidate.same_name ? ' · gleicher Name' : ''}{candidate.status !== 'active' ? ` · ${candidate.status}` : ''}</span>)}</div> : <span className="import-review__new">Keine passende Halle gefunden</span>}</td><td>{row.error ? <span>Überspringen</span> : <select value={value} onChange={(event) => onDecisionChange(row.rowNumber, event.target.value)} disabled={applying}><option value="skip">Überspringen</option><option value="create">{row.candidates.length ? 'Trotzdem neu anlegen' : 'Neu anlegen'}</option>{row.candidates.map((candidate) => <option key={candidate.id} value={`update:${candidate.id}`}>„{candidate.name}“ aktualisieren</option>)}</select>}</td></tr> })}</tbody></table></div><div className="import-review__footer"><span>{selected ? `${selected} Zeilen werden verarbeitet.` : 'Keine Zeile ausgewählt.'}</span><button type="button" className="visit-button" onClick={onApply} disabled={applying || !selected}>{applying ? 'Import wird angewendet …' : 'Auswahl anwenden'}</button></div></section>
}

function AdminSpotsView({
  spots,
  suggestions,
  correctionReports,
  onCreate,
  onPreviewImport,
  onApplyImport,
  onUpdate,
  onDelete,
  onApproveSuggestion,
  onRejectSuggestion,
  onResolveCorrection,
  onExport,
  onBack,
}) {
  const [filter, setFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSpot, setEditingSpot] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [importFile, setImportFile] = useState(null);
  const [importDecisions, setImportDecisions] = useState({});
  const [applyingImport, setApplyingImport] = useState(false);
  const [reviewingSuggestion, setReviewingSuggestion] = useState(null);
  const [sort, setSort] = useState({ key: "name", direction: "asc" });
  const csvInput = useRef(null);
  const filteredSpots = spots.filter((spot) =>
    `${spot.name} ${spot.district} ${spot.address}`
      .toLowerCase()
      .includes(filter.trim().toLowerCase()),
  );
  function changeSort(key) {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  }
  const sortedSpots = [...filteredSpots].sort((left, right) => {
    const leftValue =
      sort.key === "reports"
        ? correctionReports.filter((report) => report.spot_id === left.id)
            .length
        : String(left[sort.key] ?? "");
    const rightValue =
      sort.key === "reports"
        ? correctionReports.filter((report) => report.spot_id === right.id)
            .length
        : String(right[sort.key] ?? "");
    const result =
      typeof leftValue === "number"
        ? leftValue - rightValue
        : leftValue.localeCompare(rightValue, "de", { sensitivity: "base" });
    return sort.direction === "asc" ? result : -result;
  });
  async function importCsv(event) {
    const [file] = event.target.files;
    if (!file) return;
    setImporting(true);
    setError("");
    try {
      const preview = await onPreviewImport(file);
      setImportFile(file);
      setImportPreview(preview);
      setImportDecisions(Object.fromEntries(preview.rows.map((row) => [row.rowNumber, { action: row.error || row.candidates.length ? 'skip' : 'create' }])));
    } catch (importError) {
      setError(
        importError.message || "Der Import konnte nicht verarbeitet werden.",
      );
    } finally {
      setImporting(false);
      event.target.value = "";
    }
  }
  async function removeSpot(spot) {
    if (!window.confirm(`„${spot.name}“ aus der Karte entfernen?`)) return;
    setDeletingId(spot.id);
    setError("");
    try {
      await onDelete(spot.id);
    } catch (deleteError) {
      setError(
        deleteError.message || "Die Halle konnte nicht gelöscht werden.",
      );
    } finally {
      setDeletingId(null);
    }
  }
  function changeImportDecision(rowNumber, value) {
    const [action, targetId] = value.split(':');
    setImportDecisions((current) => ({ ...current, [rowNumber]: { action, ...(targetId ? { targetId } : {}) } }));
  }
  function bulkImport(action) {
    if (!importPreview) return;
    setImportDecisions((current) => {
      const next = { ...current };
      for (const row of importPreview.rows) {
        if (row.error) { next[row.rowNumber] = { action: 'skip' }; continue; }
        if (action === 'skip-all') next[row.rowNumber] = { action: 'skip' };
        if (action === 'create-new' && !row.candidates.length) next[row.rowNumber] = { action: 'create' };
        if (action === 'update-matches' && row.candidates.length) next[row.rowNumber] = { action: 'update', targetId: row.candidates[0].id };
      }
      return next;
    });
  }
  async function applyImport() {
    if (!importFile) return;
    setApplyingImport(true);
    setError('');
    try {
      await onApplyImport(importFile, Object.entries(importDecisions).map(([rowNumber, decision]) => ({ rowNumber: Number(rowNumber), ...decision })));
      setImportPreview(null);
      setImportFile(null);
      setImportDecisions({});
    } catch (importError) {
      setError(importError.message || 'Der Import konnte nicht angewendet werden.');
    } finally {
      setApplyingImport(false);
    }
  }
  async function exportHalls() {
    setError("");
    try {
      await onExport();
    } catch (exportError) {
      setError(exportError.message || "Der Hallenexport konnte nicht erstellt werden.");
    }
  }
  const sortLabel = (key, label) => (
    <button
      type="button"
      className="table-sort"
      onClick={() => changeSort(key)}
    >
      {label}
      {sort.key === key && (
        <span>{sort.direction === "asc" ? " ↑" : " ↓"}</span>
      )}
    </button>
  );
  return (
    <main className="view content-view compact-view admin-view">
      <div className="page-intro page-intro--action">
        <div>
          <h1>Hallen</h1>
          <p>
            Neue Boulderhallen werden nach dem Speichern direkt auf der Karte
            veröffentlicht.
          </p>
        </div>
        <button
          type="button"
          className="journal-add"
          onClick={() => setCreateOpen(true)}
        >
          <IconPlus size={18} />
          Halle anlegen
        </button>
      </div>
      {suggestions.length > 0 && (
        <section className="admin-suggestions">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Community</span>
              <h2>
                Hallenvorschläge <b>{suggestions.length}</b>
              </h2>
            </div>
          </div>
          <p>
            Diese Vorschläge werden erst nach deiner Prüfung auf der Karte
            veröffentlicht.
          </p>
          <div className="suggestion-list">
            {suggestions.map((suggestion) => (
              <article key={suggestion.id}>
                <div>
                  <b>{suggestion.name}</b>
                  <span>
                    {suggestion.address}
                    {suggestion.district ? ` · ${suggestion.district}` : ""}
                  </span>
                  <small>von {suggestion.submitted_by_name}</small>
                </div>
                <button
                  type="button"
                  onClick={() => setReviewingSuggestion(suggestion)}
                >
                  Prüfen
                </button>
              </article>
            ))}
          </div>
        </section>
      )}
      <section className="admin-import">
        <div>
          <span className="eyebrow">Mehrere Hallen</span>
          <h2>CSV importieren</h2>
          <p>
            Maximal 500 Hallen; Pflichtspalten: name, district, address,
            latitude und longitude. image_url ist optional.
          </p>
        </div>
        <div className="admin-import__actions">
          <button
            type="button"
            className="text-back"
            onClick={exportHalls}
          >
            <IconDownload size={16} />
            Export herunterladen
          </button>
          <button
            type="button"
            className="text-back"
            onClick={downloadHallTemplate}
          >
            <IconDownload size={16} />
            Vorlage herunterladen
          </button>
          <label className="visit-button">
            <IconPlus size={18} />
            {importing ? "Import wird verarbeitet …" : "CSV auswählen"}
            <input
              ref={csvInput}
              type="file"
              accept=".csv,text/csv"
              onChange={importCsv}
              disabled={importing}
            />
          </label>
        </div>
      </section>
      {error && <p className="form-error">{error}</p>}
      {importPreview && <CsvImportReview preview={importPreview} decisions={importDecisions} onDecisionChange={changeImportDecision} onBulk={bulkImport} onApply={applyImport} onClose={() => { setImportPreview(null); setImportFile(null); setImportDecisions({}) }} applying={applyingImport} />}
      <section className="admin-list">
        <div className="section-heading">
          <h2>Aktive Hallen</h2>
          <span>
            {filteredSpots.length} / {spots.length}
          </span>
        </div>
        <label className="admin-filter">
          <IconSearch size={17} />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Nach Name, Stadtteil oder Adresse filtern"
          />
        </label>
        <div className="admin-table-wrap">
          <table>
            <thead>
              <tr>
                <th>{sortLabel("name", "Halle")}</th>
                <th>{sortLabel("district", "Stadtteil")}</th>
                <th>{sortLabel("address", "Adresse")}</th>
                <th>{sortLabel("reports", "Hinweise")}</th>
                <th>{sortLabel("source", "Quelle")}</th>
                <th aria-label="Aktionen" />
              </tr>
            </thead>
            <tbody>
              {sortedSpots.map((spot) => {
                const reports = correctionReports.filter(
                  (report) => report.spot_id === spot.id,
                );
                return (
                  <tr key={spot.id}>
                    <td>{spot.name}</td>
                    <td>{spot.district}</td>
                    <td>{spot.address}</td>
                    <td>
                      {reports.length > 0 && (
                        <button
                          className="admin-correction-badge"
                          type="button"
                          onClick={() => setEditingSpot(spot)}
                        >
                          {reports.length}
                        </button>
                      )}
                    </td>
                    <td>
                      {spot.source === "admin"
                        ? "manuell"
                        : spot.source === "admin-import"
                          ? "CSV"
                          : spot.source === "user-suggestion"
                            ? "Vorschlag"
                            : "Import"}
                    </td>
                    <td>
                      <div className="admin-row-actions">
                        <button
                          type="button"
                          onClick={() => setEditingSpot(spot)}
                        >
                          Bearbeiten
                        </button>
                        <button
                          type="button"
                          className="danger"
                          disabled={deletingId === spot.id}
                          onClick={() => removeSpot(spot)}
                        >
                          {deletingId === spot.id ? "Löscht …" : "Löschen"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!filteredSpots.length && (
          <p className="journal-empty">Keine Hallen für diesen Filter.</p>
        )}
      </section>
      <button className="text-back" onClick={onBack}>
        Zurück zum Profil
      </button>
      {createOpen && (
        <SpotCreateDialog
          onCreate={onCreate}
          onClose={() => setCreateOpen(false)}
        />
      )}
      {editingSpot && (
        <SpotEditDialog
          spot={editingSpot}
          reports={correctionReports.filter(
            (report) => report.spot_id === editingSpot.id,
          )}
          onResolveReport={onResolveCorrection}
          onSave={(input, imageFile) =>
            onUpdate(editingSpot.id, input, imageFile)
          }
          onClose={() => setEditingSpot(null)}
        />
      )}
      {reviewingSuggestion && (
        <SpotSuggestionReviewDialog
          suggestion={reviewingSuggestion}
          onApprove={onApproveSuggestion}
          onReject={onRejectSuggestion}
          onClose={() => setReviewingSuggestion(null)}
        />
      )}
    </main>
  );
}

function formatFeedDate(value) {
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
}

function FeedAuthor({ entry }) {
  const [expanded, setExpanded] = useState(false)
  return <div className="feed-author"><button className="person-avatar feed-avatar" onClick={() => setExpanded((value) => !value)} aria-label={`Profil von ${entry.user_name} anzeigen`}>{entry.user_image ? <img src={`/api/avatars/${entry.user_id}`} alt="" /> : entry.user_name.split(' ').map((part) => part[0]).join('')}<RankBadge uniqueSpots={entry.author_unique_spots} /></button><span className="feed-author__identity"><b>{entry.user_name}</b><time>{formatFeedDate(entry.created_at)}</time></span>{entry.is_owner && <span className="feed-author__own">Dein Beitrag</span>}{expanded && <div className="feed-author__dropdown"><b>{entry.user_name}</b><small>@{entry.username} · {visibilityLabel(entry.visibility)}</small></div>}</div>
}

function FeedMediaCarousel({ entry, onOpenImage }) {
  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState('next')
  const media = entry.media ?? []
  const item = media[index]
  if (!item) return null
  return <div className="feed-carousel"><figure onClick={() => onOpenImage(`/api/media/${item.id}`, `Geteilter Eintrag von ${entry.user_name}`)}><img key={`${item.id}-${direction}`} className={direction === 'previous' ? 'feed-carousel__image--previous' : ''} src={`/api/media/${item.id}`} alt={`Geteilter Eintrag von ${entry.user_name}`} /><figcaption><span>war bei</span>{entry.spot_name}<small>{entry.district}</small></figcaption></figure>{media.length > 1 && <><button className="carousel-button carousel-button--previous" onClick={() => { setDirection('previous'); setIndex((current) => (current - 1 + media.length) % media.length) }} aria-label="Vorheriges Bild"><IconChevronLeft size={22} /></button><button className="carousel-button carousel-button--next" onClick={() => { setDirection('next'); setIndex((current) => (current + 1) % media.length) }} aria-label="Nächstes Bild"><IconChevronRight size={22} /></button><span className="carousel-count">{index + 1}/{media.length}</span></>}</div>
}

function Lightbox({ image, onClose }) {
  return <div className="lightbox" role="dialog" aria-modal="true" aria-label={image.alt} onClick={onClose}><button className="lightbox__close" onClick={onClose} aria-label="Bild schließen"><IconX size={21} /></button><img src={image.src} alt={image.alt} onClick={(event) => event.stopPropagation()} /></div>
}

function formatPlanDate(value) {
  return new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function PlannedVisitCard({ plan, onRsvp }) {
  const rsvp = plan.my_response
  const [people, setPeople] = useState([])
  const [peopleOpen, setPeopleOpen] = useState(false)
  async function togglePeople() { if (!peopleOpen) { const response = await fetch(`/api/planned-visits/${plan.id}/rsvps`); if (response.ok) setPeople((await response.json()).rsvps) }; setPeopleOpen((value) => !value) }
  return <article className="planned-visit-card"><div className="planned-visit-card__top"><span className="eyebrow">Geplant</span><time>{formatPlanDate(plan.starts_at)}</time></div><div className="planned-visit-author"><span className="person-avatar">{plan.user_image ? <img src={`/api/avatars/${plan.user_id}`} alt="" /> : plan.user_name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><span><b>{plan.user_name}</b><small>plant einen Besuch</small></span></div><h3>{plan.spot_name}</h3><p>{plan.district} · {plan.address}</p><p className="planned-visit-card__note">{plan.note || `${plan.user_name} plant eine Boulder-Session.`}</p><div className="planned-visit-card__footer"><div className="planned-people"><button type="button" onClick={togglePeople}><IconUsers size={16} />{plan.going_count} dabei{plan.interested_count > 0 ? ` · ${plan.interested_count} interessiert` : ''}</button>{peopleOpen && <div className="planned-people__popover">{people.length ? people.map((person) => <div key={person.id}><span className="person-avatar">{person.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><span><b>{person.name}</b><small>{person.response === 'going' ? 'Dabei' : 'Interessiert'}</small></span></div>) : <small>Noch keine Zusagen.</small>}</div>}</div>{!plan.is_owner && <div className="planned-rsvp-actions"><button className={rsvp === 'interested' ? 'is-active' : ''} onClick={() => onRsvp(plan, rsvp === 'interested' ? null : 'interested')}>Interessiert</button><button className={rsvp === 'going' ? 'is-active' : ''} onClick={() => onRsvp(plan, rsvp === 'going' ? null : 'going')}>{rsvp === 'going' ? 'Zugesagt' : 'Zusagen'}</button></div>}</div></article>
}

function FeedView({ onOpenImage, authorFilter, onClearAuthorFilter, onFeedRead }) {
  const [entries, setEntries] = useState([])
  const [plannedVisits, setPlannedVisits] = useState([])
  const [error, setError] = useState('')
  const [comments, setComments] = useState({})
  const [expanded, setExpanded] = useState(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [feedMode, setFeedMode] = useState('all')

  async function load() {
    try {
      const [feedResponse, plansResponse] = await Promise.all([fetch('/api/social/feed'), fetch('/api/social/planned-visits')])
      if (!feedResponse.ok || !plansResponse.ok) throw new Error('Feed konnte nicht geladen werden.')
      setEntries((await feedResponse.json()).entries)
      setPlannedVisits((await plansResponse.json()).plannedVisits)
      await fetch('/api/social/feed/seen', { method: 'POST' })
      onFeedRead()
    } catch (loadError) { setError(loadError.message) }
  }
  useEffect(() => { load() }, [])

  async function toggleLike(entry) {
    await fetch(`/api/social/entries/${entry.id}/like`, { method: entry.liked_by_me ? 'DELETE' : 'POST' })
    await load()
  }

  async function toggleComments(entryId) {
    if (expanded === entryId) return setExpanded(null)
    const response = await fetch(`/api/social/entries/${entryId}/comments`)
    if (response.ok) {
      const data = await response.json()
      setComments((current) => ({ ...current, [entryId]: data.comments }))
    }
    setExpanded(entryId)
  }

  async function postComment(entryId) {
    const body = commentDraft.trim()
    if (!body) return
    const response = await fetch(`/api/social/entries/${entryId}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) })
    if (!response.ok) return setError('Kommentar konnte nicht gespeichert werden.')
    setCommentDraft('')
    const data = await response.json()
    setComments((current) => ({ ...current, [entryId]: [...(current[entryId] ?? []), data.comment] }))
    await load()
  }

  async function rsvp(plan, response) {
    const result = await fetch(`/api/planned-visits/${plan.id}/rsvp`, response ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response }) } : { method: 'DELETE' })
    if (!result.ok) return setError('Deine Zusage konnte nicht aktualisiert werden.')
    await load()
  }

  const visibleEntries = (feedMode === 'friends' ? entries.filter((entry) => entry.is_friend || entry.is_owner) : entries).filter((entry) => !authorFilter || entry.user_id === authorFilter.id)
  const visiblePlans = (feedMode === 'friends' ? plannedVisits.filter((plan) => plan.is_friend || plan.is_owner) : plannedVisits).filter((plan) => !authorFilter || plan.user_id === authorFilter.id)
  return <main className="view content-view compact-view social-view">{error && <p className="form-error">{error}</p>}<section className="social-section feed-section"><div className="section-heading"><div><h2>{authorFilter ? `Feed von ${authorFilter.name}` : 'Aktuell im Feed'}</h2>{authorFilter && <button type="button" className="text-back" onClick={onClearAuthorFilter}>Gesamten Feed zeigen</button>}</div><div className="feed-toggle"><button className={feedMode === 'all' ? 'is-active' : ''} onClick={() => setFeedMode('all')}>Aktuell</button><button className={feedMode === 'friends' ? 'is-active' : ''} onClick={() => setFeedMode('friends')}>Freunde</button></div></div>{visiblePlans.length > 0 && <section className="planned-visit-list"><div className="section-heading"><h3>Geplante Besuche</h3><span>{visiblePlans.length}</span></div>{visiblePlans.map((plan) => <PlannedVisitCard key={plan.id} plan={plan} onRsvp={rsvp} />)}</section>}{!visibleEntries.length && !visiblePlans.length && <p className="journal-empty">Noch keine Beiträge für diese Ansicht.</p>}<div className="feed-list">{visibleEntries.map((entry) => <article className={entry.is_owner ? 'feed-entry feed-entry--own' : 'feed-entry'} key={entry.id}><FeedAuthor entry={entry} /><h3 className="feed-entry__visit">{entry.user_name} war bei {entry.spot_name}</h3>{entry.body && <p className="feed-body">{entry.body}</p>}{entry.media?.length > 0 && <FeedMediaCarousel entry={entry} onOpenImage={onOpenImage} />}<div className="feed-actions"><button className={entry.liked_by_me ? 'is-active' : ''} onClick={() => toggleLike(entry)}>♥ <span>{entry.like_count}</span></button><button onClick={() => toggleComments(entry.id)}>{entry.comment_count === 1 ? 'Kommentar' : 'Kommentare'} <span>{entry.comment_count}</span></button></div>{expanded === entry.id && <div className="comments"><div>{(comments[entry.id] ?? []).map((comment) => <p key={comment.id}><b>{comment.user_name}</b>{comment.body}</p>)}</div><form onSubmit={(event) => { event.preventDefault(); postComment(entry.id) }}><input value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} maxLength="1000" placeholder="Kommentar schreiben …" /><button>Posten</button></form></div>}</article>)}</div></section></main>
}

function UserAvatar({ user, onOpenImage }) {
  const initials = user.name.split(' ').map((part) => part[0]).join('').slice(0, 2)
  const avatar = <>{user.image ? <img src={`/api/avatars/${user.id ?? user.user_id}`} alt="" /> : initials}<RankBadge uniqueSpots={user.unique_spots} /></>
  if (user.image && onOpenImage) return <button type="button" className="person-avatar social-avatar social-avatar--ranked social-avatar--zoomable" onClick={() => onOpenImage(`/api/avatars/${user.id ?? user.user_id}`, `Profilbild von ${user.name}`)} aria-label={`Profilbild von ${user.name} vergrößern`}>{avatar}</button>
  return <span className="person-avatar social-avatar social-avatar--ranked">{avatar}</span>
}

function FriendsView({ onOpenMessages, onSummaryChange, onOpenUserFeed, onOpenImage }) {
  const [tab, setTab] = useState('friends')
  const [friends, setFriends] = useState([])
  const [friendSuggestions, setFriendSuggestions] = useState([])
  const [requests, setRequests] = useState({ incoming: [], outgoing: [] })
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(null)
  const [friendMenuId, setFriendMenuId] = useState(null)
  async function load() {
    try {
      const [friendsResponse, suggestionsResponse, requestsResponse, summaryResponse] = await Promise.all([fetch('/api/social/friends'), fetch('/api/social/friend-suggestions'), fetch('/api/social/friend-requests'), fetch('/api/social/friends/summary')])
      if (!friendsResponse.ok || !suggestionsResponse.ok || !requestsResponse.ok || !summaryResponse.ok) throw new Error('Freunde konnten nicht geladen werden.')
      setFriends((await friendsResponse.json()).friends)
      setFriendSuggestions((await suggestionsResponse.json()).suggestions)
      setRequests(await requestsResponse.json())
      onSummaryChange(await summaryResponse.json())
    } catch (loadError) { setError(loadError.message) }
  }
  useEffect(() => {
    load()
    const interval = window.setInterval(load, 15000)
    return () => window.clearInterval(interval)
  }, [])
  useEffect(() => {
    const searchQuery = query.trim().replace(/^@+/, '')
    if (searchQuery.length < 2) { setResults([]); return undefined }
    const timer = window.setTimeout(async () => {
      const response = await fetch(`/api/social/discover?q=${encodeURIComponent(searchQuery)}`)
      if (response.ok) setResults((await response.json()).users)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query])
  async function action(path, method = 'POST') {
    setError('')
    const response = await fetch(path, { method })
    if (!response.ok) { setError('Die Beziehung konnte nicht aktualisiert werden.'); return }
    await load()
    const searchQuery = query.trim().replace(/^@+/, '')
    if (searchQuery.length >= 2) {
      const search = await fetch(`/api/social/discover?q=${encodeURIComponent(searchQuery)}`)
      if (search.ok) setResults((await search.json()).users)
    }
  }
  async function openPreview(user) {
    if (preview?.user?.id === user.id) return setPreview(null)
    const response = await fetch(`/api/social/users/${user.id}/preview`)
    if (!response.ok) return setError('Die Vorschau konnte nicht geladen werden.')
    setPreview(await response.json())
  }
  return (
    <main className="view content-view compact-view social-view">
      <section className="social-section friends-section">
        <div className="section-heading">
          <h2>Freunde</h2>
          <div className="friends-tabs">
            <button className={tab === 'friends' ? 'is-active' : ''} onClick={() => setTab('friends')}>Freunde</button>
            <button className={`${tab === 'requests' ? 'is-active ' : ''}has-badge`} onClick={() => setTab('requests')}>Anfragen{requests.incoming.length > 0 && <b>{requests.incoming.length}</b>}</button>
            <button className={tab === 'discover' ? 'is-active' : ''} onClick={() => setTab('discover')}>Entdecken</button>
          </div>
        </div>
        {error && <p className="form-error">{error}</p>}
        {tab === 'friends' && <>
          {friendSuggestions.length > 0 && <section className="friend-suggestions">
            <div className="section-heading"><div><span className="eyebrow">Für dich</span><h3>Personen, die du kennen könntest</h3></div><span>{friendSuggestions.length}</span></div>
            <p>Vorgeschlagen über gemeinsame Kontakte.</p>
            <div className="people-list">
              {friendSuggestions.map((user) => <article key={user.id}>
                <UserAvatar user={user} />
                <div><h3>{user.name}</h3><p>@{user.username} · {user.mutual_friend_count} gemeinsame{user.mutual_friend_count === 1 ? 'r Kontakt' : ' Kontakte'}</p></div>
                <button type="button" className="suggestion-dismiss" onClick={() => action(`/api/social/friend-suggestions/${user.id}/dismiss`)} aria-label={`${user.name} nicht mehr vorschlagen`} title="Nicht mehr vorschlagen"><IconX size={16} /></button>
                <button type="button" onClick={() => action(`/api/social/friend-requests/${user.id}`)}><IconUserPlus size={16} />Anfragen</button>
              </article>)}
            </div>
          </section>}
          <div className="people-list friends-list">
            {!friends.length && <p className="journal-empty">Noch keine Freundschaften. Entdecke andere BoulderO-Nutzer:innen.</p>}
            {friends.map((user) => <article key={user.id}>
              <UserAvatar user={user} onOpenImage={onOpenImage} />
              <div><h3>{user.name}</h3><p>@{user.username}{user.last_visit_at ? ` · letzter Besuch ${formatFeedDate(user.last_visit_at)}` : ''}</p></div>
              <div className="friend-row-actions"><button type="button" className="message-button" onClick={() => openPreview(user)}>Profil</button><button className="message-button" onClick={() => { onOpenMessages(user); setFriends((current) => current.map((item) => item.id === user.id ? { ...item, unread_count: 0 } : item)) }}>Nachricht{user.unread_count > 0 && <b>{user.unread_count}</b>}</button><div className="friend-more-menu"><button type="button" className="friend-more-button" onClick={() => setFriendMenuId((current) => current === user.id ? null : user.id)} aria-label={`Beziehungsoptionen für ${user.name}`} aria-expanded={friendMenuId === user.id} title="Beziehungsoptionen"><IconDots size={19} /></button>{friendMenuId === user.id && <div className="friend-more-menu__popover"><button type="button" onClick={() => { setFriendMenuId(null); action(`/api/follows/${user.id}`, 'DELETE') }}>Nicht mehr folgen</button><button type="button" className="danger" onClick={() => { setFriendMenuId(null); action(`/api/social/friends/${user.id}`, 'DELETE') }}>Freundschaft beenden</button></div>}</div></div>
              {preview?.user?.id === user.id && <div className="friend-preview"><b>Letztes von {preview.user.name}</b>{preview.plans.map((plan) => <p key={plan.id}><IconCalendarEvent size={14} /> {formatPlanDate(plan.starts_at)} · {plan.spot_name}</p>)}{preview.entries.map((entry) => <p key={entry.id}>war bei <b>{entry.spot_name}</b>{entry.body ? ` · ${entry.body}` : ''}</p>)}{!preview.entries.length && !preview.plans.length && <p>Noch nichts geteilt.</p>}<button type="button" onClick={() => onOpenUserFeed(preview.user)}>Feed von {preview.user.name.split(' ')[0]} öffnen</button></div>}
            </article>)}
          </div>
        </>}
        {tab === 'requests' && <div className="request-groups"><section><div className="section-heading"><h3>Eingegangen</h3><span>{requests.incoming.length}</span></div><div className="people-list">{!requests.incoming.length && <p className="journal-empty">Keine offenen Anfragen.</p>}{requests.incoming.map((request) => <article key={request.id}><UserAvatar user={{ ...request, id: request.user_id }} /><div><h3>{request.name}</h3><p>@{request.username}</p></div><button className="message-button" onClick={() => action(`/api/social/friend-requests/${request.id}/decline`)}>Ablehnen</button><button onClick={() => action(`/api/social/friend-requests/${request.id}/accept`)}><IconCheck size={16} />Annehmen</button></article>)}</div></section><section><div className="section-heading"><h3>Gesendet</h3><span>{requests.outgoing.length}</span></div><div className="people-list">{!requests.outgoing.length && <p className="journal-empty">Keine gesendeten Anfragen.</p>}{requests.outgoing.map((request) => <article key={request.id}><UserAvatar user={{ ...request, id: request.user_id }} /><div><h3>{request.name}</h3><p>@{request.username} · Anfrage gesendet</p></div></article>)}</div></section></div>}
        {tab === 'discover' && <section className="friend-discover"><label className="search-field"><IconSearch size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name oder @username suchen" /></label>{query.trim().replace(/^@+/, '').length > 0 && query.trim().replace(/^@+/, '').length < 2 && <p className="journal-empty">Mindestens zwei Zeichen eingeben.</p>}<div className="people-list">{results.map((user) => <article key={user.id}><UserAvatar user={user} /><div><h3>{user.name}</h3><p>@{user.username}{user.follows_you ? ' · folgt dir' : ''}</p></div>{user.is_friend ? <span className="relationship-state"><IconUserCheck size={16} />Freund:in</span> : user.request_sent ? <span className="relationship-state">Anfrage gesendet</span> : user.request_received ? <span className="relationship-actions"><button className="message-button" onClick={() => action(`/api/social/friend-requests/${user.incoming_request_id}/decline`)}>Ablehnen</button><button onClick={() => action(`/api/social/friend-requests/${user.incoming_request_id}/accept`)}>Annehmen</button></span> : <button onClick={() => action(`/api/social/friend-requests/${user.id}`)}><IconUserPlus size={16} />Anfragen</button>}{!user.is_friend && <button className={user.following ? 'following' : ''} onClick={() => action(`/api/follows/${user.id}`, user.following ? 'DELETE' : 'POST')}>{user.following ? 'Folge ich' : 'Folgen'}</button>}</article>)}</div></section>}
      </section>
    </main>
  )
}

function formatMessageTime(value) {
  return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function MessageDialog({ user, onClose, onRead }) {
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  async function load() { const response = await fetch(`/api/messages/${user.id}`); if (response.ok) { setMessages((await response.json()).messages); onRead() } else setError('Nachrichten benötigen gegenseitiges Folgen.') }
  useEffect(() => {
    load()
    const interval = window.setInterval(load, 8000)
    return () => window.clearInterval(interval)
  }, [user.id])
  async function send(event) { event.preventDefault(); if (!draft.trim()) return; const response = await fetch(`/api/messages/${user.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: draft.trim() }) }); if (!response.ok) return setError('Nachricht konnte nicht gesendet werden.'); setDraft(''); await load() }
  return <div className="composer-backdrop"><section className="journal-composer message-dialog" role="dialog" aria-modal="true"><div className="composer-header"><div><span className="eyebrow">Direktnachrichten</span><h2>{user.name}</h2></div><button className="icon-button ui-icon-button" onClick={onClose}><IconX size={19} /></button></div>{error && <p className="form-error">{error}</p>}<div className="message-list">{messages.map((message) => { const own = message.sender_id !== user.id; return <article className={own ? 'message message--own' : 'message message--received'} key={message.id}><span>{message.body}</span><small>{own ? 'Du' : user.name.split(' ')[0]} · {formatMessageTime(message.created_at)}</small></article> })}</div><form className="message-compose" onSubmit={send}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Nachricht schreiben …" maxLength="2000" /><button>Senden</button></form></section></div>
}

function SignInDialog({ configuration, onClose, onDemoSignIn, onMemberSignIn, onRegister, onRequestPasswordReset, onResendVerification, onResetPassword, onOpenPrivacy, onOpenImprint, resetToken }) {
  const [mode, setMode] = useState(resetToken ? 'reset' : 'signin')
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  function switchMode(next) { setError(''); setNotice(''); setMode(next) }
  const normalizedUsername = username.trim().replace(/^@+/, '').toLowerCase()
  const [usernameStatus, setUsernameStatus] = useState('idle')
  useEffect(() => {
    if (mode !== 'register') return undefined
    if (!/^[a-z0-9_]{3,24}$/.test(normalizedUsername)) {
      setUsernameStatus(normalizedUsername ? 'invalid' : 'idle')
      return undefined
    }
    let cancelled = false
    setUsernameStatus('checking')
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/register/username-availability?username=${encodeURIComponent(normalizedUsername)}`)
        if (cancelled) return
        const payload = await response.json().catch(() => ({}))
        setUsernameStatus(response.ok && payload.available ? 'available' : 'taken')
      } catch {
        if (!cancelled) setUsernameStatus('taken')
      }
    }, 300)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [mode, normalizedUsername])
  async function submit(event) {
    event.preventDefault(); setError(''); setNotice('')
    try {
      if (mode === 'signin') await onMemberSignIn(email, password)
      if (mode === 'register') { if (usernameStatus !== 'available') throw new Error('Wähle einen freien @Namen.'); const result = await onRegister(name, normalizedUsername, email, password); switchMode('signin'); setNotice(result?.deliveryFailed ? 'Dein Konto wurde angelegt, aber die Bestätigungs-E-Mail konnte noch nicht versendet werden. Du kannst sie hier erneut anfordern.' : 'Fast geschafft: Bitte bestätige jetzt den Link in deiner E-Mail.') }
      if (mode === 'forgot') { await onRequestPasswordReset(email); setNotice('Falls ein Konto existiert, wurde ein Link zum Zurücksetzen versendet.') }
      if (mode === 'reset') { if (password !== passwordConfirm) throw new Error('Die Passwörter stimmen nicht überein.'); await onResetPassword(resetToken, password); setNotice('Dein Passwort wurde geändert. Du kannst dich jetzt anmelden.'); setMode('signin'); setPassword(''); setPasswordConfirm('') }
    } catch (submitError) { setError(submitError.message || 'Die Anfrage konnte nicht verarbeitet werden.') }
  }
  const title = ({ register: 'Konto erstellen', forgot: 'Passwort vergessen', reset: 'Neues Passwort', signin: 'Anmelden' })[mode]
  return <div className="composer-backdrop"><section className="journal-composer auth-dialog" role="dialog" aria-modal="true" aria-label="BoulderO Konto"><div className="composer-header"><div><span className="eyebrow">BoulderO Konto</span><h2>{title}</h2></div><button className="icon-button ui-icon-button" onClick={onClose} aria-label="Schließen"><IconX size={19} /></button></div>{!resetToken && <div className="auth-tabs"><button className={mode === 'signin' ? 'is-active' : ''} onClick={() => switchMode('signin')}>Anmelden</button><button disabled={!configuration?.registrationEnabled} className={mode === 'register' ? 'is-active' : ''} onClick={() => switchMode('register')}>Registrieren</button></div>}<form className="admin-login" onSubmit={submit}>{mode === 'register' && <><label className="form-field"><span>Name</span><input required value={name} onChange={(event) => setName(event.target.value)} /></label><label className="form-field"><span>Dein @Name</span><span className={`username-input username-input--${usernameStatus}`}><b>@</b><input required value={username} minLength="3" maxLength="24" autoCapitalize="none" autoCorrect="off" spellCheck="false" onChange={(event) => setUsername(event.target.value.replace(/^@+/, '').toLowerCase())} placeholder="kerstin" aria-describedby="username-help" />{usernameStatus === 'available' && <IconCheck size={18} aria-label="@Name ist verfügbar" />}</span><small id="username-help" className={`username-help username-help--${usernameStatus}`}>{usernameStatus === 'available' ? '@Name ist verfügbar' : usernameStatus === 'checking' ? '@Name wird geprüft …' : usernameStatus === 'taken' ? '@Name ist bereits vergeben' : usernameStatus === 'invalid' ? '3–24 Zeichen: Kleinbuchstaben, Zahlen oder _' : 'So finden dich andere in BoulderO.'}</small></label></>}{mode !== 'reset' && <label className="form-field"><span>E-Mail</span><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>}{mode !== 'forgot' && <label className="form-field"><span>{mode === 'reset' ? 'Neues Passwort' : 'Passwort'}</span><span className="password-input"><input required type={passwordVisible ? 'text' : 'password'} minLength="10" value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" onClick={() => setPasswordVisible((value) => !value)} aria-label={passwordVisible ? 'Passwort verbergen' : 'Passwort anzeigen'}><IconEye size={18} /></button></span></label>}{mode === 'reset' && <label className="form-field"><span>Passwort wiederholen</span><input required type="password" minLength="10" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} /></label>}{error && <p className="form-error">{error}</p>}{notice && <p className="form-notice">{notice}</p>}<button className="visit-button" disabled={mode === 'register' && usernameStatus !== 'available'}>{mode === 'register' ? 'Bestätigungs-E-Mail senden' : mode === 'forgot' ? 'Reset-Link senden' : mode === 'reset' ? 'Passwort speichern' : 'Anmelden'}</button></form>{mode === 'signin' && <div className="auth-links"><button type="button" className="text-back" onClick={() => switchMode('forgot')}>Passwort vergessen?</button><button type="button" className="text-back" onClick={async () => { try { await onResendVerification(email); setNotice('Falls dein Konto noch nicht bestätigt ist, wurde eine neue E-Mail gesendet.') } catch { setError('Die Bestätigungs-E-Mail konnte nicht gesendet werden.') } }}>Bestätigung erneut senden</button></div>}{mode === 'register' && !configuration?.registrationEnabled && <p className="form-error">Die E-Mail-Registrierung wird gerade eingerichtet.</p>}{mode === 'signin' && configuration?.demoEnabled && <div className="demo-account-list">{configuration.demoProfiles.map((profile) => <button key={profile.id} onClick={() => onDemoSignIn(profile.id)}><span className="person-avatar">{profile.name.split(' ').map((part) => part[0]).join('')}</span><span><b>{profile.name}</b><small>@{profile.username}</small></span><IconChevronRight size={18} /></button>)}</div>}<p className="auth-note"><IconLock size={15} />Passwörter werden sicher gespeichert. Neue Konten werden per E-Mail bestätigt.</p><div className="legal-links"><button type="button" onClick={onOpenPrivacy}>Datenschutz</button><button type="button" onClick={onOpenImprint}>Impressum</button></div></section></div>
}

function PasswordDialog({ onClose, onSave }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState('')
  async function submit(event) { event.preventDefault(); setError(''); try { if (password !== passwordConfirm) throw new Error('Die Passwörter stimmen nicht überein.'); await onSave(currentPassword, password) } catch (submitError) { setError(submitError.message || 'Passwort konnte nicht geändert werden.') } }
  return <div className="composer-backdrop"><section className="journal-composer auth-dialog" role="dialog" aria-modal="true"><div className="composer-header"><div><span className="eyebrow">BoulderO Konto</span><h2>Passwort ändern</h2></div><button className="icon-button ui-icon-button" onClick={onClose} aria-label="Schließen"><IconX size={19} /></button></div><form className="admin-login" onSubmit={submit}><label className="form-field"><span>Aktuelles Passwort</span><input required type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label><label className="form-field"><span>Neues Passwort</span><input required type="password" minLength="10" value={password} onChange={(event) => setPassword(event.target.value)} /></label><label className="form-field"><span>Passwort wiederholen</span><input required type="password" minLength="10" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} /></label>{error && <p className="form-error">{error}</p>}<button className="visit-button">Passwort ändern</button></form></section></div>
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
  const [feedAuthorFilter, setFeedAuthorFilter] = useState(null)
  const [spotSuggestions, setSpotSuggestions] = useState([])
  const [spotCorrectionReports, setSpotCorrectionReports] = useState([])
  const [authAudit, setAuthAudit] = useState([])
  const [adminStats, setAdminStats] = useState(null)
  const [suggestionDialogOpen, setSuggestionDialogOpen] = useState(false)
  const [planDialogSpotId, setPlanDialogSpotId] = useState(null)
  const [correctionDialogSpotId, setCorrectionDialogSpotId] = useState(null)
  const [legalDialog, setLegalDialog] = useState(null)

  function navigate(view, { replace = false } = {}) {
    if (!appViews.has(view)) return
    setComposerOpen(false)
    setComposerSpotId(null)
    setPlanDialogSpotId(null)
    setComposerSurface('dialog')
    const current = window.history.state
    const position = current?.position ?? 0
    const nextState = { boulderO: true, view, position: replace ? position : position + 1 }
    const path = pathForView(view)
    if (window.location.pathname !== path) window.history[replace ? 'replaceState' : 'pushState'](nextState, '', path)
    else if (!current?.boulderO || current.view !== view) window.history.replaceState(nextState, '', path)
    setActiveView(view)
  }

  function goBack(fallback = 'profile') {
    if (window.history.state?.boulderO && window.history.state.position > 0) window.history.back()
    else navigate(fallback, { replace: true })
  }

  useEffect(() => {
    const initialView = viewFromLocation()
    if (!window.history.state?.boulderO) window.history.replaceState({ boulderO: true, view: initialView, position: 0 }, '', `${pathForView(initialView)}${window.location.search}`)
    function onPopState() {
      setComposerOpen(false)
      setComposerSpotId(null)
      setPlanDialogSpotId(null)
      setComposerSurface('dialog')
      setSelectedEntry(null)
      setMessageUser(null)
      setLightboxImage(null)
      setActiveView(viewFromLocation())
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

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
      return { ...fallback, ...spot, position: [Number(spot.latitude), Number(spot.longitude)], open: spot.opening_hours, size: `${Number(spot.area_sqm ?? 0).toLocaleString('de-DE')} m²`, visits: countBySpot[spot.id] ?? 0, last_visit_at: lastVisitBySpot[spot.id] ?? null }
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
    await loadFeedSummary()
  }

  useEffect(() => {
    fetch('/api/auth/configuration').then((response) => response.ok ? response.json() : null).then(setAuthConfiguration).catch(() => undefined)
    refreshSession().catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!currentUser) return undefined
    async function refreshFriendSummary() {
      const [response] = await Promise.all([fetch('/api/social/friends/summary'), loadFeedSummary()])
      if (response.ok) setFriendSummary(await response.json())
    }
    refreshFriendSummary()
    const interval = window.setInterval(refreshFriendSummary, 15000)
    window.addEventListener('focus', refreshFriendSummary)
    return () => { window.clearInterval(interval); window.removeEventListener('focus', refreshFriendSummary) }
  }, [currentUser?.id])

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
    await fetch('/api/auth/callback/member', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrfToken, callbackUrl: window.location.origin, email, password }), redirect: 'manual' })
    const response = await fetch('/api/me')
    if (!response.ok) throw new Error('E-Mail oder Passwort sind nicht korrekt.')
    const { user } = await response.json(); setCurrentUser(user); await loadPrivateData(); await loadSpotSuggestions(user); await loadSpotCorrectionReports(user); await loadAuthAudit(user); setAuthOpen(false); showToast('Willkommen bei BoulderO')
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
    showToast('Du bist abgemeldet')
  }

  function openComposer(spotId = null) {
    if (!currentUser) {
      navigate('profile')
      showToast('Melde dich an, um Besuche dauerhaft zu speichern')
      return
    }
    setPlanDialogSpotId(null)
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
    setComposerSurface('dialog')
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
    await loadPrivateData()
    showToast(entry.visibility === 'private' ? 'Privater Tagebucheintrag gespeichert' : 'Geteilter Tagebucheintrag gespeichert')
  }

  async function updateJournalEntry(id, patch) {
    const response = await fetch(`/api/journal/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: patch.body, visibility: patch.visibility }) })
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
    if (!response.ok) return showToast('Profilfoto konnte nicht hochgeladen werden')
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
      throw new Error('Die CSV-Datei konnte nicht analysiert werden. Bitte prüfe die Vorlage und die Koordinaten.')
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

  async function exportSpots() {
    const response = await fetch('/api/admin/spots/export')
    if (!response.ok) throw new Error('Der Hallenexport konnte nicht erstellt werden.')
    const downloadUrl = URL.createObjectURL(await response.blob())
    const anchor = document.createElement('a')
    anchor.href = downloadUrl
    anchor.download = 'bouldero-hallen-export.zip'
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
    <div className="app-shell">
      <header className="app-header">
        <button className="brand" onClick={() => navigate('map')} aria-label="Zur Karte"><img className="brand-logo" src="/BoulderO_Logo.ico" alt="" /><span>Boulder<span>O</span></span></button>
        <div className="header-progress"><span><b>{uniqueVisited}</b>/10 Hallen</span><i><em style={{ width: `${uniqueVisited * 10}%` }} /></i></div>
        {currentUser ? <button className="profile-chip" onClick={() => navigate('profile')} aria-label="Profil öffnen"><span className="profile-chip__image">{currentUser.image ? <img src={`/api/avatars/${currentUser.id}`} alt="" /> : currentUser.name.split(' ').map((name) => name[0]).join('').slice(0, 2)}</span><RankBadge progress={progress} /></button> : <button className="header-login" onClick={() => setAuthOpen(true)}><IconLogin2 size={18} />Anmelden</button>}
      </header>
      {!currentUser && welcomeOpen && <section className="welcome-screen"><div className="welcome-card"><img src="/BoulderO_Logo.ico" alt="BoulderO" /><h1>BoulderO</h1><p>Entdecke Hallen, halte Besuche fest und teile deine Boulderreise mit Freundinnen und Freunden.</p><div><button className="visit-button" onClick={() => setAuthOpen(true)}>Konto erstellen oder anmelden</button><button className="text-back" onClick={() => setWelcomeOpen(false)}>Karte entdecken</button></div></div><div className="welcome-legal-links"><button type="button" onClick={() => setLegalDialog('privacy')}>Datenschutz</button><button type="button" onClick={() => setLegalDialog('imprint')}>Impressum</button></div></section>}
      {activeView === 'map' && <MapView spots={spots} currentUser={currentUser} selectedId={selectedId} lastVisitedSpotId={journalVisits[0]?.spot_id} onSelectSpot={selectSpot} onVisit={openComposer} onPlan={openPlan} onReport={openCorrection} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} isPickingSpot={isPickingSpot} onCancelPicker={() => setIsPickingSpot(false)} onMessage={showToast} />}
      {activeView === 'journal' && <JournalView currentUser={currentUser} journalVisits={journalVisits} onSignIn={() => setAuthOpen(true)} onOpenComposer={() => openComposer()} onOpenEntry={setSelectedEntry} onOpenImage={(src, alt) => setLightboxImage({ src, alt })} />}
      {activeView === 'profile' && <ProfileView spots={spots} currentUser={currentUser} onSignIn={() => setAuthOpen(true)} onSignOut={signOut} progress={progress} onOpenBadges={() => navigate('badges')} onOpenAdmin={() => navigate('admin')} onOpenAudit={() => { navigate('audit'); loadAuthAudit() }} onChangePassword={() => setPasswordDialogOpen(true)} onSuggestSpot={() => setSuggestionDialogOpen(true)} onOpenPrivacy={() => setLegalDialog('privacy')} onOpenImprint={() => setLegalDialog('imprint')} pendingSuggestionCount={spotSuggestions.length} pendingCorrectionCount={spotCorrectionReports.length} onUploadAvatar={uploadAvatar} />}
      {activeView === 'badges' && <BadgesView progress={progress} onBack={() => goBack('profile')} />}
      {activeView === 'admin' && currentUser?.role === 'superadmin' && <AdminSpotsView spots={spots} suggestions={spotSuggestions} correctionReports={spotCorrectionReports} onCreate={createSpot} onPreviewImport={previewSpotImport} onApplyImport={applySpotImport} onUpdate={updateSpot} onDelete={deleteSpot} onApproveSuggestion={approveSpotSuggestion} onRejectSuggestion={rejectSpotSuggestion} onResolveCorrection={resolveSpotCorrection} onExport={exportSpots} onBack={() => goBack('profile')} />}
      {activeView === 'audit' && currentUser?.role === 'superadmin' && <AuditView events={authAudit} stats={adminStats} onBack={() => goBack('profile')} />}
      {activeView === 'social' && <FeedView onOpenImage={(src, alt) => setLightboxImage({ src, alt })} authorFilter={feedAuthorFilter} onClearAuthorFilter={() => setFeedAuthorFilter(null)} onFeedRead={() => setFeedSummary({ unread_feed: 0 })} />}
      {(activeView === 'friends' || activeView === 'connections') && <FriendsView onOpenMessages={setMessageUser} onSummaryChange={setFriendSummary} onOpenUserFeed={(user) => { setFeedAuthorFilter(user); navigate('social') }} onOpenImage={(src, alt) => setLightboxImage({ src, alt })} />}
      <nav className="bottom-nav" aria-label="Hauptnavigation">
        {navItems.map(({ id, label, icon: Icon }) => { const notifications = friendSummary.unread_messages + friendSummary.pending_requests; const feedNotifications = feedSummary.unread_feed; return <button key={id} className={activeView === id ? 'is-active' : ''} onClick={() => navigate(id)}><span className="nav-icon"><Icon size={20} />{id === 'friends' && notifications > 0 && <b className="nav-badge">{notifications > 9 ? '9+' : notifications}</b>}{id === 'social' && feedNotifications > 0 && <b className="nav-badge">{feedNotifications > 9 ? '9+' : feedNotifications}</b>}</span><span>{label}</span></button> })}
      </nav>
      {toast && <div className="toast"><IconCheck size={17} />{toast}</div>}
      {composerOpen && <JournalComposer spot={spots.find((spot) => spot.id === composerSpotId)} onClose={closeComposer} onSave={createJournalEntry} onChooseOnMap={chooseSpotOnMap} surface={composerSurface} />}
      {planDialogSpotId && <PlannedVisitDialog spot={spots.find((spot) => spot.id === planDialogSpotId)} onSave={createPlannedVisit} onClose={() => setPlanDialogSpotId(null)} surface="map" />}
      {correctionDialogSpotId && <SpotCorrectionDialog spot={spots.find((spot) => spot.id === correctionDialogSpotId)} onSave={submitSpotCorrection} onClose={() => setCorrectionDialogSpotId(null)} />}
      {selectedEntry && <JournalEntryDialog entry={selectedEntry} onClose={() => setSelectedEntry(null)} onUpdate={updateJournalEntry} />}
      {authOpen && <SignInDialog configuration={authConfiguration} resetToken={resetToken} onClose={() => { setAuthOpen(false); setResetToken(null) }} onDemoSignIn={signInDemo} onMemberSignIn={signInMember} onRegister={registerMember} onRequestPasswordReset={requestPasswordReset} onResendVerification={resendVerification} onResetPassword={resetPassword} onOpenPrivacy={() => { setAuthOpen(false); setLegalDialog('privacy') }} onOpenImprint={() => { setAuthOpen(false); setLegalDialog('imprint') }} />}
      {passwordDialogOpen && <PasswordDialog onClose={() => setPasswordDialogOpen(false)} onSave={changePassword} />}
      {suggestionDialogOpen && <SpotSuggestionDialog onSubmit={submitSpotSuggestion} onClose={() => setSuggestionDialogOpen(false)} />}
      {legalDialog && <LegalDialog kind={legalDialog} onClose={() => setLegalDialog(null)} />}
      {messageUser && <MessageDialog user={messageUser} onClose={() => setMessageUser(null)} onRead={async () => { const response = await fetch('/api/social/friends/summary'); if (response.ok) setFriendSummary(await response.json()) }} />}
      {lightboxImage && <Lightbox image={lightboxImage} onClose={() => setLightboxImage(null)} />}
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
