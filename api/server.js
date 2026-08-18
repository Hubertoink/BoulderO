import 'dotenv/config'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import express from 'express'
import multer from 'multer'
import nodemailer from 'nodemailer'
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
const scrypt = promisify(crypto.scrypt)
const passwordScryptCost = 4096
const legacyPasswordScryptCost = 16384
const passwordScryptOptions = (cost) => ({ N: cost, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
const appOrigin = process.env.APP_ORIGIN?.replace(/\/$/, '')
const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD && process.env.SMTP_FROM)
const emailTransport = process.env.EMAIL_TRANSPORT === 'json'
  ? nodemailer.createTransport({ jsonTransport: true })
  : smtpConfigured
    ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 465),
      secure: process.env.SMTP_SECURE !== 'false',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    })
    : null
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

async function passwordHash(password) {
  const salt = crypto.randomBytes(16).toString('base64url')
  const derived = await scrypt(password, salt, 64, passwordScryptOptions(passwordScryptCost))
  return `scrypt$${passwordScryptCost}$${salt}$${Buffer.from(derived).toString('base64url')}`
}

async function passwordMatches(password, stored) {
  const parts = String(stored ?? '').split('$')
  const [algorithm, costOrSalt, saltOrEncoded, encoded] = parts
  if (algorithm !== 'scrypt') return false
  const isVersioned = parts.length === 4
  const cost = isVersioned ? Number(costOrSalt) : legacyPasswordScryptCost
  const salt = isVersioned ? saltOrEncoded : costOrSalt
  const encodedHash = isVersioned ? encoded : saltOrEncoded
  if (!salt || !encodedHash || ![passwordScryptCost, legacyPasswordScryptCost].includes(cost)) return false
  const expected = Buffer.from(encodedHash, 'base64url')
  const derived = Buffer.from(await scrypt(password, salt, expected.length, passwordScryptOptions(cost)))
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived)
}

function actionTokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('base64url')
}

function publicAppOrigin(req) {
  if (appOrigin) return appOrigin
  return `${req.protocol}://${req.get('host')}`
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]))
}

async function createAccountActionToken(userId, purpose) {
  const token = crypto.randomBytes(32).toString('base64url')
  const hours = purpose === 'verify_email' ? 24 : 1
  await pool.query('UPDATE account_action_tokens SET used_at = NOW() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL', [userId, purpose])
  await pool.query(
    `INSERT INTO account_action_tokens (user_id, purpose, token_hash, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 hour'))`,
    [userId, purpose, actionTokenHash(token), hours],
  )
  return token
}

