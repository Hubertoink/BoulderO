import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import {
  IconAdjustmentsHorizontal,
  IconBookmark,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCompass,
  IconCurrentLocation,
  IconDownload,
  IconEye,
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

const appViews = new Set(['map', 'journal', 'social', 'friends', 'profile', 'badges', 'connections', 'admin'])

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

function BoulderMap({ spots, selectedSpot, onSelect, userLocation }) {
  return (
    <div className="map-frame">
      <MapContainer center={mannheimCenter} zoom={13} zoomControl={false} scrollWheelZoom className="map-canvas">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FocusMap spot={selectedSpot} />
        <FocusLocation location={userLocation} />
        {userLocation && <Marker position={userLocation} icon={userLocationIcon()} interactive={false} />}
        {spots.map((spot) => (
          <Marker
            key={spot.id}
            position={spot.position}
            icon={markerIcon(spot.visits > 0, selectedSpot?.id === spot.id)}
            eventHandlers={{ click: () => onSelect(spot.id) }}
          />
        ))}
      </MapContainer>
      <div className="map-key" aria-label="Kartenlegende">
        <span><i className="key-dot key-dot--open" />Noch offen</span>
        <span><i className="key-dot key-dot--visited">✓</i>Besucht</span>
      </div>
      <div className="map-credits">Testdaten · Mannheim</div>
    </div>
  )
}

function SpotSheet({ spot, onVisit }) {
  const visited = spot.visits > 0
  return (
    <aside className="spot-sheet" style={spot.image_url ? { '--spot-image': `url("${spot.image_url}")` } : undefined}>
      <div className="spot-sheet__topline">
        <span className="eyebrow">{spot.district} · {spot.distance}</span>
        {visited && <span className="visited-label"><IconCheck size={14} /> besucht</span>}
      </div>
      <div className="spot-sheet__title-row">
        <div>
          <h2>{spot.name}</h2>
          <p>{spot.address}</p>
        </div>
      </div>
      <div className="spot-meta">
        <span><b>Heute</b>{spot.open}</span>
        <span><b>Fläche</b>{spot.size}</span>
        <span><b>Deine Besuche</b>{spot.visits}</span>
      </div>
      <button className={`visit-button ${visited ? 'is-visited' : ''}`} onClick={() => onVisit(spot.id)}>
        <IconCheck size={19} />
        {visited ? 'Weiteren Besuch eintragen' : 'Ersten Besuch eintragen'}
      </button>
    </aside>
  )
}

function MapView({ spots, selectedId, lastVisitedSpotId, onSelectSpot, onVisit, query, setQuery, filter, setFilter, isPickingSpot, onCancelPicker, onMessage }) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [userLocation, setUserLocation] = useState(null)

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

  const selectedSpot = spots.find((spot) => spot.id === selectedId) ?? spots[0]

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
      <BoulderMap spots={visibleSpots} selectedSpot={selectedSpot} onSelect={onSelectSpot} userLocation={userLocation} />
      <SpotSheet spot={selectedSpot} onVisit={onVisit} />
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
      await onSave({ spotId: spot.id, visitedAt, body, files: files.map((item) => item.file), visibility })
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
        <label className="form-field"><span>Erfahrungsbericht</span><textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength="4000" placeholder="Wie war deine Session? Was möchtest du später noch wissen?" /></label>
        <div className="photo-field"><div className="photo-selection">{files.map((item, index) => <figure key={item.preview}><img src={item.preview} alt={`Ausgewähltes Foto ${index + 1}`} /><button type="button" onClick={() => removePhoto(index)} aria-label={`Foto ${index + 1} entfernen`}><IconX size={15} /></button></figure>)}</div><label className="photo-picker"><IconPhoto size={19} /><span>{files.length ? `${files.length} Foto${files.length > 1 ? 's' : ''} ausgewählt` : 'Fotos hinzufügen'}</span><input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple onChange={addPhotos} /></label>{files.length > 0 && files.length < 6 && <button type="button" className="add-photo" onClick={() => fileInput.current?.click()}><IconPlus size={16} />Weiteres Foto</button>}</div>
        <VisibilityPicker value={visibility} onChange={setVisibility} />
        {error && <p className="form-error">{error}</p>}
        <button className="visit-button" disabled={isSaving || !spot}>{isSaving ? 'Wird gespeichert …' : visibility === 'private' ? 'Privaten Eintrag speichern' : 'Eintrag speichern'}</button>
      </form>
    </div>
  )
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
        <button className="visit-button" onClick={onSignIn}><IconLogin2 size={19} />Mit Demo-Profil starten</button>
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

