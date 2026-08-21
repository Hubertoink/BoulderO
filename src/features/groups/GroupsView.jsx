import { useEffect, useRef, useState } from 'react'
import {
  IconBell, IconCalendarEvent, IconCheck, IconChevronLeft, IconChevronRight, IconClock,
  IconDots, IconLock, IconMapPin, IconMessageCircle, IconPlus, IconSearch, IconTrash,
  IconUserCheck, IconUserPlus, IconUsers, IconWorld, IconX,
} from '@tabler/icons-react'
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

async function api(path, options = {}) {
  const response = await fetch(path, options)
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.error ?? 'Die Anfrage konnte nicht verarbeitet werden.')
  }
  return response.status === 204 ? null : response.json()
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
  function toggleSpot(id) {
    setSpotIds((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 5 ? [...current, id] : current)
  }
  return <div className="composer-backdrop"><section className="journal-composer group-editor" role="dialog" aria-modal="true" aria-label={group ? 'Gruppe bearbeiten' : 'Gruppe erstellen'}><div className="composer-header"><div><span className="eyebrow">BoulderO Gruppen</span><h2>{group ? 'Gruppe bearbeiten' : 'Neue Gruppe'}</h2></div><button type="button" className="icon-button ui-icon-button" onClick={onClose} aria-label="Schließen"><IconX size={19} /></button></div><form onSubmit={submit}><label className="form-field"><span>Name *</span><input required value={name} maxLength="80" onChange={(event) => setName(event.target.value)} placeholder="Zum Beispiel Mannheim Afterwork" /></label><label className="form-field"><span>Beschreibung</span><textarea value={description} maxLength="2000" onChange={(event) => setDescription(event.target.value)} placeholder="Wen sucht ihr, wann trefft ihr euch und was macht eure Gruppe aus?" /></label><label className="form-field"><span>Stadt oder Region</span><input value={city} maxLength="120" onChange={(event) => setCity(event.target.value)} placeholder="Mannheim" /></label><fieldset className="visibility-picker"><legend>Zugang</legend><div role="radiogroup" aria-label="Zugang zur Gruppe">{Object.entries(accessCopy).map(([value, [label, detail]]) => <button key={value} type="button" role="radio" aria-checked={accessMode === value} className={accessMode === value ? 'is-selected' : ''} onClick={() => setAccessMode(value)}>{value === 'open' ? <IconWorld size={20} /> : value === 'request' ? <IconUsers size={20} /> : <IconLock size={20} />}<span>{label}</span><small>{detail}</small></button>)}</div></fieldset><fieldset className="group-spot-picker"><legend>Bevorzugte Hallen <small>bis zu 5</small></legend><div>{spots.map((spot) => <label key={spot.id}><input type="checkbox" checked={spotIds.includes(spot.id)} disabled={!spotIds.includes(spot.id) && spotIds.length >= 5} onChange={() => toggleSpot(spot.id)} /><span>{spot.name}<small>{spot.district}</small></span></label>)}</div></fieldset><div className="group-image-picker"><span><b>Gruppenbild</b><small>{image ? image.name : group?.image_url ? 'Bild ändern' : 'optional'}</small></span><button type="button" className="message-button" onClick={() => imageInput.current?.click()}>Bild wählen</button><input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setImage(event.target.files?.[0] ?? null)} /></div>{error && <p className="form-error">{error}</p>}<button className="visit-button" disabled={saving}>{saving ? 'Wird gespeichert …' : group ? 'Änderungen speichern' : 'Gruppe erstellen'}</button></form></section></div>
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
  return <div className="composer-backdrop"><section className="journal-composer" role="dialog" aria-modal="true" aria-label={event ? 'Gruppentermin bearbeiten' : 'Gruppentermin erstellen'}><div className="composer-header"><div><span className="eyebrow">Gruppentermine</span><h2>{event ? 'Termin bearbeiten' : 'Neuer Termin'}</h2></div><button type="button" className="icon-button ui-icon-button" onClick={onClose} aria-label="Schließen"><IconX size={19} /></button></div><form onSubmit={submit}><label className="form-field"><span>Halle</span><select required value={spotId} onChange={(eventInput) => setSpotId(eventInput.target.value)}>{spots.map((spot) => <option key={spot.id} value={spot.id}>{spot.name} · {spot.district}</option>)}</select></label><div className="admin-form-grid"><label className="form-field"><span>Datum</span><input required type="date" value={date} onChange={(eventInput) => setDate(eventInput.target.value)} /></label><label className="form-field"><span>Beginn</span><input required type="time" value={time} onChange={(eventInput) => setTime(eventInput.target.value)} /></label></div><label className="form-field"><span>Ende <small>optional</small></span><input type="time" value={endTime} onChange={(eventInput) => setEndTime(eventInput.target.value)} /></label><label className="form-field"><span>Teilnehmerlimit <small>optional</small></span><input type="number" min="1" max="500" value={capacity} onChange={(eventInput) => setCapacity(eventInput.target.value)} /></label><label className="form-field"><span>Notiz</span><textarea value={note} maxLength="2000" onChange={(eventInput) => setNote(eventInput.target.value)} placeholder="Was steht an?" /></label>{!event && <label className="notification-switch"><span><b>Wiederkehrender Termin</b><small>Erstellt die nächsten Termine einer Serie</small></span><input type="checkbox" checked={recurring} onChange={(eventInput) => setRecurring(eventInput.target.checked)} /><i /></label>}{recurring && !event && <div className="admin-form-grid"><label className="form-field"><span>Rhythmus</span><select value={frequency} onChange={(eventInput) => setFrequency(eventInput.target.value)}><option value="weekly">Wöchentlich</option><option value="biweekly">Alle zwei Wochen</option><option value="monthly">Monatlich</option></select></label><label className="form-field"><span>Bis</span><input type="date" value={repeatUntil} onChange={(eventInput) => setRepeatUntil(eventInput.target.value)} /></label></div>}{error && <p className="form-error">{error}</p>}<button className="visit-button" disabled={saving || !spotId}>{saving ? 'Wird gespeichert …' : event ? 'Termin speichern' : 'Termin erstellen'}</button></form></section></div>
}

