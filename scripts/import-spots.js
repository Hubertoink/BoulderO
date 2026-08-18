import 'dotenv/config'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import { parse } from 'csv-parse/sync'
import { Pool } from 'pg'

const [filePath] = process.argv.slice(2)
if (!filePath) {
  throw new Error('Usage: node scripts/import-spots.js <csv-file>')
}

const file = await fs.readFile(filePath, 'utf8')
const rows = parse(file, { columns: true, skip_empty_lines: true, trim: true, bom: true })
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

function value(row, ...names) {
  return names.map((name) => row[name]).find((item) => item !== undefined && item !== '')?.trim() ?? null
}

function sourceId(row, name, latitude, longitude) {
  return value(row, 'source_external_id', 'id', 'external_id')
    ?? crypto.createHash('sha256').update(`${name}:${latitude}:${longitude}`).digest('hex').slice(0, 20)
}

let imported = 0
let rejected = 0
for (const row of rows) {
  const name = value(row, 'name', 'Name')
  const latitude = Number(value(row, 'latitude', 'lat', 'Latitude'))
  const longitude = Number(value(row, 'longitude', 'lng', 'lon', 'Longitude'))
  if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < 47 || latitude > 56 || longitude < 5 || longitude > 16) {
    rejected += 1
    continue
  }
  const externalId = sourceId(row, name, latitude, longitude)
  await pool.query(`
    INSERT INTO spots (name, district, address, website, opening_hours, area_sqm, coordinates, source, source_external_id, source_license)
    VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography, 'csv', $9, $10)
    ON CONFLICT (source, source_external_id) DO UPDATE SET
      name = EXCLUDED.name,
      district = EXCLUDED.district,
      address = EXCLUDED.address,
      website = EXCLUDED.website,
      opening_hours = EXCLUDED.opening_hours,
      area_sqm = EXCLUDED.area_sqm,
      coordinates = EXCLUDED.coordinates,
      source_license = EXCLUDED.source_license,
      updated_at = NOW()
  `, [
    name,
    value(row, 'district', 'Stadtteil', 'city', 'Ort') ?? 'Unbekannt',
    value(row, 'address', 'Adresse') ?? 'Adresse folgt',
    value(row, 'website', 'url', 'Website'),
    value(row, 'opening_hours', 'Öffnungszeiten'),
    Number(value(row, 'area_sqm', 'fläche_m2', 'Flaeche_m2')) || null,
    longitude,
    latitude,
    externalId,
    value(row, 'source_license', 'license', 'Lizenz'),
  ])
  imported += 1
}

await pool.end()
console.log(`Imported: ${imported}; rejected: ${rejected}`)