function ProfileView({ spots, currentUser, onSignIn, onSignOut, onOpenBadges, onOpenAdmin, onChangePassword, onSuggestSpot, onOpenPrivacy, onOpenImprint, pendingSuggestionCount, progress, onUploadAvatar }) {
  if (!currentUser) {
    return (
      <main className="view content-view empty-state profile-empty">
        <span className="eyebrow">BoulderO Konto</span><h1>Dein Fortschritt gehört dir.</h1>
        <p>Mit einem Konto werden Besuche, Fotos und persönliche Notizen dauerhaft und privat gespeichert.</p>
        <button className="visit-button" onClick={onSignIn}><IconLogin2 size={19} />Demo-Profil starten</button>
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
          {currentUser.role === 'superadmin' && <button onClick={onOpenAdmin}><IconAdjustmentsHorizontal size={18} /><span><b>Hallen verwalten</b><small>{pendingSuggestionCount > 0 ? `${pendingSuggestionCount} Hallenvorschlag${pendingSuggestionCount === 1 ? '' : 'e'} warten auf Prüfung` : 'Neue Boulderhallen anlegen'}</small></span>{pendingSuggestionCount > 0 && <b className="admin-count-badge">{pendingSuggestionCount > 99 ? '99+' : pendingSuggestionCount}</b>}<IconChevronRight size={18} /></button>}
          {currentUser.role === 'member' && <button onClick={onChangePassword}><IconLock size={18} /><span><b>Passwort ändern</b><small>Dein Konto sicher halten</small></span><IconChevronRight size={18} /></button>}
          <div className="profile-legal-links"><button type="button" onClick={onOpenPrivacy}>Datenschutz</button><button type="button" onClick={onOpenImprint}>Impressum</button></div>
          <button className="profile-actions__logout" onClick={onSignOut}><IconLogout size={18} />Abmelden</button>
        </section>
      </div>
    </main>
  )
}

function LegalDialog({ kind, onClose }) {
  const privacy = kind === 'privacy'
  return <div className="composer-backdrop legal-backdrop"><section className="journal-composer legal-dialog" role="dialog" aria-modal="true" aria-label={privacy ? 'Datenschutzerklärung' : 'Impressum'}><div className="composer-header"><div><span className="eyebrow">BoulderO</span><h2>{privacy ? 'Datenschutzerklärung' : 'Impressum'}</h2></div><button type="button" className="icon-button ui-icon-button" onClick={onClose} aria-label="Schließen"><IconX size={19} /></button></div>{privacy ? <div className="legal-content"><p>Stand: 18. August 2026</p><h3>Verantwortlicher</h3><p>Nikolas Häfner<br />Paul-Gerhardt-Straße 5<br />68169 Mannheim<br /><a href="mailto:hubertoink@outlook.de">hubertoink@outlook.de</a></p><h3>Welche Daten wir verarbeiten</h3><p>Bei der Registrierung verarbeiten wir Name, Benutzername, E-Mail-Adresse und ein nur gehasht gespeichertes Passwort. Wenn du BoulderO nutzt, kommen je nach Funktion Profilbild, Besuche, Tagebucheinträge, Fotos, soziale Verbindungen, Nachrichten und Hallenvorschläge hinzu.</p><h3>Zweck und Rechtsgrundlage</h3><p>Wir verarbeiten diese Daten, um dein Konto bereitzustellen, die von dir gewählten Funktionen auszuführen und BoulderO sicher zu betreiben. Rechtsgrundlage ist in der Regel die Vertragserfüllung nach Art. 6 Abs. 1 lit. b DSGVO sowie unser berechtigtes Interesse an Sicherheit und Missbrauchsschutz nach Art. 6 Abs. 1 lit. f DSGVO.</p><h3>Hosting, E-Mail und Karte</h3><p>BoulderO wird bei Mittwald gehostet. Bestätigungs- und Passwort-E-Mails werden über das BoulderO-Postfach versendet. Für die Karte werden Kacheln von OpenStreetMap geladen; dabei erhält OpenStreetMap technisch bedingt deine IP-Adresse und die angeforderten Kartendaten.</p><h3>Speicherdauer</h3><p>Kontodaten und von dir erstellte Inhalte speichern wir grundsätzlich für die Dauer deines Kontos. Danach löschen oder anonymisieren wir sie, sofern keine gesetzlichen Aufbewahrungspflichten entgegenstehen.</p><h3>Deine Rechte</h3><p>Du kannst Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch verlangen. Außerdem kannst du dich bei einer Datenschutz-Aufsichtsbehörde beschweren. Für Anliegen genügt eine E-Mail an die oben genannte Adresse.</p></div> : <div className="legal-content"><p><strong>Angaben gemäß § 5 DDG</strong></p><p>Nikolas Häfner<br />Paul-Gerhardt-Straße 5<br />68169 Mannheim</p><h3>Kontakt</h3><p><a href="mailto:hubertoink@outlook.de">hubertoink@outlook.de</a></p><h3>Verantwortlich für den Inhalt</h3><p>Nikolas Häfner<br />Paul-Gerhardt-Straße 5<br />68169 Mannheim</p></div>}</section></div>
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

function SpotEditDialog({ spot, onSave, onClose }) {
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
  return <div className="composer-backdrop"><section className="journal-composer admin-edit-dialog" role="dialog" aria-modal="true" aria-label={`${spot.name} bearbeiten`}><div className="composer-header"><div><span className="eyebrow">Halle bearbeiten</span><h2>{spot.name}</h2></div><button type="button" className="icon-button ui-icon-button" onClick={onClose}><IconX size={19} /></button></div><form onSubmit={submit}><div className="admin-form-grid"><label className="form-field"><span>Name *</span><input required value={draft.name} onChange={(event) => update('name', event.target.value)} /></label><label className="form-field"><span>Stadtteil *</span><input required value={draft.district} onChange={(event) => update('district', event.target.value)} /></label></div><label className="form-field"><span>Adresse *</span><input required value={draft.address} onChange={(event) => update('address', event.target.value)} /></label><div className="admin-form-grid"><label className="form-field"><span>Breitengrad *</span><input required type="number" step="any" value={draft.latitude} onChange={(event) => update('latitude', event.target.value)} /></label><label className="form-field"><span>Längengrad *</span><input required type="number" step="any" value={draft.longitude} onChange={(event) => update('longitude', event.target.value)} /></label></div><div className="admin-form-grid"><label className="form-field"><span>Öffnungszeiten</span><input value={draft.openingHours} onChange={(event) => update('openingHours', event.target.value)} /></label><label className="form-field"><span>Fläche in m²</span><input type="number" min="0" value={draft.areaSqm} onChange={(event) => update('areaSqm', event.target.value)} /></label></div><label className="form-field"><span>Website</span><input type="url" value={draft.website} onChange={(event) => update('website', event.target.value)} /></label><label className="form-field"><span>Bild hochladen</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setImageFile(event.target.files[0] ?? null)} /><small>{imageFile ? `${imageFile.name} ersetzt das bestehende Bild.` : hasUploadedImage ? 'Vorhandenes Upload-Bild bleibt erhalten.' : 'JPEG, PNG oder WebP, maximal 10 MB.'}</small></label>{hasUploadedImage ? null : <label className="form-field"><span>Bild-URL</span><input type="url" value={draft.imageUrl ?? ''} onChange={(event) => update('imageUrl', event.target.value)} /><small>Feld leeren, um die Bild-URL zu entfernen.</small></label>}{error && <p className="form-error">{error}</p>}<button className="visit-button" disabled={saving}>{saving ? 'Wird gespeichert …' : 'Änderungen speichern'}</button></form></section></div>
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
  return <div className="composer-backdrop"><section className="journal-composer admin-edit-dialog" role="dialog" aria-modal="true" aria-label="Halle melden"><div className="composer-header"><div><span className="eyebrow">BoulderO Community</span><h2>Halle melden</h2></div><button type="button" className="icon-button ui-icon-button" onClick={onClose} aria-label="Schließen"><IconX size={19} /></button></div><p className="auth-copy">Dein Vorschlag wird vor der Veröffentlichung durch die Verwaltung geprüft.</p><form onSubmit={submit}><div className="admin-form-grid"><label className="form-field"><span>Name *</span><input required value={form.name} onChange={(event) => update('name', event.target.value)} /></label><label className="form-field"><span>Stadtteil</span><input value={form.district} onChange={(event) => update('district', event.target.value)} /></label></div><label className="form-field"><span>Adresse *</span><input required value={form.address} onChange={(event) => update('address', event.target.value)} /></label><label className="form-field"><span>Website</span><input type="url" value={form.website} onChange={(event) => update('website', event.target.value)} placeholder="https://…" /></label><div className="admin-form-grid"><label className="form-field"><span>Breitengrad</span><input type="number" step="any" value={form.latitude} onChange={(event) => update('latitude', event.target.value)} /></label><label className="form-field"><span>Längengrad</span><input type="number" step="any" value={form.longitude} onChange={(event) => update('longitude', event.target.value)} /></label></div><label className="form-field"><span>Hinweis für die Verwaltung</span><textarea value={form.notes} maxLength="2000" onChange={(event) => update('notes', event.target.value)} placeholder="Zum Beispiel Öffnungszeiten oder ein Hinweis zur Lage" /></label>{error && <p className="form-error">{error}</p>}<button className="visit-button" disabled={saving}>{saving ? 'Wird gesendet …' : 'Hallenvorschlag senden'}</button></form></section></div>
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

function AdminSpotsView({ spots, suggestions, onCreate, onImport, onUpdate, onDelete, onApproveSuggestion, onRejectSuggestion, onBack }) {
  const [filter, setFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editingSpot, setEditingSpot] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [reviewingSuggestion, setReviewingSuggestion] = useState(null)
  const csvInput = useRef(null)
  const filteredSpots = spots.filter((spot) => `${spot.name} ${spot.district} ${spot.address}`.toLowerCase().includes(filter.trim().toLowerCase()))
  async function importCsv(event) {
    const [file] = event.target.files
    if (!file) return
    setImporting(true)
    setError('')
    try { await onImport(file) } catch (importError) { setError(importError.message || 'Der Import konnte nicht verarbeitet werden.') } finally { setImporting(false); event.target.value = '' }
  }
  async function removeSpot(spot) {
    if (!window.confirm(`„${spot.name}“ aus der Karte entfernen?`)) return
    setDeletingId(spot.id)
    setError('')
    try { await onDelete(spot.id) } catch (deleteError) { setError(deleteError.message || 'Die Halle konnte nicht gelöscht werden.') } finally { setDeletingId(null) }
  }
  return <main className="view content-view compact-view admin-view"><div className="page-intro page-intro--action"><div><h1>Hallen</h1><p>Neue Boulderhallen werden nach dem Speichern direkt auf der Karte veröffentlicht.</p></div><button type="button" className="journal-add" onClick={() => setCreateOpen(true)}><IconPlus size={18} />Halle anlegen</button></div>{suggestions.length > 0 && <section className="admin-suggestions"><div className="section-heading"><div><span className="eyebrow">Community</span><h2>Hallenvorschläge <b>{suggestions.length}</b></h2></div></div><p>Diese Vorschläge werden erst nach deiner Prüfung auf der Karte veröffentlicht.</p><div className="suggestion-list">{suggestions.map((suggestion) => <article key={suggestion.id}><div><b>{suggestion.name}</b><span>{suggestion.address}{suggestion.district ? ` · ${suggestion.district}` : ''}</span><small>von {suggestion.submitted_by_name}</small></div><button type="button" onClick={() => setReviewingSuggestion(suggestion)}>Prüfen</button></article>)}</div></section>}<section className="admin-import"><div><span className="eyebrow">Mehrere Hallen</span><h2>CSV importieren</h2><p>Maximal 500 Hallen; Pflichtspalten: name, district, address, latitude und longitude. image_url ist optional.</p></div><div className="admin-import__actions"><button type="button" className="text-back" onClick={downloadHallTemplate}><IconDownload size={16} />Vorlage herunterladen</button><label className="visit-button"><IconPlus size={18} />{importing ? 'Import wird verarbeitet …' : 'CSV auswählen'}<input ref={csvInput} type="file" accept=".csv,text/csv" onChange={importCsv} disabled={importing} /></label></div></section>{error && <p className="form-error">{error}</p>}<section className="admin-list"><div className="section-heading"><h2>Aktive Hallen</h2><span>{filteredSpots.length} / {spots.length}</span></div><label className="admin-filter"><IconSearch size={17} /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Nach Name, Stadtteil oder Adresse filtern" /></label><div className="admin-table-wrap"><table><thead><tr><th>Halle</th><th>Stadtteil</th><th>Adresse</th><th>Quelle</th><th aria-label="Aktionen" /></tr></thead><tbody>{filteredSpots.map((spot) => <tr key={spot.id}><td>{spot.name}</td><td>{spot.district}</td><td>{spot.address}</td><td>{spot.source === 'admin' ? 'manuell' : spot.source === 'admin-import' ? 'CSV' : spot.source === 'user-suggestion' ? 'Vorschlag' : 'Import'}</td><td><div className="admin-row-actions"><button type="button" onClick={() => setEditingSpot(spot)}>Bearbeiten</button><button type="button" className="danger" disabled={deletingId === spot.id} onClick={() => removeSpot(spot)}>{deletingId === spot.id ? 'Löscht …' : 'Löschen'}</button></div></td></tr>)}</tbody></table></div>{!filteredSpots.length && <p className="journal-empty">Keine Hallen für diesen Filter.</p>}</section><button className="text-back" onClick={onBack}>Zurück zum Profil</button>{createOpen && <SpotCreateDialog onCreate={onCreate} onClose={() => setCreateOpen(false)} />}{editingSpot && <SpotEditDialog spot={editingSpot} onSave={(input, imageFile) => onUpdate(editingSpot.id, input, imageFile)} onClose={() => setEditingSpot(null)} />}{reviewingSuggestion && <SpotSuggestionReviewDialog suggestion={reviewingSuggestion} onApprove={onApproveSuggestion} onReject={onRejectSuggestion} onClose={() => setReviewingSuggestion(null)} />}</main>
}

function formatFeedDate(value) {
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
}

function FeedAuthor({ entry }) {
  const [expanded, setExpanded] = useState(false)
  return <div className="feed-author"><button className="person-avatar feed-avatar" onClick={() => setExpanded((value) => !value)} aria-label={`Profil von ${entry.user_name} anzeigen`}>{entry.user_image ? <img src={`/api/avatars/${entry.user_id}`} alt="" /> : entry.user_name.split(' ').map((part) => part[0]).join('')}<RankBadge uniqueSpots={entry.author_unique_spots} /></button><time>{formatFeedDate(entry.visited_at)}</time>{expanded && <div className="feed-author__dropdown"><b>{entry.user_name}</b><small>@{entry.username} · {visibilityLabel(entry.visibility)}</small></div>}</div>
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

function FeedView({ onOpenImage }) {
  const [entries, setEntries] = useState([])
  const [error, setError] = useState('')
  const [comments, setComments] = useState({})
  const [expanded, setExpanded] = useState(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [feedMode, setFeedMode] = useState('all')

  async function load() {
    try {
      const response = await fetch('/api/social/feed')
      if (!response.ok) throw new Error('Feed konnte nicht geladen werden.')
      setEntries((await response.json()).entries)
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

  const visibleEntries = feedMode === 'friends' ? entries.filter((entry) => entry.is_friend) : entries
  return <main className="view content-view compact-view social-view">{error && <p className="form-error">{error}</p>}<section className="social-section feed-section"><div className="section-heading"><h2>Aktuell im Feed</h2><div className="feed-toggle"><button className={feedMode === 'all' ? 'is-active' : ''} onClick={() => setFeedMode('all')}>Aktuell</button><button className={feedMode === 'friends' ? 'is-active' : ''} onClick={() => setFeedMode('friends')}>Freunde</button></div></div>{!visibleEntries.length && <p className="journal-empty">Noch keine Beiträge für diese Ansicht.</p>}<div className="feed-list">{visibleEntries.map((entry) => <article key={entry.id}><FeedAuthor entry={entry} />{entry.media?.length > 0 && <FeedMediaCarousel entry={entry} onOpenImage={onOpenImage} />}<p className="feed-body">{entry.body || 'Hat einen Besuch geteilt.'}</p>{!entry.media?.length && <h3>war bei {entry.spot_name}</h3>}<div className="feed-actions"><button className={entry.liked_by_me ? 'is-active' : ''} onClick={() => toggleLike(entry)}>♥ <span>{entry.like_count}</span></button><button onClick={() => toggleComments(entry.id)}>Kommentar <span>{entry.comment_count}</span></button></div>{expanded === entry.id && <div className="comments"><div>{(comments[entry.id] ?? []).map((comment) => <p key={comment.id}><b>{comment.user_name}</b>{comment.body}</p>)}</div><form onSubmit={(event) => { event.preventDefault(); postComment(entry.id) }}><input value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} maxLength="1000" placeholder="Kommentar schreiben …" /><button>Posten</button></form></div>}</article>)}</div></section></main>
}

function UserAvatar({ user }) {
  const initials = user.name.split(' ').map((part) => part[0]).join('').slice(0, 2)
  return <span className="person-avatar social-avatar">{user.image ? <img src={`/api/avatars/${user.id ?? user.user_id}`} alt="" /> : initials}</span>
}

function FriendsView({ onOpenMessages, onSummaryChange }) {
  const [tab, setTab] = useState('friends')
  const [friends, setFriends] = useState([])
  const [requests, setRequests] = useState({ incoming: [], outgoing: [] })
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [error, setError] = useState('')
  async function load() {
    try {
      const [friendsResponse, requestsResponse, summaryResponse] = await Promise.all([fetch('/api/social/friends'), fetch('/api/social/friend-requests'), fetch('/api/social/friends/summary')])
      if (!friendsResponse.ok || !requestsResponse.ok || !summaryResponse.ok) throw new Error('Freunde konnten nicht geladen werden.')
      setFriends((await friendsResponse.json()).friends)
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
    if (query.trim().length < 2) { setResults([]); return undefined }
    const timer = window.setTimeout(async () => {
      const response = await fetch(`/api/social/discover?q=${encodeURIComponent(query.trim())}`)
      if (response.ok) setResults((await response.json()).users)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query])
  async function action(path, method = 'POST') {
    setError('')
    const response = await fetch(path, { method })
    if (!response.ok) { setError('Die Beziehung konnte nicht aktualisiert werden.'); return }
    await load()
    if (query.trim().length >= 2) {
      const search = await fetch(`/api/social/discover?q=${encodeURIComponent(query.trim())}`)
      if (search.ok) setResults((await search.json()).users)
    }
  }
  return <main className="view content-view compact-view social-view"><section className="social-section friends-section"><div className="section-heading"><h2>Freunde</h2><div className="friends-tabs"><button className={tab === 'friends' ? 'is-active' : ''} onClick={() => setTab('friends')}>Freunde</button><button className={`${tab === 'requests' ? 'is-active ' : ''}has-badge`} onClick={() => setTab('requests')}>Anfragen{requests.incoming.length > 0 && <b>{requests.incoming.length}</b>}</button><button className={tab === 'discover' ? 'is-active' : ''} onClick={() => setTab('discover')}>Entdecken</button></div></div>{error && <p className="form-error">{error}</p>}{tab === 'friends' && <div className="people-list friends-list">{!friends.length && <p className="journal-empty">Noch keine Freundschaften. Entdecke andere BoulderO-Nutzer:innen.</p>}{friends.map((user) => <article key={user.id}><UserAvatar user={user} /><div><h3>{user.name}</h3><p>@{user.username}{user.last_visit_at ? ` · letzter Besuch ${formatFeedDate(user.last_visit_at)}` : ''}</p></div><button className="message-button" onClick={() => { onOpenMessages(user); setFriends((current) => current.map((item) => item.id === user.id ? { ...item, unread_count: 0 } : item)) }}>Nachricht{user.unread_count > 0 && <b>{user.unread_count}</b>}</button></article>)}</div>}{tab === 'requests' && <div className="request-groups"><section><div className="section-heading"><h3>Eingegangen</h3><span>{requests.incoming.length}</span></div><div className="people-list">{!requests.incoming.length && <p className="journal-empty">Keine offenen Anfragen.</p>}{requests.incoming.map((request) => <article key={request.id}><UserAvatar user={{ ...request, id: request.user_id }} /><div><h3>{request.name}</h3><p>@{request.username}</p></div><button className="message-button" onClick={() => action(`/api/social/friend-requests/${request.id}/decline`)}>Ablehnen</button><button onClick={() => action(`/api/social/friend-requests/${request.id}/accept`)}><IconCheck size={16} />Annehmen</button></article>)}</div></section><section><div className="section-heading"><h3>Gesendet</h3><span>{requests.outgoing.length}</span></div><div className="people-list">{!requests.outgoing.length && <p className="journal-empty">Keine gesendeten Anfragen.</p>}{requests.outgoing.map((request) => <article key={request.id}><UserAvatar user={{ ...request, id: request.user_id }} /><div><h3>{request.name}</h3><p>@{request.username} · Anfrage gesendet</p></div></article>)}</div></section></div>}{tab === 'discover' && <section className="friend-discover"><label className="search-field"><IconSearch size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name oder @username suchen" /></label>{query.trim().length > 0 && query.trim().length < 2 && <p className="journal-empty">Mindestens zwei Zeichen eingeben.</p>}<div className="people-list">{results.map((user) => <article key={user.id}><UserAvatar user={user} /><div><h3>{user.name}</h3><p>@{user.username}{user.follows_you ? ' · folgt dir' : ''}</p></div>{user.is_friend ? <span className="relationship-state"><IconUserCheck size={16} />Freund:in</span> : user.request_sent ? <span className="relationship-state">Anfrage gesendet</span> : user.request_received ? <span className="relationship-actions"><button className="message-button" onClick={() => action(`/api/social/friend-requests/${user.incoming_request_id}/decline`)}>Ablehnen</button><button onClick={() => action(`/api/social/friend-requests/${user.incoming_request_id}/accept`)}>Annehmen</button></span> : <button onClick={() => action(`/api/social/friend-requests/${user.id}`)}><IconUserPlus size={16} />Anfragen</button>}{!user.is_friend && <button className={user.following ? 'following' : ''} onClick={() => action(`/api/follows/${user.id}`, user.following ? 'DELETE' : 'POST')}>{user.following ? 'Folge ich' : 'Folgen'}</button>}</article>)}</div></section>}</section></main>
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

function SignInDialog({ configuration, onClose, onDemoSignIn, onSuperAdminSignIn, onMemberSignIn, onRegister, onRequestPasswordReset, onResendVerification, onResetPassword, onOpenPrivacy, onOpenImprint, resetToken }) {
  const [mode, setMode] = useState(resetToken ? 'reset' : 'signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  function switchMode(next) { setError(''); setNotice(''); setMode(next) }
  async function submitSuperAdmin(event) { event.preventDefault(); setError(''); try { await onSuperAdminSignIn(email, password) } catch { setError('E-Mail oder Passwort sind nicht korrekt.') } }
  async function submit(event) {
    event.preventDefault(); setError(''); setNotice('')
    try {
      if (mode === 'signin') await onMemberSignIn(email, password)
      if (mode === 'register') { const result = await onRegister(name, email, password); switchMode('signin'); setNotice(result?.deliveryFailed ? 'Dein Konto wurde angelegt, aber die Bestätigungs-E-Mail konnte noch nicht versendet werden. Du kannst sie hier erneut anfordern.' : 'Fast geschafft: Bitte bestätige jetzt den Link in deiner E-Mail.') }
      if (mode === 'forgot') { await onRequestPasswordReset(email); setNotice('Falls ein Konto existiert, wurde ein Link zum Zurücksetzen versendet.') }
      if (mode === 'reset') { if (password !== passwordConfirm) throw new Error('Die Passwörter stimmen nicht überein.'); await onResetPassword(resetToken, password); setNotice('Dein Passwort wurde geändert. Du kannst dich jetzt anmelden.'); setMode('signin'); setPassword(''); setPasswordConfirm('') }
    } catch (submitError) { setError(submitError.message || 'Die Anfrage konnte nicht verarbeitet werden.') }
  }
  const title = ({ register: 'Konto erstellen', forgot: 'Passwort vergessen', reset: 'Neues Passwort', signin: 'Anmelden' })[mode]
  return <div className="composer-backdrop"><section className="journal-composer auth-dialog" role="dialog" aria-modal="true" aria-label="BoulderO Konto"><div className="composer-header"><div><span className="eyebrow">BoulderO Konto</span><h2>{title}</h2></div><button className="icon-button ui-icon-button" onClick={onClose} aria-label="Schließen"><IconX size={19} /></button></div>{!resetToken && <div className="auth-tabs"><button className={mode === 'signin' ? 'is-active' : ''} onClick={() => switchMode('signin')}>Anmelden</button><button disabled={!configuration?.registrationEnabled} className={mode === 'register' ? 'is-active' : ''} onClick={() => switchMode('register')}>Registrieren</button></div>}<form className="admin-login" onSubmit={submit}>{mode === 'register' && <label className="form-field"><span>Name</span><input required value={name} onChange={(event) => setName(event.target.value)} /></label>}{mode !== 'reset' && <label className="form-field"><span>E-Mail</span><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>}{mode !== 'forgot' && <label className="form-field"><span>{mode === 'reset' ? 'Neues Passwort' : 'Passwort'}</span><input required type="password" minLength="10" value={password} onChange={(event) => setPassword(event.target.value)} /></label>}{mode === 'reset' && <label className="form-field"><span>Passwort wiederholen</span><input required type="password" minLength="10" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} /></label>}{error && <p className="form-error">{error}</p>}{notice && <p className="form-notice">{notice}</p>}<button className="visit-button">{mode === 'register' ? 'Bestätigungs-E-Mail senden' : mode === 'forgot' ? 'Reset-Link senden' : mode === 'reset' ? 'Passwort speichern' : 'Anmelden'}</button></form>{mode === 'signin' && <div className="auth-links"><button type="button" className="text-back" onClick={() => switchMode('forgot')}>Passwort vergessen?</button><button type="button" className="text-back" onClick={async () => { try { await onResendVerification(email); setNotice('Falls dein Konto noch nicht bestätigt ist, wurde eine neue E-Mail gesendet.') } catch { setError('Die Bestätigungs-E-Mail konnte nicht gesendet werden.') } }}>Bestätigung erneut senden</button></div>}{mode === 'register' && !configuration?.registrationEnabled && <p className="form-error">Die E-Mail-Registrierung wird gerade eingerichtet.</p>}{mode === 'signin' && configuration?.superAdminEnabled && <form className="admin-login" onSubmit={submitSuperAdmin}><p className="auth-copy"><b>Verwaltung</b> · Superadmin-Zugang</p><button className="text-back">Als Verwaltung anmelden</button></form>}{mode === 'signin' && configuration?.demoEnabled && <div className="demo-account-list">{configuration.demoProfiles.map((profile) => <button key={profile.id} onClick={() => onDemoSignIn(profile.id)}><span className="person-avatar">{profile.name.split(' ').map((part) => part[0]).join('')}</span><span><b>{profile.name}</b><small>@{profile.username}</small></span><IconChevronRight size={18} /></button>)}</div>}<p className="auth-note"><IconLock size={15} />Passwörter werden sicher gespeichert. Neue Konten werden per E-Mail bestätigt.</p><div className="legal-links"><button type="button" onClick={onOpenPrivacy}>Datenschutz</button><button type="button" onClick={onOpenImprint}>Impressum</button></div></section></div>
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
  const [spotSuggestions, setSpotSuggestions] = useState([])
  const [suggestionDialogOpen, setSuggestionDialogOpen] = useState(false)
  const [legalDialog, setLegalDialog] = useState(null)

  function navigate(view, { replace = false } = {}) {
    if (!appViews.has(view)) return
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
    setJournalVisits(visits)
    setSpots(apiSpots.map((spot) => {
      const fallback = initialSpots.find((item) => item.id === spot.id) ?? {}
      return { ...fallback, ...spot, position: [Number(spot.latitude), Number(spot.longitude)], open: spot.opening_hours, size: `${Number(spot.area_sqm ?? 0).toLocaleString('de-DE')} m²`, visits: countBySpot[spot.id] ?? 0 }
    }))
  }

  async function loadSpotSuggestions(user = currentUser) {
    if (user?.role !== 'superadmin') { setSpotSuggestions([]); return }
    const response = await fetch('/api/admin/spot-suggestions')
    if (response.ok) setSpotSuggestions((await response.json()).suggestions)
  }

  async function refreshSession() {
    const response = await fetch('/api/me')
    if (!response.ok) return
    const { user } = await response.json()
    setCurrentUser(user)
    await loadPrivateData()
    await loadSpotSuggestions(user)
    const summaryResponse = await fetch('/api/social/friends/summary')
    if (summaryResponse.ok) setFriendSummary(await summaryResponse.json())
  }

  useEffect(() => {
    fetch('/api/auth/configuration').then((response) => response.ok ? response.json() : null).then(setAuthConfiguration).catch(() => undefined)
    refreshSession().catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!currentUser) return undefined
    async function refreshFriendSummary() {
      const response = await fetch('/api/social/friends/summary')
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

  async function signInSuperAdmin(email, password) {
    const csrfResponse = await fetch('/api/auth/csrf')
    const { csrfToken } = await csrfResponse.json()
    await fetch('/api/auth/callback/superadmin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrfToken, callbackUrl: window.location.origin, email, password }),
      redirect: 'manual',
    })
    const sessionResponse = await fetch('/api/me')
    if (!sessionResponse.ok) throw new Error('authentication_failed')
    const { user } = await sessionResponse.json()
    setCurrentUser(user)
    await loadPrivateData()
    await loadSpotSuggestions(user)
    setAuthOpen(false)
    showToast('Verwaltungskonto ist aktiv')
  }

  async function signInMember(email, password) {
    const csrfResponse = await fetch('/api/auth/csrf')
    const { csrfToken } = await csrfResponse.json()
    await fetch('/api/auth/callback/member', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrfToken, callbackUrl: window.location.origin, email, password }), redirect: 'manual' })
    const response = await fetch('/api/me')
    if (!response.ok) throw new Error('E-Mail oder Passwort sind nicht korrekt.')
    const { user } = await response.json(); setCurrentUser(user); await loadPrivateData(); await loadSpotSuggestions(user); setAuthOpen(false); showToast('Willkommen bei BoulderO')
  }

  async function registerMember(name, email, password) {
    const response = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, password }) })
    if (!response.ok) { const payload = await response.json().catch(() => ({})); if (payload.error === 'email_delivery_failed') return { deliveryFailed: true }; throw new Error(payload.error === 'email_taken' ? 'Diese E-Mail-Adresse ist bereits registriert.' : payload.error === 'email_not_configured' ? 'Die E-Mail-Registrierung wird gerade eingerichtet.' : 'Konto konnte nicht erstellt werden.') }
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
    setFriendSummary({ unread_messages: 0, pending_requests: 0 })
    showToast('Du bist abgemeldet')
  }

  function openComposer(spotId = null) {
    if (!currentUser) {
      navigate('profile')
      showToast('Melde dich an, um Besuche dauerhaft zu speichern')
      return
    }
    setComposerSpotId(spotId)
    setComposerSurface(spotId ? 'map' : 'dialog')
    setComposerOpen(true)
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
    const response = await fetch('/api/visits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spotId: entry.spotId, visitedAt: entry.visitedAt, body: entry.body, visibility: entry.visibility }) })
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

  async function importSpots(file) {
    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch('/api/admin/spots/import', { method: 'POST', body: formData })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      if (payload.error === 'csv_headers_invalid') throw new Error(`Diese Spalten fehlen: ${payload.missing.join(', ')}`)
      if (payload.error === 'csv_limit_exceeded') throw new Error('Pro Import sind höchstens 500 Hallen möglich.')
      throw new Error('Die CSV-Datei konnte nicht importiert werden. Bitte prüfe die Vorlage und die Koordinaten.')
    }
    const { imported } = await response.json()
    await loadPrivateData()
    showToast(`${imported} Hallen wurden importiert`)
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

  async function submitSpotSuggestion(input) {
    const response = await fetch('/api/spot-suggestions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
    if (!response.ok) throw new Error('Bitte prüfe Name, Adresse und optionale Koordinaten.')
    showToast('Dein Hallenvorschlag wurde zur Prüfung gesendet')
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
        <button className="brand" onClick={() => navigate('map')} aria-label="Zur Karte"><IconCompass size={22} /><span>Boulder<span>O</span></span></button>
        <div className="header-progress"><span><b>{uniqueVisited}</b>/10 Hallen</span><i><em style={{ width: `${uniqueVisited * 10}%` }} /></i></div>
        {currentUser ? <button className="profile-chip" onClick={() => navigate('profile')} aria-label="Profil öffnen"><span className="profile-chip__image">{currentUser.image ? <img src={`/api/avatars/${currentUser.id}`} alt="" /> : currentUser.name.split(' ').map((name) => name[0]).join('').slice(0, 2)}</span><RankBadge progress={progress} /></button> : <button className="header-login" onClick={() => setAuthOpen(true)}><IconLogin2 size={18} />Anmelden</button>}
      </header>
      {!currentUser && welcomeOpen && <section className="welcome-screen"><div className="welcome-card"><img src="/BoulderO_Logo.ico" alt="BoulderO" /><h1>BoulderO</h1><p>Entdecke Hallen, halte Besuche fest und teile deine Boulderreise mit Freundinnen und Freunden.</p><div><button className="visit-button" onClick={() => setAuthOpen(true)}>Konto erstellen oder anmelden</button><button className="text-back" onClick={() => setWelcomeOpen(false)}>Karte entdecken</button></div></div><div className="welcome-legal-links"><button type="button" onClick={() => setLegalDialog('privacy')}>Datenschutz</button><button type="button" onClick={() => setLegalDialog('imprint')}>Impressum</button></div></section>}
      {activeView === 'map' && <MapView spots={spots} selectedId={selectedId} lastVisitedSpotId={journalVisits[0]?.spot_id} onSelectSpot={selectSpot} onVisit={openComposer} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} isPickingSpot={isPickingSpot} onCancelPicker={() => setIsPickingSpot(false)} onMessage={showToast} />}
      {activeView === 'journal' && <JournalView currentUser={currentUser} journalVisits={journalVisits} onSignIn={() => setAuthOpen(true)} onOpenComposer={() => openComposer()} onOpenEntry={setSelectedEntry} onOpenImage={(src, alt) => setLightboxImage({ src, alt })} />}
      {activeView === 'profile' && <ProfileView spots={spots} currentUser={currentUser} onSignIn={() => setAuthOpen(true)} onSignOut={signOut} progress={progress} onOpenBadges={() => navigate('badges')} onOpenAdmin={() => navigate('admin')} onChangePassword={() => setPasswordDialogOpen(true)} onSuggestSpot={() => setSuggestionDialogOpen(true)} onOpenPrivacy={() => setLegalDialog('privacy')} onOpenImprint={() => setLegalDialog('imprint')} pendingSuggestionCount={spotSuggestions.length} onUploadAvatar={uploadAvatar} />}
      {activeView === 'badges' && <BadgesView progress={progress} onBack={() => goBack('profile')} />}
      {activeView === 'admin' && currentUser?.role === 'superadmin' && <AdminSpotsView spots={spots} suggestions={spotSuggestions} onCreate={createSpot} onImport={importSpots} onUpdate={updateSpot} onDelete={deleteSpot} onApproveSuggestion={approveSpotSuggestion} onRejectSuggestion={rejectSpotSuggestion} onBack={() => goBack('profile')} />}
      {activeView === 'social' && <FeedView onOpenImage={(src, alt) => setLightboxImage({ src, alt })} />}
      {(activeView === 'friends' || activeView === 'connections') && <FriendsView onOpenMessages={setMessageUser} onSummaryChange={setFriendSummary} />}
      <nav className="bottom-nav" aria-label="Hauptnavigation">
        {navItems.map(({ id, label, icon: Icon }) => { const notifications = friendSummary.unread_messages + friendSummary.pending_requests; return <button key={id} className={activeView === id ? 'is-active' : ''} onClick={() => navigate(id)}><span className="nav-icon"><Icon size={20} />{id === 'friends' && notifications > 0 && <b className="nav-badge">{notifications > 9 ? '9+' : notifications}</b>}</span><span>{label}</span></button> })}
      </nav>
      {toast && <div className="toast"><IconCheck size={17} />{toast}</div>}
      {composerOpen && <JournalComposer spot={spots.find((spot) => spot.id === composerSpotId)} onClose={closeComposer} onSave={createJournalEntry} onChooseOnMap={chooseSpotOnMap} surface={composerSurface} />}
      {selectedEntry && <JournalEntryDialog entry={selectedEntry} onClose={() => setSelectedEntry(null)} onUpdate={updateJournalEntry} />}
      {authOpen && <SignInDialog configuration={authConfiguration} resetToken={resetToken} onClose={() => { setAuthOpen(false); setResetToken(null) }} onDemoSignIn={signInDemo} onSuperAdminSignIn={signInSuperAdmin} onMemberSignIn={signInMember} onRegister={registerMember} onRequestPasswordReset={requestPasswordReset} onResendVerification={resendVerification} onResetPassword={resetPassword} onOpenPrivacy={() => { setAuthOpen(false); setLegalDialog('privacy') }} onOpenImprint={() => { setAuthOpen(false); setLegalDialog('imprint') }} />}
      {passwordDialogOpen && <PasswordDialog onClose={() => setPasswordDialogOpen(false)} onSave={changePassword} />}
      {suggestionDialogOpen && <SpotSuggestionDialog onSubmit={submitSpotSuggestion} onClose={() => setSuggestionDialogOpen(false)} />}
      {legalDialog && <LegalDialog kind={legalDialog} onClose={() => setLegalDialog(null)} />}
      {messageUser && <MessageDialog user={messageUser} onClose={() => setMessageUser(null)} onRead={async () => { const response = await fetch('/api/social/friends/summary'); if (response.ok) setFriendSummary(await response.json()) }} />}
      {lightboxImage && <Lightbox image={lightboxImage} onClose={() => setLightboxImage(null)} />}
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