async function sendAccountActionEmail(req, user, purpose) {
  if (!emailTransport) throw new Error('email_not_configured')
  const token = await createAccountActionToken(user.id, purpose)
  const isVerification = purpose === 'verify_email'
  const url = new URL(publicAppOrigin(req))
  url.searchParams.set(isVerification ? 'verifyEmail' : 'resetPassword', token)
  const subject = isVerification ? 'Bestätige dein BoulderO Konto' : 'BoulderO Passwort zurücksetzen'
  const title = isVerification ? 'Bestätige deine E-Mail-Adresse' : 'Setze dein Passwort zurück'
  const copy = isVerification
    ? 'Bitte bestätige deine E-Mail-Adresse, um dein BoulderO Konto freizuschalten.'
    : 'Du hast angefordert, dein BoulderO Passwort zurückzusetzen.'
  const action = isVerification ? 'E-Mail-Adresse bestätigen' : 'Passwort zurücksetzen'
  const html = `<p>Hallo ${escapeHtml(user.name || 'BoulderO Mitglied')},</p><p>${copy}</p><p><a href="${url.toString()}">${action}</a></p><p>Der Link ist ${isVerification ? '24 Stunden' : 'eine Stunde'} gültig. Falls du diese Nachricht nicht angefordert hast, kannst du sie ignorieren.</p>`
  const result = await emailTransport.sendMail({ from: process.env.SMTP_FROM, to: user.email, subject, text: `${copy}\n\n${url.toString()}`, html })
  if (process.env.EMAIL_TRANSPORT === 'json') console.info(`E-Mail-Vorschau (${purpose}): ${result.message}`)
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

providers.push(Credentials({
  id: 'member',
  name: 'BoulderO Konto',
  credentials: {
    email: { label: 'E-Mail', type: 'email' },
    password: { label: 'Passwort', type: 'password' },
  },
  authorize: async (credentials) => {
    const email = String(credentials?.email ?? '').trim().toLowerCase()
    const password = String(credentials?.password ?? '')
    const result = await pool.query('SELECT id, name, email, username, image, role, password_hash, email_verified_at FROM users WHERE email = $1', [email])
    const user = result.rows[0]
    if (!user || !user.email_verified_at || !await passwordMatches(password, user.password_hash)) return null
    return { id: user.id, name: user.name, email: user.email, username: user.username, image: user.image, role: user.role }
  },
}))

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
    registrationEnabled: Boolean(emailTransport),
    emailDeliveryEnabled: Boolean(emailTransport),
    demoProfiles: demoMode ? demoUsers.map(({ id, name, username }) => ({ id, name, username })) : [],
  })
})
app.get('/auth/configuration', (_req, res) => {
  res.json({
    demoEnabled: demoMode,
    googleEnabled: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    superAdminEnabled,
    registrationEnabled: Boolean(emailTransport),
    emailDeliveryEnabled: Boolean(emailTransport),
    demoProfiles: demoMode ? demoUsers.map(({ id, name, username }) => ({ id, name, username })) : [],
  })
})
// Auth.js must retain the public `/api/auth` path for CSRF cookies, sessions,
// and OAuth callbacks. The other API routes are defined without that prefix.
app.use('/api/auth', ExpressAuth(authConfig))
// The local Nginx reverse proxy strips `/api`, so support its internal path too.
app.use('/auth', ExpressAuth(authConfig))
// Mittwald forwards the matching `/api` path prefix to the container. Strip it
// for all non-auth routes so they work locally and behind that ingress.
app.use((req, _res, next) => {
  if (req.url === '/api' || req.url.startsWith('/api/')) {
    req.url = req.url.slice(4) || '/'
  }
  next()
})
app.use(express.json({ limit: '1mb' }))

function usernameFromName(name) {
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'boulderer'
}

app.post('/register', asyncRoute(async (req, res) => {
  if (!emailTransport) return res.status(503).json({ error: 'email_not_configured' })
  const input = z.object({
    name: z.string().trim().min(2).max(80),
    email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
    password: z.string().min(10).max(200),
  }).parse(req.body)
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [input.email])
  if (existing.rowCount) return res.status(409).json({ error: 'email_taken' })
  const hash = await passwordHash(input.password)
  const baseUsername = usernameFromName(input.name)
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const username = suffix ? `${baseUsername}${suffix + 1}`.slice(0, 30) : baseUsername
    try {
      const created = await pool.query(
        `INSERT INTO users (name, email, username, password_hash, role)
         VALUES ($1, $2, $3, $4, 'member') RETURNING id, name, email, username, role`,
        [input.name, input.email, username, hash],
      )
      try {
        await sendAccountActionEmail(req, created.rows[0], 'verify_email')
      } catch (error) {
        console.error('Bestätigungs-E-Mail konnte nicht versendet werden:', error)
        return res.status(503).json({ error: 'email_delivery_failed' })
      }
      return res.status(201).json({ user: created.rows[0], verificationRequired: true })
    } catch (error) {
      if (error?.code === '23505' && error?.constraint?.includes('email')) return res.status(409).json({ error: 'email_taken' })
      if (error?.code === '23505') continue
      throw error
    }
  }
  res.status(409).json({ error: 'username_unavailable' })
}))

app.post('/account/verification/resend', asyncRoute(async (req, res) => {
  if (!emailTransport) return res.status(503).json({ error: 'email_not_configured' })
  const input = z.object({ email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()) }).parse(req.body)
  const result = await pool.query('SELECT id, name, email, email_verified_at FROM users WHERE email = $1', [input.email])
  const user = result.rows[0]
  if (user && !user.email_verified_at) await sendAccountActionEmail(req, user, 'verify_email')
  res.status(202).json({ accepted: true })
}))

