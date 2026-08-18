import 'dotenv/config'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Pool } from 'pg'

const uploadRoot = process.env.UPLOAD_DIR ?? '/app/uploads'
const assetsRoot = process.env.DEMO_ASSETS_DIR ?? '/tmp/bouldero-demo-assets'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const authors = [
  { id: '7c5e37a2-1f52-4ce4-b204-412b2e8bc902', body: 'Die neuen Sloper im Überhang waren heute meine Challenge. Gute Session!', spotId: '419ca859-f9a5-4b5e-87f3-a4f2da0ad201', image: 'pexels-eberhardgross-1366909.jpg' },
  { id: 'f0dc01b0-4cc8-4266-bd3f-bbc9a4635503', body: 'Abendsession mit ruhigen Routen und viel Zeit zum Ausprobieren.', spotId: 'ee258faf-7be1-4b65-aeb8-af0ed41a2d02', image: 'pexels-christopher-politano-978995-38412647.jpg' },
]

const avatars = [
  ['3b9a8c88-779d-4cb9-a950-23c8f4559011', 'pexels-eberhardgross-28701196.jpg'],
  ['7c5e37a2-1f52-4ce4-b204-412b2e8bc902', 'pexels-eberhardgross-1366909.jpg'],
  ['f0dc01b0-4cc8-4266-bd3f-bbc9a4635503', 'pexels-christopher-politano-978995-38412647.jpg'],
]

const client = await pool.connect()
try {
  await client.query('BEGIN')
  for (const [userId, image] of avatars) {
    const user = await client.query('SELECT image FROM users WHERE id = $1', [userId])
    if (user.rows[0]?.image) continue
    const sourcePath = path.join(assetsRoot, image)
    const directory = path.join(uploadRoot, userId)
    const storageName = `avatar-demo-${crypto.randomUUID()}.jpg`
    await fs.mkdir(directory, { recursive: true })
    await fs.copyFile(sourcePath, path.join(directory, storageName))
    await client.query('UPDATE users SET image = $2 WHERE id = $1', [userId, `${userId}/${storageName}`])
  }
  for (const item of authors) {
    const existing = await client.query('SELECT id FROM journal_entries WHERE body = $1', [item.body])
    let entryId = existing.rows[0]?.id
    if (!entryId) {
      const visit = await client.query(
        `INSERT INTO visits (user_id, spot_id, visited_at) VALUES ($1, $2, CURRENT_DATE - 1) RETURNING id`,
        [item.id, item.spotId],
      )
      const entry = await client.query(
        `INSERT INTO journal_entries (user_id, visit_id, body, visibility) VALUES ($1, $2, $3, 'public') RETURNING id`,
        [item.id, visit.rows[0].id, item.body],
      )
      entryId = entry.rows[0].id
    }
    const alreadyHasImage = await client.query('SELECT 1 FROM media WHERE journal_entry_id = $1', [entryId])
    if (!alreadyHasImage.rowCount) {
      const sourcePath = path.join(assetsRoot, item.image)
      const directory = path.join(uploadRoot, item.id)
      const storageName = `demo-${crypto.randomUUID()}.jpg`
      await fs.mkdir(directory, { recursive: true })
      await fs.copyFile(sourcePath, path.join(directory, storageName))
      await client.query(`
        INSERT INTO media (journal_entry_id, owner_id, storage_key, original_name, content_type, byte_size)
        VALUES ($1, $2, $3, $4, 'image/jpeg', $5)
      `, [entryId, item.id, `${item.id}/${storageName}`, item.image, (await fs.stat(sourcePath)).size])
    }
    await client.query('INSERT INTO entry_likes (journal_entry_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [entryId, '3b9a8c88-779d-4cb9-a950-23c8f4559011'])
  }
  await client.query("INSERT INTO follows (follower_id, followed_id, status) VALUES ($1, $2, 'accepted'), ($2, $1, 'accepted') ON CONFLICT (follower_id, followed_id) DO NOTHING", ['3b9a8c88-779d-4cb9-a950-23c8f4559011', '7c5e37a2-1f52-4ce4-b204-412b2e8bc902'])
  await client.query("INSERT INTO friend_requests (sender_id, recipient_id, status) VALUES ($1, $2, 'pending') ON CONFLICT (sender_id, recipient_id) DO NOTHING", ['f0dc01b0-4cc8-4266-bd3f-bbc9a4635503', '3b9a8c88-779d-4cb9-a950-23c8f4559011'])
  await client.query("INSERT INTO direct_messages (sender_id, recipient_id, body) SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM direct_messages WHERE sender_id = $1 AND recipient_id = $2 AND body = $3)", ['7c5e37a2-1f52-4ce4-b204-412b2e8bc902', '3b9a8c88-779d-4cb9-a950-23c8f4559011', 'Lust auf eine Runde im Kantenwerk diese Woche?'])
  await client.query('COMMIT')
  console.log('Seeded social demo entries with images.')
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  client.release()
  await pool.end()
}
