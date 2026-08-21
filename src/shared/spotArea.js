export function formatSpotArea(value, fallback = 'Keine Angabe') {
  const area = String(value ?? '').trim()
  return area && area !== '0' ? area : fallback
}

export function spotAreaSquareMeters(value) {
  const area = String(value ?? '').trim()
  if (!/(?:m²|m2|qm|quadratmeter)/iu.test(area)) return null

  const match = area.match(/\d[\d.,\s]*/u)
  if (!match) return null

  // Angaben aus den Hallen-Websites sind in der Regel ganze Quadratmeter.
  // Punkte, Kommas und Leerzeichen können dabei Tausendertrennzeichen sein.
  const squareMeters = Number(match[0].replace(/[^\d]/gu, ''))
  return Number.isFinite(squareMeters) ? squareMeters : null
}
