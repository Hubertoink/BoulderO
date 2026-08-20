import { useEffect, useMemo, useRef, useState } from 'react'
import { IconAdjustmentsHorizontal, IconArrowsMaximize, IconBookmark, IconCalendarEvent, IconCheck, IconChevronLeft, IconChevronRight, IconCompass, IconClock, IconCurrentLocation, IconDownload, IconDots, IconEye, IconFlag, IconLock, IconMapPin, IconMedal, IconMessageCircle, IconLogin2, IconLogout, IconPhoto, IconPlus, IconSearch, IconSparkles, IconTrophy, IconTrash, IconUserCircle, IconUserCheck, IconUserPlus, IconUsers, IconWorld, IconX } from '@tabler/icons-react'
import { formatJournalDate, formatPlanDate } from '../../shared/viewHelpers.js'

export async function optimizePhoto(file) {
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

export function VisibilityPicker({ value, onChange }) {
  return <fieldset className="visibility-picker"><legend>Teilen mit</legend><div role="radiogroup" aria-label="Sichtbarkeit des Eintrags">{visibilityOptions.map(({ value: optionValue, label, description, icon: Icon }) => <button key={optionValue} type="button" role="radio" aria-checked={value === optionValue} className={value === optionValue ? 'is-selected' : ''} onClick={() => onChange(optionValue)}><Icon size={20} /><span>{label}</span><small>{description}</small></button>)}</div></fieldset>
}

export function JournalComposer({ spot, onClose, onSave, onChooseOnMap, surface, plannedVisit }) {
  const plannedDate = plannedVisit ? new Date(plannedVisit.starts_at) : null
  const [visitedAt, setVisitedAt] = useState(plannedDate ? plannedDate.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10))
  const [timesOpen, setTimesOpen] = useState(false)
  const [startedAt, setStartedAt] = useState(plannedDate ? plannedDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }) : '')
  const [endedAt, setEndedAt] = useState(plannedVisit?.ends_at ? new Date(plannedVisit.ends_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }) : '')
  const [body, setBody] = useState('')
  const [visibility, setVisibility] = useState('followers')
  const [files, setFiles] = useState([])
  const fileInput = useRef(null)
  const viewportReveal = useRef(null)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  function clearViewportReveal() {
    if (!viewportReveal.current) return
    window.visualViewport?.removeEventListener('resize', viewportReveal.current)
    viewportReveal.current = null
  }

  useEffect(() => clearViewportReveal, [])

  async function submit(event) {
    event.preventDefault()
    setIsSaving(true)
    setError('')
    try {
      if (!spot) throw new Error('Wähle zuerst eine Halle auf der Karte aus.')
      await onSave({ spotId: spot.id, visitedAt, startedAt, endedAt, body, files: files.map((item) => item.file), visibility, plannedVisitId: plannedVisit?.is_owner ? plannedVisit.id : null })
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

  function revealExperienceField(event) {
    clearViewportReveal()
    if (surface !== 'map') return
    const field = event.currentTarget
    const scrollField = () => {
      if (field.isConnected) field.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
    }
    const revealAfterKeyboardResize = () => {
      viewportReveal.current = null
      scrollField()
    }
    if (window.visualViewport) {
      viewportReveal.current = revealAfterKeyboardResize
      window.visualViewport.addEventListener('resize', revealAfterKeyboardResize, { once: true })
    }
    window.requestAnimationFrame(scrollField)
  }

  return (
    <div className={`composer-backdrop ${surface === 'map' ? 'composer-backdrop--map' : ''}`} role="presentation">
      <form className={`journal-composer journal-composer--entry ${surface === 'map' ? 'journal-composer--map' : ''}`} onSubmit={submit}>
        <div className="composer-header"><div><span className="eyebrow">{plannedVisit ? 'Geplanter Besuch' : 'Tagebucheintrag'}</span><h2>Besuch festhalten</h2></div><button type="button" className="icon-button ui-icon-button" onClick={onClose} aria-label="Schließen"><IconX size={19} /></button></div>
        <div className="form-field"><span>Halle</span>{spot ? <div className="chosen-spot"><IconMapPin size={18} /><span><b>{spot.name}</b><small>{spot.district} · {spot.address}</small></span><button type="button" onClick={onChooseOnMap}>Ändern</button></div> : <button type="button" className="choose-spot" onClick={onChooseOnMap}><IconMapPin size={18} />Halle auf Karte auswählen</button>}</div>
        <label className="form-field"><span>Datum</span><input type="date" value={visitedAt} onChange={(event) => setVisitedAt(event.target.value)} required /></label>
        <section className="visit-time-picker"><button type="button" className={timesOpen ? 'is-open' : ''} onClick={() => setTimesOpen((value) => !value)}><IconClock size={18} /><span>Uhrzeit hinzufügen <small>optional</small></span><IconChevronRight size={17} /></button>{timesOpen && <div className="visit-time-picker__fields"><label className="form-field"><span>Von</span><input type="time" value={startedAt} onChange={(event) => setStartedAt(event.target.value)} /></label><label className="form-field"><span>Bis</span><input type="time" value={endedAt} onChange={(event) => setEndedAt(event.target.value)} /></label></div>}</section>
        <label className="form-field"><span>Erfahrungsbericht</span><textarea value={body} onChange={(event) => setBody(event.target.value)} onFocus={revealExperienceField} onBlur={clearViewportReveal} maxLength="4000" placeholder="Wie war deine Session? Was möchtest du später noch wissen?" /></label>
        <div className="photo-field"><div className="photo-selection">{files.map((item, index) => <figure key={item.preview}><img src={item.preview} alt={`Ausgewähltes Foto ${index + 1}`} /><button type="button" onClick={() => removePhoto(index)} aria-label={`Foto ${index + 1} entfernen`}><IconX size={15} /></button></figure>)}</div><label className="photo-picker"><IconPhoto size={19} /><span>{files.length ? `${files.length} Foto${files.length > 1 ? 's' : ''} ausgewählt` : 'Fotos hinzufügen'}</span><input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple onChange={addPhotos} /></label>{files.length > 0 && files.length < 6 && <button type="button" className="add-photo" onClick={() => fileInput.current?.click()}><IconPlus size={16} />Weiteres Foto</button>}</div>
        <VisibilityPicker value={visibility} onChange={setVisibility} />
        {error && <p className="form-error">{error}</p>}
        <button className="visit-button" disabled={isSaving || !spot}>{isSaving ? 'Wird gespeichert …' : visibility === 'private' ? 'Privaten Eintrag speichern' : 'Eintrag speichern'}</button>
      </form>
    </div>
  )
}

export function PlannedVisitDialog({ spot, onSave, onClose, surface = 'dialog' }) {
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
