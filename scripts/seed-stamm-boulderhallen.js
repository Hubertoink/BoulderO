import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'csv-parse/sync'
import { Pool } from 'pg'

const directory = path.dirname(fileURLToPath(import.meta.url))
const sourcePath = process.argv[2] ?? path.resolve(directory, '../data/StammBoulderhallen.csv')
const sourceLicense = 'BoulderO StammBoulderhallen – eigene Datensammlung'
const sourceName = 'stamm-boulderhallen'

const file = await fs.readFile(sourcePath, 'utf8')
const rows = parse(file, { columns: true, skip_empty_lines: true, trim: true, bom: true })
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

function text(row, name) {
  return row[name]?.trim() || null
}

function number(row, name) {
  const value = Number(text(row, name))
  return Number.isFinite(value) ? value : null
}

function record(row, index) {
  const spot = {
    sourceExternalId: text(row, 'source_external_id'),
    name: text(row, 'name'),
    district: text(row, 'district'),
    address: text(row, 'address'),
    website: text(row, 'website'),
    openingHours: text(row, 'opening_hours'),
    areaSqm: number(row, 'area_sqm'),
    latitude: number(row, 'latitude'),
    longitude: number(row, 'longitude'),
  }
  if (!spot.sourceExternalId || !spot.name || !spot.district || !spot.address || spot.latitude === null || spot.longitude === null) {
    throw new Error(`Ungültige Stammdaten in CSV-Zeile ${index + 2}.`)
  }
  if (spot.latitude < -90 || spot.latitude > 90 || spot.longitude < -180 || spot.longitude > 180) {
    throw new Error(`Koordinate außerhalb des gültigen Bereichs in CSV-Zeile ${index + 2}.`)
  }
  return spot
}

const client = await pool.connect()
let reconciled = 0
try {
  await client.query('BEGIN')
  for (const [index, row] of rows.entries()) {
    const spot = record(row, index)

    // Ein vor dem Seed manuell angelegter Eintrag wird anhand von Name und
    // räumlicher Nähe übernommen. Damit bleibt seine UUID (und damit Besuche,
    // Bilder und Verknüpfungen) erhalten, statt eine Halle doppelt anzulegen.
    const existing = await client.query(`
      SELECT id FROM spots
       WHERE source <> $1
         AND status = 'active'
         AND lower(name) = lower($2)
         AND ST_DWithin(
           coordinates,
           ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography,
           300
         )
       LIMIT 1
    `, [sourceName, spot.name, spot.latitude, spot.longitude])
    if (existing.rowCount) {
      await client.query(
        `UPDATE spots SET source = $2, source_external_id = $3, source_license = $4, updated_at = NOW() WHERE id = $1`,
        [existing.rows[0].id, sourceName, spot.sourceExternalId, sourceLicense],
      )
      reconciled += 1
    }

    await client.query(`
      INSERT INTO spots (
        name, district, address, website, opening_hours, area_sqm, coordinates,
        source, source_external_id, source_license, status
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        ST_SetSRID(ST_MakePoint($8, $7), 4326)::geography,
        $9, $10, $11, 'active'
      )
      ON CONFLICT (source, source_external_id) DO UPDATE SET
        name = EXCLUDED.name,
        district = EXCLUDED.district,
        address = EXCLUDED.address,
        website = COALESCE(EXCLUDED.website, spots.website),
        opening_hours = COALESCE(EXCLUDED.opening_hours, spots.opening_hours),
        area_sqm = COALESCE(EXCLUDED.area_sqm, spots.area_sqm),
        coordinates = EXCLUDED.coordinates,
        source_license = EXCLUDED.source_license,
        updated_at = NOW()
    `, [
      spot.name,
      spot.district,
      spot.address,
      spot.website,
      spot.openingHours,
      spot.areaSqm,
      spot.latitude,
      spot.longitude,
      sourceName,
      spot.sourceExternalId,
      sourceLicense,
    ])
  }
  await client.query('COMMIT')
  console.log(`StammBoulderhallen synchronisiert: ${rows.length}; manuelle Einträge übernommen: ${reconciled}`)
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  client.release()
  await pool.end()
}
