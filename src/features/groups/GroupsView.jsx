import { useEffect, useRef, useState } from 'react'
import {
  IconBell, IconCalendarEvent, IconCheck, IconChevronDown, IconChevronLeft, IconChevronRight, IconClock,
  IconDots, IconLock, IconMapPin, IconMedal, IconMessageCircle, IconPlus, IconSearch, IconTrash,
  IconPhoto, IconUserCheck, IconUserPlus, IconUsers, IconWorld, IconX,
} from '@tabler/icons-react'
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet'
import { markerIcon } from '../map/MapView.jsx'
import { mannheimCenter } from '../../data/spots'
import { formatFeedDate, formatPlanDate, useOutsideDismiss } from '../../shared/viewHelpers.ts'
import { optimizePhoto } from '../journal/JournalComposer.jsx'

const accessCopy = {
  open: ['Offen', 'Sofort beitreten'],
  request: ['Auf Anfrage', 'Beitritt wird bestätigt'],
  private: ['Privat', 'Nur per Einladung'],
}

function groupInitials(name) {
  return String(name ?? 'G').split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
}

function GroupImage({ group, className = '' }) {
  return <span className={`group-image ${className}`}>{group.image_url ? <img src={group.image_url} alt="" /> : groupInitials(group.name)}</span>
}

function groupCoverStyle(group) {
  return group.image_url ? { '--group-cover': `url(${group.image_url})` } : undefined
}

function groupSpotPosition(spot) {
  const position = spot.position ?? [Number(spot.latitude), Number(spot.longitude)]
  return Number.isFinite(Number(position[0])) && Number.isFinite(Number(position[1])) ? position : null
}

function GroupSpotMapFocus({ spot }) {
  const map = useMap()
  useEffect(() => {
    const position = spot ? groupSpotPosition(spot) : null
    if (position) map.flyTo(position, Math.max(map.getZoom(), 11), { duration: 0.35 })
  }, [map, spot])
  return null
}

async function api(path, options = {}) {
  const response = await fetch(path, options)
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.error ?? 'Die Anfrage konnte nicht verarbeitet werden.')
  }
  return response.status === 204 ? null : response.json()
}

