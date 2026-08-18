import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../db/migrations')
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

await pool.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`)

const files = (await fs.readdir(directory)).filter((file) => file.endsWith('.sql')).sort()
for (const filename of files) {
  const applied = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [filename])
  if (applied.rowCount) continue
  const sql = await fs.readFile(path.join(directory, filename), 'utf8')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(sql)
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename])
    await client.query('COMMIT')
    console.log(`Applied migration ${filename}`)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

await pool.end()
