import 'dotenv/config'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import express from 'express'
import multer from 'multer'
import { ExpressAuth, getSession } from '@auth/express'
import Credentials from '@auth/express/providers/credentials'
import Google from '@auth/express/providers/google'
import PostgresAdapter from '@auth/pg-adapter'
import { Pool } from 'pg'
import { z } from 'zod'

const port = Number(process.env.PORT ?? 3001)
const uploadRoot = process.env.UPLOAD_DIR ?? '/app/uploads'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const demoMode = process.env.DEMO_MODE === 'true'
const superAdminEmail = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase()
const superAdminPassword = process.env.SUPERADMIN_PASSWORD
const superAdminEnabled = Boolean(superAdminEmail && superAdminPassword)
const demoUsers = [
  { id: '3b9a8c88-779d-4cb9-a950-23c8f4559011', name: 'Mira Keller', email: 'mira@bouldero.local', username: 'miraklettert', image: null, role: 'member' },
  { id: '7c5e37a2-1f52-4ce4-b204-412b2e8bc902', name: 'Alex Winter', email: 'alex@bouldero.local', username: 'alexziehtdurch', image: null, role: 'member' },
  { id: 'f0dc01b0-4cc8-4266-bd3f-bbc9a4635503', name: 'Lea Hofmann', email: 'lea@bouldero.local', username: 'leahochhinaus', image: null, role: 'member' },
]
const superAdmin = superAdminEnabled
  ? { id: '0bb3b9c3-e6eb-4384-9ad4-7cb04ec18630', name: 'BoulderO Verwaltung', email: superAdminEmail, username: 'bouldero_admin', image: null, role: 'superadmin' }
  : null
const providers = []

if (demoMode) {
  providers.push(Credentials({
    id: 'demo',
    name: 'Demo-Profil',
    credentials: { profile: { label: 'Profil', type: 'text' } },
    authorize: async (credentials) => demoUsers.find((user) => user.id === credentials?.profile) ?? null,
  }))
}

function matchesSecret(value, expected) {
  const supplied = Buffer.from(value ?? '')
  const secret = Buffer.from(expected ?? '')
  return supplied.length === secret.length && crypto.timingSafeEqual(supplied, secret)
}

if (superAdminEnabled) {
  providers.push(Credentials({
    id: 'superadmin',
    name: 'BoulderO Verwaltung',
    credentials: {
      email: { label: 'E-Mail', type: 'email' },
      password: { label: 'Passwort', type: 'password' },
    },
    authorize: async (credentials) => (
      matchesSecret(String(credentials?.email).trim().toLowerCase(), superAdminEmail)
      && matchesSecret(credentials?.password, superAdminPassword)
        ? superAdmin
        : null
    ),
  }))
}

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(Google({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }))
}

const authConfig = {
  adapter: PostgresAdapter(pool),
  providers,
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  session: { strategy: 'jwt' },
}

const app = express()
app.set('trust proxy', true)
app.get('/api/auth/configuration', (_req, res) => {
  res.json({
    demoEnabled: demoMode,
    googleEnabled: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    superAdminEnabled,
    demoProfiles: demoMode ? demoUsers.map(({ id, name, username }) => ({ id, name, username })) : [],
  })
})
// Auth.js must retain the public `/api/auth` path for CSRF cookies, sessions,
// and OAuth callbacks. The other API routes are defined without that prefix.
app.use('/api/auth', ExpressAuth(authConfig))
// Mittwald forwards the matching `/api` path prefix to the container. Strip it
// for all non-auth routes so they work locally and behind that ingress.
app.use((req, _res, next) => {
  if (req.url === '/api' || req.url.startsWith('/api/')) {
    req.url = req.url.slice(4) || '/'
  }
  next()
})
app.use(express.json({ limit: '1mb' }))

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

async function ensureManagedUsers() {
  const users = [...(demoMode ? demoUsers : []), ...(superAdmin ? [superAdmin] : [])]
  for (const user of users) {
    await pool.query(
      `INSERT INTO users (id, name, email, username, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, username = EXCLUDED.username, role = EXCLUDED.role`,
      [user.id, user.name, user.email, user.username, user.role],
    )
  }
}

