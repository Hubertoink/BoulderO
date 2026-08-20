function normalizedText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('de-DE')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function matchesSpotSearch(spot, query) {
  const terms = normalizedText(query).split(' ').filter(Boolean)
  if (!terms.length) return true
  const searchable = normalizedText([spot.name, spot.district, spot.address].join(' '))
  return terms.every((term) => searchable.includes(term))
}

export function spotSearchRank(spot, query) {
  const terms = normalizedText(query).split(' ').filter(Boolean)
  if (!terms.length) return 0
  const matchesAll = (value) => {
    const searchable = normalizedText(value)
    return terms.every((term) => searchable.includes(term))
  }
  if (matchesAll(spot.name)) return 0
  if (matchesAll(spot.district)) return 1
  return 2
}

export function spotSearchLocation(spot) {
  return String(spot.district ?? '').replace(/^\s*\d{5}\s+/, '').trim()
}

export function spotSearchMeta(spot) {
  return [spotSearchLocation(spot), spot.distance].filter(Boolean).join(' · ')
}