app.post('/account/verify-email', asyncRoute(async (req, res) => {
  const input = z.object({ token: z.string().min(32).max(256) }).parse(req.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const action = await client.query(
      `SELECT id, user_id FROM account_action_tokens
       WHERE token_hash = $1 AND purpose = 'verify_email' AND used_at IS NULL AND expires_at > NOW()
       FOR UPDATE`,
      [actionTokenHash(input.token)],
    )
    if (!action.rowCount) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'invalid_or_expired_token' })
    }
    await client.query('UPDATE users SET email_verified_at = NOW() WHERE id = $1', [action.rows[0].user_id])
    await client.query('UPDATE account_action_tokens SET used_at = NOW() WHERE id = $1', [action.rows[0].id])
    await client.query('COMMIT')
    res.json({ verified: true })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

app.post('/account/password-reset/request', asyncRoute(async (req, res) => {
  if (!emailTransport) return res.status(503).json({ error: 'email_not_configured' })
  const input = z.object({ email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()) }).parse(req.body)
  const result = await pool.query('SELECT id, name, email, password_hash FROM users WHERE email = $1', [input.email])
  if (result.rows[0]?.password_hash) await sendAccountActionEmail(req, result.rows[0], 'reset_password')
  res.status(202).json({ accepted: true })
}))

app.post('/account/password-reset', asyncRoute(async (req, res) => {
  const input = z.object({ token: z.string().min(32).max(256), password: z.string().min(10).max(200) }).parse(req.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const action = await client.query(
      `SELECT id, user_id FROM account_action_tokens
       WHERE token_hash = $1 AND purpose = 'reset_password' AND used_at IS NULL AND expires_at > NOW()
       FOR UPDATE`,
      [actionTokenHash(input.token)],
    )
    if (!action.rowCount) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'invalid_or_expired_token' })
    }
    await client.query('UPDATE users SET password_hash = $2, password_changed_at = NOW() WHERE id = $1', [action.rows[0].user_id, await passwordHash(input.password)])
    await client.query('UPDATE account_action_tokens SET used_at = NOW() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL', [action.rows[0].user_id, 'reset_password'])
    await client.query('COMMIT')
    res.json({ reset: true })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

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

const spotImageUpload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, callback) => {
      try {
        const directory = path.join(uploadRoot, 'spot-images')
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
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype)),
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

const spotSuggestionInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  district: z.string().trim().max(120).optional().or(z.literal('')),
  address: z.string().trim().min(5).max(300),
  website: z.string().trim().url().max(500).optional().or(z.literal('')),
  latitude: z.number().gte(-90).lte(90).nullable().optional(),
  longitude: z.number().gte(-180).lte(180).nullable().optional(),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
}).superRefine((value, context) => {
  if ((value.latitude === null || value.latitude === undefined) !== (value.longitude === null || value.longitude === undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Koordinaten müssen zusammen angegeben werden.' })
  }
})

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const visitInputSchema = z.object({
  spotId: z.string().uuid(),
  visitedAt: z.string().date().optional(),
  startedAt: timeSchema.optional().or(z.literal('')),
  endedAt: timeSchema.optional().or(z.literal('')),
  body: z.string().trim().max(4000).default(''),
  visibility: z.enum(['private', 'friends', 'followers', 'public']).default('private'),
}).superRefine((value, context) => {
  if (Boolean(value.startedAt) !== Boolean(value.endedAt)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Start- und Endzeit müssen zusammen angegeben werden.' })
  if (value.startedAt && value.endedAt && value.endedAt <= value.startedAt) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Die Endzeit muss nach der Startzeit liegen.' })
})

const plannedVisitInputSchema = z.object({
  spotId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).optional().nullable(),
  note: z.string().trim().max(2000).default(''),
  visibility: z.enum(['private', 'friends', 'followers', 'public']).default('friends'),
}).superRefine((value, context) => {
  if (value.endsAt && new Date(value.endsAt) <= new Date(value.startsAt)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Das Ende muss nach dem Beginn liegen.' })
})

const spotCorrectionInputSchema = z.object({
  category: z.enum(['coordinates', 'address', 'opening_hours', 'website', 'other']),
  note: z.string().trim().min(3).max(2000),
  suggestedLatitude: z.number().gte(-90).lte(90).nullable().optional(),
  suggestedLongitude: z.number().gte(-180).lte(180).nullable().optional(),
}).superRefine((value, context) => {
  if ((value.suggestedLatitude === null || value.suggestedLatitude === undefined) !== (value.suggestedLongitude === null || value.suggestedLongitude === undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Koordinaten müssen zusammen angegeben werden.' })
  }
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

app.post('/me/password', requireUser, asyncRoute(async (req, res) => {
  const input = z.object({
    currentPassword: z.string().min(1).max(200),
    password: z.string().min(10).max(200),
  }).parse(req.body)
  const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id])
  if (!result.rows[0]?.password_hash) return res.status(400).json({ error: 'password_change_not_available' })
  if (!await passwordMatches(input.currentPassword, result.rows[0].password_hash)) return res.status(400).json({ error: 'current_password_incorrect' })
  await pool.query('UPDATE users SET password_hash = $2, password_changed_at = NOW() WHERE id = $1', [req.user.id, await passwordHash(input.password)])
  await pool.query('UPDATE account_action_tokens SET used_at = NOW() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL', [req.user.id, 'reset_password'])
  res.json({ changed: true })
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

app.get('/social/feed/summary', requireUser, asyncRoute(async (req, res) => {
  const result = await pool.query(`
    WITH last_seen AS (
      SELECT COALESCE((SELECT last_seen_at FROM social_feed_reads WHERE user_id = $1), TIMESTAMPTZ 'epoch') AS value
    )
    SELECT (
      (SELECT COUNT(*) FROM entry_likes l JOIN journal_entries j ON j.id = l.journal_entry_id, last_seen WHERE j.user_id = $1 AND l.user_id <> $1 AND l.created_at > last_seen.value)
      + (SELECT COUNT(*) FROM entry_comments c JOIN journal_entries j ON j.id = c.journal_entry_id, last_seen WHERE j.user_id = $1 AND c.user_id <> $1 AND c.created_at > last_seen.value)
      + (SELECT COUNT(*) FROM planned_visit_rsvps r JOIN planned_visits p ON p.id = r.planned_visit_id, last_seen WHERE p.user_id = $1 AND r.user_id <> $1 AND r.updated_at > last_seen.value)
    )::int AS unread_feed
  `, [req.user.id])
  res.json(result.rows[0])
}))

app.post('/social/feed/seen', requireUser, asyncRoute(async (req, res) => {
  await pool.query(`INSERT INTO social_feed_reads (user_id, last_seen_at) VALUES ($1, NOW()) ON CONFLICT (user_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`, [req.user.id])
  res.status(204).end()
}))

app.get('/social/planned-visits', requireUser, asyncRoute(async (req, res) => {
  const result = await pool.query(`
    SELECT p.id, p.starts_at, p.ends_at, p.note, p.visibility, p.created_at, p.user_id,
           s.id AS spot_id, s.name AS spot_name, s.district, s.address,
           u.name AS user_name, u.username, u.image AS user_image,
           (p.user_id = $1) AS is_owner,
           (EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followed_id = p.user_id AND f.status = 'accepted') AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = p.user_id AND f.followed_id = $1 AND f.status = 'accepted')) AS is_friend,
           (SELECT COUNT(*)::int FROM planned_visit_rsvps r WHERE r.planned_visit_id = p.id AND r.response = 'going') AS going_count,
           (SELECT COUNT(*)::int FROM planned_visit_rsvps r WHERE r.planned_visit_id = p.id AND r.response = 'interested') AS interested_count,
           (SELECT response FROM planned_visit_rsvps r WHERE r.planned_visit_id = p.id AND r.user_id = $1) AS my_response
      FROM planned_visits p
      JOIN spots s ON s.id = p.spot_id
      JOIN users u ON u.id = p.user_id
     WHERE p.status = 'scheduled'
       AND p.starts_at >= NOW() - INTERVAL '2 hours'
       AND (
         p.user_id = $1
         OR p.visibility = 'public'
         OR (p.visibility = 'followers' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followed_id = p.user_id AND f.status = 'accepted'))
         OR (p.visibility = 'friends' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followed_id = p.user_id AND f.status = 'accepted') AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = p.user_id AND f.followed_id = $1 AND f.status = 'accepted'))
       )
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = p.user_id) OR (b.blocker_id = p.user_id AND b.blocked_id = $1))
     ORDER BY p.starts_at ASC
     LIMIT 20
  `, [req.user.id])
  res.json({ plannedVisits: result.rows })
}))

app.get('/planned-visits/mine', requireUser, asyncRoute(async (req, res) => {
  const result = await pool.query(`
    SELECT p.id, p.spot_id, p.starts_at, p.ends_at, p.note, p.visibility, p.status,
           s.name AS spot_name, s.district, s.address
      FROM planned_visits p JOIN spots s ON s.id = p.spot_id
     WHERE p.user_id = $1 AND p.status = 'scheduled' AND p.starts_at >= NOW() - INTERVAL '2 hours'
     ORDER BY p.starts_at ASC
  `, [req.user.id])
  res.json({ plannedVisits: result.rows })
}))

app.post('/planned-visits', requireUser, asyncRoute(async (req, res) => {
  const input = plannedVisitInputSchema.parse(req.body)
  const spot = await pool.query('SELECT id FROM spots WHERE id = $1 AND status = \'active\'', [input.spotId])
  if (!spot.rowCount) return res.status(404).json({ error: 'spot_not_found' })
  const result = await pool.query(
    `INSERT INTO planned_visits (user_id, spot_id, starts_at, ends_at, note, visibility)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, spot_id, starts_at, ends_at, note, visibility, status, created_at`,
    [req.user.id, input.spotId, input.startsAt, input.endsAt ?? null, input.note, input.visibility],
  )
  res.status(201).json({ plannedVisit: result.rows[0] })
}))

app.post('/planned-visits/:planId/rsvp', requireUser, asyncRoute(async (req, res) => {
  const planId = z.string().uuid().parse(req.params.planId)
  const input = z.object({ response: z.enum(['going', 'interested']) }).parse(req.body)
  const plan = await pool.query('SELECT id, user_id, visibility, status FROM planned_visits WHERE id = $1', [planId])
  const item = plan.rows[0]
  if (!item || item.status !== 'scheduled') return res.status(404).json({ error: 'planned_visit_not_found' })
  if (item.user_id === req.user.id) return res.status(400).json({ error: 'cannot_rsvp_own_plan' })
  if (!await canViewEntry(req.user.id, item.user_id, item.visibility)) return res.status(404).json({ error: 'planned_visit_not_found' })
  const result = await pool.query(
    `INSERT INTO planned_visit_rsvps (planned_visit_id, user_id, response)
     VALUES ($1, $2, $3)
     ON CONFLICT (planned_visit_id, user_id) DO UPDATE SET response = EXCLUDED.response, updated_at = NOW()
     RETURNING response`,
    [planId, req.user.id, input.response],
  )
  res.json({ rsvp: result.rows[0] })
}))

app.delete('/planned-visits/:planId/rsvp', requireUser, asyncRoute(async (req, res) => {
  const planId = z.string().uuid().parse(req.params.planId)
  await pool.query('DELETE FROM planned_visit_rsvps WHERE planned_visit_id = $1 AND user_id = $2', [planId, req.user.id])
  res.status(204).end()
}))

app.get('/planned-visits/:planId/rsvps', requireUser, asyncRoute(async (req, res) => {
  const planId = z.string().uuid().parse(req.params.planId)
  const plan = await pool.query('SELECT user_id, visibility, status FROM planned_visits WHERE id = $1', [planId])
  const item = plan.rows[0]
  if (!item || item.status !== 'scheduled' || !await canViewEntry(req.user.id, item.user_id, item.visibility)) return res.status(404).json({ error: 'planned_visit_not_found' })
  const result = await pool.query(`
    SELECT u.id, u.name, u.username, u.image, r.response
      FROM planned_visit_rsvps r JOIN users u ON u.id = r.user_id
     WHERE r.planned_visit_id = $1
     ORDER BY CASE r.response WHEN 'going' THEN 0 ELSE 1 END, u.name
  `, [planId])
  res.json({ rsvps: result.rows })
}))

app.get('/social/users/:userId/preview', requireUser, asyncRoute(async (req, res) => {
  const userId = z.string().uuid().parse(req.params.userId)
  if (!await areFriends(req.user.id, userId)) return res.status(403).json({ error: 'friends_required' })
  const [user, entries, plans] = await Promise.all([
    pool.query('SELECT id, name, username, image FROM users WHERE id = $1', [userId]),
    pool.query(`
      SELECT j.id, j.body, j.created_at, v.visited_at, s.name AS spot_name, s.district
        FROM journal_entries j JOIN visits v ON v.id = j.visit_id JOIN spots s ON s.id = v.spot_id
       WHERE j.user_id = $1 AND j.visibility IN ('public', 'followers', 'friends')
       ORDER BY j.created_at DESC LIMIT 3
    `, [userId]),
    pool.query(`
      SELECT p.id, p.starts_at, p.note, s.name AS spot_name
        FROM planned_visits p JOIN spots s ON s.id = p.spot_id
       WHERE p.user_id = $1 AND p.status = 'scheduled' AND p.starts_at >= NOW() - INTERVAL '2 hours' AND p.visibility IN ('public', 'followers', 'friends')
       ORDER BY p.starts_at ASC LIMIT 2
    `, [userId]),
  ])
  if (!user.rowCount) return res.status(404).json({ error: 'user_not_found' })
  res.json({ user: user.rows[0], entries: entries.rows, plans: plans.rows })
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
    SELECT id, name, district, address, website, opening_hours, area_sqm,
           CASE WHEN image_url LIKE 'upload:%' THEN '/api/spot-images/' || id ELSE image_url END AS image_url,
           source,
           ST_Y(coordinates::geometry) AS latitude,
           ST_X(coordinates::geometry) AS longitude
      FROM spots
     WHERE status = 'active'
     ORDER BY name
  `)
  res.json({ spots: result.rows })
}))

app.post('/spots/:spotId/corrections', requireUser, asyncRoute(async (req, res) => {
  const spotId = z.string().uuid().parse(req.params.spotId)
  const input = spotCorrectionInputSchema.parse(req.body)
  const spot = await pool.query('SELECT id FROM spots WHERE id = $1 AND status = \'active\'', [spotId])
  if (!spot.rowCount) return res.status(404).json({ error: 'spot_not_found' })
  const result = await pool.query(
    `INSERT INTO spot_correction_reports (spot_id, reporter_id, category, note, suggested_latitude, suggested_longitude)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, category, note, suggested_latitude, suggested_longitude, status, created_at`,
    [spotId, req.user.id, input.category, input.note, input.suggestedLatitude ?? null, input.suggestedLongitude ?? null],
  )
  res.status(201).json({ report: result.rows[0] })
}))

app.post('/spot-suggestions', requireUser, asyncRoute(async (req, res) => {
  const input = spotSuggestionInputSchema.parse(req.body)
  const result = await pool.query(
    `INSERT INTO spot_suggestions (submitted_by, name, district, address, website, latitude, longitude, notes)
     VALUES ($1, $2, NULLIF($3, ''), $4, NULLIF($5, ''), $6, $7, NULLIF($8, ''))
     RETURNING id, name, district, address, website, latitude, longitude, notes, status, created_at`,
    [req.user.id, input.name, input.district || '', input.address, input.website || '', input.latitude ?? null, input.longitude ?? null, input.notes || ''],
  )
  res.status(201).json({ suggestion: result.rows[0] })
}))

app.get('/admin/spot-suggestions', ...requireSuperAdmin, asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `SELECT ss.id, ss.name, ss.district, ss.address, ss.website, ss.latitude, ss.longitude, ss.notes, ss.created_at,
            u.name AS submitted_by_name, u.email AS submitted_by_email
       FROM spot_suggestions ss
       JOIN users u ON u.id = ss.submitted_by
      WHERE ss.status = 'pending'
      ORDER BY ss.created_at ASC`,
  )
  res.json({ suggestions: result.rows })
}))

app.get('/admin/spot-corrections', ...requireSuperAdmin, asyncRoute(async (_req, res) => {
  const result = await pool.query(`
    SELECT r.id, r.spot_id, r.category, r.note, r.suggested_latitude, r.suggested_longitude, r.created_at,
           u.name AS reporter_name, u.email AS reporter_email
      FROM spot_correction_reports r
      JOIN users u ON u.id = r.reporter_id
     WHERE r.status = 'pending'
     ORDER BY r.created_at ASC
  `)
  res.json({ reports: result.rows })
}))

app.post('/admin/spot-corrections/:reportId/:decision', ...requireSuperAdmin, asyncRoute(async (req, res) => {
  const reportId = z.string().uuid().parse(req.params.reportId)
  const decision = z.enum(['resolve', 'dismiss']).parse(req.params.decision)
  const status = decision === 'resolve' ? 'resolved' : 'dismissed'
  const result = await pool.query(
    `UPDATE spot_correction_reports
        SET status = $2, reviewed_by = $3, reviewed_at = NOW()
      WHERE id = $1 AND status = 'pending'
      RETURNING id, spot_id, status`,
    [reportId, status, req.user.id],
  )
  if (!result.rowCount) return res.status(404).json({ error: 'spot_correction_not_found' })
  res.json({ report: result.rows[0] })
}))

app.post('/admin/spot-suggestions/:suggestionId/approve', ...requireSuperAdmin, asyncRoute(async (req, res) => {
  const suggestionId = z.string().uuid().parse(req.params.suggestionId)
  const input = spotInputSchema.parse(req.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const suggestion = await client.query('SELECT id FROM spot_suggestions WHERE id = $1 AND status = \'pending\' FOR UPDATE', [suggestionId])
    if (!suggestion.rowCount) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'spot_suggestion_not_found' })
    }
    const created = await client.query(
      `INSERT INTO spots (name, district, address, website, opening_hours, area_sqm, image_url, coordinates, source, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, ST_SetSRID(ST_MakePoint($9, $8), 4326)::geography, 'user-suggestion', 'active')
       RETURNING id, name, district, address, website, opening_hours, area_sqm, image_url, source,
         ST_Y(coordinates::geometry) AS latitude, ST_X(coordinates::geometry) AS longitude`,
      [input.name, input.district, input.address, input.website || null, input.openingHours || null, input.areaSqm ?? null, input.imageUrl || null, input.latitude, input.longitude],
    )
    await client.query(
      `UPDATE spot_suggestions
          SET status = 'approved', approved_spot_id = $2, reviewed_by = $3, reviewed_at = NOW()
        WHERE id = $1`,
      [suggestionId, created.rows[0].id, req.user.id],
    )
    await client.query('COMMIT')
    res.status(201).json({ spot: created.rows[0] })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

app.post('/admin/spot-suggestions/:suggestionId/reject', ...requireSuperAdmin, asyncRoute(async (req, res) => {
  const suggestionId = z.string().uuid().parse(req.params.suggestionId)
  const input = z.object({ reviewNote: z.string().trim().max(1000).optional().or(z.literal('')) }).parse(req.body ?? {})
  const result = await pool.query(
    `UPDATE spot_suggestions
        SET status = 'rejected', review_note = NULLIF($3, ''), reviewed_by = $2, reviewed_at = NOW()
      WHERE id = $1 AND status = 'pending'
      RETURNING id`,
    [suggestionId, req.user.id, input.reviewNote || ''],
  )
  if (!result.rowCount) return res.status(404).json({ error: 'spot_suggestion_not_found' })
  res.status(204).end()
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

app.post('/admin/spots/:spotId/image', ...requireSuperAdmin, spotImageUpload.single('image'), asyncRoute(async (req, res) => {
  const spotId = z.string().uuid().parse(req.params.spotId)
  const file = req.file
  if (!file) return res.status(400).json({ error: 'no_valid_spot_image' })
  const storageKey = path.relative(uploadRoot, file.path).split(path.sep).join('/')
  const result = await pool.query(
    `UPDATE spots SET image_url = $2, updated_at = NOW() WHERE id = $1
     RETURNING id, name, '/api/spot-images/' || id AS image_url`,
    [spotId, `upload:${storageKey}`],
  )
  if (!result.rowCount) {
    await fs.unlink(file.path).catch(() => undefined)
    return res.status(404).json({ error: 'spot_not_found' })
  }
  res.status(201).json({ spot: result.rows[0] })
}))

app.patch('/admin/spots/:spotId', ...requireSuperAdmin, asyncRoute(async (req, res) => {
  const spotId = z.string().uuid().parse(req.params.spotId)
  const input = spotInputSchema.parse(req.body)
  const result = await pool.query(
    `UPDATE spots
        SET name = $2, district = $3, address = $4, website = $5, opening_hours = $6,
            area_sqm = $7,
            image_url = CASE WHEN $8::text IS NULL THEN image_url ELSE NULLIF($8, '') END,
            coordinates = ST_SetSRID(ST_MakePoint($10, $9), 4326)::geography,
            updated_at = NOW()
      WHERE id = $1 AND status = 'active'
      RETURNING id, name, district, address, website, opening_hours, area_sqm,
        CASE WHEN image_url LIKE 'upload:%' THEN '/api/spot-images/' || id ELSE image_url END AS image_url,
        source, ST_Y(coordinates::geometry) AS latitude, ST_X(coordinates::geometry) AS longitude`,
    [spotId, input.name, input.district, input.address, input.website || null, input.openingHours || null, input.areaSqm ?? null, input.imageUrl || null, input.latitude, input.longitude],
  )
  if (!result.rowCount) return res.status(404).json({ error: 'spot_not_found' })
  res.json({ spot: result.rows[0] })
}))

app.delete('/admin/spots/:spotId', ...requireSuperAdmin, asyncRoute(async (req, res) => {
  const spotId = z.string().uuid().parse(req.params.spotId)
  const result = await pool.query(
    `UPDATE spots SET status = 'archived', updated_at = NOW()
      WHERE id = $1 AND status = 'active'
      RETURNING id, name`,
    [spotId],
  )
  if (!result.rowCount) return res.status(404).json({ error: 'spot_not_found' })
  res.status(204).end()
}))

app.get('/spot-images/:spotId', asyncRoute(async (req, res) => {
  const spotId = z.string().uuid().parse(req.params.spotId)
  const result = await pool.query(`SELECT image_url FROM spots WHERE id = $1 AND image_url LIKE 'upload:%'`, [spotId])
  const imageUrl = result.rows[0]?.image_url
  if (!imageUrl) return res.status(404).end()
  const storageKey = imageUrl.slice('upload:'.length)
  const absolutePath = path.resolve(uploadRoot, storageKey)
  if (!absolutePath.startsWith(path.resolve(uploadRoot, 'spot-images'))) return res.status(400).end()
  res.sendFile(absolutePath)
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
    SELECT v.id, v.spot_id, v.visited_at, v.started_at, v.ended_at, v.created_at, s.name AS spot_name,
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
  const input = visitInputSchema.parse(req.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const visit = await client.query(
      `INSERT INTO visits (user_id, spot_id, visited_at, started_at, ended_at)
       VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), NULLIF($4, '')::time, NULLIF($5, '')::time)
       RETURNING id, spot_id, visited_at, started_at, ended_at, created_at`,
      [req.user.id, input.spotId, input.visitedAt ?? null, input.startedAt ?? '', input.endedAt ?? ''],
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
