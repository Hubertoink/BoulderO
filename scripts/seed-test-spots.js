import 'dotenv/config'
import { Pool } from 'pg'

const requested = Number(process.argv[2] ?? 1000)
const count = Number.isInteger(requested) && requested > 0 && requested <= 5000 ? requested : 1000
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const cities = [
  ['Berlin', 52.5200, 13.4050], ['Hamburg', 53.5511, 9.9937], ['München', 48.1351, 11.5820],
  ['Köln', 50.9375, 6.9603], ['Frankfurt', 50.1109, 8.6821], ['Stuttgart', 48.7758, 9.1829],
  ['Düsseldorf', 51.2277, 6.7735], ['Leipzig', 51.3397, 12.3731], ['Dresden', 51.0504, 13.7373],
  ['Hannover', 52.3759, 9.7320], ['Nürnberg', 49.4521, 11.0767], ['Bremen', 53.0793, 8.8017],
  ['Mannheim', 49.4875, 8.4660], ['Freiburg', 47.9990, 7.8421], ['Münster', 51.9607, 7.6261],
]

function fraction(seed) {
  return ((Math.sin(seed * 12.9898) * 43758.5453) % 1 + 1) % 1
}

function offset(seed, amount) {
  return (fraction(seed) - .5) * amount
}

const client = await pool.connect()
try {
  await client.query('BEGIN')
  for (let index = 1; index <= count; index += 1) {
    const city = index <= Math.min(150, count) ? cities[12] : cities[index % cities.length]
    const spread = city[0] === 'Mannheim' ? .22 : .42
    const latitude = city[1] + offset(index * 2, spread)
    const longitude = city[2] + offset(index * 3, spread * 1.45)
    const padded = String(index).padStart(4, '0')
    await client.query(`
      INSERT INTO spots (name, district, address, opening_hours, area_sqm, coordinates, source, source_external_id, source_license)
      VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography, 'test-seed', $8, 'Testdaten – nicht reale Boulderhalle')
      ON CONFLICT (source, source_external_id) DO UPDATE SET
        name = EXCLUDED.name, district = EXCLUDED.district, address = EXCLUDED.address,
        opening_hours = EXCLUDED.opening_hours, area_sqm = EXCLUDED.area_sqm,
        coordinates = EXCLUDED.coordinates, updated_at = NOW()
    `, [
      `Test Boulderhalle ${padded}`,
      `${city[0]} · Testgebiet`,
      `Teststraße ${index}, ${city[0]}`,
      index % 3 === 0 ? '07:00–23:00' : '09:00–22:30',
      450 + (index * 37) % 1150,
      longitude,
      latitude,
      `test-hall-${padded}`,
    ])
  }
  await client.query('COMMIT')
  console.log(`Seeded or updated ${count} fictional test spots.`)
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  client.release()
  await pool.end()
}