function GroupPollDialog({ groupId, spots, onClose, onSaved }) {
  const [kind, setKind] = useState('spot')
  const [question, setQuestion] = useState('Wo sollen wir als Nächstes bouldern?')
  const [closesAt, setClosesAt] = useState('')
  const [options, setOptions] = useState([{ label: '', spotId: spots[0]?.id ?? '', startsAt: '' }, { label: '', spotId: spots[1]?.id ?? spots[0]?.id ?? '', startsAt: '' }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
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
  return <div className="composer-backdrop"><section className="journal-composer group-poll-editor" role="dialog" aria-modal="true" aria-label="Abstimmung erstellen"><div className="composer-header"><div><span className="eyebrow">Gruppenabstimmung</span><h2>Neue Abstimmung</h2></div><button type="button" className="icon-button ui-icon-button" onClick={onClose} aria-label="Schließen"><IconX size={19} /></button></div><form onSubmit={submit}><label className="form-field"><span>Art</span><select value={kind} onChange={(event) => { const next = event.target.value; setKind(next); setQuestion(next === 'spot' ? 'Wo sollen wir als Nächstes bouldern?' : next === 'date' ? 'Wann passt der nächste Termin?' : '') }}><option value="spot">Boulderhalle</option><option value="date">Datum und Uhrzeit</option><option value="general">Allgemein</option></select></label><label className="form-field"><span>Frage</span><input required value={question} maxLength="240" onChange={(event) => setQuestion(event.target.value)} /></label><label className="form-field"><span>Endet <small>optional</small></span><input type="datetime-local" value={closesAt} onChange={(event) => setClosesAt(event.target.value)} /></label><div className="group-poll-options">{options.map((option, index) => <div key={index}>{kind === 'spot' ? <select value={option.spotId} onChange={(event) => updateOption(index, { spotId: event.target.value })}>{spots.map((spot) => <option key={spot.id} value={spot.id}>{spot.name}</option>)}</select> : kind === 'date' ? <input required type="datetime-local" value={option.startsAt} onChange={(event) => updateOption(index, { startsAt: event.target.value, label: event.target.value })} /> : <input required value={option.label} maxLength="160" onChange={(event) => updateOption(index, { label: event.target.value })} placeholder={`Option ${index + 1}`} />}{options.length > 2 && <button type="button" onClick={() => setOptions((current) => current.filter((_, optionIndex) => optionIndex !== index))} aria-label="Option entfernen"><IconX size={16} /></button>}</div>)}</div>{options.length < 8 && <button type="button" className="text-back" onClick={() => setOptions((current) => [...current, { label: '', spotId: spots[0]?.id ?? '', startsAt: '' }])}><IconPlus size={16} />Option hinzufügen</button>}{error && <p className="form-error">{error}</p>}<button className="visit-button" disabled={saving}>{saving ? 'Wird erstellt …' : 'Abstimmung starten'}</button></form></section></div>
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

function GroupDetailView({ groupId, spots, onBack, onSummaryChange }) {
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
  async function approve(userId, approved) { try { await api(`/api/community/groups/${groupId}/members/${userId}/${approved ? 'approve' : 'decline'}`, { method: 'POST' }); await loadActive() } catch (memberError) { setError(memberError.message) } }
  async function invite() { if (!inviteUserId) return; try { await api(`/api/community/groups/${groupId}/invitations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: inviteUserId }) }); setInviteUserId(''); await loadActive() } catch (inviteError) { setError(inviteError.message) } }
  async function updateRole(userId, role) { try { await api(`/api/community/groups/${groupId}/members/${userId}/role`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) }); await loadActive() } catch (roleError) { setError(roleError.message) } }
  async function removeMember(userId) { try { await api(`/api/community/groups/${groupId}/members/${userId}`, { method: 'DELETE' }); await loadActive() } catch (memberError) { setError(memberError.message) } }
  async function changeNotification(level) { try { await api(`/api/community/groups/${groupId}/notifications`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level }) }); setGroup((current) => ({ ...current, notification_level: level })) } catch (notificationError) { setError(notificationError.message) } }
  if (loading && !group) return <main className="view content-view compact-view"><p className="journal-empty">Gruppe wird geladen …</p></main>
  if (!group) return <main className="view content-view compact-view"><p className="form-error">{error || 'Diese Gruppe ist nicht verfügbar.'}</p><button className="text-back" onClick={onBack}>Zurück zu Gruppen</button></main>
  const pendingMembers = members.filter((member) => member.status === 'requested')
  const activeMembers = members.filter((member) => member.status === 'active')
  return <main className="view content-view compact-view group-detail-view"><button className="text-back" onClick={onBack}><IconChevronLeft size={17} />Alle Gruppen</button><section className="group-hero"><GroupImage group={group} /><div><span className="eyebrow">{accessCopy[group.access_mode]?.[0]}</span><h1>{group.name}</h1><p>{group.city || 'BoulderO Gruppe'} · {group.member_count} Mitglied{group.member_count === 1 ? '' : 'er'}</p></div>{active && <select className="group-notification-select" value={group.notification_level ?? 'important'} onChange={(event) => void changeNotification(event.target.value)} aria-label="Gruppenbenachrichtigungen"><option value="all">Alle Hinweise</option><option value="important">Nur Wichtiges</option><option value="muted">Stumm</option></select>}</section>{error && <p className="form-error">{error}</p>}{!active ? <section className="group-public-card"><p>{group.description || 'Noch keine Beschreibung.'}</p>{group.spots?.length > 0 && <p><IconMapPin size={16} /> {group.spots.map((spot) => spot.name).join(' · ')}</p>}{group.membership_status === 'requested' ? <p className="form-notice">Deine Anfrage wartet auf Bestätigung.</p> : <button className="visit-button" disabled={saving} onClick={() => void join()}>{group.membership_status === 'invited' ? 'Einladung annehmen' : group.access_mode === 'open' ? 'Gruppe beitreten' : 'Beitritt anfragen'}</button>}</section> : <><div className="group-tabs" role="tablist"><button className={tab === 'overview' ? 'is-active' : ''} onClick={() => selectTab('overview')}>Übersicht</button><button className={tab === 'chat' ? 'is-active' : ''} onClick={() => selectTab('chat')}>Chat</button><button className={tab === 'events' ? 'is-active' : ''} onClick={() => selectTab('events')}>Termine</button><button className={tab === 'polls' ? 'is-active' : ''} onClick={() => selectTab('polls')}>Abstimmungen</button><button className={tab === 'members' ? 'is-active' : ''} onClick={() => selectTab('members')}>Mitglieder</button></div>{tab === 'overview' && <section className="group-overview"><div className="group-overview__description"><h2>Über diese Gruppe</h2><p>{group.description || 'Noch keine Beschreibung.'}</p>{group.spots?.length > 0 && <p className="group-base-spots"><IconMapPin size={16} />{group.spots.map((spot) => spot.name).join(' · ')}</p>}</div><section className="group-overview__panel"><div className="section-heading"><h2>Nächster Termin</h2><button type="button" onClick={() => selectTab('events')}>Alle Termine</button></div>{events[0] ? <GroupEventCard event={events[0]} groupId={groupId} onRefresh={loadActive} onEdit={setEventEditor} /> : <p className="journal-empty">Noch kein Termin geplant.</p>}</section><section className="group-overview__panel"><div className="section-heading"><h2>Aktuelle Abstimmung</h2><button type="button" onClick={() => selectTab('polls')}>Alle Abstimmungen</button></div>{polls.find((poll) => !poll.is_closed) ? <PollCard poll={polls.find((poll) => !poll.is_closed)} canManage={canManagePolls} onVote={vote} onClose={closePoll} /> : <p className="journal-empty">Keine offene Abstimmung.</p>}</section>{canManage && <div className="group-overview__actions"><button className="message-button" onClick={() => setEditorOpen(true)}>Gruppe verwalten</button><button className="message-button" onClick={() => setEventCreateOpen(true)}><IconCalendarEvent size={16} />Termin planen</button></div>}</section>}{tab === 'chat' && <section className="group-chat"><div className="section-heading"><div><h2>Gruppenchat</h2><span>Nur für Mitglieder</span></div></div><div className="message-list group-message-list">{messages.length ? messages.map((message) => <article className={`message${message.user_id === group.owner_id ? ' message--own' : ' message--received'}`} key={message.id}><span>{message.deleted_at ? 'Nachricht wurde entfernt.' : message.body}</span><small>{message.user_name} · {formatFeedDate(message.created_at)}</small></article>) : <p className="journal-empty">Schreibe die erste Nachricht.</p>}</div><form className="message-compose" onSubmit={sendMessage}><input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength="2000" placeholder="Nachricht an die Gruppe …" /><button disabled={saving}>Senden</button></form></section>}{tab === 'events' && <section className="group-events"><div className="section-heading"><div><h2>Termine</h2><span>{events.length}</span></div>{canManage && <button type="button" onClick={() => setEventCreateOpen(true)}><IconPlus size={16} />Termin planen</button>}</div>{events.length ? <div className="planned-visit-list">{events.map((event) => <GroupEventCard key={event.id} event={event} groupId={groupId} onRefresh={loadActive} onEdit={setEventEditor} />)}</div> : <p className="journal-empty">Noch keine Gruppentermine.</p>}</section>}{tab === 'polls' && <section className="group-polls"><div className="section-heading"><div><h2>Abstimmungen</h2><span>{polls.length}</span></div>{canManage && <button type="button" onClick={() => setPollOpen(true)}><IconPlus size={16} />Abstimmung</button>}</div>{polls.length ? polls.map((poll) => <PollCard key={poll.id} poll={poll} canManage={canManagePolls} onVote={vote} onClose={closePoll} />) : <p className="journal-empty">Noch keine Abstimmungen.</p>}</section>}{tab === 'members' && <section className="group-members"><div className="section-heading"><div><h2>Mitglieder</h2><span>{activeMembers.length}</span></div></div>{canManage && <div className="group-invite"><select value={inviteUserId} onChange={(event) => setInviteUserId(event.target.value)}><option value="">Freund:in einladen …</option>{friends.filter((friend) => !members.some((member) => member.user_id === friend.id && ['active', 'invited'].includes(member.status))).map((friend) => <option key={friend.id} value={friend.id}>{friend.name}</option>)}</select><button type="button" disabled={!inviteUserId} onClick={() => void invite()}><IconUserPlus size={16} />Einladen</button></div>}{pendingMembers.length > 0 && <section className="group-member-section"><h3>Anfragen</h3>{pendingMembers.map((member) => <article key={member.user_id}><MemberAvatar member={member} /><div><b>{member.name}</b><small>{member.request_note || 'Möchte der Gruppe beitreten'}</small></div><button className="message-button" onClick={() => void approve(member.user_id, false)}>Ablehnen</button><button onClick={() => void approve(member.user_id, true)}><IconCheck size={16} />Annehmen</button></article>)}</section>}<section className="group-member-section"><h3>Aktiv</h3>{activeMembers.map((member) => <article key={member.user_id}><MemberAvatar member={member} /><div><b>{member.name}</b><small>{member.role === 'owner' ? 'Eigentümer:in' : member.role === 'admin' ? 'Organisator:in' : 'Mitglied'}</small></div>{group.my_role === 'owner' && member.role !== 'owner' && <select value={member.role} onChange={(event) => void updateRole(member.user_id, event.target.value)}><option value="member">Mitglied</option><option value="admin">Organisator:in</option></select>}{canManage && member.role !== 'owner' && <button type="button" className="suggestion-dismiss" onClick={() => void removeMember(member.user_id)} aria-label={`${member.name} entfernen`}><IconTrash size={16} /></button>}</article>)}</section>{group.my_role !== 'owner' && <button className="text-back group-leave" disabled={saving} onClick={() => void leave()}>Gruppe verlassen</button>}</section>}</>}{editorOpen && <GroupEditorDialog group={group} spots={spots} onClose={() => setEditorOpen(false)} onSaved={async () => { setEditorOpen(false); await loadGroup(); await loadActive() }} />}{eventCreateOpen && <GroupEventDialog groupId={groupId} spots={spots} onClose={() => setEventCreateOpen(false)} onSaved={async () => { setEventCreateOpen(false); await loadActive() }} />}{eventEditor && <GroupEventDialog groupId={groupId} spots={spots} event={eventEditor} onClose={() => setEventEditor(null)} onSaved={async () => { setEventEditor(null); await loadActive() }} />}{pollOpen && <GroupPollDialog groupId={groupId} spots={spots} onClose={() => setPollOpen(false)} onSaved={async () => { setPollOpen(false); await loadActive() }} />}</main>
}

function MemberAvatar({ member }) { return <span className="person-avatar">{member.image ? <img src={`/api/avatars/${member.user_id}`} alt="" /> : groupInitials(member.name)}</span> }

function PollCard({ poll, canManage, onVote, onClose }) {
  const total = poll.options.reduce((sum, option) => sum + Number(option.vote_count), 0)
  return <article className={`group-poll${poll.is_closed ? ' is-closed' : ''}`}><div className="group-poll__heading"><div><span className="eyebrow">{poll.kind === 'spot' ? 'Hallenabstimmung' : poll.kind === 'date' ? 'Terminabstimmung' : 'Abstimmung'}</span><h3>{poll.question}</h3><small>{poll.is_closed ? 'Beendet' : poll.closes_at ? `Endet ${formatFeedDate(poll.closes_at)}` : 'Offen'}</small></div>{canManage && !poll.is_closed && <button type="button" className="suggestion-dismiss" onClick={() => void onClose(poll.id)} title="Abstimmung beenden"><IconX size={16} /></button>}</div><div className="group-poll__options">{poll.options.map((option) => <button type="button" key={option.id} disabled={poll.is_closed} className={option.voted_by_me ? 'is-selected' : ''} onClick={() => void onVote(poll.id, option.id)}><span>{option.label}</span><b>{option.vote_count}</b><i><em style={{ width: `${total ? option.vote_count / total * 100 : 0}%` }} /></i></button>)}</div></article>
}

export function GroupsView({ spots, onOpenFriends, onSummaryChange }) {
  const initialGroupId = new URLSearchParams(window.location.search).get('group')
  const [selectedGroupId, setSelectedGroupId] = useState(initialGroupId)
  const [tab, setTab] = useState('mine')
  const [groups, setGroups] = useState([])
  const [discover, setDiscover] = useState([])
  const [invitations, setInvitations] = useState([])
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  async function load() {
    try {
      const [myGroups, discovered, pending, summary] = await Promise.all([api('/api/community/groups'), api(`/api/community/groups/discover?q=${encodeURIComponent(query)}`), api('/api/community/groups/invitations'), api('/api/social/friends/summary')])
      setGroups(myGroups.groups); setDiscover(discovered.groups); setInvitations(pending.invitations); onSummaryChange(summary)
    } catch (loadError) { setError(loadError.message) }
  }
  useEffect(() => { void load() }, [])
  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timer) }, [query])
  function openGroup(id, nextTab = 'overview') { setSelectedGroupId(id); window.history.replaceState(window.history.state, '', `/groups?group=${encodeURIComponent(id)}&tab=${nextTab}`) }
  function backToGroups() { setSelectedGroupId(null); window.history.replaceState(window.history.state, '', '/groups'); void load() }
  if (selectedGroupId) return <GroupDetailView groupId={selectedGroupId} spots={spots} onBack={backToGroups} onSummaryChange={onSummaryChange} />
  const display = tab === 'mine' ? groups : tab === 'discover' ? discover : invitations
  return <main className="view content-view compact-view social-view groups-view"><section className="social-section friends-section"><div className="section-heading"><h2>Community</h2><div className="friends-tabs"><button type="button" onClick={onOpenFriends}>Freunde</button><button className="is-active">Gruppen</button></div></div><div className="groups-toolbar"><div className="friends-tabs"><button className={tab === 'mine' ? 'is-active' : ''} onClick={() => setTab('mine')}>Meine</button><button className={tab === 'discover' ? 'is-active' : ''} onClick={() => setTab('discover')}>Entdecken</button><button className={`${tab === 'invites' ? 'is-active ' : ''}has-badge`} onClick={() => setTab('invites')}>Einladungen{invitations.length > 0 && <b>{invitations.length}</b>}</button></div><button type="button" onClick={() => setCreating(true)}><IconPlus size={16} />Gruppe erstellen</button></div>{error && <p className="form-error">{error}</p>}{tab === 'discover' && <label className="search-field group-search"><IconSearch size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Gruppen, Ort oder Beschreibung suchen" />{query && <button type="button" onClick={() => setQuery('')} aria-label="Suche löschen"><IconX size={16} /></button>}</label>}<div className="group-list">{!display.length && <p className="journal-empty">{tab === 'mine' ? 'Du bist noch in keiner Gruppe. Erstelle eine Gruppe oder entdecke Communities in deiner Nähe.' : tab === 'invites' ? 'Keine offenen Gruppeneinladungen.' : 'Keine passenden Gruppen gefunden.'}</p>}{display.map((group) => <article key={group.id}><button type="button" className="group-list__main" onClick={() => openGroup(group.id)}><GroupImage group={group} /><span><b>{group.name}</b><small>{group.city || 'BoulderO Gruppe'} · {group.member_count} Mitglied{group.member_count === 1 ? '' : 'er'}</small><em>{group.description || accessCopy[group.access_mode]?.[1]}</em>{group.next_event?.starts_at && <i><IconCalendarEvent size={14} />{formatPlanDate(group.next_event.starts_at)} · {group.next_event.spot_name}</i>}</span><IconChevronRight size={18} /></button>{tab === 'mine' && group.unread_messages > 0 && <b className="group-list__badge">{group.unread_messages > 9 ? '9+' : group.unread_messages}</b>}{tab === 'invites' && <button type="button" onClick={() => openGroup(group.id)}>Einladung ansehen</button>}</article>)}</div></section>{creating && <GroupEditorDialog spots={spots} onClose={() => setCreating(false)} onSaved={async (id) => { setCreating(false); await load(); openGroup(id) }} />}</main>
}