async function canViewEntry(viewerId, entryUserId, visibility) {
  if (viewerId === entryUserId) return true
  if (visibility === 'public') return true
  if (visibility === 'private') return false
  const relationship = await pool.query(
    `SELECT
       EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND followed_id = $2 AND status = 'accepted') AS follows_author,
       EXISTS(SELECT 1 FROM follows WHERE follower_id = $2 AND followed_id = $1 AND status = 'accepted') AS author_follows_back`,
    [viewerId, entryUserId],
  )
  const { follows_author: followsAuthor, author_follows_back: authorFollowsBack } = relationship.rows[0]
  return visibility === 'followers' ? followsAuthor : followsAuthor && authorFollowsBack
}

async function getViewableEntry(viewerId, entryId) {
  const result = await pool.query('SELECT id, user_id, visibility FROM journal_entries WHERE id = $1', [entryId])
  const entry = result.rows[0]
  if (!entry || !await canViewEntry(viewerId, entry.user_id, entry.visibility)) return null
  return entry
}

async function areFriends(firstUserId, secondUserId) {
  const result = await pool.query(
    `SELECT EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND followed_id = $2 AND status = 'accepted')
        AND EXISTS(SELECT 1 FROM follows WHERE follower_id = $2 AND followed_id = $1 AND status = 'accepted') AS friends`,
    [firstUserId, secondUserId],
  )
  return result.rows[0].friends
}

async function currentUser(req) {
  const session = await getSession(req, authConfig)
  if (!session?.user?.email) return null
  const result = await pool.query(
    'SELECT id, name, email, image, username, role FROM users WHERE email = $1',
    [session.user.email],
  )
  return result.rows[0] ?? null
}

const requireUser = asyncRoute(async (req, res, next) => {
  const user = await currentUser(req)
  if (!user) return res.status(401).json({ error: 'authentication_required' })
  req.user = user
  next()
})

const requireSuperAdmin = [requireUser, (req, res, next) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'superadmin_required' })
  next()
}]

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: async (req, _file, callback) => {
      try {
        const directory = path.join(uploadRoot, req.user.id)
        await fs.mkdir(directory, { recursive: true })
        callback(null, directory)
      } catch (error) {
        callback(error)
      }
    },
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase() || '.jpg'
      callback(null, `${crypto.randomUUID()}${extension}`)
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 6 },
  fileFilter: (_req, file, callback) => callback(null, /^image\/(jpeg|png|webp|heic)$/.test(file.mimetype)),
})

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(null, /^(text\/csv|application\/csv|application\/vnd\.ms-excel)$/.test(file.mimetype) || file.originalname.toLowerCase().endsWith('.csv')),
})

const spotInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  district: z.string().trim().min(2).max(120),
  address: z.string().trim().min(5).max(300),
  website: z.string().trim().url().max(500).optional().or(z.literal('')),
  openingHours: z.string().trim().max(300).optional(),
  areaSqm: z.number().int().min(0).max(1000000).nullable().optional(),
  imageUrl: z.string().trim().url().max(1000).optional().or(z.literal('')),
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
})

function parseCsv(text) {
  const rows = []
  let row = []
  let value = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index += 1 } else quoted = !quoted
    } else if (character === ',' && !quoted) { row.push(value); value = ''
    } else if (character === '\n' && !quoted) { row.push(value); rows.push(row); row = []; value = ''
    } else if (character !== '\r') value += character
  }
  if (quoted) throw new Error('Nicht geschlossene Anführungszeichen in der CSV-Datei.')
  if (value || row.length) { row.push(value); rows.push(row) }
  return rows.filter((fields) => fields.some((field) => field.trim()))
}

function numberFromCsv(value, field, rowNumber, { optional = false, integer = false } = {}) {
  const normalized = String(value ?? '').trim().replace(',', '.')
  if (!normalized && optional) return null
  const number = Number(normalized)
  if (!Number.isFinite(number) || (integer && !Number.isInteger(number))) throw new Error(`Zeile ${rowNumber}: ${field} ist ungültig.`)
  return number
}

