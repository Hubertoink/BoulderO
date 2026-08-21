import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import {
  IconAdjustmentsHorizontal, IconArrowsMaximize, IconBookmark, IconCalendarEvent, IconCheck,
  IconChevronLeft, IconChevronRight, IconCompass, IconClock, IconCurrentLocation, IconDownload,
  IconDots, IconEye, IconFlag, IconLock, IconMapPin, IconMedal, IconMessageCircle, IconLogin2,
  IconLogout, IconPhoto, IconPlus, IconSearch, IconSparkles, IconTrophy, IconTrash, IconUserCircle,
  IconUserCheck, IconUserPlus, IconUsers, IconWorld, IconX,
} from '@tabler/icons-react'
import 'leaflet/dist/leaflet.css'
import { mannheimCenter } from './data/spots'
import { MapView, markerIcon } from './features/map/MapView.jsx'
import { JournalComposer, optimizePhoto, PlannedVisitDialog, VisibilityPicker } from './features/journal/JournalComposer.jsx'
import { formatFeedDate, formatJournalDate, formatPlanDate, useOutsideDismiss } from './shared/viewHelpers.js'

let activePlanningAuthorFilter = null

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

function JournalEntryDialog({ entry, onClose, onUpdate, onDelete }) {
  const [body, setBody] = useState(entry.body ?? '')
  const [visibility, setVisibility] = useState(entry.visibility ?? 'private')
  const [visitedAt, setVisitedAt] = useState(String(entry.visited_at).slice(0, 10))
  const [media, setMedia] = useState(entry.media ?? [])
  const [removedMediaIds, setRemovedMediaIds] = useState([])
  const [newFiles, setNewFiles] = useState([])
  const [saving, setSaving] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef(null)
  const menuRef = useOutsideDismiss(menuOpen, () => setMenuOpen(false))

  async function save() {
    setSaving(true); setError('')
    try { await onUpdate(entry.journal_entry_id, { body, visibility, visitedAt, removedMediaIds, files: newFiles.map((item) => item.file) }); onClose() } catch (saveError) { setError(saveError.message || 'Der Eintrag konnte nicht aktualisiert werden.') } finally { setSaving(false) }
  }

  async function removeEntry() {
    setSaving(true); setError('')
    try { await onDelete(entry); onClose() } catch (deleteError) { setError(deleteError.message || 'Der Eintrag konnte nicht gelöscht werden.') } finally { setSaving(false) }
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
    <div className="composer-header"><div><span className="eyebrow">{formatJournalDate(entry.visited_at).day} {formatJournalDate(entry.visited_at).month} · {visibilityLabel(entry.visibility)}</span><h2>{entry.spot_name}</h2><p>{entry.district}</p></div><div className="entry-dialog__header-actions"><div className="friend-more-menu" ref={menuRef}><button type="button" className="icon-button ui-icon-button" onClick={() => setMenuOpen((value) => !value)} aria-label="Eintrag verwalten"><IconDots size={19} /></button>{menuOpen && <div className="friend-more-menu__popover"><button type="button" className="danger" onClick={() => { setMenuOpen(false); setConfirmDelete(true) }}><IconTrash size={16} />Eintrag löschen</button></div>}</div><button className="icon-button ui-icon-button" onClick={onClose} aria-label="Schließen"><IconX size={19} /></button></div></div>
    <label className="form-field"><span>Datum</span><input type="date" value={visitedAt} onChange={(event) => setVisitedAt(event.target.value)} /></label>
    <label className="form-field"><span>Dein Erfahrungsbericht</span><textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength="4000" /></label>
    {(media.length > 0 || newFiles.length > 0) && <div className="entry-photo-grid">{media.map((item) => <figure key={item.id}><img src={`/api/media/${item.id}`} alt={`Foto von ${entry.spot_name}`} /><button type="button" onClick={() => removeExistingPhoto(item.id)} aria-label="Foto im Entwurf entfernen"><IconX size={15} /></button></figure>)}{newFiles.map((item, index) => <figure key={item.preview}><img src={item.preview} alt="Neues Foto im Entwurf" /><button type="button" onClick={() => removeNewPhoto(index)} aria-label="Neues Foto entfernen"><IconX size={15} /></button></figure>)}</div>}
    {media.length + newFiles.length < 6 && <label className="add-entry-photo"><IconPlus size={17} />Foto hinzufügen<input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple onChange={addPhotos} /></label>}
    <VisibilityPicker value={visibility} onChange={setVisibility} />
    {error && <p className="form-error">{error}</p>}<p className="field-help">Änderungen an Fotos werden erst mit „Änderungen speichern“ übernommen.</p><button className="visit-button" disabled={saving} onClick={save}>{saving ? 'Wird gespeichert …' : 'Änderungen speichern'}</button>
    {confirmDelete && <div className="entry-delete-confirm"><p><b>Eintrag wirklich löschen?</b><br />Text, Fotos und Reaktionen auf diesen Eintrag werden dauerhaft entfernt.</p><div><button type="button" className="text-back" disabled={saving} onClick={() => setConfirmDelete(false)}>Abbrechen</button><button type="button" className="danger" disabled={saving} onClick={removeEntry}>{saving ? 'Wird gelöscht …' : 'Eintrag löschen'}</button></div></div>}
  </section></div>
}

function JournalFilterDialog({ halls, years, months, filters, onApply, onClose }) {
  const [draft, setDraft] = useState(filters)
  const selectableMonths = draft.year === 'all' ? [] : months.filter((month) => month.year === draft.year)
  return <div className="composer-backdrop"><section className="journal-composer filter-dialog" role="dialog" aria-modal="true" aria-label="Tagebuch filtern"><div className="composer-header"><div><span className="eyebrow">Tagebuch</span><h2>Einträge filtern</h2></div><button className="icon-button ui-icon-button" onClick={onClose}><IconX size={19} /></button></div><label className="form-field"><span>Boulderhalle</span><select value={draft.hall} onChange={(event) => setDraft({ ...draft, hall: event.target.value })}><option value="all">Alle Hallen</option>{halls.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><div className="filter-date-row"><label className="form-field"><span>Jahr</span><select value={draft.year} onChange={(event) => setDraft({ ...draft, year: event.target.value, month: 'all' })}><option value="all">Alle Jahre</option>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select></label><label className="form-field"><span>Monat</span><select value={draft.month} disabled={draft.year === 'all'} onChange={(event) => setDraft({ ...draft, month: event.target.value })}><option value="all">Alle Monate</option>{selectableMonths.map((month) => <option key={month.value} value={month.month}>{month.label}</option>)}</select></label></div><div className="filter-date-row"><label className="form-field"><span>Von <small>optional</small></span><input type="date" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label><label className="form-field"><span>Bis <small>optional</small></span><input type="date" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label></div><label className="form-field"><span>Eintragstyp</span><select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })}><option value="all">Alle Einträge</option><option value="photos">Mit Fotos</option><option value="shared">Geteilt</option></select></label><div className="filter-dialog__actions"><button type="button" className="text-back" onClick={() => setDraft({ hall: 'all', year: 'all', month: 'all', from: '', to: '', type: 'all' })}>Zurücksetzen</button><button className="journal-add" onClick={() => { onApply(draft); onClose() }}>Anwenden</button></div></section></div>
}

function journalMonthLabel(monthKey) {
  const [year, month] = monthKey.split('-').map(Number)
  const current = new Date()
  const currentKey = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`
  const previous = new Date(current.getFullYear(), current.getMonth() - 1, 1)
  const previousKey = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`
  if (monthKey === currentKey) return 'Diesen Monat'
  if (monthKey === previousKey) return 'Letzten Monat'
  return new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1))
}

function PastPlanDecisionDialog({ plan, onLogPlan, onMarkMissed, onClose }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function markMissed() {
    setSaving(true); setError('')
    try { await onMarkMissed(plan); onClose() } catch (markError) { setError(markError.message || 'Der Status konnte nicht gespeichert werden.') } finally { setSaving(false) }
  }
  return <div className="composer-backdrop"><section className="journal-composer plan-attendance-dialog" role="dialog" aria-modal="true" aria-label="Vergangene Planung abschließen"><div className="composer-header"><div><span className="eyebrow">Vergangene Planung</span><h2>{plan.spot_name}</h2><p>{formatPlanDate(plan.starts_at)}</p></div><button type="button" className="icon-button ui-icon-button" onClick={onClose} aria-label="Schließen"><IconX size={19} /></button></div><p className="auth-copy">Hat der geplante Besuch stattgefunden?</p>{error && <p className="form-error">{error}</p>}<div className="plan-attendance-dialog__actions"><button type="button" className="plan-attendance-dialog__missed" disabled={saving} onClick={markMissed}>Nicht stattgefunden</button><button type="button" className="visit-button" disabled={saving} onClick={() => { onLogPlan(plan); onClose() }}><IconCheck size={17} />Besuch eintragen</button></div></section></div>
}