function GroupNotificationMenu({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const menuRef = useOutsideDismiss(open, () => setOpen(false))
  const options = [
    ['all', 'Alle Hinweise', 'Chat, Termine und wichtige Gruppenaktivitäten'],
    ['important', 'Nur Wichtiges', 'Einladungen, Änderungen und wichtige Termine'],
    ['muted', 'Stumm', 'Keine Hinweise aus dieser Gruppe'],
  ]
  const active = options.find(([level]) => level === value) ?? options[1]
  return <div className="group-notification-menu" ref={menuRef}>
    <button type="button" className="ui-icon-button" aria-label={`Gruppenbenachrichtigungen: ${active[1]}`} title={`Benachrichtigungen: ${active[1]}`} aria-expanded={open} onClick={() => setOpen((current) => !current)}><IconBell size={19} /></button>
    {open && <div className="group-notification-menu__popover"><span className="eyebrow">Benachrichtigungen</span>{options.map(([level, label, detail]) => <button key={level} type="button" className={value === level ? 'is-active' : ''} onClick={() => { void onChange(level); setOpen(false) }}><IconBell size={16} /><span><b>{label}</b><small>{detail}</small></span>{value === level && <IconCheck size={16} />}</button>)}</div>}
  </div>
}

function GroupAdminProfile({ group, onOpenUserFeed }) {
  const [open, setOpen] = useState(false)
  const menuRef = useOutsideDismiss(open, () => setOpen(false))
  if (!group.owner_name) return null
  const owner = { id: group.owner_id, name: group.owner_name, username: group.owner_username, image: group.owner_image }
  return <div className="group-admin-profile" ref={menuRef}>
    <span className="group-admin-profile__label">Organisiert von</span>
    <button type="button" className="group-admin-profile__toggle" onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-label={`${owner.name}, Gruppenadmin anzeigen`} title="Gruppenadmin anzeigen">
      <span className="person-avatar">{owner.image ? <img src={`/api/avatars/${owner.id}`} alt="" /> : groupInitials(owner.name)}</span>
    </button>
    {open && <div className="spot-visitors__popover group-admin-profile__popover"><button type="button" onClick={() => { setOpen(false); onOpenUserFeed?.(owner) }}><span className="person-avatar">{owner.image ? <img src={`/api/avatars/${owner.id}`} alt="" /> : groupInitials(owner.name)}</span><span><b>{owner.name}</b><small>@{owner.username || 'bouldero'} · Gruppenadmin</small></span><IconChevronRight size={16} /></button></div>}
  </div>
}

function GroupSpotMapPicker({ spots, selectedIds, maxSelection = 5, title = 'Auf Karte auswählen', onApply, onClose }) {
  const [draftIds, setDraftIds] = useState(selectedIds)
  const [search, setSearch] = useState('')
  const [focusSpotId, setFocusSpotId] = useState(null)
  const normalizedSearch = search.trim().toLocaleLowerCase('de-DE')
  const selectableSpots = spots.filter((spot) => groupSpotPosition(spot) && (!normalizedSearch || `${spot.name} ${spot.district}`.toLocaleLowerCase('de-DE').includes(normalizedSearch)))
  const searchResults = normalizedSearch ? selectableSpots.slice(0, 8) : []
  const selectedSpots = spots.filter((spot) => draftIds.includes(spot.id))
  const initialCenter = groupSpotPosition(selectedSpots[0] ?? {}) ?? mannheimCenter
  function toggleSpot(id) {
    setDraftIds((current) => {
      if (maxSelection === 1) return current[0] === id ? current : [id]
      return current.includes(id)
        ? current.filter((item) => item !== id)
        : current.length < maxSelection ? [...current, id] : current
    })
  }
  return <div className="composer-backdrop group-spot-map-backdrop" role="presentation">
    <section className="group-spot-map-dialog" role="dialog" aria-modal="true" aria-label="Hallen auf der Karte auswählen">
      <div className="composer-header"><div><span className="eyebrow">Hallenpicker</span><h2>{title}</h2></div><button type="button" className="icon-button ui-icon-button" onClick={onClose} aria-label="Karte schließen"><IconX size={19} /></button></div>
      <p className="group-spot-map-help"><IconMapPin size={17} /><span>Tippe auf einen Marker, um {maxSelection === 1 ? 'eine Halle' : 'Hallen'} auszuwählen.</span><b>{draftIds.length}/{maxSelection}</b></p>
      <label className="group-spot-map-search"><IconSearch size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Halle oder Ort suchen" />{search && <button type="button" onClick={() => setSearch('')} aria-label="Hallensuche löschen"><IconX size={15} /></button>}</label>
      {searchResults.length > 0 && <div className="group-spot-map-search-results">{searchResults.map((spot) => <button type="button" key={spot.id} onClick={() => { setFocusSpotId(spot.id); setDraftIds((current) => maxSelection === 1 ? [spot.id] : current.includes(spot.id) ? current : current.length < maxSelection ? [...current, spot.id] : current) }}><span><b>{spot.name}</b><small>{spot.district}</small></span><IconChevronRight size={16} /></button>)}</div>}
      <div className="group-spot-map-canvas">
        <MapContainer center={initialCenter} zoom={selectedSpots.length ? 11 : 7} scrollWheelZoom className="group-spot-map-leaflet">
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <GroupSpotMapFocus spot={spots.find((spot) => spot.id === focusSpotId)} />
          {selectableSpots.map((spot) => <Marker key={spot.id} position={groupSpotPosition(spot)} icon={markerIcon(false, draftIds.includes(spot.id))} eventHandlers={{ click: () => toggleSpot(spot.id) }} />)}
        </MapContainer>
      </div>
      <div className="group-spot-map-selection">{selectedSpots.length ? selectedSpots.map((spot) => <button key={spot.id} type="button" onClick={() => toggleSpot(spot.id)}><IconMapPin size={14} /><span>{spot.name}</span><IconX size={14} /></button>) : <span>Noch keine Halle ausgewählt.</span>}</div>
      <div className="group-spot-map-actions"><button type="button" className="text-back" onClick={onClose}>Abbrechen</button><button type="button" className="visit-button" onClick={() => { onApply(draftIds); onClose() }} disabled={!draftIds.length}>{maxSelection === 1 ? 'Halle hinzufügen' : 'Hallen hinzufügen'}{draftIds.length > 0 ? ` · ${draftIds.length}` : ''}</button></div>
    </section>
  </div>
}

function GroupEditorDialog({ group = null, spots, onClose, onSaved }) {
  const [name, setName] = useState(group?.name ?? '')
  const [description, setDescription] = useState(group?.description ?? '')
  const [city, setCity] = useState(group?.city ?? '')
  const [accessMode, setAccessMode] = useState(group?.access_mode ?? 'request')
  const [spotIds, setSpotIds] = useState(group?.spots?.map((spot) => spot.id) ?? [])
  const [image, setImage] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [spotMapOpen, setSpotMapOpen] = useState(false)
  const imageInput = useRef(null)
  async function submit(event) {
    event.preventDefault(); setSaving(true); setError('')
    try {
      const payload = { name, description, city, accessMode, spotIds }
      const result = group
        ? await api(`/api/community/groups/${group.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await api('/api/community/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const groupId = group?.id ?? result.group.id
      if (image) {
        const data = new FormData()
        data.append('image', await optimizePhoto(image))
        await api(`/api/community/groups/${groupId}/image`, { method: 'POST', body: data })
      }
      await onSaved(groupId)
    } catch (saveError) { setError(saveError.message || 'Die Gruppe konnte nicht gespeichert werden.') } finally { setSaving(false) }
  }
  const selectedSpots = spots.filter((spot) => spotIds.includes(spot.id))
  return <div className="composer-backdrop"><section className="journal-composer group-editor" role="dialog" aria-modal="true" aria-label={group ? 'Gruppe bearbeiten' : 'Gruppe erstellen'}><div className="composer-header"><div><span className="eyebrow">BoulderO Gruppen</span><h2>{group ? 'Gruppe bearbeiten' : 'Neue Gruppe'}</h2></div><button type="button" className="icon-button ui-icon-button" onClick={onClose} aria-label="Schließen"><IconX size={19} /></button></div><form onSubmit={submit}><label className="form-field"><span>Name *</span><input required value={name} maxLength="80" onChange={(event) => setName(event.target.value)} placeholder="Zum Beispiel Mannheim Afterwork" /></label><label className="form-field"><span>Beschreibung</span><textarea value={description} maxLength="2000" onChange={(event) => setDescription(event.target.value)} placeholder="Wen sucht ihr, wann trefft ihr euch und was macht eure Gruppe aus?" /></label><label className="form-field"><span>Stadt oder Region</span><input value={city} maxLength="120" onChange={(event) => setCity(event.target.value)} placeholder="Mannheim" /></label><fieldset className="visibility-picker"><legend>Zugang</legend><div role="radiogroup" aria-label="Zugang zur Gruppe">{Object.entries(accessCopy).map(([value, [label, detail]]) => <button key={value} type="button" role="radio" aria-checked={accessMode === value} className={accessMode === value ? 'is-selected' : ''} onClick={() => setAccessMode(value)}>{value === 'open' ? <IconWorld size={20} /> : value === 'request' ? <IconUsers size={20} /> : <IconLock size={20} />}<span>{label}</span><small>{detail}</small></button>)}</div></fieldset><section className="group-spot-picker"><div className="group-spot-picker__heading"><span>Bevorzugte Hallen <small>bis zu 5</small></span><button type="button" className="message-button" onClick={() => setSpotMapOpen(true)}><IconMapPin size={16} />Auf Karte wählen</button></div>{selectedSpots.length ? <div className="group-spot-picker__selection">{selectedSpots.map((spot) => <span key={spot.id}><IconMapPin size={14} />{spot.name}</span>)}</div> : <button type="button" className="group-spot-picker__empty" onClick={() => setSpotMapOpen(true)}><IconMapPin size={18} />Hallen auf Karte auswählen</button>}</section><div className="photo-field group-image-picker"><label className="photo-picker"><IconPhoto size={19} /><span>{image ? image.name : group?.image_url ? 'Gruppenbild ändern' : 'Gruppenbild hinzufügen'}</span><input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setImage(event.target.files?.[0] ?? null)} /></label><small>{image ? 'Wird nach dem Speichern verwendet.' : group?.image_url ? 'Vorhandenes Bild bleibt erhalten.' : 'Optional'}</small></div>{error && <p className="form-error">{error}</p>}<button className="visit-button" disabled={saving}>{saving ? 'Wird gespeichert …' : group ? 'Änderungen speichern' : 'Gruppe erstellen'}</button></form></section>{spotMapOpen && <GroupSpotMapPicker spots={spots} selectedIds={spotIds} onApply={setSpotIds} onClose={() => setSpotMapOpen(false)} />}</div>
}

function GroupEventDialog({ groupId, spots, event = null, onClose, onSaved }) {
  const start = event ? new Date(event.starts_at) : new Date(Date.now() + 24 * 60 * 60 * 1000)
  const [spotId, setSpotId] = useState(event?.spot_id ?? spots[0]?.id ?? '')
  const [date, setDate] = useState(start.toISOString().slice(0, 10))
  const [time, setTime] = useState(start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }))
  const [endTime, setEndTime] = useState(event?.ends_at ? new Date(event.ends_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }) : '')
  const [note, setNote] = useState(event?.note ?? '')
  const [capacity, setCapacity] = useState(event?.capacity ? String(event.capacity) : '')
  const [recurring, setRecurring] = useState(false)
  const [frequency, setFrequency] = useState('weekly')
  const [repeatUntil, setRepeatUntil] = useState(() => new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [spotMapOpen, setSpotMapOpen] = useState(false)
  const [error, setError] = useState('')
  async function submit(eventSubmit) {
    eventSubmit.preventDefault(); setSaving(true); setError('')
    try {
      const payload = {
        spotId,
        startsAt: new Date(`${date}T${time}:00`).toISOString(),
        endsAt: endTime ? new Date(`${date}T${endTime}:00`).toISOString() : null,
        note,
        capacity: capacity ? Number(capacity) : null,
        ...(recurring && !event ? { recurrence: { frequency, repeatUntil } } : {}),
      }
      await api(`/api/community/groups/${groupId}/events${event ? `/${event.id}` : ''}`, { method: event ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      await onSaved()
    } catch (saveError) { setError(saveError.message || 'Der Termin konnte nicht gespeichert werden.') } finally { setSaving(false) }
  }
  return <div className="composer-backdrop"><section className="journal-composer" role="dialog" aria-modal="true" aria-label={event ? 'Gruppentermin bearbeiten' : 'Gruppentermin erstellen'}><div className="composer-header"><div><span className="eyebrow">Gruppentermine</span><h2>{event ? 'Termin bearbeiten' : 'Neuer Termin'}</h2></div><button type="button" className="icon-button ui-icon-button" onClick={onClose} aria-label="Schließen"><IconX size={19} /></button></div><form onSubmit={submit}><div className="form-field group-event-spot-field"><span>Halle</span><button type="button" className="message-button group-poll-spot-picker group-event-spot-picker" onClick={() => setSpotMapOpen(true)}><IconMapPin size={16} /><span>{spots.find((spot) => spot.id === spotId)?.name ?? "Halle auf Karte wählen"}</span><IconChevronRight size={16} /></button></div><div className="admin-form-grid"><label className="form-field"><span>Datum</span><input required type="date" value={date} onChange={(eventInput) => setDate(eventInput.target.value)} /></label><label className="form-field"><span>Beginn</span><input required type="time" value={time} onChange={(eventInput) => setTime(eventInput.target.value)} /></label></div><label className="form-field"><span>Ende <small>optional</small></span><input type="time" value={endTime} onChange={(eventInput) => setEndTime(eventInput.target.value)} /></label><label className="form-field"><span>Teilnehmerlimit <small>optional</small></span><input type="number" min="1" max="500" value={capacity} onChange={(eventInput) => setCapacity(eventInput.target.value)} /></label><label className="form-field"><span>Notiz</span><textarea value={note} maxLength="2000" onChange={(eventInput) => setNote(eventInput.target.value)} placeholder="Was steht an?" /></label>{!event && <label className="notification-switch"><span><b>Wiederkehrender Termin</b><small>Erstellt die nächsten Termine einer Serie</small></span><input type="checkbox" checked={recurring} onChange={(eventInput) => setRecurring(eventInput.target.checked)} /><i /></label>}{recurring && !event && <div className="admin-form-grid"><label className="form-field"><span>Rhythmus</span><select value={frequency} onChange={(eventInput) => setFrequency(eventInput.target.value)}><option value="weekly">Wöchentlich</option><option value="biweekly">Alle zwei Wochen</option><option value="monthly">Monatlich</option></select></label><label className="form-field"><span>Bis</span><input type="date" value={repeatUntil} onChange={(eventInput) => setRepeatUntil(eventInput.target.value)} /></label></div>}{error && <p className="form-error">{error}</p>}<button className="visit-button" disabled={saving || !spotId}>{saving ? 'Wird gespeichert …' : event ? 'Termin speichern' : 'Termin erstellen'}</button></form></section>{spotMapOpen && <GroupSpotMapPicker spots={spots} selectedIds={spotId ? [spotId] : []} maxSelection={1} title="Halle für Termin wählen" onApply={(selectedIds) => setSpotId(selectedIds[0] ?? "")} onClose={() => setSpotMapOpen(false)} />}</div>
}

function GroupPollDialog({ groupId, spots, onClose, onSaved }) {
  const [kind, setKind] = useState('spot')
  const [question, setQuestion] = useState('Wo sollen wir als Nächstes bouldern?')
  const [closesAt, setClosesAt] = useState('')
  const [options, setOptions] = useState([{ label: '', spotId: spots[0]?.id ?? '', startsAt: '' }, { label: '', spotId: spots[1]?.id ?? spots[0]?.id ?? '', startsAt: '' }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [spotPickerIndex, setSpotPickerIndex] = useState(null)
  function updateOption(index, patch) { setOptions((current) => current.map((option, optionIndex) => optionIndex === index ? { ...option, ...patch } : option)) }
  async function submit(event) {
    event.preventDefault(); setSaving(true); setError('')
    try {
      const prepared = options.map((option) => ({
        label: kind === 'spot' ? spots.find((spot) => spot.id === option.spotId)?.name ?? option.label : option.label,
        spotId: kind === 'spot' ? option.spotId : null,
        startsAt: kind === 'date' && option.startsAt ? new Date(option.startsAt).toISOString() : null,
      }))
      await api(`/api/community/groups/${groupId}/polls`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, kind, closesAt: closesAt ? new Date(closesAt).toISOString() : null, options: prepared }) })
      await onSaved()
    } catch (saveError) { setError(saveError.message || 'Die Abstimmung konnte nicht erstellt werden.') } finally { setSaving(false) }
  }
  return <div className="composer-backdrop"><section className="journal-composer group-poll-editor" role="dialog" aria-modal="true" aria-label="Abstimmung erstellen"><div className="composer-header"><div><span className="eyebrow">Gruppenabstimmung</span><h2>Neue Abstimmung</h2></div><button type="button" className="icon-button ui-icon-button" onClick={onClose} aria-label="Schließen"><IconX size={19} /></button></div><form onSubmit={submit}><label className="form-field"><span>Art</span><select value={kind} onChange={(event) => { const next = event.target.value; setKind(next); setSpotPickerIndex(null); setQuestion(next === 'spot' ? 'Wo sollen wir als Nächstes bouldern?' : next === 'date' ? 'Wann passt der nächste Termin?' : '') }}><option value="spot">Boulderhalle</option><option value="date">Datum und Uhrzeit</option><option value="general">Allgemein</option></select></label><label className="form-field"><span>Frage</span><input required value={question} maxLength="240" onChange={(event) => setQuestion(event.target.value)} /></label><label className="form-field"><span>Endet <small>optional</small></span><input type="datetime-local" value={closesAt} onChange={(event) => setClosesAt(event.target.value)} /></label><div className="group-poll-options">{options.map((option, index) => <div className="group-poll-option-row" key={index}><span className="group-poll-option-label">Option {index + 1}</span>{kind === 'spot' ? <button type="button" className="message-button group-poll-spot-picker" onClick={() => setSpotPickerIndex(index)}><IconMapPin size={16} /><span>{spots.find((spot) => spot.id === option.spotId)?.name ?? 'Halle auf Karte wählen'}</span><IconChevronRight size={16} /></button> : kind === 'date' ? <input required type="datetime-local" value={option.startsAt} onChange={(event) => updateOption(index, { startsAt: event.target.value, label: event.target.value })} /> : <input required value={option.label} maxLength="160" onChange={(event) => updateOption(index, { label: event.target.value })} placeholder={`Option ${index + 1}`} />}{options.length > 2 && <button type="button" onClick={() => setOptions((current) => current.filter((_, optionIndex) => optionIndex !== index))} aria-label="Option entfernen"><IconX size={16} /></button>}</div>)}</div>{options.length < 8 && <button type="button" className="text-back" onClick={() => setOptions((current) => [...current, { label: '', spotId: spots[0]?.id ?? '', startsAt: '' }])}><IconPlus size={16} />Option hinzufügen</button>}{error && <p className="form-error">{error}</p>}<button className="visit-button" disabled={saving || (kind === 'spot' && options.some((option) => !option.spotId))}>{saving ? 'Wird erstellt …' : 'Abstimmung starten'}</button></form></section>{spotPickerIndex !== null && <GroupSpotMapPicker spots={spots} selectedIds={options[spotPickerIndex]?.spotId ? [options[spotPickerIndex].spotId] : []} maxSelection={1} title={`Halle für Option ${spotPickerIndex + 1} wählen`} onApply={(selectedIds) => updateOption(spotPickerIndex, { spotId: selectedIds[0] ?? '' })} onClose={() => setSpotPickerIndex(null)} />}</div>
}

function GroupEventCard({ event, groupId, onRefresh, onEdit }) {
  const [people, setPeople] = useState([])
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const peopleRef = useOutsideDismiss(peopleOpen, () => setPeopleOpen(false))
  const menuRef = useOutsideDismiss(menuOpen, () => setMenuOpen(false))
  async function togglePeople() {
    if (!peopleOpen) setPeople((await api(`/api/community/groups/${groupId}/events/${event.id}/rsvps`)).rsvps)
    setPeopleOpen((current) => !current)
  }
  async function respond(response) {
    if (event.my_response === response || (response === null && event.my_response)) await api(`/api/community/groups/${groupId}/events/${event.id}/rsvp`, { method: 'DELETE' })
    else await api(`/api/community/groups/${groupId}/events/${event.id}/rsvp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response }) })
    await onRefresh()
  }
  async function cancel() { await api(`/api/community/groups/${groupId}/events/${event.id}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }); await onRefresh() }
  return <article className="group-event-card"><div className="planned-visit-card__top"><span className="eyebrow">{event.group_event_series_id ? 'Terminserie' : 'Gruppentermin'}</span><time>{formatPlanDate(event.starts_at)}</time></div><div className="planned-visit-author"><span className="person-avatar">{event.user_image ? <img src={`/api/avatars/${event.user_id}`} alt="" /> : groupInitials(event.user_name)}</span><span><b>{event.user_name}</b><small>organisiert diesen Termin</small></span>{event.can_manage && <div className="plan-card-menu" ref={menuRef}><button type="button" className="friend-more-button" onClick={() => setMenuOpen((current) => !current)} aria-label="Termin verwalten"><IconDots size={18} /></button>{menuOpen && <div className="friend-more-menu__popover"><button type="button" onClick={() => { setMenuOpen(false); onEdit(event) }}>Bearbeiten</button><button type="button" className="danger" onClick={() => { setMenuOpen(false); void cancel() }}>Absagen</button></div>}</div>}</div><h3>{event.spot_name}</h3><p>{event.district} · {event.address}</p>{event.note && <p className="planned-visit-card__note">{event.note}</p>}<div className="planned-visit-card__footer"><div className="planned-people" ref={peopleRef}><button type="button" onClick={() => void togglePeople()}><IconUsers size={16} />{event.going_count} dabei{event.capacity ? ` / ${event.capacity}` : ''}{event.waitlisted_count > 0 ? ` · ${event.waitlisted_count} Warteliste` : ''}</button>{peopleOpen && <div className="planned-people__popover">{people.length ? people.map((person) => <div key={person.id}><span className="person-avatar">{person.image ? <img src={`/api/avatars/${person.id}`} alt="" /> : groupInitials(person.name)}</span><span><b>{person.name}</b><small>{person.response === 'going' ? 'Dabei' : person.response === 'waitlisted' ? 'Warteliste' : 'Vielleicht'}</small></span></div>) : <small>Noch keine Antworten.</small>}</div>}</div><div className="planned-rsvp-actions"><button className={event.my_response === 'interested' ? 'is-active' : ''} onClick={() => void respond('interested')}>Vielleicht</button><button className={event.my_response === 'going' ? 'is-active' : ''} onClick={() => void respond('going')}>{event.my_response === 'waitlisted' ? 'Warteliste' : event.my_response === 'going' ? 'Dabei' : 'Zusagen'}</button></div></div></article>
}

function GroupEventAttendees({ event, groupId }) {
  const [people, setPeople] = useState([])
  const [open, setOpen] = useState(false)
  const peopleRef = useOutsideDismiss(open, () => setOpen(false))
  async function toggle() {
    if (!open) setPeople((await api(`/api/community/groups/${groupId}/events/${event.id}/rsvps`)).rsvps)
    setOpen((current) => !current)
  }
  return <div className="planned-people" ref={peopleRef}><button type="button" onClick={() => void toggle()}><IconUsers size={16} />{event.going_count} dabei{event.capacity ? ` / ${event.capacity}` : ''}{event.waitlisted_count > 0 ? ` · ${event.waitlisted_count} Warteliste` : ''}</button>{open && <div className="planned-people__popover">{people.length ? people.map((person) => <div key={person.id}><span className="person-avatar">{person.image ? <img src={`/api/avatars/${person.id}`} alt="" /> : groupInitials(person.name)}</span><span><b>{person.name}</b><small>{person.response === 'going' ? 'Dabei' : person.response === 'waitlisted' ? 'Warteliste' : 'Vielleicht'}</small></span></div>) : <small>Noch keine Antworten.</small>}</div>}</div>
}

function GroupEventResponses({ event, groupId, onRefresh }) {
  async function respond(response) {
    if (event.my_response === response || (response === null && event.my_response)) await api(`/api/community/groups/${groupId}/events/${event.id}/rsvp`, { method: 'DELETE' })
    else await api(`/api/community/groups/${groupId}/events/${event.id}/rsvp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response }) })
    await onRefresh()
  }
  return <div className="planned-rsvp-actions"><button className={event.my_response === 'interested' ? 'is-active' : ''} onClick={() => void respond('interested')}>Vielleicht</button><button className={event.my_response === 'going' ? 'is-active' : ''} onClick={() => void respond('going')}>{event.my_response === 'waitlisted' ? 'Warteliste' : event.my_response === 'going' ? 'Dabei' : 'Zusagen'}</button></div>
}