app.get('/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1')
  res.json({ status: 'ok' })
}))

app.get('/me', requireUser, (req, res) => res.json({ user: req.user }))

app.patch('/me', requireUser, asyncRoute(async (req, res) => {
  const input = z.object({
    name: z.string().trim().min(1).max(80).optional(),
    username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,24}$/).optional(),
  }).parse(req.body)
  const result = await pool.query(
    `UPDATE users
       SET name = COALESCE($2, name), username = COALESCE($3, username)
     WHERE id = $1
       RETURNING id, name, email, image, username, role`,
    [req.user.id, input.name ?? null, input.username ?? null],
  )
  res.json({ user: result.rows[0] })
}))

app.post('/me/avatar', requireUser, imageUpload.single('avatar'), asyncRoute(async (req, res) => {
  const file = req.file
  if (!file) return res.status(400).json({ error: 'no_valid_avatar' })
  const storageKey = path.relative(uploadRoot, file.path).split(path.sep).join('/')
  const result = await pool.query(
    `UPDATE users SET image = $2 WHERE id = $1
    RETURNING id, name, email, image, username, role`,
    [req.user.id, storageKey],
  )
  res.status(201).json({ user: result.rows[0] })
}))

app.get('/avatars/:userId', requireUser, asyncRoute(async (req, res) => {
  const result = await pool.query('SELECT image FROM users WHERE id = $1', [req.params.userId])
  const storageKey = result.rows[0]?.image
  if (!storageKey) return res.status(404).end()
  const absolutePath = path.resolve(uploadRoot, storageKey)
  if (!absolutePath.startsWith(path.resolve(uploadRoot))) return res.status(400).end()
  res.sendFile(absolutePath)
}))

app.get('/social/users', requireUser, asyncRoute(async (req, res) => {
  const result = await pool.query(`
    SELECT u.id, u.name, u.username,
      EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followed_id = u.id AND f.status = 'accepted') AS following,
      EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = u.id AND f.followed_id = $1 AND f.status = 'accepted') AS follows_you
    FROM users u
    WHERE u.id <> $1
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = $1))
    ORDER BY u.name
  `, [req.user.id])
  res.json({ users: result.rows })
}))