function JournalUpcomingPlans({ onLogPlan, onMarkMissed, onOpenPlan }) {
  const [plans, setPlans] = useState([])
  const [mode, setMode] = useState('upcoming')
  const [decisionPlan, setDecisionPlan] = useState(null)
  useEffect(() => {
    const from = new Date(Date.now() - 270 * 24 * 60 * 60 * 1000).toISOString()
    const to = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
    fetch(`/api/social/planned-visits?scope=all&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).then((response) => response.ok ? response.json() : { plannedVisits: [] }).then((payload) => setPlans(payload.plannedVisits)).catch(() => setPlans([]))
  }, [])
  const pastPlans = plans.filter((plan) => plan.is_owner && new Date(plan.starts_at) < new Date())
  const visible = plans.filter((plan) => mode === 'past' ? plan.is_owner && new Date(plan.starts_at) < new Date() : mode === 'mine' ? plan.is_owner && new Date(plan.starts_at) >= new Date() : mode === 'interested' ? plan.my_response === 'interested' && new Date(plan.starts_at) >= new Date() : (plan.is_owner || plan.my_response === 'going') && new Date(plan.starts_at) >= new Date())
  if (!plans.length) return null
  return <><section className="journal-plans"><div className="section-heading"><h2>{mode === 'past' ? 'Vergangene Planungen' : 'Deine nächsten Besuche'}</h2><span>{visible.length}</span></div><div className="plan-filters"><button className={mode === 'upcoming' ? 'is-active' : ''} onClick={() => setMode('upcoming')}>Anstehend</button><button className={mode === 'interested' ? 'is-active' : ''} onClick={() => setMode('interested')}>Interessiert</button><button className={mode === 'mine' ? 'is-active' : ''} onClick={() => setMode('mine')}>Von mir</button><button className={mode === 'past' ? 'is-active' : ''} onClick={() => setMode('past')}>Vergangen{pastPlans.length > 0 && <b>{pastPlans.length}</b>}</button></div>{!visible.length && <p className="journal-empty">Für diesen Filter gibt es keine geplanten Besuche.</p>}<div>{visible.slice(0, 6).map((plan) => <article key={plan.id}><time>{formatPlanDate(plan.starts_at)}</time><div><b>{plan.spot_name}</b><small>{mode === 'past' ? 'Bitte Status festlegen' : plan.is_owner ? 'Deine Planung' : plan.my_response === 'going' ? 'Du hast zugesagt' : 'Du bist interessiert'}</small></div>{mode === 'past' ? <button type="button" onClick={() => setDecisionPlan(plan)}><IconCheck size={16} />Status wählen</button> : null}<button type="button" className="journal-plan-open" onClick={() => onOpenPlan(plan)} aria-label={`${plan.spot_name} im Planungsfeed öffnen`} title="Im Planungsfeed öffnen"><IconChevronRight size={18} /></button></article>)}</div></section>{decisionPlan && <PastPlanDecisionDialog plan={decisionPlan} onLogPlan={onLogPlan} onMarkMissed={async (plan) => { await onMarkMissed(plan); setPlans((current) => current.filter((item) => item.id !== plan.id)) }} onClose={() => setDecisionPlan(null)} />}</>
}

function JournalView({ spots, currentUser, journalVisits, onSignIn, onOpenComposer, onOpenEntry, onOpenImage, onLogPlan, onMarkPlanMissed, onOpenPlan }) {
  const [filters, setFilters] = useState({ hall: 'all', year: 'all', month: 'all', from: '', to: '', type: 'all' })
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
  const hallTotal = spots.length
  const exploredPercentage = hallTotal ? Math.round((uniqueHallCount / hallTotal) * 100) : 0
  const halls = [...new Map(journalVisits.map((visit) => [visit.spot_id, visit.spot_name])).entries()]
  const years = [...new Set(journalVisits.map((visit) => String(visit.visited_at).slice(0, 4)))].sort((a, b) => b.localeCompare(a))
  const months = [...new Map(journalVisits.map((visit) => {
    const value = String(visit.visited_at).slice(0, 7)
    const [year, month] = value.split('-').map(Number)
    return [value, { value, year: String(year), month: String(month).padStart(2, '0'), label: new Intl.DateTimeFormat('de-DE', { month: 'long' }).format(new Date(year, month - 1, 1)) }]
  })).values()].sort((a, b) => b.value.localeCompare(a.value))
  const visibleVisits = journalVisits.filter((visit) => {
    const date = String(visit.visited_at).slice(0, 10)
    return (filters.type !== 'photos' || visit.media?.length > 0) && (filters.type !== 'shared' || visit.visibility !== 'private') && (filters.hall === 'all' || visit.spot_id === filters.hall) && (filters.year === 'all' || date.slice(0, 4) === filters.year) && (filters.month === 'all' || date.slice(5, 7) === filters.month) && (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to)
  }).sort((a, b) => String(b.visited_at).localeCompare(String(a.visited_at)))
  const visitGroups = [...visibleVisits.reduce((groups, visit) => {
    const key = String(visit.visited_at).slice(0, 7)
    groups.set(key, [...(groups.get(key) ?? []), visit])
    return groups
  }, new Map()).entries()]
  return (
    <main className="view content-view journal-view">
      <div className="journal-content">
      <div className="page-intro page-intro--action">
        <div>
        <h1>Tagebuch</h1>
        </div>
        <button className="journal-add" onClick={onOpenComposer}><IconPlus size={18} />Eintrag</button>
      </div>
      <JournalUpcomingPlans onLogPlan={onLogPlan} onMarkMissed={onMarkPlanMissed} onOpenPlan={onOpenPlan} />
      <section className="journal-summary">
        <div><strong>{visitTotal}</strong><span>Besuche</span></div>
        <div className="journal-summary__ratio"><strong>{uniqueHallCount}</strong><i>/</i><small>{hallTotal}</small><span>Hallen besucht</span></div>
        <div><strong>{exploredPercentage}%</strong><span>Hallen entdeckt</span></div>
      </section>
      <section className="journal-list" aria-label="Letzte Besuche">
        <div className="section-heading"><h2>Deine Einträge</h2><div className="journal-list-actions"><span>{visibleVisits.length} von {visitTotal}</span><button className="ui-icon-button" onClick={() => setFiltersOpen(true)} aria-label="Einträge filtern"><IconAdjustmentsHorizontal size={18} /></button></div></div>
        {!journalVisits.length && <p className="journal-empty">Noch kein Eintrag. Halte deine nächste Session direkt hier fest.</p>}
        {!visibleVisits.length && journalVisits.length > 0 && <p className="journal-empty">Für diesen Filter gibt es noch keine Einträge.</p>}
        {visitGroups.map(([monthKey, visits]) => <section className="journal-entry-group" key={monthKey}><div className="journal-entry-group__heading"><h3>{journalMonthLabel(monthKey)}</h3><span>{visits.length}</span></div>{visits.map((visit) => {
          const date = formatJournalDate(visit.visited_at)
          return <button type="button" className="journal-entry" key={visit.id} onClick={() => onOpenEntry(visit)}>
            <div className="journal-entry__date"><b>{date.day}</b><span>{date.month}</span></div>
            <div className="journal-entry__main"><h3>{visit.spot_name}</h3><small className="entry-meta">{visit.district} · {visibilityLabel(visit.visibility)}</small>{visit.body && <p className="journal-entry__body">{visit.body}</p>}{visit.media?.length > 0 && <div className="journal-entry__photos">{visit.media.map((media) => <img key={media.id} onClick={(event) => { event.stopPropagation(); onOpenImage(`/api/media/${media.id}`, `Foto von ${visit.spot_name}`) }} src={`/api/media/${media.id}`} alt="Tagebucheintrag" />)}</div>}</div>
            <IconChevronRight size={19} />
          </button>
        })}</section>)}
      </section>
      </div>
      {filtersOpen && <JournalFilterDialog halls={halls} years={years} months={months} filters={filters} onApply={setFilters} onClose={() => setFiltersOpen(false)} />}
    </main>
  )
}


function RankBadge({ progress, uniqueSpots }) {
  const badge = uniqueSpots === undefined
    ? [...(progress?.badges ?? [])].reverse().find((item) => item.unlocked)
    : [{ threshold: 50, name: 'Boulder-Veteran' }, { threshold: 25, name: 'Deutschland-Crusher' }, { threshold: 10, name: 'Boulder-Scout' }, { threshold: 5, name: 'Hallen-Hopper' }, { threshold: 1, name: 'Erster Griff' }].find((item) => uniqueSpots >= item.threshold)
  return badge ? <span className={`rank-badge rank-badge--${badge.threshold}`} title={badge.name}><IconMedal size={15} /></span> : null
}

function avatarCropLayout(size, sourceWidth, sourceHeight, zoom, position) {
  const baseScale = Math.max(size / sourceWidth, size / sourceHeight)
  const width = sourceWidth * baseScale * zoom
  const height = sourceHeight * baseScale * zoom
  const overflowX = Math.max(0, width - size)
  const overflowY = Math.max(0, height - size)
  return { width, height, overflowX, overflowY, left: (size - width) / 2 + position.x * overflowX / 2, top: (size - height) / 2 + position.y * overflowY / 2 }
}

async function cropAvatarImage(file, zoom, position) {
  const sourceUrl = URL.createObjectURL(file)
  try {
    const source = await new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('Das Bild konnte nicht verarbeitet werden.'))
      image.src = sourceUrl
    })
    const size = 720
    const layout = avatarCropLayout(size, source.naturalWidth, source.naturalHeight, zoom, position)
    const canvas = document.createElement('canvas')
    canvas.width = size; canvas.height = size
    canvas.getContext('2d').drawImage(source, layout.left, layout.top, layout.width, layout.height)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', .9))
    if (!blob) throw new Error('Das Bild konnte nicht verarbeitet werden.')
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'profilbild'}.jpg`, { type: 'image/jpeg' })
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }
}

function AvatarCropDialog({ file, onClose, onSave }) {
  const [zoom, setZoom] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [drag, setDrag] = useState(null)
  const [imageSize, setImageSize] = useState(null)
  const [stageSize, setStageSize] = useState(280)
  const stageRef = useRef(null)
  const previewUrl = useMemo(() => URL.createObjectURL(file), [file])
  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl])
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    const updateSize = () => setStageSize(stage.clientWidth || 280)
    updateSize()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize)
      return () => window.removeEventListener('resize', updateSize)
    }
    const observer = new ResizeObserver(updateSize)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])
  const layout = imageSize ? avatarCropLayout(stageSize, imageSize.width, imageSize.height, zoom, position) : null
  function move(event) {
    if (!drag) return
    const clamp = (value) => Math.max(-1, Math.min(1, value))
    setPosition({ x: drag.layout.overflowX ? clamp(drag.position.x + (event.clientX - drag.x) * 2 / drag.layout.overflowX) : 0, y: drag.layout.overflowY ? clamp(drag.position.y + (event.clientY - drag.y) * 2 / drag.layout.overflowY) : 0 })
  }
  async function save() {
    setSaving(true); setError('')
    try { await onSave(await cropAvatarImage(file, zoom, position)); onClose() } catch (saveError) { setError(saveError.message || 'Profilfoto konnte nicht gespeichert werden.') } finally { setSaving(false) }
  }
  return <div className="composer-backdrop avatar-crop-backdrop"><section className="journal-composer avatar-crop-dialog" role="dialog" aria-modal="true" aria-label="Profilfoto zuschneiden"><div className="composer-header"><div><span className="eyebrow">Profilfoto</span><h2>Bild auswählen</h2></div><button type="button" className="icon-button ui-icon-button" onClick={onClose} aria-label="Schließen"><IconX size={19} /></button></div><p className="auth-copy">Ziehe das Bild im Kreis an die gewünschte Position und passe den Ausschnitt mit dem Zoom an.</p><div className="avatar-crop-stage" ref={stageRef} onPointerDown={(event) => { if (!layout) return; event.currentTarget.setPointerCapture(event.pointerId); setDrag({ x: event.clientX, y: event.clientY, position, layout }) }} onPointerMove={move} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>{imageSize && <img src={previewUrl} alt="Vorschau für dein Profilfoto" draggable="false" style={{ width: layout.width, height: layout.height, left: layout.left, top: layout.top }} />}{!imageSize && <img className="avatar-crop-stage__loader" src={previewUrl} alt="Vorschau für dein Profilfoto" onLoad={(event) => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />}<span className="avatar-crop-guide" /></div><label className="avatar-crop-zoom"><span>Zoom</span><input type="range" min="1" max="3" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>{error && <p className="form-error">{error}</p>}<div className="avatar-crop-actions"><button type="button" className="text-back" onClick={onClose}>Abbrechen</button><button type="button" className="visit-button" disabled={saving} onClick={save}>{saving ? 'Wird gespeichert …' : 'Foto übernehmen'}</button></div></section></div>
}

