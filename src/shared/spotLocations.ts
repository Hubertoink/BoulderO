import type { Coordinates, InitialSpot } from './domain.ts'
import { spotSearchLocation } from './spotSearch'

interface LocationSpot extends Pick<InitialSpot, 'id' | 'name' | 'district' | 'address' | 'position'> {}

export interface SpotLocation {
  key: string
  name: string
  position: Coordinates
  spotIds: string[]
}

function normalizedLocation(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('de-DE')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function withoutPostalCode(value: unknown): string {
  return String(value ?? '').replace(/^\s*(?:[A-Z]{1,2}-)?\d{4,5}\s+/u, '').trim()
}

function addressLocation(address: unknown): string {
  const parts = String(address ?? '').split(',').map((part) => part.trim()).filter(Boolean)
  if (parts.length < 2) return ''
  const countries = /^(?:deutschland|germany|österreich|austria|schweiz|switzerland)$/iu
  const candidate = countries.test(parts.at(-1) ?? '') ? parts.at(-2) : parts.at(-1)
  const location = withoutPostalCode(candidate)
  return /\p{L}/u.test(location) ? location : ''
}

function namesForSpot(spot: LocationSpot): string[] {
  const names = [spotSearchLocation(spot), addressLocation(spot.address)].filter(Boolean)
  return names.filter((name, index) => names.findIndex((candidate) => normalizedLocation(candidate) === normalizedLocation(name)) === index)
}

export function buildSpotLocations(spots: LocationSpot[]): SpotLocation[] {
  const grouped = new Map<string, { name: string; spotIds: string[]; latitude: number; longitude: number; positions: number }>()

  for (const spot of spots) {
    const latitude = Number(spot.position?.[0])
    const longitude = Number(spot.position?.[1])
    for (const name of namesForSpot(spot)) {
      const key = normalizedLocation(name)
      if (!key) continue
      const location = grouped.get(key) ?? { name, spotIds: [], latitude: 0, longitude: 0, positions: 0 }
      if (!location.spotIds.includes(String(spot.id))) location.spotIds.push(String(spot.id))
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        location.latitude += latitude
        location.longitude += longitude
        location.positions += 1
      }
      grouped.set(key, location)
    }
  }

  return [...grouped.entries()].filter(([, location]) => location.positions > 0).map(([key, location]) => ({
    key,
    name: location.name,
    position: [location.latitude / location.positions, location.longitude / location.positions] as Coordinates,
    spotIds: location.spotIds,
  })).sort((first, second) => first.name.localeCompare(second.name, 'de-DE'))
}

export function matchingSpotLocations(locations: SpotLocation[], query: unknown): SpotLocation[] {
  const search = normalizedLocation(query)
  if (!search) return []
  return locations.filter((location) => normalizedLocation(location.name).includes(search)).sort((first, second) => {
    const firstName = normalizedLocation(first.name)
    const secondName = normalizedLocation(second.name)
    const firstRank = firstName === search ? 0 : firstName.startsWith(search) ? 1 : 2
    const secondRank = secondName === search ? 0 : secondName.startsWith(search) ? 1 : 2
    return firstRank - secondRank || first.name.localeCompare(second.name, 'de-DE')
  })
}
