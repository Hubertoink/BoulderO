const weekdayLabels = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const weekdayIndex = new Map([
  ['mo', 0], ['montag', 0],
  ['di', 1], ['dienstag', 1],
  ['mi', 2], ['mittwoch', 2],
  ['do', 3], ['donnerstag', 3],
  ['fr', 4], ['freitag', 4],
  ['sa', 5], ['samstag', 5],
  ['so', 6], ['sonntag', 6],
])

function normalizedTimeRange(value) {
  const match = String(value ?? '')
    .replace(/\buhr\b/gi, '')
    .trim()
    .match(/^(\d{1,2})(?::(\d{2}))?\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?$/)
  if (!match) return null

  const [, startHour, startMinute = '00', endHour, endMinute = '00'] = match
  const values = [Number(startHour), Number(startMinute), Number(endHour), Number(endMinute)]
  if (values[0] > 24 || values[2] > 24 || values[1] > 59 || values[3] > 59) return null
  return `${startHour.padStart(2, '0')}:${startMinute}–${endHour.padStart(2, '0')}:${endMinute}`
}

function parseWeeklyOpeningHours(value) {
  const days = Array(7).fill(null)
  const entries = String(value ?? '').split(';').map((entry) => entry.trim()).filter(Boolean)
  if (!entries.length) return null

  for (const entry of entries) {
    const match = entry.match(/^([a-zäöü]+)\.?\s*:?\s*(.+)$/i)
    const day = weekdayIndex.get(match?.[1]?.toLocaleLowerCase('de-DE'))
    const hours = normalizedTimeRange(match?.[2])
    if (day === undefined || !hours || days[day]) return null
    days[day] = hours
  }
  return days.some(Boolean) ? days : null
}

export function formatOpeningHoursLines(value) {
  const source = String(value ?? '').trim()
  const days = parseWeeklyOpeningHours(source)
  if (!days) return [source || 'Öffnungszeiten folgen']

  const groups = []
  for (let start = 0; start < days.length; start += 1) {
    if (!days[start]) continue
    let end = start
    while (end + 1 < days.length && days[end + 1] === days[start]) end += 1
    groups.push(`${weekdayLabels[start]}${end > start ? `–${weekdayLabels[end]}` : ''} ${days[start]}`)
    start = end
  }
  return groups
}

export function formatOpeningHours(value) {
  return formatOpeningHoursLines(value).join(' · ')
}