function ProfileAvatar({ user, progress, onChooseFile }) {
  const input = useRef(null)
  function chooseFile(event) { const selected = event.target.files?.[0]; event.target.value = ''; if (selected) onChooseFile(selected) }
  return <div className="profile-avatar-control"><button type="button" className="avatar profile-avatar" onClick={() => input.current?.click()} aria-label="Profilfoto ändern"><span className="profile-avatar__image">{user.image ? <img src={`/api/avatars/${user.id}?v=${encodeURIComponent(user.image)}`} alt="Dein Profil" /> : user.name.split(' ').map((name) => name[0]).join('').slice(0, 2)}</span><RankBadge progress={progress} /></button><input ref={input} type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseFile} /><span>Profilfoto ändern</span></div>
}

function AccountDeletionDialog({ username, onClose, onDelete }) {
  const [confirmation, setConfirmation] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault(); setSaving(true); setError('')
    try { await onDelete(); onClose() } catch (deleteError) { setError(deleteError.message || 'Das Konto konnte nicht gelöscht werden.') } finally { setSaving(false) }
  }
  return <div className="composer-backdrop"><section className="journal-composer account-deletion-dialog" role="dialog" aria-modal="true" aria-label="Konto löschen"><div className="composer-header"><div><span className="eyebrow">Konto</span><h2>Konto endgültig löschen</h2></div><button type="button" className="icon-button ui-icon-button" onClick={onClose} aria-label="Schließen"><IconX size={19} /></button></div><p className="auth-copy">Dein Profil, Besuche, Fotos, Planungen und persönlichen Daten werden dauerhaft gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.</p><form className="admin-login" onSubmit={submit}><label className="form-field"><span>Zur Bestätigung <b>LOESCHEN</b> eingeben</span><input required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoCapitalize="characters" /></label>{error && <p className="form-error">{error}</p>}<div className="account-deletion-dialog__actions"><button type="button" className="text-back" onClick={onClose}>Abbrechen</button><button type="submit" className="danger" disabled={confirmation !== 'LOESCHEN' || saving}>{saving ? 'Wird gelöscht …' : `@${username} löschen`}</button></div></form></section></div>
}

