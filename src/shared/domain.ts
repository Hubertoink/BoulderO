export interface SpotSearchRecord {
  name: string
  district?: string | null
  address?: string | null
  distance?: string | null
}

export type Coordinates = [latitude: number, longitude: number]

export interface InitialSpot extends SpotSearchRecord {
  id: string
  position: Coordinates
  open: string
  size: string
  visits: number
}