app.get('/social/friends/summary', requireUser, asyncRoute(async (req, res) => {
  const result = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM direct_messages WHERE recipient_id = $1 AND read_at IS NULL) AS unread_messages,
      (SELECT COUNT(*)::int FROM friend_requests WHERE recipient_id = $1 AND status = 'pending') AS pending_requests
  `, [req.user.id])
  res.json(result.rows[0])
}))

app.get('/social/friends', requireUser, asyncRoute(async (req, res) => {
  const result = await pool.query(`
    SELECT u.id, u.name, u.username, u.image,
      (SELECT MAX(v.visited_at) FROM visits v WHERE v.user_id = u.id) AS last_visit_at,
      (SELECT MAX(m.created_at) FROM direct_messages m
        WHERE (m.sender_id = $1 AND m.recipient_id = u.id) OR (m.sender_id = u.id AND m.recipient_id = $1)) AS last_message_at,
      (SELECT COUNT(*)::int FROM direct_messages m WHERE m.sender_id = u.id AND m.recipient_id = $1 AND m.read_at IS NULL) AS unread_count
    FROM users u
    WHERE u.id <> $1
      AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followed_id = u.id AND f.status = 'accepted')
      AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = u.id AND f.followed_id = $1 AND f.status = 'accepted')
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = $1))
    ORDER BY last_message_at DESC NULLS LAST, u.name
  `, [req.user.id])
  res.json({ friends: result.rows })
}))

app.get('/social/friend-requests', requireUser, asyncRoute(async (req, res) => {
  const [incoming, outgoing] = await Promise.all([
    pool.query(`SELECT r.id, r.created_at, u.id AS user_id, u.name, u.username, u.image FROM friend_requests r JOIN users u ON u.id = r.sender_id WHERE r.recipient_id = $1 AND r.status = 'pending' ORDER BY r.created_at DESC`, [req.user.id]),
    pool.query(`SELECT r.id, r.created_at, u.id AS user_id, u.name, u.username, u.image FROM friend_requests r JOIN users u ON u.id = r.recipient_id WHERE r.sender_id = $1 AND r.status = 'pending' ORDER BY r.created_at DESC`, [req.user.id]),
  ])
  res.json({ incoming: incoming.rows, outgoing: outgoing.rows })
}))

app.get('/social/discover', requireUser, asyncRoute(async (req, res) => {
  const input = z.object({ q: z.string().trim().min(2).max(64) }).parse(req.query)
  const pattern = `%${input.q.replace(/[\\%_]/g, '\\$&')}%`
  const result = await pool.query(`
    SELECT u.id, u.name, u.username, u.image,
      EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followed_id = u.id AND f.status = 'accepted') AS following,
      EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = u.id AND f.followed_id = $1 AND f.status = 'accepted') AS follows_you,
      (EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followed_id = u.id AND f.status = 'accepted') AND EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = u.id AND f.followed_id = $1 AND f.status = 'accepted')) AS is_friend,
      EXISTS(SELECT 1 FROM friend_requests r WHERE r.sender_id = $1 AND r.recipient_id = u.id AND r.status = 'pending') AS request_sent,
      EXISTS(SELECT 1 FROM friend_requests r WHERE r.sender_id = u.id AND r.recipient_id = $1 AND r.status = 'pending') AS request_received,
      (SELECT r.id FROM friend_requests r WHERE r.sender_id = u.id AND r.recipient_id = $1 AND r.status = 'pending' LIMIT 1) AS incoming_request_id
    FROM users u
    WHERE u.id <> $1
      AND (u.name ILIKE $2 ESCAPE '\\' OR u.username ILIKE $2 ESCAPE '\\')
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = $1))
    ORDER BY u.name LIMIT 20
  `, [req.user.id, pattern])
  res.json({ users: result.rows })
}))

app.post('/social/friend-requests/:userId', requireUser, asyncRoute(async (req, res) => {
  const targetId = req.params.userId
  if (targetId === req.user.id) return res.status(400).json({ error: 'cannot_request_self' })
  const target = await pool.query('SELECT id FROM users WHERE id = $1', [targetId])
  if (!target.rowCount) return res.status(404).json({ error: 'user_not_found' })
  if (await areFriends(req.user.id, targetId)) return res.status(409).json({ error: 'already_friends' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const reverse = await client.query("SELECT id FROM friend_requests WHERE sender_id = $1 AND recipient_id = $2 AND status = 'pending' FOR UPDATE", [targetId, req.user.id])
    if (reverse.rowCount) {
      await client.query("UPDATE friend_requests SET status = 'accepted', responded_at = NOW() WHERE id = $1", [reverse.rows[0].id])
      await client.query("INSERT INTO follows (follower_id, followed_id, status) VALUES ($1, $2, 'accepted'), ($2, $1, 'accepted') ON CONFLICT (follower_id, followed_id) DO UPDATE SET status = 'accepted'", [req.user.id, targetId])
      await client.query('COMMIT')
      return res.status(201).json({ status: 'accepted' })
    }
    const request = await client.query("INSERT INTO friend_requests (sender_id, recipient_id, status, created_at, responded_at) VALUES ($1, $2, 'pending', NOW(), NULL) ON CONFLICT (sender_id, recipient_id) DO UPDATE SET status = 'pending', created_at = NOW(), responded_at = NULL RETURNING id, status, created_at", [req.user.id, targetId])
    await client.query('COMMIT')
    res.status(201).json({ request: request.rows[0] })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

app.post('/social/friend-requests/:requestId/accept', requireUser, asyncRoute(async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const request = await client.query("UPDATE friend_requests SET status = 'accepted', responded_at = NOW() WHERE id = $1 AND recipient_id = $2 AND status = 'pending' RETURNING sender_id, recipient_id", [req.params.requestId, req.user.id])
    if (!request.rowCount) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'friend_request_not_found' })
    }
    const { sender_id: senderId, recipient_id: recipientId } = request.rows[0]
    await client.query("INSERT INTO follows (follower_id, followed_id, status) VALUES ($1, $2, 'accepted'), ($2, $1, 'accepted') ON CONFLICT (follower_id, followed_id) DO UPDATE SET status = 'accepted'", [senderId, recipientId])
    await client.query('COMMIT')
    res.json({ accepted: true })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

app.post('/social/friend-requests/:requestId/decline', requireUser, asyncRoute(async (req, res) => {
  const result = await pool.query("UPDATE friend_requests SET status = 'declined', responded_at = NOW() WHERE id = $1 AND recipient_id = $2 AND status = 'pending' RETURNING id", [req.params.requestId, req.user.id])
  if (!result.rowCount) return res.status(404).json({ error: 'friend_request_not_found' })
  res.status(204).end()
}))

app.get('/social/feed', requireUser, asyncRoute(async (req, res) => {
  const result = await pool.query(`
    SELECT j.id, j.body, j.visibility, j.created_at, v.visited_at, s.name AS spot_name, s.district,
           u.id AS user_id, u.name AS user_name, u.username, u.image AS user_image,
           (SELECT COUNT(DISTINCT pv.spot_id)::int FROM visits pv WHERE pv.user_id = u.id) AS author_unique_spots,
           (EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followed_id = j.user_id AND f.status = 'accepted') AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = j.user_id AND f.followed_id = $1 AND f.status = 'accepted')) AS is_friend,
           (SELECT COUNT(*)::int FROM entry_likes l WHERE l.journal_entry_id = j.id) AS like_count,
           EXISTS(SELECT 1 FROM entry_likes l WHERE l.journal_entry_id = j.id AND l.user_id = $1) AS liked_by_me,
           (SELECT COUNT(*)::int FROM entry_comments c WHERE c.journal_entry_id = j.id) AS comment_count,
           COALESCE(json_agg(json_build_object('id', m.id, 'contentType', m.content_type))
             FILTER (WHERE m.id IS NOT NULL), '[]') AS media
      FROM journal_entries j
      JOIN visits v ON v.id = j.visit_id
      JOIN spots s ON s.id = v.spot_id
      JOIN users u ON u.id = j.user_id
      LEFT JOIN media m ON m.journal_entry_id = j.id
     WHERE j.user_id <> $1
       AND (
         j.visibility = 'public'
         OR (j.visibility = 'followers' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followed_id = j.user_id AND f.status = 'accepted'))
         OR (j.visibility = 'friends' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followed_id = j.user_id AND f.status = 'accepted') AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = j.user_id AND f.followed_id = $1 AND f.status = 'accepted'))
       )
     GROUP BY j.id, v.id, s.id, u.id
     ORDER BY j.created_at DESC
     LIMIT 30
  `, [req.user.id])
  res.json({ entries: result.rows })
}))

app.get('/social/entries/:entryId/comments', requireUser, asyncRoute(async (req, res) => {
  const entry = await getViewableEntry(req.user.id, req.params.entryId)
  if (!entry) return res.status(404).json({ error: 'entry_not_found' })
  const result = await pool.query(`
    SELECT c.id, c.body, c.created_at, u.id AS user_id, u.name AS user_name, u.username
      FROM entry_comments c JOIN users u ON u.id = c.user_id
     WHERE c.journal_entry_id = $1 ORDER BY c.created_at
  `, [entry.id])
  res.json({ comments: result.rows })
}))

app.post('/social/entries/:entryId/comments', requireUser, asyncRoute(async (req, res) => {
  const entry = await getViewableEntry(req.user.id, req.params.entryId)
  if (!entry) return res.status(404).json({ error: 'entry_not_found' })
  const input = z.object({ body: z.string().trim().min(1).max(1000) }).parse(req.body)
  const result = await pool.query(`
    INSERT INTO entry_comments (journal_entry_id, user_id, body)
    VALUES ($1, $2, $3)
    RETURNING id, body, created_at
  `, [entry.id, req.user.id, input.body])
  res.status(201).json({ comment: { ...result.rows[0], user_id: req.user.id, user_name: req.user.name, username: req.user.username } })
}))

app.post('/social/entries/:entryId/like', requireUser, asyncRoute(async (req, res) => {
  const entry = await getViewableEntry(req.user.id, req.params.entryId)
  if (!entry) return res.status(404).json({ error: 'entry_not_found' })
  await pool.query('INSERT INTO entry_likes (journal_entry_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [entry.id, req.user.id])
  res.status(201).json({ liked: true })
}))

app.delete('/social/entries/:entryId/like', requireUser, asyncRoute(async (req, res) => {
  await pool.query('DELETE FROM entry_likes WHERE journal_entry_id = $1 AND user_id = $2', [req.params.entryId, req.user.id])
  res.status(204).end()
}))

app.get('/messages/:userId', requireUser, asyncRoute(async (req, res) => {
  if (!await areFriends(req.user.id, req.params.userId)) return res.status(403).json({ error: 'friends_required' })
  await pool.query('UPDATE direct_messages SET read_at = NOW() WHERE sender_id = $1 AND recipient_id = $2 AND read_at IS NULL', [req.params.userId, req.user.id])
  const result = await pool.query(`
    SELECT m.id, m.body, m.created_at, m.read_at, m.sender_id, m.recipient_id, u.name AS sender_name
      FROM direct_messages m JOIN users u ON u.id = m.sender_id
     WHERE (m.sender_id = $1 AND m.recipient_id = $2) OR (m.sender_id = $2 AND m.recipient_id = $1)
     ORDER BY m.created_at ASC LIMIT 100
  `, [req.user.id, req.params.userId])
  res.json({ messages: result.rows })
}))

app.post('/messages/:userId', requireUser, asyncRoute(async (req, res) => {
  if (!await areFriends(req.user.id, req.params.userId)) return res.status(403).json({ error: 'friends_required' })
  const input = z.object({ body: z.string().trim().min(1).max(2000) }).parse(req.body)
  const result = await pool.query(`
    INSERT INTO direct_messages (sender_id, recipient_id, body) VALUES ($1, $2, $3)
    RETURNING id, body, created_at, sender_id, recipient_id
  `, [req.user.id, req.params.userId, input.body])
  res.status(201).json({ message: result.rows[0] })
}))

app.get('/spots', asyncRoute(async (_req, res) => {
  const result = await pool.query(`
    SELECT id, name, district, address, website, opening_hours, area_sqm, image_url, source,
           ST_Y(coordinates::geometry) AS latitude,
           ST_X(coordinates::geometry) AS longitude
      FROM spots
     WHERE status = 'active'
     ORDER BY name
  `)
  res.json({ spots: result.rows })
}))

app.post('/admin/spots', ...requireSuperAdmin, asyncRoute(async (req, res) => {
  const input = spotInputSchema.parse(req.body)
  const result = await pool.query(
    `INSERT INTO spots (name, district, address, website, opening_hours, area_sqm, image_url, coordinates, source, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, ST_SetSRID(ST_MakePoint($9, $8), 4326)::geography, 'admin', 'active')
     RETURNING id, name, district, address, website, opening_hours, area_sqm, image_url, source,
       ST_Y(coordinates::geometry) AS latitude, ST_X(coordinates::geometry) AS longitude`,
    [input.name, input.district, input.address, input.website || null, input.openingHours || null, input.areaSqm ?? null, input.imageUrl || null, input.latitude, input.longitude],
  )
  res.status(201).json({ spot: result.rows[0] })
}))

app.post('/admin/spots/import', ...requireSuperAdmin, csvUpload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'csv_file_required' })
  const rows = parseCsv(req.file.buffer.toString('utf8'))
  if (rows.length < 2) return res.status(400).json({ error: 'csv_rows_required' })
  if (rows.length > 501) return res.status(400).json({ error: 'csv_limit_exceeded' })
  const headers = rows[0].map((value) => value.trim().replace(/^\uFEFF/, '').toLowerCase())
  const required = ['name', 'district', 'address', 'latitude', 'longitude']
  const missing = required.filter((name) => !headers.includes(name))
  if (missing.length) return res.status(400).json({ error: 'csv_headers_invalid', missing })
  const inputs = rows.slice(1).map((values, index) => {
    const record = { rowNumber: index + 2 }
    headers.forEach((header, column) => { record[header] = values[column] ?? '' })
    return spotInputSchema.parse({
      name: record.name,
      district: record.district,
      address: record.address,
      website: record.website || '',
      openingHours: record.opening_hours || '',
      areaSqm: numberFromCsv(record.area_sqm, 'area_sqm', record.rowNumber, { optional: true, integer: true }),
      imageUrl: record.image_url || '',
      latitude: numberFromCsv(record.latitude, 'latitude', record.rowNumber),
      longitude: numberFromCsv(record.longitude, 'longitude', record.rowNumber),
    })
  })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const input of inputs) {
      await client.query(
        `INSERT INTO spots (name, district, address, website, opening_hours, area_sqm, image_url, coordinates, source, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, ST_SetSRID(ST_MakePoint($9, $8), 4326)::geography, 'admin-import', 'active')`,
        [input.name, input.district, input.address, input.website || null, input.openingHours || null, input.areaSqm ?? null, input.imageUrl || null, input.latitude, input.longitude],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  res.status(201).json({ imported: inputs.length })
}))

app.get('/visits', requireUser, asyncRoute(async (req, res) => {
  const result = await pool.query(`
    SELECT v.id, v.spot_id, v.visited_at, v.created_at, s.name AS spot_name,
           s.district, j.id AS journal_entry_id, j.body, j.visibility,
           COALESCE(json_agg(json_build_object('id', m.id, 'contentType', m.content_type))
             FILTER (WHERE m.id IS NOT NULL), '[]') AS media
      FROM visits v
      JOIN spots s ON s.id = v.spot_id
      LEFT JOIN journal_entries j ON j.visit_id = v.id
      LEFT JOIN media m ON m.journal_entry_id = j.id
     WHERE v.user_id = $1
     GROUP BY v.id, s.id, j.id
     ORDER BY v.visited_at DESC, v.created_at DESC
  `, [req.user.id])
  res.json({ visits: result.rows })
}))

app.post('/visits', requireUser, asyncRoute(async (req, res) => {
  const input = z.object({
    spotId: z.string().uuid(),
    visitedAt: z.string().date().optional(),
    body: z.string().trim().max(4000).default(''),
    visibility: z.enum(['private', 'friends', 'followers', 'public']).default('private'),
  }).parse(req.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const visit = await client.query(
      `INSERT INTO visits (user_id, spot_id, visited_at)
       VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE))
       RETURNING id, spot_id, visited_at, created_at`,
      [req.user.id, input.spotId, input.visitedAt ?? null],
    )
    const entry = await client.query(
      `INSERT INTO journal_entries (user_id, visit_id, body, visibility)
       VALUES ($1, $2, $3, $4)
       RETURNING id, body, visibility, created_at`,
      [req.user.id, visit.rows[0].id, input.body, input.visibility],
    )
    await client.query('COMMIT')
    res.status(201).json({ visit: visit.rows[0], journalEntry: entry.rows[0] })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

app.patch('/journal/:entryId', requireUser, asyncRoute(async (req, res) => {
  const input = z.object({
    body: z.string().trim().max(4000).optional(),
    visibility: z.enum(['private', 'friends', 'followers', 'public']).optional(),
  }).parse(req.body)
  const result = await pool.query(
    `UPDATE journal_entries
        SET body = COALESCE($3, body), visibility = COALESCE($4, visibility), updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING id, body, visibility, updated_at`,
    [req.params.entryId, req.user.id, input.body ?? null, input.visibility ?? null],
  )
  if (!result.rowCount) return res.status(404).json({ error: 'journal_entry_not_found' })
  res.json({ journalEntry: result.rows[0] })
}))

app.post('/journal/:entryId/photos', requireUser, imageUpload.array('photos', 6), asyncRoute(async (req, res) => {
  const entry = await pool.query(
    'SELECT id FROM journal_entries WHERE id = $1 AND user_id = $2',
    [req.params.entryId, req.user.id],
  )
  if (!entry.rowCount) return res.status(404).json({ error: 'journal_entry_not_found' })
  const files = req.files ?? []
  if (!files.length) return res.status(400).json({ error: 'no_valid_photos' })
  const media = await Promise.all(files.map(async (file) => {
    const storageKey = path.relative(uploadRoot, file.path).split(path.sep).join('/')
    const result = await pool.query(
      `INSERT INTO media (journal_entry_id, owner_id, storage_key, original_name, content_type, byte_size)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, content_type, byte_size, created_at`,
      [entry.rows[0].id, req.user.id, storageKey, file.originalname, file.mimetype, file.size],
    )
    return result.rows[0]
  }))
  res.status(201).json({ media })
}))

app.get('/media/:mediaId', requireUser, asyncRoute(async (req, res) => {
  const result = await pool.query(`
    SELECT m.storage_key, m.content_type, j.user_id, j.visibility
      FROM media m
      JOIN journal_entries j ON j.id = m.journal_entry_id
     WHERE m.id = $1
  `, [req.params.mediaId])
  const media = result.rows[0]
  if (!media || !await canViewEntry(req.user.id, media.user_id, media.visibility)) {
    return res.status(404).end()
  }
  const absolutePath = path.resolve(uploadRoot, media.storage_key)
  if (!absolutePath.startsWith(path.resolve(uploadRoot))) return res.status(400).end()
  res.type(media.content_type).sendFile(absolutePath)
}))

app.delete('/media/:mediaId', requireUser, asyncRoute(async (req, res) => {
  const result = await pool.query(
    'SELECT id, storage_key FROM media WHERE id = $1 AND owner_id = $2',
    [req.params.mediaId, req.user.id],
  )
  if (!result.rowCount) return res.status(404).json({ error: 'media_not_found' })
  await pool.query('DELETE FROM media WHERE id = $1', [req.params.mediaId])
  const absolutePath = path.resolve(uploadRoot, result.rows[0].storage_key)
  if (absolutePath.startsWith(path.resolve(uploadRoot))) await fs.unlink(absolutePath).catch(() => undefined)
  res.status(204).end()
}))

app.post('/follows/:userId', requireUser, asyncRoute(async (req, res) => {
  if (req.params.userId === req.user.id) return res.status(400).json({ error: 'cannot_follow_self' })
  const result = await pool.query(
    `INSERT INTO follows (follower_id, followed_id, status)
     VALUES ($1, $2, 'accepted')
     ON CONFLICT (follower_id, followed_id) DO UPDATE SET status = 'accepted'
     RETURNING follower_id, followed_id, status, created_at`,
    [req.user.id, req.params.userId],
  )
  res.status(201).json({ follow: result.rows[0] })
}))

app.delete('/follows/:userId', requireUser, asyncRoute(async (req, res) => {
  await pool.query('DELETE FROM follows WHERE follower_id = $1 AND followed_id = $2', [req.user.id, req.params.userId])
  res.status(204).end()
}))

app.get('/progress', requireUser, asyncRoute(async (req, res) => {
  const result = await pool.query(`
    SELECT
      (SELECT COUNT(DISTINCT spot_id)::int FROM visits WHERE user_id = $1) AS unique_spots,
      (SELECT COUNT(*)::int FROM visits WHERE user_id = $1) AS total_visits,
      (SELECT COUNT(*)::int FROM follows WHERE followed_id = $1 AND status = 'accepted') AS follower_count
  `, [req.user.id])
  const progress = result.rows[0]
  const badges = await pool.query(
    'SELECT id, name, threshold, threshold <= $1 AS unlocked FROM badges ORDER BY threshold',
    [progress.unique_spots],
  )
  res.json({ ...progress, badges: badges.rows })
}))

app.use((error, _req, res, _next) => {
  if (error instanceof z.ZodError) return res.status(400).json({ error: 'invalid_input', details: error.flatten() })
  if (error?.code === '23505') return res.status(409).json({ error: 'conflict' })
  if (error instanceof multer.MulterError) return res.status(400).json({ error: error.code })
  console.error(error)
  res.status(500).json({ error: 'internal_error' })
})

await ensureManagedUsers()
app.listen(port, () => console.log(`BoulderO API listening on ${port}`))