function ProfileView({ spots, currentUser, onSignIn, onSignOut, onDeleteAccount, onOpenBadges, onOpenAdmin, onOpenAudit, onChangePassword, onSuggestSpot, onOpenPrivacy, onOpenImprint, pendingSuggestionCount, pendingCorrectionCount, progress, onUploadAvatar }) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [avatarFile, setAvatarFile] = useState(null)
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
  const discoveryProgress = spots.length ? Math.min(100, uniqueSpots / spots.length * 100) : 0
  return (
    <main className="view content-view profile-view">
      <div className="profile-content">
        <section className="profile-hero">
          <div className="profile-hero__shade" />
          <div className="profile-hero__content">
            <ProfileAvatar user={currentUser} progress={progress} onChooseFile={setAvatarFile} />
            <h1>{currentUser.name}</h1>
            <p>@{currentUser.username ?? 'boulderfan'}</p>
          </div>
        </section>
        <section className="rank-card">
          <div className="rank-card__icon"><IconTrophy size={22} /></div>
          <div><span className="eyebrow">Dein Rang</span><h2>{currentRank?.name ?? 'Boulder-Neuling'}</h2><p>{nextRank ? `Noch ${Math.max(0, nextRank.threshold - uniqueSpots)} neue Hallen bis zum ${nextRank.name}.` : 'Alle Ränge freigeschaltet.'}</p></div>
        </section>
        <section className="progress-section">
          <div className="section-heading"><h2>Dein Fortschritt</h2><span>{uniqueSpots} Hallen</span></div>
          <div className="progress-bar"><span style={{ width: `${discoveryProgress}%` }} /></div>
          <div className="profile-stats"><div><strong>{uniqueSpots}</strong><span>Hallen entdeckt</span></div><div><strong>{total}</strong><span>Besuche</span></div><div><strong>{progress?.follower_count ?? 0}</strong><span>Follower</span></div></div>
        </section>
        <section className="profile-actions">
          <button onClick={onOpenBadges}><IconSparkles size={18} /><span><b>Abzeichen ansehen</b><small>Deine Meilensteine und nächsten Ziele</small></span><IconChevronRight size={18} /></button>
          <button onClick={onSuggestSpot}><IconMapPin size={18} /><span><b>Halle melden</b><small>Schlage eine Boulderhalle zur Prüfung vor</small></span><IconChevronRight size={18} /></button>
          {currentUser.role === 'superadmin' && <button onClick={onOpenAdmin}><IconAdjustmentsHorizontal size={18} /><span><b>Hallen verwalten</b><small>{spots.length} Hallen · {pendingSuggestionCount + pendingCorrectionCount} Hinweis{pendingSuggestionCount + pendingCorrectionCount === 1 ? '' : 'e'} offen</small></span>{pendingSuggestionCount + pendingCorrectionCount > 0 && <b className="admin-count-badge">{pendingSuggestionCount + pendingCorrectionCount > 99 ? '99+' : pendingSuggestionCount + pendingCorrectionCount}</b>}<IconChevronRight size={18} /></button>}
          {currentUser.role === 'superadmin' && <button onClick={onOpenAudit}><IconLock size={18} /><span><b>Registrierungen & Anmeldungen</b><small>Audit der letzten Kontoereignisse</small></span><IconChevronRight size={18} /></button>}
          {currentUser.role === 'member' && <button onClick={onChangePassword}><IconLock size={18} /><span><b>Passwort ändern</b><small>Dein Konto sicher halten</small></span><IconChevronRight size={18} /></button>}
          <button className="profile-actions__logout" onClick={onSignOut}><IconLogout size={18} />Abmelden</button>
          {currentUser.role === 'member' && <button className="profile-actions__delete" onClick={() => setDeleteOpen(true)}><IconTrash size={18} /><span><b>Konto löschen</b><small>Profil und persönliche Daten dauerhaft entfernen</small></span><IconChevronRight size={18} /></button>}
          <div className="profile-legal-links"><button type="button" onClick={onOpenPrivacy}>Datenschutz</button><button type="button" onClick={onOpenImprint}>Impressum</button></div>
        </section>
      </div>
      {avatarFile && <AvatarCropDialog file={avatarFile} onClose={() => setAvatarFile(null)} onSave={onUploadAvatar} />}
      {deleteOpen && <AccountDeletionDialog username={currentUser.username} onClose={() => setDeleteOpen(false)} onDelete={onDeleteAccount} />}
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
  const csv = 'id,source,source_external_id,name,district,address,latitude,longitude,opening_hours,area_sqm,website\n,,,Beispiel Boulderhalle,Jungbusch,Beispielstraße 12,49.4964,8.4548,Mo–Fr 10:00–22:00,850,https://example.com\n'
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
  return <div className="composer-backdrop"><section className="journal-composer admin-edit-dialog spot-suggestion-dialog" role="dialog" aria-modal="true" aria-label="Halle melden"><div className="composer-header"><div><h2>Halle melden</h2></div><button type="button" className="icon-button ui-icon-button" onClick={onClose} aria-label="Schließen"><IconX size={19} /></button></div><p className="auth-copy">Dein Vorschlag wird vor der Veröffentlichung durch die Verwaltung geprüft.</p><form onSubmit={submit}><div className="admin-form-grid"><label className="form-field"><span>Name *</span><input required value={form.name} onChange={(event) => update('name', event.target.value)} /></label><label className="form-field"><span>Stadtteil</span><input value={form.district} onChange={(event) => update('district', event.target.value)} /></label></div><label className="form-field"><span>Adresse *</span><input required value={form.address} onChange={(event) => update('address', event.target.value)} /></label><label className="form-field"><span>Website</span><input type="url" value={form.website} onChange={(event) => update('website', event.target.value)} placeholder="https://…" /></label><div className="admin-form-grid"><label className="form-field"><span>Breitengrad</span><input type="number" step="any" value={form.latitude} onChange={(event) => update('latitude', event.target.value)} /></label><label className="form-field"><span>Längengrad</span><input type="number" step="any" value={form.longitude} onChange={(event) => update('longitude', event.target.value)} /></label></div><SuggestionCoordinatePicker latitude={form.latitude} longitude={form.longitude} onChange={(latitude, longitude) => setForm((current) => ({ ...current, latitude, longitude }))} /><label className="form-field"><span>Hinweis für die Verwaltung</span><textarea value={form.notes} maxLength="2000" onChange={(event) => update('notes', event.target.value)} placeholder="Zum Beispiel Öffnungszeiten oder ein Hinweis zur Lage" /></label>{error && <p className="form-error">{error}</p>}<button className="visit-button" disabled={saving}>{saving ? 'Wird gesendet …' : 'Hallenvorschlag senden'}</button></form></section></div>
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
  return <div className="composer-backdrop"><section className="journal-composer admin-edit-dialog" role="dialog" aria-modal="true" aria-label={`${suggestion.name} prüfen`}><div className="composer-header"><div><span className="eyebrow">Hallenvorschlag prüfen</span><h2>{suggestion.name}</h2></div><button type="button" className="icon-button ui-icon-button" onClick={onClose} aria-label="Schließen"><IconX size={19} /></button></div><p className="suggestion-meta">Gemeldet von {suggestion.submitted_by_name} · {suggestion.submitted_by_email}</p>{suggestion.notes && <p className="suggestion-note"><b>Hinweis:</b> {suggestion.notes}</p>}<form onSubmit={approve}><div className="admin-form-grid"><label className="form-field"><span>Name *</span><input required value={draft.name} onChange={(event) => update('name', event.target.value)} /></label><label className="form-field"><span>Stadtteil *</span><input required value={draft.district} onChange={(event) => update('district', event.target.value)} /></label></div><label className="form-field"><span>Adresse *</span><input required value={draft.address} onChange={(event) => update('address', event.target.value)} /></label><div className="admin-form-grid"><label className="form-field"><span>Breitengrad *</span><input required type="number" step="any" value={draft.latitude} onChange={(event) => update('latitude', event.target.value)} /></label><label className="form-field"><span>Längengrad *</span><input required type="number" step="any" value={draft.longitude} onChange={(event) => update('longitude', event.target.value)} /></label></div><SuggestionCoordinatePicker latitude={draft.latitude} longitude={draft.longitude} onChange={(latitude, longitude) => setDraft((current) => ({ ...current, latitude, longitude }))} /><div className="admin-form-grid"><label className="form-field"><span>Öffnungszeiten</span><input value={draft.openingHours} onChange={(event) => update('openingHours', event.target.value)} /></label><label className="form-field"><span>Fläche in m²</span><input type="number" min="0" value={draft.areaSqm} onChange={(event) => update('areaSqm', event.target.value)} /></label></div><label className="form-field"><span>Website</span><input type="url" value={draft.website} onChange={(event) => update('website', event.target.value)} /></label>{error && <p className="form-error">{error}</p>}<div className="suggestion-review-actions"><button type="button" className="danger" disabled={saving} onClick={reject}>Ablehnen</button><button className="visit-button" disabled={saving}>{saving ? 'Wird geprüft …' : 'Freigeben und veröffentlichen'}</button></div></form></section></div>
}