function GroupEventOccurrence({ event, groupId, onRefresh, onEdit }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useOutsideDismiss(menuOpen, () => setMenuOpen(false))
  async function cancel() {
    await api(`/api/community/groups/${groupId}/events/${event.id}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
    await onRefresh()
  }
  return <article className="group-event-series__occurrence"><time>{formatPlanDate(event.starts_at)}</time><div className="group-event-series__occurrence-actions"><GroupEventAttendees event={event} groupId={groupId} /><GroupEventResponses event={event} groupId={groupId} onRefresh={onRefresh} />{event.can_manage && <div className="plan-card-menu" ref={menuRef}><button type="button" className="friend-more-button" onClick={() => setMenuOpen((current) => !current)} aria-label="Termin verwalten"><IconDots size={18} /></button>{menuOpen && <div className="friend-more-menu__popover"><button type="button" onClick={() => { setMenuOpen(false); onEdit(event) }}>Termin bearbeiten</button><button type="button" className="danger" onClick={() => { setMenuOpen(false); void cancel() }}>Termin löschen</button></div>}</div>}</div></article>
}

function GroupEventSeriesCard({ events, groupId, onRefresh, onEdit }) {
  const [expanded, setExpanded] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useOutsideDismiss(menuOpen, () => setMenuOpen(false))
  const event = events[0]
  const canManage = events.some((item) => item.can_manage)
  async function cancelSeries() {
    await api(`/api/community/groups/${groupId}/event-series/${event.group_event_series_id}/cancel`, { method: 'POST' })
    await onRefresh()
  }
  return <article className="group-event-card group-event-series"><div className="planned-visit-card__top"><span className="eyebrow">Terminserie</span><span className="group-event-series__count">{events.length} Termin{events.length === 1 ? '' : 'e'}</span></div><div className="planned-visit-author"><span className="person-avatar">{event.user_image ? <img src={`/api/avatars/${event.user_id}`} alt="" /> : groupInitials(event.user_name)}</span><span><b>{event.user_name}</b><small>organisiert diese Serie</small></span>{canManage && <div className="plan-card-menu" ref={menuRef}><button type="button" className="friend-more-button" onClick={() => setMenuOpen((current) => !current)} aria-label="Terminserie verwalten"><IconDots size={18} /></button>{menuOpen && <div className="friend-more-menu__popover"><button type="button" className="danger" onClick={() => { setMenuOpen(false); void cancelSeries() }}>Terminserie löschen</button></div>}</div>}</div><h3>{event.spot_name}</h3><p>{event.district} · {event.address}</p>{event.note && <p className="planned-visit-card__note">{event.note}</p>}<button type="button" className="group-event-series__toggle" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}><span>{expanded ? 'Termine ausblenden' : `Termine anzeigen · ${events.length}`}</span><IconChevronDown size={18} /></button><div className={`ui-collapse group-event-series__collapse${expanded ? ' is-open' : ''}`} aria-hidden={!expanded}><div className="ui-collapse__content"><div className="group-event-series__occurrences">{events.map((occurrence) => <GroupEventOccurrence key={occurrence.id} event={occurrence} groupId={groupId} onRefresh={onRefresh} onEdit={onEdit} />)}</div></div></div></article>
}

function GroupEventList({ events, groupId, onRefresh, onEdit }) {
  const items = []
  const series = new Map()
  for (const event of events) {
    if (!event.group_event_series_id) { items.push({ kind: 'single', event }); continue }
    const existing = series.get(event.group_event_series_id)
    if (existing) existing.events.push(event)
    else {
      const item = { kind: 'series', id: event.group_event_series_id, events: [event] }
      series.set(event.group_event_series_id, item)
      items.push(item)
    }
  }
  return <div className="planned-visit-list">{items.map((item) => item.kind === 'series' ? <GroupEventSeriesCard key={item.id} events={item.events} groupId={groupId} onRefresh={onRefresh} onEdit={onEdit} /> : <GroupEventCard key={item.event.id} event={item.event} groupId={groupId} onRefresh={onRefresh} onEdit={onEdit} />)}</div>
}

function GroupSpotList({ spots, onOpenSpot }) {
  if (!spots?.length) return null
  return <div className="group-base-spots">{spots.map((spot) => <div key={spot.id}><span><IconMapPin size={16} /><b>{spot.name}</b><small>{spot.district}</small></span><button type="button" className="ui-icon-button" onClick={() => onOpenSpot?.(spot.id)} aria-label={`${spot.name} auf der Karte öffnen`} title="Auf Karte anzeigen"><IconMapPin size={17} /></button></div>)}</div>
}

function GroupDetailView({ groupId, spots, onBack, onOpenSpot, onOpenUserFeed, onSummaryChange }) {
  const initialTab = new URLSearchParams(window.location.search).get('tab')
  const [tab, setTab] = useState(['overview', 'chat', 'events', 'polls', 'members'].includes(initialTab) ? initialTab : 'overview')
  const [group, setGroup] = useState(null)
  const [members, setMembers] = useState([])
  const [messages, setMessages] = useState([])
  const [events, setEvents] = useState([])
  const [polls, setPolls] = useState([])
  const [canManagePolls, setCanManagePolls] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [eventEditor, setEventEditor] = useState(null)
  const [eventCreateOpen, setEventCreateOpen] = useState(false)
  const [pollOpen, setPollOpen] = useState(false)
  const [inviteUserId, setInviteUserId] = useState('')
  const [friends, setFriends] = useState([])
  const [saving, setSaving] = useState(false)
  const active = group?.membership_status === 'active'
  const canManage = active && ['owner', 'admin'].includes(group?.my_role)
  async function loadGroup() {
    setLoading(true); setError('')
    try { const payload = await api(`/api/community/groups/${groupId}`); setGroup(payload.group) } catch (loadError) { setError(loadError.message) } finally { setLoading(false) }
  }
  async function loadActive() {
    if (!active) return
    try {
      const [memberPayload, eventPayload, pollPayload] = await Promise.all([
        api(`/api/community/groups/${groupId}/members`), api(`/api/community/groups/${groupId}/events`), api(`/api/community/groups/${groupId}/polls`),
      ])
      setMembers(memberPayload.members); setEvents(eventPayload.events); setPolls(pollPayload.polls); setCanManagePolls(pollPayload.canManage)
      if (canManage) { const friendsPayload = await api('/api/social/friends'); setFriends(friendsPayload.friends) }
      if (canManage && tab === 'members') await refreshSummary()
    } catch (loadError) { setError(loadError.message) }
  }
  async function loadMessages() {
    if (!active || tab !== 'chat') return
    try { setMessages((await api(`/api/community/groups/${groupId}/messages`)).messages); await refreshSummary() } catch (loadError) { setError(loadError.message) }
  }
  async function refreshSummary() { const summary = await api('/api/social/friends/summary'); onSummaryChange(summary) }
  useEffect(() => { void loadGroup() }, [groupId])
  useEffect(() => { void loadActive() }, [group?.membership_status])
  useEffect(() => { void loadMessages(); if (tab !== 'chat' || !active) return undefined; const interval = window.setInterval(() => void loadMessages(), 8000); return () => window.clearInterval(interval) }, [tab, active, groupId])
  function selectTab(next) { setTab(next); const params = new URLSearchParams({ group: groupId, tab: next }); window.history.replaceState(window.history.state, '', `/groups?${params}`) }
  async function join() { setSaving(true); try { await api(`/api/community/groups/${groupId}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }); await loadGroup(); await refreshSummary() } catch (joinError) { setError(joinError.message) } finally { setSaving(false) } }
  async function leave() { setSaving(true); try { await api(`/api/community/groups/${groupId}/leave`, { method: 'POST' }); onBack() } catch (leaveError) { setError(leaveError.message) } finally { setSaving(false) } }
  async function sendMessage(event) { event.preventDefault(); if (!draft.trim()) return; setSaving(true); try { await api(`/api/community/groups/${groupId}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: draft.trim() }) }); setDraft(''); await loadMessages() } catch (sendError) { setError(sendError.message) } finally { setSaving(false) } }
  async function vote(pollId, optionId) { try { await api(`/api/community/groups/${groupId}/polls/${pollId}/vote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ optionId }) }); await loadActive() } catch (voteError) { setError(voteError.message) } }
  async function closePoll(pollId) { try { await api(`/api/community/groups/${groupId}/polls/${pollId}/close`, { method: 'POST' }); await loadActive() } catch (closeError) { setError(closeError.message) } }
  async function approve(userId, approved) { try { await api(`/api/community/groups/${groupId}/members/${userId}/${approved ? 'approve' : 'decline'}`, { method: 'POST' }); await loadActive(); await refreshSummary() } catch (memberError) { setError(memberError.message) } }
  async function invite() { if (!inviteUserId) return; try { await api(`/api/community/groups/${groupId}/invitations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: inviteUserId }) }); setInviteUserId(''); await loadActive() } catch (inviteError) { setError(inviteError.message) } }
  async function updateRole(userId, role) { try { await api(`/api/community/groups/${groupId}/members/${userId}/role`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) }); await loadActive() } catch (roleError) { setError(roleError.message) } }
  async function removeMember(userId) { try { await api(`/api/community/groups/${groupId}/members/${userId}`, { method: 'DELETE' }); await loadActive() } catch (memberError) { setError(memberError.message) } }
  async function changeNotification(level) { try { await api(`/api/community/groups/${groupId}/notifications`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level }) }); setGroup((current) => ({ ...current, notification_level: level })) } catch (notificationError) { setError(notificationError.message) } }
  if (loading && !group) return <main className="view content-view compact-view"><p className="journal-empty">Gruppe wird geladen …</p></main>
  if (!group) return <main className="view content-view compact-view"><p className="form-error">{error || 'Diese Gruppe ist nicht verfügbar.'}</p><button className="text-back" onClick={onBack}>Zurück zu Gruppen</button></main>
  const pendingMembers = members.filter((member) => member.status === 'requested')
  const activeMembers = members.filter((member) => member.status === 'active')
  return <main className="view content-view compact-view group-detail-view"><button className="text-back" onClick={onBack}><IconChevronLeft size={17} />Alle Gruppen</button><section className={`group-hero${group.image_url ? ' has-image' : ''}`} style={groupCoverStyle(group)}><GroupImage group={group} /><div><span className="eyebrow">{accessCopy[group.access_mode]?.[0]}</span><h1>{group.name}</h1><p>{group.city || 'BoulderO Gruppe'} · {group.member_count} Mitglied{group.member_count === 1 ? '' : 'er'}</p></div><GroupAdminProfile group={group} onOpenUserFeed={onOpenUserFeed} />{active && <GroupNotificationMenu value={group.notification_level ?? 'important'} onChange={changeNotification} />}</section>{error && <p className="form-error">{error}</p>}{!active ? <section className="group-public-card"><p>{group.description || 'Noch keine Beschreibung.'}</p>{group.spots?.length > 0 && <GroupSpotList spots={group.spots} onOpenSpot={onOpenSpot} />}{group.membership_status === 'requested' ? <p className="form-notice">Deine Anfrage wartet auf Bestätigung.</p> : <button className="visit-button" disabled={saving} onClick={() => void join()}>{group.membership_status === 'invited' ? 'Einladung annehmen' : group.access_mode === 'open' ? 'Gruppe beitreten' : 'Beitritt anfragen'}</button>}</section> : <><div className="group-tabs" role="tablist"><button className={tab === 'overview' ? 'is-active' : ''} onClick={() => selectTab('overview')}>Übersicht</button><button className={tab === 'chat' ? 'is-active' : ''} onClick={() => selectTab('chat')}>Chat</button><button className={tab === 'events' ? 'is-active' : ''} onClick={() => selectTab('events')}>Termine</button><button className={tab === 'polls' ? 'is-active' : ''} onClick={() => selectTab('polls')}>Abstimmungen</button><button className={tab === 'members' ? 'is-active' : ''} onClick={() => selectTab('members')}>Mitglieder{pendingMembers.length > 0 && <b className="group-tab-badge">{pendingMembers.length > 9 ? '9+' : pendingMembers.length}</b>}</button></div>{tab === 'overview' && <section className="group-overview"><div className="group-overview__description"><h2>Über diese Gruppe</h2><p>{group.description || 'Noch keine Beschreibung.'}</p><GroupSpotList spots={group.spots} onOpenSpot={onOpenSpot} /></div><section className="group-overview__panel"><div className="section-heading"><h2>Nächster Termin</h2><button type="button" onClick={() => selectTab('events')}>Alle Termine</button></div>{events[0] ? <GroupEventCard event={events[0]} groupId={groupId} onRefresh={loadActive} onEdit={setEventEditor} /> : <p className="journal-empty">Noch kein Termin geplant.</p>}</section><section className="group-overview__panel"><div className="section-heading"><h2>Aktuelle Abstimmung</h2><button type="button" onClick={() => selectTab('polls')}>Alle Abstimmungen</button></div>{polls.find((poll) => !poll.is_closed) ? <PollCard poll={polls.find((poll) => !poll.is_closed)} canManage={canManagePolls} onVote={vote} onClose={closePoll} /> : <p className="journal-empty">Keine offene Abstimmung.</p>}</section>{canManage && <div className="group-overview__actions"><button type="button" className="journal-add" onClick={() => setEditorOpen(true)}>Gruppe verwalten</button><button type="button" className="journal-add" onClick={() => setEventCreateOpen(true)}><IconCalendarEvent size={16} />Termin planen</button></div>}</section>}{tab === 'chat' && <section className="group-chat"><div className="section-heading"><div><h2>Gruppenchat</h2><span>Nur für Mitglieder</span></div></div><div className="message-list group-message-list">{messages.length ? messages.map((message) => <article className={`message${message.user_id === group.owner_id ? ' message--own' : ' message--received'}`} key={message.id}><span>{message.deleted_at ? 'Nachricht wurde entfernt.' : message.body}</span><small>{message.user_name} · {formatFeedDate(message.created_at)}</small></article>) : <p className="journal-empty">Schreibe die erste Nachricht.</p>}</div><form className="message-compose" onSubmit={sendMessage}><input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength="2000" placeholder="Nachricht an die Gruppe …" /><button disabled={saving}>Senden</button></form></section>}{tab === 'events' && <section className="group-events"><div className="section-heading"><div><h2>Termine</h2><span>{events.length}</span></div>{canManage && <button type="button" onClick={() => setEventCreateOpen(true)}><IconPlus size={16} />Termin planen</button>}</div>{events.length ? <GroupEventList events={events} groupId={groupId} onRefresh={loadActive} onEdit={setEventEditor} /> : <p className="journal-empty">Noch keine Gruppentermine.</p>}</section>}{tab === 'polls' && <section className="group-polls"><div className="section-heading"><div><h2>Abstimmungen</h2><span>{polls.length}</span></div>{canManage && <button type="button" onClick={() => setPollOpen(true)}><IconPlus size={16} />Abstimmung</button>}</div>{polls.length ? polls.map((poll) => <PollCard key={poll.id} poll={poll} canManage={canManagePolls} onVote={vote} onClose={closePoll} />) : <p className="journal-empty">Noch keine Abstimmungen.</p>}</section>}{tab === 'members' && <section className="group-members"><div className="section-heading"><div><h2>Mitglieder</h2><span>{activeMembers.length}</span></div></div>{canManage && <div className="group-invite"><select value={inviteUserId} onChange={(event) => setInviteUserId(event.target.value)}><option value="">Freund:in einladen …</option>{friends.filter((friend) => !members.some((member) => member.user_id === friend.id && ['active', 'invited'].includes(member.status))).map((friend) => <option key={friend.id} value={friend.id}>{friend.name}</option>)}</select><button type="button" disabled={!inviteUserId} onClick={() => void invite()}><IconUserPlus size={16} />Einladen</button></div>}{pendingMembers.length > 0 && <section className="group-member-section"><h3>Anfragen</h3>{pendingMembers.map((member) => <article key={member.user_id}><MemberAvatar member={member} /><div><b>{member.name}</b><small>{member.request_note || 'Möchte der Gruppe beitreten'}</small></div><button className="message-button" onClick={() => void approve(member.user_id, false)}>Ablehnen</button><button onClick={() => void approve(member.user_id, true)}><IconCheck size={16} />Annehmen</button></article>)}</section>}<section className="group-member-section"><h3>Aktiv</h3>{activeMembers.map((member) => <article key={member.user_id}><MemberAvatar member={member} /><div><b>{member.name}</b><small>{member.role === 'owner' ? 'Eigentümer:in' : member.role === 'admin' ? 'Organisator:in' : 'Mitglied'}</small></div>{group.my_role === 'owner' && member.role !== 'owner' && <select value={member.role} onChange={(event) => void updateRole(member.user_id, event.target.value)}><option value="member">Mitglied</option><option value="admin">Organisator:in</option></select>}{canManage && member.role !== 'owner' && <button type="button" className="suggestion-dismiss" onClick={() => void removeMember(member.user_id)} aria-label={`${member.name} entfernen`}><IconTrash size={16} /></button>}</article>)}</section>{group.my_role !== 'owner' && <button className="text-back group-leave" disabled={saving} onClick={() => void leave()}>Gruppe verlassen</button>}</section>}</>}{editorOpen && <GroupEditorDialog group={group} spots={spots} onClose={() => setEditorOpen(false)} onSaved={async () => { setEditorOpen(false); await loadGroup(); await loadActive() }} />}{eventCreateOpen && <GroupEventDialog groupId={groupId} spots={spots} onClose={() => setEventCreateOpen(false)} onSaved={async () => { setEventCreateOpen(false); await loadActive() }} />}{eventEditor && <GroupEventDialog groupId={groupId} spots={spots} event={eventEditor} onClose={() => setEventEditor(null)} onSaved={async () => { setEventEditor(null); await loadActive() }} />}{pollOpen && <GroupPollDialog groupId={groupId} spots={spots} onClose={() => setPollOpen(false)} onSaved={async () => { setPollOpen(false); await loadActive() }} />}</main>
}

function MemberAvatar({ member }) {
  const count = Number(member.unique_spots ?? 0)
  const threshold = [50, 25, 10, 5, 1].find((item) => count >= item)
  return <span className="person-avatar social-avatar social-avatar--ranked group-member-avatar">{member.image ? <img src={`/api/avatars/${member.user_id}`} alt="" /> : groupInitials(member.name)}{threshold && <span className={`rank-badge rank-badge--${threshold}`} title={`${count} Hallen besucht`}><IconMedal size={12} /></span>}</span>
}

function PollCard({ poll, canManage, onVote, onClose }) {
  const total = poll.options.reduce((sum, option) => sum + Number(option.vote_count), 0)
  return <article className={`group-poll${poll.is_closed ? ' is-closed' : ''}`}><div className="group-poll__heading"><div><span className="eyebrow">{poll.kind === 'spot' ? 'Hallenabstimmung' : poll.kind === 'date' ? 'Terminabstimmung' : 'Abstimmung'}</span><h3>{poll.question}</h3><small>{poll.is_closed ? 'Beendet' : poll.closes_at ? `Endet ${formatFeedDate(poll.closes_at)}` : 'Offen'}</small></div>{canManage && !poll.is_closed && <button type="button" className="suggestion-dismiss" onClick={() => void onClose(poll.id)} title="Abstimmung beenden"><IconX size={16} /></button>}</div><div className="group-poll__options">{poll.options.map((option) => <button type="button" key={option.id} disabled={poll.is_closed} className={option.voted_by_me ? 'is-selected' : ''} onClick={() => void onVote(poll.id, option.id)}><span>{option.label}</span><b>{option.vote_count}</b><i><em style={{ width: `${total ? option.vote_count / total * 100 : 0}%` }} /></i></button>)}</div></article>
}

export function GroupsView({ spots, onOpenFriends, onOpenSpot, onOpenUserFeed, onSummaryChange }) {
  const initialGroupId = new URLSearchParams(window.location.search).get('group')
  const [selectedGroupId, setSelectedGroupId] = useState(initialGroupId)
  const [tab, setTab] = useState('mine')
  const [groups, setGroups] = useState([])
  const [discover, setDiscover] = useState([])
  const [invitations, setInvitations] = useState([])
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [summary, setSummary] = useState({ unread_groups: 0 })
  const [error, setError] = useState('')
  async function load() {
    try {
      const [myGroups, discovered, pending, summary] = await Promise.all([api('/api/community/groups'), api(`/api/community/groups/discover?q=${encodeURIComponent(query)}`), api('/api/community/groups/invitations'), api('/api/social/friends/summary')])
      setGroups(myGroups.groups); setDiscover(discovered.groups); setInvitations(pending.invitations); setSummary(summary); onSummaryChange(summary)
    } catch (loadError) { setError(loadError.message) }
  }
  useEffect(() => { void load() }, [])
  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timer) }, [query])
  function openGroup(id, nextTab = 'overview') { setSelectedGroupId(id); window.history.replaceState(window.history.state, '', `/groups?group=${encodeURIComponent(id)}&tab=${nextTab}`) }
  function backToGroups() { setSelectedGroupId(null); window.history.replaceState(window.history.state, '', '/groups'); void load() }
  if (selectedGroupId) return <GroupDetailView groupId={selectedGroupId} spots={spots} onBack={backToGroups} onOpenSpot={onOpenSpot} onOpenUserFeed={onOpenUserFeed} onSummaryChange={onSummaryChange} />
  const display = tab === 'mine' ? groups : tab === 'discover' ? discover : invitations
  return <main className="view content-view compact-view social-view groups-view"><section className="social-section friends-section"><div className="section-heading"><h2>Community</h2><div className="friends-tabs"><button type="button" onClick={onOpenFriends}>Freunde</button><button className="is-active">Gruppen{summary.unread_groups > 0 && <b>{summary.unread_groups > 9 ? '9+' : summary.unread_groups}</b>}</button></div></div><div className="groups-toolbar"><div className="friends-tabs"><button className={tab === 'mine' ? 'is-active' : ''} onClick={() => setTab('mine')}>Meine</button><button className={tab === 'discover' ? 'is-active' : ''} onClick={() => setTab('discover')}>Entdecken</button><button className={`${tab === 'invites' ? 'is-active ' : ''}has-badge`} onClick={() => setTab('invites')}>Einladungen{invitations.length > 0 && <b>{invitations.length}</b>}</button></div><button type="button" onClick={() => setCreating(true)}><IconPlus size={16} />Gruppe erstellen</button></div>{error && <p className="form-error">{error}</p>}{tab === 'discover' && <label className="search-field group-search"><IconSearch size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Gruppen, Ort oder Beschreibung suchen" />{query && <button type="button" onClick={() => setQuery('')} aria-label="Suche löschen"><IconX size={16} /></button>}</label>}<div className="group-list">{!display.length && <p className="journal-empty">{tab === 'mine' ? 'Du bist noch in keiner Gruppe. Erstelle eine Gruppe oder entdecke Communities in deiner Nähe.' : tab === 'invites' ? 'Keine offenen Gruppeneinladungen.' : 'Keine passenden Gruppen gefunden.'}</p>}{display.map((group) => <article key={group.id} className={group.image_url ? 'has-image' : ''} style={groupCoverStyle(group)}><button type="button" className="group-list__main" onClick={() => openGroup(group.id)}><span><b>{group.name}</b><small>{group.city || 'BoulderO Gruppe'} · {group.member_count} Mitglied{group.member_count === 1 ? '' : 'er'}</small><em>{group.description || accessCopy[group.access_mode]?.[1]}</em>{group.next_event?.starts_at && <i><IconCalendarEvent size={14} />{formatPlanDate(group.next_event.starts_at)} · {group.next_event.spot_name}</i>}</span><IconChevronRight size={18} /></button>{tab === 'mine' && Number(group.unread_messages ?? 0) + Number(group.pending_requests ?? 0) > 0 && <b className="group-list__badge">{Number(group.unread_messages ?? 0) + Number(group.pending_requests ?? 0) > 9 ? '9+' : Number(group.unread_messages ?? 0) + Number(group.pending_requests ?? 0)}</b>}{tab === 'invites' && <button type="button" onClick={() => openGroup(group.id)}>Einladung ansehen</button>}</article>)}</div></section>{creating && <GroupEditorDialog spots={spots} onClose={() => setCreating(false)} onSaved={async (id) => { setCreating(false); await load(); openGroup(id) }} />}</main>
}