function CsvImportReview({ preview, decisions, onDecisionChange, onBulk, onApply, onClose, applying }) {
  const [filter, setFilter] = useState('all')
  const rows = preview.rows.filter((row) => filter === 'all' || (filter === 'new' && row.input && !row.candidates.length && !row.error) || (filter === 'matches' && row.candidates.length) || (filter === 'invalid' && row.error))
  const counts = {
    new: preview.rows.filter((row) => row.input && !row.candidates.length && !row.error).length,
    matches: preview.rows.filter((row) => row.candidates.length).length,
    safeUpdates: preview.rows.filter((row) => row.safeUpdateTargetId).length,
    invalid: preview.rows.filter((row) => row.error).length,
  }
  const selected = Object.values(decisions).filter((decision) => decision.action !== 'skip').length
  const matchLabel = (candidate) => ({
    id: 'gleiche BoulderO-ID',
    source_external_id: 'gleiche Quellen-ID',
    name: 'gleicher Name',
    nearby: `${candidate.distance_m} m entfernt`,
  }[candidate.match_type] ?? 'möglicher Treffer')
  return <section className="import-review"><div className="section-heading"><div><span className="eyebrow">Excel-/CSV-Prüfung</span><h2>{preview.rows.length} Zeilen analysiert</h2></div><button type="button" className="text-back" onClick={onClose} disabled={applying}>Verwerfen</button></div><p>Eine vorhandene BoulderO-ID wird immer direkt derselben Halle zugeordnet. Weitere Treffer werden über Quellen-ID, gleichen Namen oder bis zu 150 m Abstand vorgeschlagen. Erst mit „Auswahl anwenden“ werden Daten geändert.</p><div className="import-review__summary"><span>{counts.new} neu</span><span>{counts.matches} mögliche Treffer</span><span>{counts.safeUpdates} sichere Updates</span><span>{counts.invalid} ungültig</span><span>{selected} ausgewählt</span></div><div className="import-review__bulk"><button type="button" onClick={() => onBulk('create-new')} disabled={applying || !counts.new}>Alle neuen anlegen</button><button type="button" onClick={() => onBulk('update-matches')} disabled={applying || !counts.safeUpdates}>Sichere Updates übernehmen</button><button type="button" onClick={() => onBulk('skip-all')} disabled={applying}>Alle überspringen</button></div><div className="import-review__filters" role="tablist" aria-label="Importzeilen filtern">{[['all', 'Alle'], ['new', 'Neu'], ['matches', 'Treffer'], ['invalid', 'Ungültig']].map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div><div className="admin-table-wrap"><table className="import-review__table"><thead><tr><th>Zeile</th><th>Import-Halle</th><th>Prüfergebnis</th><th>Aktion</th></tr></thead><tbody>{rows.map((row) => { const decision = decisions[row.rowNumber] ?? { action: 'skip' }; const value = decision.action === 'update' ? `update:${decision.targetId}` : decision.action; return <tr key={row.rowNumber} className={row.error ? 'is-invalid' : row.candidates.length ? 'has-match' : ''}><td>{row.rowNumber}</td><td>{row.input ? <><b>{row.input.name}</b><small>{row.input.address} · {row.input.district}</small></> : 'Nicht lesbar'}</td><td>{row.error ? <span className="import-review__error">{row.error}</span> : row.candidates.length ? <div className="import-review__matches">{row.candidates.map((candidate) => <span key={candidate.id}><b>{candidate.name}</b> · {matchLabel(candidate)}{candidate.status !== 'active' ? ` · ${candidate.status}` : ''}</span>)}</div> : <span className="import-review__new">Keine passende Halle gefunden</span>}</td><td>{row.error ? <span>Überspringen</span> : <select value={value} onChange={(event) => onDecisionChange(row.rowNumber, event.target.value)} disabled={applying}><option value="skip">Überspringen</option><option value="create">{row.candidates.length ? 'Trotzdem neu anlegen' : 'Neu anlegen'}</option>{row.candidates.map((candidate) => <option key={candidate.id} value={`update:${candidate.id}`}>„{candidate.name}“ aktualisieren</option>)}</select>}</td></tr> })}</tbody></table></div><div className="import-review__footer"><span>{selected ? `${selected} Zeilen werden verarbeitet.` : 'Keine Zeile ausgewählt.'}</span><button type="button" className="visit-button" onClick={onApply} disabled={applying || !selected}>{applying ? 'Import wird angewendet …' : 'Auswahl anwenden'}</button></div></section>
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
      setImportDecisions(Object.fromEntries(preview.rows.map((row) => [row.rowNumber, row.error ? { action: 'skip' } : row.safeUpdateTargetId ? { action: 'update', targetId: row.safeUpdateTargetId } : row.candidates.length ? { action: 'skip' } : { action: 'create' }])));
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
        if (action === 'update-matches' && row.safeUpdateTargetId) next[row.rowNumber] = { action: 'update', targetId: row.safeUpdateTargetId };
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
          <h2>Excel oder CSV importieren</h2>
          <p>
            Maximal 500 Hallen; Pflichtspalten: name, district, address,
            latitude und longitude. Für einen sicheren Rückimport die
            exportierte <code>id</code>-Spalte unverändert lassen.
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
            {importing ? "Import wird verarbeitet …" : "Datei auswählen"}
            <input
              ref={csvInput}
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
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


function FeedAuthor({ entry }) {
  const [expanded, setExpanded] = useState(false)
  const authorRef = useOutsideDismiss(expanded, () => setExpanded(false))
  function openSpotOnMap() {
    const current = window.history.state
    window.history.pushState({ boulderO: true, view: 'map', position: (current?.position ?? 0) + 1 }, '', `/map?spot=${encodeURIComponent(entry.spot_id)}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
  function openDiscover() {
    const current = window.history.state
    window.history.pushState({ boulderO: true, view: 'friends', position: (current?.position ?? 0) + 1 }, '', `/friends?discover=${encodeURIComponent(entry.username)}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
  return <div className="feed-author" id={`feed-entry-${entry.id}`} ref={authorRef}><button className="person-avatar feed-avatar" onClick={() => setExpanded((value) => !value)} aria-label={`Profil von ${entry.user_name} anzeigen`}>{entry.user_image ? <img src={`/api/avatars/${entry.user_id}`} alt="" /> : entry.user_name.split(' ').map((part) => part[0]).join('')}<RankBadge uniqueSpots={entry.author_unique_spots} /></button><span className="feed-author__identity"><b>{entry.user_name}</b><time>{formatFeedDate(entry.visited_at)}</time></span>{entry.is_owner && <span className="feed-author__own">Dein Beitrag</span>}<button type="button" className="ui-icon-button feed-author__map-link" onClick={openSpotOnMap} aria-label={`${entry.spot_name} auf der Karte öffnen`} title="Auf Karte anzeigen"><IconMapPin size={17} /></button>{expanded && <div className="feed-author__dropdown"><b>{entry.user_name}</b><small>@{entry.username} · {visibilityLabel(entry.visibility)}</small>{!entry.is_owner && <button type="button" onClick={openDiscover}>In Freunde öffnen</button>}</div>}</div>
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

function PlannedVisitCard({ plan, onRsvp, onEdit, onCancel, onLogVisit }) {
  const rsvp = plan.my_response
  const [people, setPeople] = useState([])
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const peopleRef = useOutsideDismiss(peopleOpen, () => setPeopleOpen(false))
  const menuRef = useOutsideDismiss(menuOpen, () => setMenuOpen(false))
  async function togglePeople() { if (!peopleOpen) { const response = await fetch(`/api/planned-visits/${plan.id}/rsvps`); if (response.ok) setPeople((await response.json()).rsvps) }; setMenuOpen(false); setPeopleOpen((value) => !value) }
  return <article className="planned-visit-card"><div className="planned-visit-card__top"><span className="eyebrow">{plan.is_owner ? 'Deine Planung' : 'Geplant'}</span><time>{formatPlanDate(plan.starts_at)}</time></div><div className="planned-visit-author"><span className="person-avatar">{plan.user_image ? <img src={`/api/avatars/${plan.user_id}`} alt="" /> : plan.user_name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><span><b>{plan.user_name}</b><small>{plan.is_owner ? 'organisierst diesen Besuch' : 'plant einen Besuch'}</small></span>{plan.is_owner && <div className="plan-card-menu" ref={menuRef}><button type="button" className="friend-more-button" onClick={() => { setPeopleOpen(false); setMenuOpen((value) => !value) }} aria-label="Planung verwalten"><IconDots size={18} /></button>{menuOpen && <div className="friend-more-menu__popover"><button type="button" onClick={() => { setMenuOpen(false); onEdit?.(plan) }}>Bearbeiten</button><button type="button" className="danger" onClick={() => { setMenuOpen(false); onCancel?.(plan) }}>Absagen</button></div>}</div>}</div><h3>{plan.spot_name}</h3><p>{plan.district} · {plan.address}</p><p className="planned-visit-card__note">{plan.note || `${plan.user_name} plant eine Boulder-Session.`}</p><div className="planned-visit-card__footer"><div className="planned-people" ref={peopleRef}><button type="button" onClick={togglePeople}><IconUsers size={16} />{plan.going_count} dabei{plan.interested_count > 0 ? ` · ${plan.interested_count} interessiert` : ''}</button>{peopleOpen && <div className="planned-people__popover">{people.length ? people.map((person) => <div key={person.id}><span className="person-avatar">{person.image ? <img src={`/api/avatars/${person.id}`} alt="" /> : person.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><span><b>{person.name}</b><small>{person.response === 'going' ? 'Dabei' : 'Interessiert'}</small></span></div>) : <small>Noch keine Zusagen.</small>}</div>}</div>{plan.is_owner && new Date(plan.starts_at) <= new Date() && <button type="button" className="plan-log-button" onClick={() => onLogVisit?.(plan)}><IconBookmark size={16} />Besuch festhalten</button>}{!plan.is_owner && <div className="planned-rsvp-actions"><button className={rsvp === 'interested' ? 'is-active' : ''} onClick={() => onRsvp(plan, rsvp === 'interested' ? null : 'interested')}>Interessiert</button><button className={rsvp === 'going' ? 'is-active' : ''} onClick={() => onRsvp(plan, rsvp === 'going' ? null : 'going')}>{rsvp === 'going' ? 'Zugesagt' : 'Zusagen'}</button></div>}</div></article>
}

function planDayKey(value) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date(value))
}

function planMonthKey(value) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`
}

function planListRange(selectedDay) {
  const from = selectedDay ? new Date(`${selectedDay}T00:00:00`) : new Date()
  if (!selectedDay) from.setHours(0, 0, 0, 0)
  const to = new Date(from)
  to.setDate(to.getDate() + (selectedDay ? 1 : 90))
  return new URLSearchParams({ scope: 'all', from: from.toISOString(), to: to.toISOString() })
}

function PlanCalendar({ month, days, selectedDay, onMonthChange, onDayChange }) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const startOffset = (first.getDay() + 6) % 7
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const byDay = new Map(days.map((day) => [String(day.day).slice(0, 10), day]))
  const cells = Array.from({ length: Math.ceil((startOffset + count) / 7) * 7 }, (_, index) => index - startOffset + 1)
  const authorScope = activePlanningAuthorFilter
  return <div className="plan-calendar-wrap">{authorScope && <div className="plan-author-scope"><span><b>Planung von {authorScope.author.name}</b><small>@{authorScope.author.username}</small></span><button type="button" onClick={authorScope.onClear}>Filter zurücksetzen</button></div>}<section className="plan-calendar"><div className="plan-calendar__header"><button type="button" className="ui-icon-button" onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Vorheriger Monat"><IconChevronLeft size={18} /></button><b>{new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(month)}</b><button type="button" className="ui-icon-button" onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Nächster Monat"><IconChevronRight size={18} /></button></div><div className="plan-calendar__weekdays">{['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((day) => <span key={day}>{day}</span>)}</div><div className="plan-calendar__days">{cells.map((number, index) => { if (number < 1 || number > count) return <span key={`empty-${index}`} />; const key = `${planMonthKey(month)}-${String(number).padStart(2, '0')}`; const day = byDay.get(key); return <button key={key} type="button" className={`${selectedDay === key ? 'is-selected ' : ''}${day ? 'has-plans' : ''}`} onClick={() => onDayChange(selectedDay === key ? null : key)}><span>{number}</span>{day && <i className="plan-calendar__dots">{day.own_count > 0 && <b className="is-own" />}{day.going_count > 0 && <b className="is-going" />}{day.interested_count > 0 && <b className="is-interested" />}{day.total > day.own_count + day.going_count + day.interested_count && <b className="is-other" />}</i>}</button> })}</div></section></div>
}

function PlanEditorDialog({ plan, spots, onSave, onClose }) {
  const start = new Date(plan.starts_at)
  const end = plan.ends_at ? new Date(plan.ends_at) : null
  const [spotId, setSpotId] = useState(plan.spot_id)
  const [date, setDate] = useState(start.toISOString().slice(0, 10))
  const [time, setTime] = useState(start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }))
  const [endTime, setEndTime] = useState(end ? end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }) : '')
  const [note, setNote] = useState(plan.note ?? '')
  const [visibility, setVisibility] = useState(plan.visibility)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function submit(event) { event.preventDefault(); setSaving(true); setError(''); try { await onSave(plan.id, { spotId, startsAt: new Date(`${date}T${time}:00`).toISOString(), endsAt: endTime ? new Date(`${date}T${endTime}:00`).toISOString() : null, note, visibility }); onClose() } catch (saveError) { setError(saveError.message || 'Die Planung konnte nicht gespeichert werden.') } finally { setSaving(false) } }
  return <div className="composer-backdrop"><section className="journal-composer" role="dialog" aria-modal="true"><div className="composer-header"><div><span className="eyebrow">Planung</span><h2>Besuch bearbeiten</h2></div><button type="button" className="icon-button ui-icon-button" onClick={onClose} aria-label="Schließen"><IconX size={19} /></button></div><form onSubmit={submit}><label className="form-field"><span>Halle</span><select value={spotId} onChange={(event) => setSpotId(event.target.value)}>{spots.map((spot) => <option key={spot.id} value={spot.id}>{spot.name} · {spot.district}</option>)}</select></label><div className="admin-form-grid"><label className="form-field"><span>Datum</span><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label className="form-field"><span>Beginn</span><input required type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label></div><label className="form-field"><span>Ende <small>optional</small></span><input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label><label className="form-field"><span>Notiz</span><textarea value={note} maxLength="2000" onChange={(event) => setNote(event.target.value)} /></label><VisibilityPicker value={visibility} onChange={setVisibility} />{error && <p className="form-error">{error}</p>}<button className="visit-button" disabled={saving}>{saving ? 'Wird gespeichert …' : 'Änderungen speichern'}</button></form></section></div>
}

function PlanCancelDialog({ plan, onCancel, onClose }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  async function submit(event) { event.preventDefault(); setSaving(true); try { await onCancel(plan.id, reason); onClose() } finally { setSaving(false) } }
  return <div className="composer-backdrop"><section className="journal-composer" role="dialog" aria-modal="true"><div className="composer-header"><div><span className="eyebrow">Planung absagen</span><h2>{plan.spot_name}</h2></div><button type="button" className="icon-button ui-icon-button" onClick={onClose} aria-label="Schließen"><IconX size={19} /></button></div><p className="auth-copy">Zugesagte und interessierte Personen werden benachrichtigt.</p><form onSubmit={submit}><label className="form-field"><span>Grund <small>optional</small></span><textarea value={reason} maxLength="1000" onChange={(event) => setReason(event.target.value)} /></label><div className="plan-dialog-actions"><button type="button" className="message-button" onClick={onClose}>Zurück</button><button className="danger" disabled={saving}>{saving ? 'Wird abgesagt …' : 'Planung absagen'}</button></div></form></section></div>
}

function PlanNotifications({ notifications, onRead }) {
  if (!notifications.length) return null
  return <section className="plan-notifications"><div className="section-heading"><h3>Neu für dich</h3><button type="button" onClick={onRead}>Als gelesen markieren</button></div>{notifications.map((notification) => { const payload = notification.payload ?? {}; const copy = notification.type === 'plan_cancelled' ? `${notification.actor_name ?? 'Jemand'} hat ${payload.spotName ?? notification.spot_name} abgesagt.` : notification.type === 'plan_updated' ? `${notification.actor_name ?? 'Jemand'} hat ${payload.spotName ?? notification.spot_name} geändert.` : `${notification.actor_name ?? 'Jemand'} ist ${payload.response === 'going' ? 'dabei' : 'interessiert'} bei ${payload.spotName ?? notification.spot_name}.`; return <article key={notification.id}><b>{copy}</b>{payload.reason && <small>{payload.reason}</small>}<time>{formatFeedDate(notification.created_at)}</time></article> })}</section>
}

function FeedView({ onOpenImage, onOpenSpot, authorFilter, onClearAuthorFilter, onFeedRead, spots, onLogPlan, planFocus, onPlanFocusConsumed }) {
  const [entries, setEntries] = useState([])
  const [entryFocusId, setEntryFocusId] = useState(() => new URLSearchParams(window.location.search).get('entry'))
  const [plannedVisits, setPlannedVisits] = useState([])
  const [calendarDays, setCalendarDays] = useState([])
  const [notifications, setNotifications] = useState([])
  const [error, setError] = useState('')
  const [comments, setComments] = useState({})
  const [expanded, setExpanded] = useState(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [feedMode, setFeedMode] = useState('all')
  const [section, setSection] = useState('feed')
  const [planScope, setPlanScope] = useState('all')
  const [planResponse, setPlanResponse] = useState('all')
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [selectedDay, setSelectedDay] = useState(null)
  const [editingPlan, setEditingPlan] = useState(null)
  const [cancellingPlan, setCancellingPlan] = useState(null)
  const loadRequest = useRef(0)

  async function load() {
    const requestId = ++loadRequest.current
    try {
      const [feedResponse, plansResponse] = await Promise.all([fetch('/api/social/feed'), fetch(`/api/social/planned-visits?${planListRange(selectedDay)}`)])
      if (!feedResponse.ok || !plansResponse.ok) throw new Error('Feed konnte nicht geladen werden.')
      if (requestId !== loadRequest.current) return
      setEntries((await feedResponse.json()).entries)
      setPlannedVisits((await plansResponse.json()).plannedVisits)
      await fetch('/api/social/feed/seen', { method: 'POST' })
      onFeedRead()
    } catch (loadError) { if (requestId === loadRequest.current) setError(loadError.message) }
  }
  useEffect(() => {
    load()
    const interval = window.setInterval(load, 30000)
    return () => window.clearInterval(interval)
  }, [selectedDay])
  useEffect(() => { fetch(`/api/social/planned-visits/calendar?month=${planMonthKey(calendarMonth)}`).then((response) => response.ok ? response.json() : { days: [] }).then((payload) => setCalendarDays(payload.days)).catch(() => setCalendarDays([])) }, [calendarMonth])
  useEffect(() => { if (section !== 'plans') return; fetch('/api/notifications?unreadOnly=true').then((response) => response.ok ? response.json() : { notifications: [] }).then((payload) => setNotifications(payload.notifications)).catch(() => setNotifications([])) }, [section])
  useEffect(() => {
    if (!entryFocusId) return
    setSection('feed')
    setFeedMode('all')
  }, [entryFocusId])
  useEffect(() => {
    if (!entryFocusId || section !== 'feed' || !entries.some((entry) => entry.id === entryFocusId)) return undefined
    const timer = window.setTimeout(() => {
      document.getElementById(`feed-entry-${entryFocusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setEntryFocusId(null)
      window.history.replaceState(window.history.state, '', '/social')
    }, 80)
    return () => window.clearTimeout(timer)
  }, [entries, entryFocusId, section])
  useEffect(() => {
    if (!planFocus) return
    const date = new Date(planFocus.starts_at)
    setSection('plans')
    setPlanScope('all')
    setPlanResponse('all')
    setCalendarMonth(new Date(date.getFullYear(), date.getMonth(), 1))
    setSelectedDay(planDayKey(planFocus.starts_at))
    onPlanFocusConsumed()
  }, [planFocus, onPlanFocusConsumed])

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

  async function updatePlan(id, patch) { const response = await fetch(`/api/planned-visits/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }); if (!response.ok) throw new Error('Die Planung konnte nicht aktualisiert werden.'); await load() }
  async function cancelPlan(id, reason) { const response = await fetch(`/api/planned-visits/${id}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) }); if (!response.ok) throw new Error('Die Planung konnte nicht abgesagt werden.'); await load() }
  async function readPlanNotifications() { await fetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plannedOnly: true }) }); setNotifications([]); onFeedRead({ plans: true }) }

  const visibleEntries = (feedMode === 'friends' ? entries.filter((entry) => entry.is_friend || entry.is_owner) : entries).filter((entry) => !authorFilter || entry.user_id === authorFilter.id || entry.id === entryFocusId)
  const visiblePlans = plannedVisits.filter((plan) => (!authorFilter || plan.user_id === authorFilter.id) && (planScope !== 'friends' || plan.is_friend || plan.is_owner) && (planScope !== 'mine' || plan.is_owner || plan.my_response === 'going') && (planResponse === 'all' || plan.my_response === planResponse) && (!selectedDay || planDayKey(plan.starts_at) === selectedDay))
  activePlanningAuthorFilter = section === 'plans' && authorFilter ? { author: authorFilter, onClear: onClearAuthorFilter } : null
  return <main className="view content-view compact-view social-view">{error && <p className="form-error">{error}</p>}<section className="social-section feed-section"><div className="section-heading"><div><h2>{section === 'feed' ? (authorFilter ? `Feed von ${authorFilter.name}` : 'Aktuell im Feed') : 'Planung'}</h2>{authorFilter && section === 'feed' && <button type="button" className="text-back" onClick={onClearAuthorFilter}>Gesamten Feed zeigen</button>}</div><div className="feed-toggle"><button className={section === 'feed' ? 'is-active' : ''} onClick={() => setSection('feed')}>Feed</button><button className={section === 'plans' ? 'is-active' : ''} onClick={() => setSection('plans')}>Planung{notifications.length > 0 && <b>{notifications.length}</b>}</button></div></div>{section === 'feed' ? <><div className="feed-filter-row"><div className="feed-toggle feed-toggle--secondary"><button className={feedMode === 'all' ? 'is-active' : ''} onClick={() => setFeedMode('all')}>Aktuell</button><button className={feedMode === 'friends' ? 'is-active' : ''} onClick={() => setFeedMode('friends')}>Freunde</button></div></div>{!visibleEntries.length && <p className="journal-empty">Noch keine Beiträge für diese Ansicht.</p>}<div className="feed-list">{visibleEntries.map((entry) => <article className={entry.is_owner ? 'feed-entry feed-entry--own' : 'feed-entry'} key={entry.id}><FeedAuthor entry={entry} /><h3 className="feed-entry__visit">{entry.user_name} war bei {entry.spot_name}</h3>{entry.body && <p className="feed-body">{entry.body}</p>}{entry.media?.length > 0 && <FeedMediaCarousel entry={entry} onOpenImage={onOpenImage} />}<div className="feed-actions"><button className={entry.liked_by_me ? 'is-active' : ''} onClick={() => toggleLike(entry)}>♥ <span>{entry.like_count}</span></button><button onClick={() => toggleComments(entry.id)}>{entry.comment_count === 1 ? 'Kommentar' : 'Kommentare'} <span>{entry.comment_count}</span></button></div>{expanded === entry.id && <div className="comments"><div>{(comments[entry.id] ?? []).map((comment) => <p key={comment.id}><b>{comment.user_name}</b>{comment.body}</p>)}</div><form onSubmit={(event) => { event.preventDefault(); postComment(entry.id) }}><input value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} maxLength="1000" placeholder="Kommentar schreiben …" /><button>Posten</button></form></div>}</article>)}</div></> : <><PlanNotifications notifications={notifications} onRead={readPlanNotifications} /><div className="planning-layout"><PlanCalendar month={calendarMonth} days={calendarDays} selectedDay={selectedDay} onMonthChange={(month) => { setCalendarMonth(month); setSelectedDay(null) }} onDayChange={setSelectedDay} /><div className="planning-list"><div className="plan-filters"><button className={planScope === 'all' ? 'is-active' : ''} onClick={() => setPlanScope('all')}>Alle</button><button className={planScope === 'friends' ? 'is-active' : ''} onClick={() => setPlanScope('friends')}>Freunde</button><button className={planScope === 'mine' ? 'is-active' : ''} onClick={() => setPlanScope('mine')}>Meine</button></div><div className="plan-filters plan-filters--response"><button className={planResponse === 'all' ? 'is-active' : ''} onClick={() => setPlanResponse('all')}>Alle</button><button className={planResponse === 'going' ? 'is-active' : ''} onClick={() => setPlanResponse('going')}>Zugesagt</button><button className={planResponse === 'interested' ? 'is-active' : ''} onClick={() => setPlanResponse('interested')}>Interessiert</button></div>{selectedDay && <button type="button" className="text-back plan-clear-day" onClick={() => setSelectedDay(null)}>Tagesauswahl aufheben</button>}{!visiblePlans.length && <p className="journal-empty">Für diese Auswahl gibt es keine geplanten Besuche.</p>}<div className="planned-visit-list">{visiblePlans.map((plan) => <PlannedVisitCard key={plan.id} plan={plan} onRsvp={rsvp} onEdit={setEditingPlan} onCancel={setCancellingPlan} onLogVisit={onLogPlan} />)}</div></div></div></>}{editingPlan && <PlanEditorDialog plan={editingPlan} spots={spots} onSave={updatePlan} onClose={() => setEditingPlan(null)} />}{cancellingPlan && <PlanCancelDialog plan={cancellingPlan} onCancel={cancelPlan} onClose={() => setCancellingPlan(null)} />}</section></main>
}


function UserAvatar({ user, onOpenImage }) {
  const initials = user.name.split(' ').map((part) => part[0]).join('').slice(0, 2)
  const avatar = <>{user.image ? <img src={`/api/avatars/${user.id ?? user.user_id}`} alt="" /> : initials}<RankBadge uniqueSpots={user.unique_spots} /></>
  if (user.image && onOpenImage) return <button type="button" className="person-avatar social-avatar social-avatar--ranked social-avatar--zoomable" onClick={() => onOpenImage(`/api/avatars/${user.id ?? user.user_id}`, `Profilbild von ${user.name}`)} aria-label={`Profilbild von ${user.name} vergrößern`}>{avatar}</button>
  return <span className="person-avatar social-avatar social-avatar--ranked">{avatar}</span>
}

function FriendsView({ onOpenMessages, onSummaryChange, onOpenUserFeed, onOpenImage }) {
  const initialDiscoverUsername = new URLSearchParams(window.location.search).get('discover')?.replace(/^@+/, '') ?? ''
  const [tab, setTab] = useState(initialDiscoverUsername ? 'discover' : 'friends')
  const [friends, setFriends] = useState([])
  const [friendSuggestions, setFriendSuggestions] = useState([])
  const [requests, setRequests] = useState({ incoming: [], outgoing: [] })
  const [query, setQuery] = useState(initialDiscoverUsername ? `@${initialDiscoverUsername}` : '')
  const [results, setResults] = useState([])
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(null)
  const [friendMenuId, setFriendMenuId] = useState(null)
  const friendMenuRef = useOutsideDismiss(friendMenuId !== null, () => setFriendMenuId(null))
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
              <div className="friend-row-actions"><button type="button" className="message-button" onClick={() => openPreview(user)}>Profil</button><button className="message-button" onClick={() => { onOpenMessages(user); setFriends((current) => current.map((item) => item.id === user.id ? { ...item, unread_count: 0 } : item)) }}>Nachricht{user.unread_count > 0 && <b>{user.unread_count}</b>}</button><div className="friend-more-menu" ref={friendMenuId === user.id ? friendMenuRef : null}><button type="button" className="friend-more-button" onClick={() => setFriendMenuId((current) => current === user.id ? null : user.id)} aria-label={`Beziehungsoptionen für ${user.name}`} aria-expanded={friendMenuId === user.id} title="Beziehungsoptionen"><IconDots size={19} /></button>{friendMenuId === user.id && <div className="friend-more-menu__popover"><button type="button" onClick={() => { setFriendMenuId(null); action(`/api/follows/${user.id}`, 'DELETE') }}>Nicht mehr folgen</button><button type="button" className="danger" onClick={() => { setFriendMenuId(null); action(`/api/social/friends/${user.id}`, 'DELETE') }}>Freundschaft beenden</button></div>}</div></div>
              {preview?.user?.id === user.id && <div className="friend-preview"><b>Letztes von {preview.user.name}</b>{preview.plans.map((plan) => <p key={plan.id}><IconCalendarEvent size={14} /> {formatPlanDate(plan.starts_at)} · {plan.spot_name}</p>)}{preview.entries.map((entry) => <p key={entry.id}>war bei <b>{entry.spot_name}</b>{entry.body ? ` · ${entry.body}` : ''}</p>)}{!preview.entries.length && !preview.plans.length && <p>Noch nichts geteilt.</p>}<button type="button" onClick={() => onOpenUserFeed(preview.user)}>Feed von {preview.user.name.split(' ')[0]} öffnen</button></div>}
            </article>)}
          </div>
        </>}
        {tab === 'requests' && <div className="request-groups"><section><div className="section-heading"><h3>Eingegangen</h3><span>{requests.incoming.length}</span></div><div className="people-list">{!requests.incoming.length && <p className="journal-empty">Keine offenen Anfragen.</p>}{requests.incoming.map((request) => <article key={request.id}><UserAvatar user={{ ...request, id: request.user_id }} /><div><h3>{request.name}</h3><p>@{request.username}</p></div><button className="message-button" onClick={() => action(`/api/social/friend-requests/${request.id}/decline`)}>Ablehnen</button><button onClick={() => action(`/api/social/friend-requests/${request.id}/accept`)}><IconCheck size={16} />Annehmen</button></article>)}</div></section><section><div className="section-heading"><h3>Gesendet</h3><span>{requests.outgoing.length}</span></div><div className="people-list">{!requests.outgoing.length && <p className="journal-empty">Keine gesendeten Anfragen.</p>}{requests.outgoing.map((request) => <article key={request.id}><UserAvatar user={{ ...request, id: request.user_id }} /><div><h3>{request.name}</h3><p>@{request.username} · Anfrage gesendet</p></div></article>)}</div></section></div>}
        {tab === 'discover' && <section className="friend-discover"><label className="search-field"><IconSearch size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name oder @username suchen" />{query && <button type="button" onClick={() => setQuery('')} aria-label="Suche löschen"><IconX size={16} /></button>}</label>{query.trim().replace(/^@+/, '').length > 0 && query.trim().replace(/^@+/, '').length < 2 && <p className="journal-empty">Mindestens zwei Zeichen eingeben.</p>}<div className="people-list">{results.map((user) => <article key={user.id}><UserAvatar user={user} /><div><h3>{user.name}</h3><p>@{user.username}{user.follows_you ? ' · folgt dir' : ''}</p></div>{user.is_friend ? <span className="relationship-state"><IconUserCheck size={16} />Freund:in</span> : user.request_sent ? <span className="relationship-state">Anfrage gesendet</span> : user.request_received ? <span className="relationship-actions"><button className="message-button" onClick={() => action(`/api/social/friend-requests/${user.incoming_request_id}/decline`)}>Ablehnen</button><button onClick={() => action(`/api/social/friend-requests/${user.incoming_request_id}/accept`)}>Annehmen</button></span> : <button onClick={() => action(`/api/social/friend-requests/${user.id}`)}><IconUserPlus size={16} />Anfragen</button>}{!user.is_friend && <button className={user.following ? 'following' : ''} onClick={() => action(`/api/follows/${user.id}`, user.following ? 'DELETE' : 'POST')}>{user.following ? 'Folge ich' : 'Folgen'}</button>}</article>)}</div></section>}
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
  const [submitting, setSubmitting] = useState(false)
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
    event.preventDefault(); if (submitting) return; setError(''); setNotice(''); setSubmitting(true)
    try {
      if (mode === 'signin') await onMemberSignIn(email, password)
      if (mode === 'register') { if (usernameStatus !== 'available') throw new Error('Wähle einen freien @Namen.'); const result = await onRegister(name, normalizedUsername, email, password); switchMode('signin'); setNotice(result?.deliveryFailed ? 'Dein Konto wurde angelegt, aber die Bestätigungs-E-Mail konnte noch nicht versendet werden. Du kannst sie hier erneut anfordern.' : 'Fast geschafft: Bitte bestätige jetzt den Link in deiner E-Mail.') }
      if (mode === 'forgot') { await onRequestPasswordReset(email); setNotice('Falls ein Konto existiert, wurde ein Link zum Zurücksetzen versendet.') }
      if (mode === 'reset') { if (password !== passwordConfirm) throw new Error('Die Passwörter stimmen nicht überein.'); await onResetPassword(resetToken, password); setNotice('Dein Passwort wurde geändert. Du kannst dich jetzt anmelden.'); setMode('signin'); setPassword(''); setPasswordConfirm('') }
    } catch (submitError) { setError(submitError.message || 'Die Anfrage konnte nicht verarbeitet werden.') } finally { setSubmitting(false) }
  }
  const title = ({ register: 'Konto erstellen', forgot: 'Passwort vergessen', reset: 'Neues Passwort', signin: 'Anmelden' })[mode]
  return <div className="composer-backdrop"><section className="journal-composer auth-dialog" role="dialog" aria-modal="true" aria-label="BoulderO Konto"><div className="composer-header"><div><span className="eyebrow">BoulderO Konto</span><h2>{title}</h2></div><button className="icon-button ui-icon-button" onClick={onClose} aria-label="Schließen"><IconX size={19} /></button></div>{!resetToken && <div className="auth-tabs"><button className={mode === 'signin' ? 'is-active' : ''} onClick={() => switchMode('signin')}>Anmelden</button><button disabled={!configuration?.registrationEnabled} className={mode === 'register' ? 'is-active' : ''} onClick={() => switchMode('register')}>Registrieren</button></div>}<form className="admin-login" onSubmit={submit}>{mode === 'register' && <><label className="form-field"><span>Name</span><input required value={name} onChange={(event) => setName(event.target.value)} /></label><label className="form-field"><span>Dein @Name</span><span className={`username-input username-input--${usernameStatus}`}><b>@</b><input required value={username} minLength="3" maxLength="24" autoCapitalize="none" autoCorrect="off" spellCheck="false" onChange={(event) => setUsername(event.target.value.replace(/^@+/, '').toLowerCase())} placeholder="kerstin" aria-describedby="username-help" />{usernameStatus === 'available' && <IconCheck size={18} aria-label="@Name ist verfügbar" />}</span><small id="username-help" className={`username-help username-help--${usernameStatus}`}>{usernameStatus === 'available' ? '@Name ist verfügbar' : usernameStatus === 'checking' ? '@Name wird geprüft …' : usernameStatus === 'taken' ? '@Name ist bereits vergeben' : usernameStatus === 'invalid' ? '3–24 Zeichen: Kleinbuchstaben, Zahlen oder _' : 'So finden dich andere in BoulderO.'}</small></label></>}{mode !== 'reset' && <label className="form-field"><span>E-Mail</span><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>}{mode !== 'forgot' && <label className="form-field"><span>{mode === 'reset' ? 'Neues Passwort' : 'Passwort'}</span><span className="password-input"><input required type={passwordVisible ? 'text' : 'password'} minLength="10" value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" onClick={() => setPasswordVisible((value) => !value)} aria-label={passwordVisible ? 'Passwort verbergen' : 'Passwort anzeigen'}><IconEye size={18} /></button></span></label>}{mode === 'reset' && <label className="form-field"><span>Passwort wiederholen</span><input required type="password" minLength="10" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} /></label>}{error && <p className="form-error">{error}</p>}{notice && <p className="form-notice">{notice}</p>}<button className="visit-button" disabled={submitting || (mode === 'register' && usernameStatus !== 'available')}>{submitting ? 'Wird geprüft …' : mode === 'register' ? 'Bestätigungs-E-Mail senden' : mode === 'forgot' ? 'Reset-Link senden' : mode === 'reset' ? 'Passwort speichern' : 'Anmelden'}</button></form>{mode === 'signin' && <div className="auth-links"><button type="button" className="text-back" onClick={() => switchMode('forgot')}>Passwort vergessen?</button><button type="button" className="text-back" onClick={async () => { try { await onResendVerification(email); setNotice('Falls dein Konto noch nicht bestätigt ist, wurde eine neue E-Mail gesendet.') } catch { setError('Die Bestätigungs-E-Mail konnte nicht gesendet werden.') } }}>Bestätigung erneut senden</button></div>}{mode === 'register' && !configuration?.registrationEnabled && <p className="form-error">Die E-Mail-Registrierung wird gerade eingerichtet.</p>}{mode === 'signin' && configuration?.demoEnabled && <div className="demo-account-list">{configuration.demoProfiles.map((profile) => <button key={profile.id} onClick={() => onDemoSignIn(profile.id)}><span className="person-avatar">{profile.name.split(' ').map((part) => part[0]).join('')}</span><span><b>{profile.name}</b><small>@{profile.username}</small></span><IconChevronRight size={18} /></button>)}</div>}<p className="auth-note"><IconLock size={15} />Passwörter werden sicher gespeichert. Neue Konten werden per E-Mail bestätigt.</p><div className="legal-links"><button type="button" onClick={onOpenPrivacy}>Datenschutz</button><button type="button" onClick={onOpenImprint}>Impressum</button></div></section></div>
}

function PasswordDialog({ onClose, onSave }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState('')
  async function submit(event) { event.preventDefault(); setError(''); try { if (password !== passwordConfirm) throw new Error('Die Passwörter stimmen nicht überein.'); await onSave(currentPassword, password) } catch (submitError) { setError(submitError.message || 'Passwort konnte nicht geändert werden.') } }
  return <div className="composer-backdrop"><section className="journal-composer auth-dialog" role="dialog" aria-modal="true"><div className="composer-header"><div><span className="eyebrow">BoulderO Konto</span><h2>Passwort ändern</h2></div><button className="icon-button ui-icon-button" onClick={onClose} aria-label="Schließen"><IconX size={19} /></button></div><form className="admin-login" onSubmit={submit}><label className="form-field"><span>Aktuelles Passwort</span><input required type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label><label className="form-field"><span>Neues Passwort</span><input required type="password" minLength="10" value={password} onChange={(event) => setPassword(event.target.value)} /></label><label className="form-field"><span>Passwort wiederholen</span><input required type="password" minLength="10" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} /></label>{error && <p className="form-error">{error}</p>}<button className="visit-button">Passwort ändern</button></form></section></div>
}


export {
  AdminSpotsView, BadgesView, FeedView, FriendsView, JournalComposer, JournalEntryDialog,
  JournalView, LegalDialog, Lightbox, MapView, MessageDialog, PasswordDialog, PlannedVisitDialog,
  ProfileView, RankBadge, SignInDialog, SpotCorrectionDialog, SpotSuggestionDialog, optimizePhoto,
}
