import 'dotenv/config'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { ZipArchive } from 'archiver'
import ExcelJS from 'exceljs'
import express from 'express'
import multer from 'multer'
import nodemailer from 'nodemailer'
import webpush from 'web-push'
import { ExpressAuth, getSession } from '@auth/express'
import Credentials from '@auth/express/providers/credentials'
import Google from '@auth/express/providers/google'
import PostgresAdapter from '@auth/pg-adapter'
import { Pool } from 'pg'
import { z } from 'zod'
import { areMutualFollowers, isEntryVisible } from './visibility.js'

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
const notificationCategories = ['messages', 'friendships', 'comments', 'reactions', 'plans', 'reminders', 'groups']
const notificationDefaults = {
  messages: { inAppEnabled: true, pushEnabled: true },
  friendships: { inAppEnabled: true, pushEnabled: true },
  comments: { inAppEnabled: true, pushEnabled: true },
  reactions: { inAppEnabled: true, pushEnabled: false },
  plans: { inAppEnabled: true, pushEnabled: true },
  reminders: { inAppEnabled: true, pushEnabled: true },
  groups: { inAppEnabled: true, pushEnabled: true },
}
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY?.trim()
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY?.trim()
const vapidSubject = process.env.VAPID_SUBJECT?.trim()
let pushConfigured = process.env.PUSH_NOTIFICATIONS_ENABLED === 'true' && Boolean(vapidPublicKey && vapidPrivateKey && vapidSubject)
if (pushConfigured) {
  try {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
  } catch (error) {
    pushConfigured = false
    console.error('Web-Push ist deaktiviert: VAPID-Konfiguration ist ungültig.', error)
  }
}
const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD && process.env.SMTP_FROM)
const geocodingCache = new Map()
let lastGeocodingRequestAt = 0
const loginAttemptWindowMs = 15 * 60 * 1000
const loginAttemptLimit = 10
const loginAttemptsByIp = new Map()
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

async function writeAuthAudit(eventType, user) {
  try {
    await pool.query(
      `INSERT INTO auth_audit_events (event_type, user_id, user_name, user_email)
       VALUES ($1, $2, $3, $4)`,
      [eventType, user.id, user.name, user.email],
    )
  } catch (error) {
    console.error('Konto-Audit konnte nicht geschrieben werden:', error)
  }
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
  const logoUrl = new URL('/BoulderO_Logo.ico', publicAppOrigin(req)).toString()
  const expiry = isVerification ? '24 Stunden' : 'eine Stunde'
  const html = `<!doctype html><html lang="de"><body style="margin:0;padding:0;background:#edf1f0;font-family:Arial,sans-serif;color:#153243"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden"><tr><td style="padding:28px 32px 20px;background:#153243;color:#ffffff"><img src="${logoUrl}" width="42" height="42" alt="BoulderO" style="display:block;margin-bottom:12px" /><div style="font-size:25px;font-weight:700;letter-spacing:-.4px">BoulderO</div><div style="margin-top:5px;color:#d8e3e2;font-size:13px">Deine Boulderkarte</div></td></tr><tr><td style="padding:32px"><h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#153243">${title}</h1><p style="margin:0 0 14px;font-size:16px;line-height:1.55">Hallo ${escapeHtml(user.name || 'BoulderO Mitglied')},</p><p style="margin:0 0 24px;font-size:16px;line-height:1.55">${copy}</p><a href="${url.toString()}" style="display:inline-block;padding:13px 20px;border-radius:8px;background:#153243;color:#ffffff;text-decoration:none;font-weight:700">${action}</a><p style="margin:28px 0 0;padding-top:20px;border-top:1px solid #dce4e1;color:#587080;font-size:13px;line-height:1.55">Der Link ist ${expiry} gültig. Falls du diese Nachricht nicht angefordert hast, kannst du sie ignorieren.</p></td></tr></table><p style="margin:16px 0 0;color:#587080;font-size:12px">© BoulderO · <a href="https://bouldero.de" style="color:#587080">bouldero.de</a></p></td></tr></table></body></html>`
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
    authorize: async (credentials) => {
      const authenticated = matchesSecret(String(credentials?.email).trim().toLowerCase(), superAdminEmail)
        && matchesSecret(credentials?.password, superAdminPassword)
      if (!authenticated) return null
      await writeAuthAudit('login', superAdmin)
      return superAdmin
    },
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
    if (superAdminEnabled && matchesSecret(email, superAdminEmail) && matchesSecret(password, superAdminPassword)) {
      await writeAuthAudit('login', superAdmin)
      return superAdmin
    }
    const result = await pool.query('SELECT id, name, email, username, image, role, password_hash, email_verified_at FROM users WHERE email = $1', [email])
    const user = result.rows[0]
    if (!user || !user.email_verified_at || !await passwordMatches(password, user.password_hash)) return null
    const authenticatedUser = { id: user.id, name: user.name, email: user.email, username: user.username, image: user.image, role: user.role }
    await writeAuthAudit('login', authenticatedUser)
    return authenticatedUser
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
function limitLoginAttempts(req, res, next) {
  const now = Date.now()
  const ip = req.ip || req.socket.remoteAddress || 'unknown'
  const recentAttempts = (loginAttemptsByIp.get(ip) ?? []).filter((attempt) => now - attempt < loginAttemptWindowMs)
  if (recentAttempts.length >= loginAttemptLimit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((loginAttemptWindowMs - (now - recentAttempts[0])) / 1000))
    res.set('Retry-After', String(retryAfterSeconds))
    return res.status(429).json({ error: 'too_many_login_attempts', retry_after_seconds: retryAfterSeconds })
  }
  recentAttempts.push(now)
  loginAttemptsByIp.set(ip, recentAttempts)
  next()
}
app.post([
  '/api/auth/callback/member',
  '/auth/callback/member',
  '/api/auth/callback/superadmin',
  '/auth/callback/superadmin',
], limitLoginAttempts)
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

const registrationUsernameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,24}$/)

app.get('/register/username-availability', asyncRoute(async (req, res) => {
  const username = registrationUsernameSchema.parse(req.query.username)
  const result = await pool.query('SELECT 1 FROM users WHERE username = $1', [username])
  res.json({ username, available: !result.rowCount })
}))

app.post('/register', asyncRoute(async (req, res) => {
  if (!emailTransport) return res.status(503).json({ error: 'email_not_configured' })
  const input = z.object({
    name: z.string().trim().min(2).max(80),
    username: registrationUsernameSchema,
    email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
    password: z.string().min(10).max(200),
  }).parse(req.body)
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [input.email])
  if (existing.rowCount) return res.status(409).json({ error: 'email_taken' })
  const hash = await passwordHash(input.password)
  try {
    const created = await pool.query(
      `INSERT INTO users (name, email, username, password_hash, role)
       VALUES ($1, $2, $3, $4, 'member') RETURNING id, name, email, username, role`,
      [input.name, input.email, input.username, hash],
    )
    await writeAuthAudit('registration', created.rows[0])
    try {
      await sendAccountActionEmail(req, created.rows[0], 'verify_email')
    } catch (error) {
      console.error('Bestätigungs-E-Mail konnte nicht versendet werden:', error)
      return res.status(503).json({ error: 'email_delivery_failed' })
    }
    return res.status(201).json({ user: created.rows[0], verificationRequired: true })
  } catch (error) {
    if (error?.code === '23505' && error?.constraint?.includes('email')) return res.status(409).json({ error: 'email_taken' })
    if (error?.code === '23505' && error?.constraint?.includes('username')) return res.status(409).json({ error: 'username_taken' })
    throw error
  }
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

async function relationshipState(firstUserId, secondUserId) {
  const relationship = await pool.query(
    `SELECT
       EXISTS(SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)) AS blocked,
       EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND followed_id = $2 AND status = 'accepted') AS first_follows_second,
       EXISTS(SELECT 1 FROM follows WHERE follower_id = $2 AND followed_id = $1 AND status = 'accepted') AS second_follows_first`,
    [firstUserId, secondUserId],
  )
  return relationship.rows[0]
}

async function canViewEntry(viewerId, entryUserId, visibility) {
  if (viewerId === entryUserId) return true
  const relationship = await relationshipState(viewerId, entryUserId)
  return isEntryVisible({
    viewerId,
    ownerId: entryUserId,
    visibility,
    blocked: relationship.blocked,
    followsOwner: relationship.first_follows_second,
    ownerFollowsViewer: relationship.second_follows_first,
  })
}

async function getViewableEntry(viewerId, entryId) {
  const result = await pool.query('SELECT id, user_id, visibility FROM journal_entries WHERE id = $1', [entryId])
  const entry = result.rows[0]
  if (!entry || !await canViewEntry(viewerId, entry.user_id, entry.visibility)) return null
  return entry
}

async function areFriends(firstUserId, secondUserId) {
  if (firstUserId === secondUserId) return false
  const relationship = await relationshipState(firstUserId, secondUserId)
  return areMutualFollowers({
    blocked: relationship.blocked,
    firstFollowsSecond: relationship.first_follows_second,
    secondFollowsFirst: relationship.second_follows_first,
  })
}

async function ensureNotificationPreferences(client, userId) {
  await client.query(
    `INSERT INTO notification_preferences (user_id, category, in_app_enabled, push_enabled)
     VALUES
       ($1, 'messages', TRUE, TRUE),
       ($1, 'friendships', TRUE, TRUE),
       ($1, 'comments', TRUE, TRUE),
       ($1, 'reactions', TRUE, FALSE),
       ($1, 'plans', TRUE, TRUE),
       ($1, 'reminders', TRUE, TRUE),
       ($1, 'groups', TRUE, TRUE)
     ON CONFLICT (user_id, category) DO NOTHING`,
    [userId],
  )
}

async function preferencesForUser(client, userId) {
  await ensureNotificationPreferences(client, userId)
  const result = await client.query(
    'SELECT category, in_app_enabled, push_enabled FROM notification_preferences WHERE user_id = $1',
    [userId],
  )
  return Object.fromEntries(result.rows.map((row) => [row.category, {
    inAppEnabled: row.in_app_enabled,
    pushEnabled: row.push_enabled,
  }]))
}

function privatePushCopy(category) {
  return ({
    messages: 'Neue Nachricht in BoulderO',
    friendships: 'Neue Freundschaftsaktivität in BoulderO',
    comments: 'Neuer Kommentar zu deinem Beitrag',
    reactions: 'Neue Reaktion auf deinen Beitrag',
    plans: 'Neue Änderung bei einer Planung',
    reminders: 'Erinnerung an deine Boulderplanung',
    groups: 'Neue Aktivität in einer Bouldergruppe',
  })[category] ?? 'Neue Benachrichtigung in BoulderO'
}

async function createNotifications(client, { recipientIds, actorId = null, type, category, plannedVisitId = null, payload = {}, title, body, targetUrl }) {
  const recipients = [...new Set(recipientIds.filter((id) => id && id !== actorId))]
  const createdIds = []
  for (const recipientId of recipients) {
    const preferences = await preferencesForUser(client, recipientId)
    const preference = preferences[category] ?? notificationDefaults[category]
    const deliverPush = pushConfigured && preference.pushEnabled
    if (!preference.inAppEnabled && !deliverPush) continue
    const notification = await client.query(
      `INSERT INTO notifications (user_id, actor_id, type, category, planned_visit_id, payload, title, body, target_url, in_app_visible)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [recipientId, actorId, type, category, plannedVisitId, JSON.stringify(payload), title, body, targetUrl, preference.inAppEnabled],
    )
    if (!notification.rowCount) continue
    const notificationId = notification.rows[0].id
    createdIds.push(notificationId)
    if (deliverPush) {
      await client.query(
        `INSERT INTO notification_deliveries (notification_id, subscription_id)
         SELECT $1, id FROM push_subscriptions WHERE user_id = $2
         ON CONFLICT (notification_id, subscription_id) DO NOTHING`,
        [notificationId, recipientId],
      )
    }
  }
  return createdIds
}

async function notifyPlanUsers(client, planId, actorId, type, payload, recipientIds) {
  const presentation = {
    plan_rsvp: { title: 'Neue Zusage', body: `Es gibt eine neue Rückmeldung für ${payload.spotName}.` },
    plan_updated: { title: 'Planung geändert', body: `Die Planung für ${payload.spotName} wurde geändert.` },
    plan_cancelled: { title: 'Planung abgesagt', body: `Die Planung für ${payload.spotName} wurde abgesagt.` },
    plan_reminder: { title: 'Erinnerung', body: `Deine Planung bei ${payload.spotName} steht bald an.` },
  }[type]
  return createNotifications(client, {
    recipientIds,
    actorId,
    type,
    category: type === 'plan_reminder' ? 'reminders' : 'plans',
    plannedVisitId: planId,
    payload,
    title: presentation.title,
    body: presentation.body,
    targetUrl: `/social?section=plans&plan=${encodeURIComponent(planId)}`,
  })
}

function isGroupManager(membership) {
  return membership?.status === 'active' && ['owner', 'admin'].includes(membership.role)
}

async function groupMembership(client, groupId, userId) {
  const result = await client.query(
    `SELECT group_id, user_id, role, status, notification_level, invited_by, request_note, joined_at
       FROM community_group_members
      WHERE group_id = $1 AND user_id = $2`,
    [groupId, userId],
  )
  return result.rows[0] ?? null
}

async function groupMembersForNotification(client, groupId, importance = 'important') {
  const result = await client.query(
    `SELECT user_id
       FROM community_group_members
      WHERE group_id = $1
        AND status = 'active'
        AND notification_level <> 'muted'
        AND ($2 <> 'message' OR notification_level = 'all')`,
    [groupId, importance],
  )
  return result.rows.map((row) => row.user_id)
}

async function notifyGroupMembers(client, { groupId, actorId = null, type, title, body, targetTab = 'overview', plannedVisitId = null, payload = {}, importance = 'important', recipientIds = null }) {
  const recipients = recipientIds ?? await groupMembersForNotification(client, groupId, importance)
  return createNotifications(client, {
    recipientIds: recipients,
    actorId,
    type,
    category: 'groups',
    plannedVisitId,
    payload: { groupId, ...payload },
    title,
    body,
    targetUrl: `/groups?group=${encodeURIComponent(groupId)}&tab=${encodeURIComponent(targetTab)}`,
  })
}

async function promoteGroupWaitlist(client, planId) {
  const event = await client.query('SELECT capacity FROM planned_visits WHERE id = $1 FOR UPDATE', [planId])
  const capacity = event.rows[0]?.capacity
  if (!capacity) return null
  const going = await client.query("SELECT COUNT(*)::int AS count FROM planned_visit_rsvps WHERE planned_visit_id = $1 AND response = 'going'", [planId])
  if (going.rows[0].count >= capacity) return null
  const waiting = await client.query(
    `SELECT user_id FROM planned_visit_rsvps
      WHERE planned_visit_id = $1 AND response = 'waitlisted'
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE`,
    [planId],
  )
  if (!waiting.rowCount) return null
  await client.query(
    "UPDATE planned_visit_rsvps SET response = 'going', updated_at = NOW() WHERE planned_visit_id = $1 AND user_id = $2",
    [planId, waiting.rows[0].user_id],
  )
  return waiting.rows[0].user_id
}

async function claimPendingPushDeliveries(limit = 25) {
  if (!pushConfigured) return []
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const claimed = await client.query(
      `WITH candidates AS (
         SELECT id
           FROM notification_deliveries
          WHERE status = 'pending'
            AND available_at <= NOW()
            AND (locked_until IS NULL OR locked_until < NOW())
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT $1
       )
       UPDATE notification_deliveries delivery
          SET attempt_count = delivery.attempt_count + 1,
              locked_until = NOW() + INTERVAL '2 minutes'
         FROM candidates
        WHERE delivery.id = candidates.id
       RETURNING delivery.id`,
      [limit],
    )
    if (!claimed.rowCount) {
      await client.query('COMMIT')
      return []
    }
    const deliveries = await client.query(
      `SELECT delivery.id, delivery.attempt_count, notification.user_id, notification.title, notification.body,
              notification.category, notification.target_url, subscription.endpoint, subscription.p256dh,
              subscription.auth, subscription.content_preview_enabled, subscription.badge_enabled
         FROM notification_deliveries delivery
         JOIN notifications notification ON notification.id = delivery.notification_id
         JOIN push_subscriptions subscription ON subscription.id = delivery.subscription_id
        WHERE delivery.id = ANY($1::uuid[])`,
      [claimed.rows.map((row) => row.id)],
    )
    await client.query('COMMIT')
    return deliveries.rows
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function flushPushDeliveries() {
  const deliveries = await claimPendingPushDeliveries()
  for (const delivery of deliveries) {
    try {
      const unread = delivery.badge_enabled
        ? await pool.query('SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND in_app_visible AND read_at IS NULL', [delivery.user_id])
        : { rows: [{ count: 0 }] }
      const payload = {
        title: delivery.content_preview_enabled ? delivery.title : 'BoulderO',
        body: delivery.content_preview_enabled ? delivery.body : privatePushCopy(delivery.category),
        targetUrl: delivery.target_url,
        badgeCount: unread.rows[0].count,
        showBadge: delivery.badge_enabled,
      }
      await webpush.sendNotification({ endpoint: delivery.endpoint, keys: { p256dh: delivery.p256dh, auth: delivery.auth } }, JSON.stringify(payload), { TTL: 60 * 60 })
      await pool.query('UPDATE notification_deliveries SET status = \'sent\', sent_at = NOW(), locked_until = NULL, last_error = NULL WHERE id = $1', [delivery.id])
      await pool.query('UPDATE push_subscriptions SET last_used_at = NOW() WHERE endpoint = $1', [delivery.endpoint])
    } catch (error) {
      const statusCode = Number(error?.statusCode)
      if (statusCode === 404 || statusCode === 410) {
        await pool.query("UPDATE notification_deliveries SET status = 'failed', locked_until = NULL, last_error = 'subscription_expired' WHERE id = $1", [delivery.id])
        await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [delivery.endpoint])
      } else {
        const exhausted = delivery.attempt_count >= 5
        const delayMinutes = Math.min(24 * 60, 2 ** delivery.attempt_count)
        await pool.query(
          `UPDATE notification_deliveries
              SET status = CASE WHEN $2 THEN 'failed' ELSE 'pending' END,
                  available_at = NOW() + ($3 * INTERVAL '1 minute'),
                  locked_until = NULL,
                  last_error = $4
            WHERE id = $1`,
          [delivery.id, exhausted, delayMinutes, String(error?.message ?? 'push_delivery_failed').slice(0, 500)],
        )
      }
    }
  }
}

async function schedulePlanReminders() {
  const duePlans = await pool.query(
    `SELECT plan.id, plan.user_id, plan.starts_at, spot.name AS spot_name
       FROM planned_visits plan
       JOIN spots spot ON spot.id = plan.spot_id
      WHERE plan.status = 'scheduled'
        AND plan.starts_at > NOW()
        AND plan.starts_at <= NOW() + INTERVAL '2 hours'
        AND NOT EXISTS (
          SELECT 1 FROM notifications reminder
           WHERE reminder.user_id = plan.user_id
             AND reminder.planned_visit_id = plan.id
             AND reminder.type = 'plan_reminder'
        )
      ORDER BY plan.starts_at
      LIMIT 100`,
  )
  for (const plan of duePlans.rows) {
    await createNotifications(pool, {
      recipientIds: [plan.user_id], type: 'plan_reminder', category: 'reminders', plannedVisitId: plan.id,
      payload: { spotName: plan.spot_name, startsAt: plan.starts_at }, title: 'Boulderplanung in Kürze',
      body: `Deine Planung bei ${plan.spot_name} beginnt in weniger als zwei Stunden.`,
      targetUrl: `/social?section=plans&plan=${encodeURIComponent(plan.id)}`,
    })
  }
  if (duePlans.rowCount) void flushPushDeliveries().catch((error) => console.error('Push-Zustellung fehlgeschlagen:', error))
}

async function planRsvpUsers(client, planId) {
  const result = await client.query('SELECT user_id FROM planned_visit_rsvps WHERE planned_visit_id = $1', [planId])
  return result.rows.map((row) => row.user_id)
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

const groupImageUpload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, callback) => {
      try {
        const directory = path.join(uploadRoot, 'group-images')
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

const spotImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const name = file.originalname.toLowerCase()
    const supportedType = /^(text\/csv|application\/csv|application\/vnd\.ms-excel|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet)$/.test(file.mimetype)
    callback(null, supportedType || name.endsWith('.csv') || name.endsWith('.xlsx'))
  },
})

const spotInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  district: z.string().trim().min(2).max(120),
  address: z.string().trim().min(5).max(300),
  website: z.string().trim().url().max(500).optional().or(z.literal('')),
  openingHours: z.string().trim().max(300).optional(),
  areaSqm: z.union([z.string(), z.number()]).transform((value) => String(value).trim()).pipe(z.string().max(120)).nullable().optional(),
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

const plannedVisitUpdateSchema = z.object({
  spotId: z.string().uuid().optional(),
  startsAt: z.string().datetime({ offset: true }).optional(),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  note: z.string().trim().max(2000).optional(),
  visibility: z.enum(['private', 'friends', 'followers', 'public']).optional(),
})

const plannedVisitCancelSchema = z.object({
  reason: z.string().trim().max(1000).default(''),
})

const groupAccessModes = ['open', 'request', 'private']
const groupRoles = ['owner', 'admin', 'member']
const groupNotificationLevels = ['all', 'important', 'muted']
const groupInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(2000).default(''),
  city: z.string().trim().max(120).default(''),
  accessMode: z.enum(groupAccessModes).default('request'),
  spotIds: z.array(z.string().uuid()).max(5).default([]),
})

const groupUpdateSchema = groupInputSchema.partial().refine((value) => Object.keys(value).length > 0)

const groupMessageSchema = z.object({ body: z.string().trim().min(1).max(2000) })

const groupEventInputSchema = z.object({
  spotId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  note: z.string().trim().max(2000).default(''),
  capacity: z.number().int().min(1).max(500).nullable().optional(),
  recurrence: z.object({
    frequency: z.enum(['weekly', 'biweekly', 'monthly']),
    repeatUntil: z.string().date(),
  }).nullable().optional(),
})

const groupEventSchema = groupEventInputSchema.superRefine((value, context) => {
  if (value.endsAt && new Date(value.endsAt) <= new Date(value.startsAt)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Die Endzeit muss nach dem Beginn liegen.' })
  if (value.recurrence && new Date(`${value.recurrence.repeatUntil}T23:59:59`) < new Date(value.startsAt)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Die Terminserie muss nach dem ersten Termin enden.' })
})

const groupEventUpdateSchema = groupEventInputSchema.omit({ recurrence: true }).partial().refine((value) => Object.keys(value).length > 0)

const groupPollSchema = z.object({
  question: z.string().trim().min(3).max(240),
  kind: z.enum(['spot', 'date', 'general']),
  closesAt: z.string().datetime({ offset: true }).nullable().optional(),
  options: z.array(z.object({
    label: z.string().trim().min(1).max(160),
    spotId: z.string().uuid().nullable().optional(),
    startsAt: z.string().datetime({ offset: true }).nullable().optional(),
  })).min(2).max(8),
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

function importCellText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    if (value.hyperlink !== undefined) return String(value.hyperlink)
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text ?? '').join('')
    if (value.text !== undefined) return importCellText(value.text)
    if (value.result !== undefined) return importCellText(value.result)
  }
  return String(value)
}

function normalizedImportHeader(value) {
  return importCellText(value).trim().replace(/^\uFEFF/, '').toLowerCase()
}

async function importFileRows(file) {
  const isXlsx = file.originalname.toLowerCase().endsWith('.xlsx')
    || file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (!isXlsx) return parseCsv(file.buffer.toString('utf8')).map((values, index) => ({ rowNumber: index + 1, values }))

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(file.buffer)
  const sheet = workbook.getWorksheet('Hallen') ?? workbook.worksheets[0]
  if (!sheet) throw new Error('xlsx_sheet_required')
  const rows = []
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const values = row.values.slice(1).map(importCellText)
    if (values.some((value) => value.trim())) rows.push({ rowNumber, values })
  })
  return rows
}

function optionalImportArea(value) {
  const normalized = importCellText(value).trim()
  if (!normalized || normalized === '0') return undefined
  return normalized
}

function coordinateFromImport(value, field, rowNumber, maximum) {
  const text = importCellText(value).trim()
  let coordinate = numberFromCsv(text, field, rowNumber)
  // German Excel can interpret dots in copied coordinates as thousands
  // separators (48.8161875 becomes 488161875). Reinsert the decimal point
  // only when an integer is clearly outside the valid coordinate range.
  if (Math.abs(coordinate) > maximum && /^-?\d+$/.test(text)) {
    while (Math.abs(coordinate) > maximum) coordinate /= 10
  }
  if (coordinate < -maximum || coordinate > maximum) throw new Error(`Zeile ${rowNumber}: ${field} ist ungültig.`)
  return coordinate
}

function importText(value) {
  return importCellText(value).trim()
}

function normalizedImportKey(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('de-DE').replace(/[^a-z0-9]/g, '')
}

function markDuplicateImportRows(rows) {
  const groups = new Map()
  for (const row of rows) {
    if (!row.input || row.error) continue
    const input = row.input
    const key = row.id
      ? `id:${row.id}`
      : row.source && row.sourceExternalId
        ? `source:${row.source}:${row.sourceExternalId}`
        : `hall:${normalizedImportKey(input.name)}:${input.latitude.toFixed(5)}:${input.longitude.toFixed(5)}`
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue
    for (const row of group) row.error = 'Die Halle kommt in dieser Datei mehrfach vor.'
  }
}

async function parseAdminSpotImport(file) {
  if (!file) throw new Error('import_file_required')
  let rows
  try {
    rows = await importFileRows(file)
  } catch (error) {
    if (error.message?.startsWith('xlsx_')) throw error
    throw new Error('xlsx_invalid')
  }
  if (rows.length < 2) throw new Error('csv_rows_required')
  if (rows.length > 501) throw new Error('csv_limit_exceeded')
  const headers = rows[0].values.map(normalizedImportHeader)
  const required = ['name', 'district', 'address', 'latitude', 'longitude']
  const missing = required.filter((name) => !headers.includes(name))
  if (missing.length) {
    const error = new Error('csv_headers_invalid')
    error.missing = missing
    throw error
  }
  const parsed = rows.slice(1).map(({ rowNumber, values }) => {
    const record = { rowNumber }
    headers.forEach((header, column) => { record[header] = values[column] ?? '' })
    try {
      const id = importText(record.id)
      const source = importText(record.source)
      const sourceExternalId = importText(record.source_external_id)
      return {
        rowNumber: record.rowNumber,
        input: spotInputSchema.parse({
          name: importText(record.name),
          district: importText(record.district),
          address: importText(record.address),
          website: importText(record.website) || undefined,
          openingHours: importText(record.opening_hours) || undefined,
          areaSqm: optionalImportArea(record.area_sqm),
          latitude: coordinateFromImport(record.latitude, 'latitude', record.rowNumber, 90),
          longitude: coordinateFromImport(record.longitude, 'longitude', record.rowNumber, 180),
        }),
        id: id ? z.string().uuid().parse(id) : null,
        source: source || null,
        sourceExternalId: sourceExternalId || null,
        error: null,
      }
    } catch (error) {
      return { rowNumber: record.rowNumber, input: null, error: error.issues?.[0]?.message ?? error.message }
    }
  })
  markDuplicateImportRows(parsed)
  return parsed
}

function candidateFromSpot(spot, input, matchType) {
  const latitude = Number(spot.latitude)
  const longitude = Number(spot.longitude)
  const latitudeDifference = (input.latitude - latitude) * Math.PI / 180
  const longitudeDifference = (input.longitude - longitude) * Math.PI / 180
  const a = Math.sin(latitudeDifference / 2) ** 2
    + Math.cos(input.latitude * Math.PI / 180) * Math.cos(latitude * Math.PI / 180) * Math.sin(longitudeDifference / 2) ** 2
  return {
    ...spot,
    match_type: matchType,
    same_name: normalizedImportKey(spot.name) === normalizedImportKey(input.name),
    distance_m: Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))),
    changes: importChanges(input, spot),
  }
}

function sameImportValue(first, second) {
  return String(first ?? '').trim() === String(second ?? '').trim()
}

function importChanges(input, spot) {
  const changes = []
  const fields = [
    ['Name', 'name'],
    ['Ort', 'district'],
    ['Adresse', 'address'],
    ['Website', 'website'],
    ['Öffnungszeiten', 'openingHours', 'opening_hours'],
    ['Area', 'areaSqm', 'area_sqm'],
  ]
  for (const [label, inputKey, spotKey = inputKey] of fields) {
    // Leere optionale Importfelder lassen vorhandene Daten bewusst unverändert.
    if (['website', 'openingHours', 'areaSqm'].includes(inputKey) && input[inputKey] === undefined) continue
    if (!sameImportValue(input[inputKey], spot[spotKey])) {
      changes.push({ field: label, before: spot[spotKey] ?? null, after: input[inputKey] ?? null })
    }
  }
  const latitudeChanged = Math.abs(Number(input.latitude) - Number(spot.latitude)) > 0.0000001
  const longitudeChanged = Math.abs(Number(input.longitude) - Number(spot.longitude)) > 0.0000001
  if (latitudeChanged || longitudeChanged) {
    changes.push({
      field: 'Position',
      before: `${Number(spot.latitude).toFixed(6)}, ${Number(spot.longitude).toFixed(6)}`,
      after: `${Number(input.latitude).toFixed(6)}, ${Number(input.longitude).toFixed(6)}`,
    })
  }
  return changes
}

async function findImportCandidates(rows) {
  const candidates = new Map()
  const validRows = rows.filter((row) => row.input && !row.error)
  if (!validRows.length) return candidates

  const withId = validRows.filter((row) => row.id)
  if (withId.length) {
    const result = await pool.query(`
      SELECT id, name, district, address, website, opening_hours, area_sqm, status,
             ST_Y(coordinates::geometry) AS latitude, ST_X(coordinates::geometry) AS longitude
        FROM spots
       WHERE id = ANY($1::uuid[])
    `, [withId.map((row) => row.id)])
    const spotsById = new Map(result.rows.map((spot) => [spot.id, spot]))
    for (const row of withId) {
      const spot = spotsById.get(row.id)
      if (!spot) row.error = 'Die BoulderO-ID existiert nicht mehr. Entferne die ID, um die Halle als neue Halle zu importieren.'
      else candidates.set(row.rowNumber, [candidateFromSpot(spot, row.input, 'id')])
    }
  }

  const withSourceId = validRows.filter((row) => !row.id && row.source && row.sourceExternalId)
  if (withSourceId.length) {
    const params = []
    const values = withSourceId.map((row, index) => {
      const start = index * 3
      params.push(row.rowNumber, row.source, row.sourceExternalId)
      return `($${start + 1}::int, $${start + 2}::text, $${start + 3}::text)`
    }).join(', ')
    const result = await pool.query(`
      WITH incoming(row_number, source, source_external_id) AS (VALUES ${values})
      SELECT incoming.row_number, spots.id, spots.name, spots.district, spots.address, spots.website, spots.opening_hours, spots.area_sqm, spots.status,
             ST_Y(spots.coordinates::geometry) AS latitude, ST_X(spots.coordinates::geometry) AS longitude
        FROM incoming
        JOIN spots ON spots.source = incoming.source AND spots.source_external_id = incoming.source_external_id
    `, params)
    for (const spot of result.rows) {
      const row = withSourceId.find((item) => item.rowNumber === spot.row_number)
      if (row) candidates.set(row.rowNumber, [candidateFromSpot(spot, row.input, 'source_external_id')])
    }
  }

  const fuzzyRows = validRows.filter((row) => !row.id && !candidates.has(row.rowNumber))
  if (!fuzzyRows.length) return candidates
  const params = []
  const values = fuzzyRows.map((row, index) => {
    const start = index * 4
    params.push(row.rowNumber, row.input.name, row.input.latitude, row.input.longitude)
    return `($${start + 1}::int, $${start + 2}::text, $${start + 3}::double precision, $${start + 4}::double precision)`
  }).join(', ')
  const result = await pool.query(`
    WITH incoming(row_number, name, latitude, longitude) AS (VALUES ${values})
    SELECT incoming.row_number, spots.id, spots.name, spots.district, spots.address, spots.website, spots.opening_hours, spots.area_sqm, spots.status,
           ROUND(ST_Distance(spots.coordinates, ST_SetSRID(ST_MakePoint(incoming.longitude, incoming.latitude), 4326)::geography))::int AS distance_m,
           LOWER(TRIM(spots.name)) = LOWER(TRIM(incoming.name)) AS same_name
      FROM incoming
      JOIN spots ON LOWER(TRIM(spots.name)) = LOWER(TRIM(incoming.name))
        OR ST_DWithin(spots.coordinates, ST_SetSRID(ST_MakePoint(incoming.longitude, incoming.latitude), 4326)::geography, 150)
     ORDER BY incoming.row_number, same_name DESC, distance_m ASC, spots.name ASC
  `, params)
  for (const row of result.rows) {
    const items = candidates.get(row.row_number) ?? []
    const input = fuzzyRows.find((item) => item.rowNumber === row.row_number)?.input
    items.push({ ...row, match_type: row.same_name ? 'name' : 'nearby', changes: input ? importChanges(input, row) : [] })
    candidates.set(row.row_number, items)
  }
  return candidates
}

app.get('/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1')
  res.json({ status: 'ok' })
}))

app.get('/me', requireUser, (req, res) => res.json({ user: req.user }))

app.get('/notification-preferences', requireUser, asyncRoute(async (req, res) => {
  const preferences = await preferencesForUser(pool, req.user.id)
  res.json({
    preferences: notificationCategories.map((category) => ({ category, ...preferences[category] })),
    push: {
      configured: pushConfigured,
      publicKey: pushConfigured ? vapidPublicKey : null,
    },
  })
}))

app.put('/notification-preferences', requireUser, asyncRoute(async (req, res) => {
  const input = z.object({
    preferences: z.array(z.object({
      category: z.enum(notificationCategories),
      inAppEnabled: z.boolean(),
      pushEnabled: z.boolean(),
    })).min(1).max(notificationCategories.length),
  }).parse(req.body)
  if (new Set(input.preferences.map((preference) => preference.category)).size !== input.preferences.length) {
    return res.status(400).json({ error: 'duplicate_notification_category' })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await ensureNotificationPreferences(client, req.user.id)
    for (const preference of input.preferences) {
      await client.query(
        `INSERT INTO notification_preferences (user_id, category, in_app_enabled, push_enabled, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (user_id, category)
         DO UPDATE SET in_app_enabled = EXCLUDED.in_app_enabled, push_enabled = EXCLUDED.push_enabled, updated_at = NOW()`,
        [req.user.id, preference.category, preference.inAppEnabled, preference.pushEnabled],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  const preferences = await preferencesForUser(pool, req.user.id)
  res.json({ preferences: notificationCategories.map((category) => ({ category, ...preferences[category] })) })
}))

app.post('/push-subscriptions', requireUser, asyncRoute(async (req, res) => {
  if (!pushConfigured) return res.status(503).json({ error: 'push_not_configured' })
  const input = z.object({
    endpoint: z.string().url().max(2048),
    keys: z.object({ p256dh: z.string().min(16).max(1024), auth: z.string().min(8).max(1024) }),
    expirationTime: z.number().finite().positive().nullable().optional(),
    contentPreviewEnabled: z.boolean().optional().default(false),
    badgeEnabled: z.boolean().optional().default(true),
  }).parse(req.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existing = await client.query('SELECT id FROM push_subscriptions WHERE endpoint = $1 FOR UPDATE', [input.endpoint])
    if (existing.rowCount) await client.query('DELETE FROM notification_deliveries WHERE subscription_id = $1', [existing.rows[0].id])
    const result = await client.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, expiration_time, user_agent, content_preview_enabled, badge_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (endpoint) DO UPDATE
         SET user_id = EXCLUDED.user_id,
             p256dh = EXCLUDED.p256dh,
             auth = EXCLUDED.auth,
             expiration_time = EXCLUDED.expiration_time,
             user_agent = EXCLUDED.user_agent,
             content_preview_enabled = EXCLUDED.content_preview_enabled,
             badge_enabled = EXCLUDED.badge_enabled,
             updated_at = NOW()
       RETURNING id, content_preview_enabled, badge_enabled`,
      [req.user.id, input.endpoint, input.keys.p256dh, input.keys.auth, input.expirationTime ? new Date(input.expirationTime) : null, String(req.get('user-agent') ?? '').slice(0, 500), input.contentPreviewEnabled, input.badgeEnabled],
    )
    await client.query('COMMIT')
    res.status(201).json({ subscription: result.rows[0] })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

app.patch('/push-subscriptions/:subscriptionId', requireUser, asyncRoute(async (req, res) => {
  const id = z.string().uuid().parse(req.params.subscriptionId)
  const input = z.object({
    contentPreviewEnabled: z.boolean().optional(),
    badgeEnabled: z.boolean().optional(),
  }).refine((value) => value.contentPreviewEnabled !== undefined || value.badgeEnabled !== undefined).parse(req.body)
  const result = await pool.query(
    `UPDATE push_subscriptions
        SET content_preview_enabled = COALESCE($3, content_preview_enabled),
            badge_enabled = COALESCE($4, badge_enabled),
            updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING id, content_preview_enabled, badge_enabled`,
    [id, req.user.id, input.contentPreviewEnabled ?? null, input.badgeEnabled ?? null],
  )
  if (!result.rowCount) return res.status(404).json({ error: 'push_subscription_not_found' })
  res.json({ subscription: result.rows[0] })
}))

app.delete('/push-subscriptions/:subscriptionId', requireUser, asyncRoute(async (req, res) => {
  const id = z.string().uuid().parse(req.params.subscriptionId)
  await pool.query('DELETE FROM push_subscriptions WHERE id = $1 AND user_id = $2', [id, req.user.id])
  res.status(204).end()
}))

app.delete('/me', requireUser, asyncRoute(async (req, res) => {
  const input = z.object({ confirmation: z.literal('LOESCHEN') }).parse(req.body)
  void input
  if (req.user.role === 'superadmin' || demoUsers.some((user) => user.id === req.user.id)) {
    return res.status(403).json({ error: 'account_deletion_not_available' })
  }

  const client = await pool.connect()
  let storageKeys = []
  try {
    await client.query('BEGIN')
    const assets = await client.query(
      `SELECT storage_key FROM media WHERE owner_id = $1
       UNION
       SELECT image AS storage_key FROM users WHERE id = $1 AND image IS NOT NULL`,
      [req.user.id],
    )
    storageKeys = assets.rows.map((row) => row.storage_key).filter(Boolean)
    const deleted = await client.query('DELETE FROM users WHERE id = $1 RETURNING id', [req.user.id])
    if (!deleted.rowCount) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'user_not_found' })
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }

  await Promise.all(storageKeys.map(async (storageKey) => {
    const absolutePath = path.resolve(uploadRoot, storageKey)
    if (absolutePath.startsWith(path.resolve(uploadRoot))) await fs.unlink(absolutePath).catch(() => undefined)
  }))
  res.status(204).end()
}))

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

app.get('/group-images/:groupId', requireUser, asyncRoute(async (req, res) => {
  const groupId = z.string().uuid().parse(req.params.groupId)
  const result = await pool.query(`
    SELECT g.image, g.access_mode,
           EXISTS(SELECT 1 FROM community_group_members m WHERE m.group_id = g.id AND m.user_id = $2 AND m.status IN ('active', 'invited')) AS has_access
      FROM community_groups g
     WHERE g.id = $1 AND NOT g.is_archived`, [groupId, req.user.id])
  const group = result.rows[0]
  if (!group?.image || (group.access_mode === 'private' && !group.has_access)) return res.status(404).end()
  const absolutePath = path.resolve(uploadRoot, group.image)
  if (!absolutePath.startsWith(path.resolve(uploadRoot, 'group-images'))) return res.status(400).end()
  res.sendFile(absolutePath)
}))

app.get('/community/groups', requireUser, asyncRoute(async (req, res) => {
  const result = await pool.query(`
    SELECT g.id, g.name, g.description, g.city, g.access_mode, g.created_at,
           CASE WHEN g.image IS NULL THEN NULL ELSE '/api/group-images/' || g.id END AS image_url,
           m.role, m.notification_level,
           (SELECT COUNT(*)::int FROM community_group_members members WHERE members.group_id = g.id AND members.status = 'active') AS member_count,
           (SELECT json_build_object('id', p.id, 'starts_at', p.starts_at, 'spot_name', s.name)
              FROM planned_visits p JOIN spots s ON s.id = p.spot_id
             WHERE p.group_id = g.id AND p.status = 'scheduled' AND p.starts_at >= NOW()
             ORDER BY p.starts_at ASC LIMIT 1) AS next_event,
           (SELECT COUNT(*)::int
              FROM community_group_messages message
              LEFT JOIN community_group_message_reads reads ON reads.group_id = message.group_id AND reads.user_id = $1
             WHERE message.group_id = g.id AND message.deleted_at IS NULL AND message.user_id <> $1
               AND message.created_at > COALESCE(reads.last_read_at, TIMESTAMPTZ 'epoch')) AS unread_messages
      FROM community_group_members m
      JOIN community_groups g ON g.id = m.group_id
     WHERE m.user_id = $1 AND m.status = 'active' AND NOT g.is_archived
     ORDER BY (SELECT MIN(p.starts_at) FROM planned_visits p WHERE p.group_id = g.id AND p.status = 'scheduled' AND p.starts_at >= NOW()) NULLS LAST, g.name ASC`, [req.user.id])
  res.json({ groups: result.rows })
}))

app.get('/community/groups/discover', requireUser, asyncRoute(async (req, res) => {
  const { q } = z.object({ q: z.string().trim().max(80).optional().default('') }).parse(req.query)
  const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`
  const result = await pool.query(`
    SELECT g.id, g.name, g.description, g.city, g.access_mode, g.created_at,
           CASE WHEN g.image IS NULL THEN NULL ELSE '/api/group-images/' || g.id END AS image_url,
           (SELECT COUNT(*)::int FROM community_group_members members WHERE members.group_id = g.id AND members.status = 'active') AS member_count,
           (SELECT json_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY mapping.position, s.name)
              FROM community_group_spots mapping JOIN spots s ON s.id = mapping.spot_id
             WHERE mapping.group_id = g.id) AS spots,
           COALESCE((SELECT status FROM community_group_members membership WHERE membership.group_id = g.id AND membership.user_id = $1), '') AS membership_status
      FROM community_groups g
     WHERE NOT g.is_archived
       AND g.access_mode <> 'private'
       AND (g.name ILIKE $2 ESCAPE '\\' OR g.description ILIKE $2 ESCAPE '\\' OR g.city ILIKE $2 ESCAPE '\\')
       AND NOT EXISTS (SELECT 1 FROM community_group_members membership WHERE membership.group_id = g.id AND membership.user_id = $1 AND membership.status = 'active')
     ORDER BY CASE WHEN g.name ILIKE $2 ESCAPE '\\' THEN 0 ELSE 1 END, g.created_at DESC
     LIMIT 40`, [req.user.id, pattern])
  res.json({ groups: result.rows })
}))

app.get('/community/groups/invitations', requireUser, asyncRoute(async (req, res) => {
  const result = await pool.query(`
    SELECT g.id, g.name, g.description, g.city, g.access_mode,
           CASE WHEN g.image IS NULL THEN NULL ELSE '/api/group-images/' || g.id END AS image_url,
           inviter.name AS invited_by_name,
           (SELECT COUNT(*)::int FROM community_group_members members WHERE members.group_id = g.id AND members.status = 'active') AS member_count
      FROM community_group_members membership
      JOIN community_groups g ON g.id = membership.group_id
      LEFT JOIN users inviter ON inviter.id = membership.invited_by
     WHERE membership.user_id = $1 AND membership.status = 'invited' AND NOT g.is_archived
     ORDER BY membership.updated_at DESC`, [req.user.id])
  res.json({ invitations: result.rows })
}))

app.post('/community/groups', requireUser, asyncRoute(async (req, res) => {
  const input = groupInputSchema.parse(req.body)
  if (new Set(input.spotIds).size !== input.spotIds.length) return res.status(400).json({ error: 'duplicate_group_spots' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (input.spotIds.length) {
      const spots = await client.query("SELECT id FROM spots WHERE id = ANY($1::uuid[]) AND status = 'active'", [input.spotIds])
      if (spots.rowCount !== input.spotIds.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'spot_not_found' }) }
    }
    const created = await client.query(`
      INSERT INTO community_groups (owner_id, name, description, city, access_mode)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name, description, city, access_mode, created_at`,
      [req.user.id, input.name, input.description, input.city, input.accessMode],
    )
    const group = created.rows[0]
    await client.query(`
      INSERT INTO community_group_members (group_id, user_id, role, status, joined_at)
      VALUES ($1, $2, 'owner', 'active', NOW())`, [group.id, req.user.id])
    for (const [position, spotId] of input.spotIds.entries()) {
      await client.query('INSERT INTO community_group_spots (group_id, spot_id, position) VALUES ($1, $2, $3)', [group.id, spotId, position])
    }
    await client.query('COMMIT')
    res.status(201).json({ group: { ...group, role: 'owner', member_count: 1, image_url: null } })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}))

app.get('/community/groups/:groupId', requireUser, asyncRoute(async (req, res) => {
  const groupId = z.string().uuid().parse(req.params.groupId)
  const result = await pool.query(`
    SELECT g.id, g.owner_id, g.name, g.description, g.city, g.access_mode, g.is_archived, g.created_at, g.updated_at,
           CASE WHEN g.image IS NULL THEN NULL ELSE '/api/group-images/' || g.id END AS image_url,
           membership.role AS my_role, membership.status AS membership_status, membership.notification_level,
           (SELECT COUNT(*)::int FROM community_group_members members WHERE members.group_id = g.id AND members.status = 'active') AS member_count,
           COALESCE((SELECT json_agg(json_build_object('id', s.id, 'name', s.name, 'district', s.district) ORDER BY mapping.position, s.name)
              FROM community_group_spots mapping JOIN spots s ON s.id = mapping.spot_id WHERE mapping.group_id = g.id), '[]'::json) AS spots
      FROM community_groups g
      LEFT JOIN community_group_members membership ON membership.group_id = g.id AND membership.user_id = $2
     WHERE g.id = $1 AND NOT g.is_archived`, [groupId, req.user.id])
  const group = result.rows[0]
  if (!group || (group.access_mode === 'private' && !['active', 'invited'].includes(group.membership_status))) return res.status(404).json({ error: 'group_not_found' })
  res.json({ group })
}))

app.patch('/community/groups/:groupId', requireUser, asyncRoute(async (req, res) => {
  const groupId = z.string().uuid().parse(req.params.groupId)
  const input = groupUpdateSchema.parse(req.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const membership = await groupMembership(client, groupId, req.user.id)
    if (!isGroupManager(membership)) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'group_manager_required' }) }
    const currentResult = await client.query('SELECT * FROM community_groups WHERE id = $1 AND NOT is_archived FOR UPDATE', [groupId])
    const current = currentResult.rows[0]
    if (!current) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'group_not_found' }) }
    const currentSpots = await client.query('SELECT spot_id FROM community_group_spots WHERE group_id = $1 ORDER BY position', [groupId])
    const next = groupInputSchema.parse({
      name: input.name ?? current.name,
      description: input.description ?? current.description,
      city: input.city ?? current.city,
      accessMode: input.accessMode ?? current.access_mode,
      spotIds: input.spotIds ?? currentSpots.rows.map((row) => row.spot_id),
    })
    if (new Set(next.spotIds).size !== next.spotIds.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'duplicate_group_spots' }) }
    if (next.spotIds.length) {
      const spots = await client.query("SELECT id FROM spots WHERE id = ANY($1::uuid[]) AND status = 'active'", [next.spotIds])
      if (spots.rowCount !== next.spotIds.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'spot_not_found' }) }
    }
    const updated = await client.query(`
      UPDATE community_groups SET name = $2, description = $3, city = $4, access_mode = $5, updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, description, city, access_mode, updated_at`, [groupId, next.name, next.description, next.city, next.accessMode])
    if (input.spotIds !== undefined) {
      await client.query('DELETE FROM community_group_spots WHERE group_id = $1', [groupId])
      for (const [position, spotId] of next.spotIds.entries()) await client.query('INSERT INTO community_group_spots (group_id, spot_id, position) VALUES ($1, $2, $3)', [groupId, spotId, position])
    }
    await client.query('COMMIT')
    res.json({ group: updated.rows[0] })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}))

app.post('/community/groups/:groupId/image', requireUser, groupImageUpload.single('image'), asyncRoute(async (req, res) => {
  const groupId = z.string().uuid().parse(req.params.groupId)
  if (!req.file) return res.status(400).json({ error: 'image_required' })
  const membership = await groupMembership(pool, groupId, req.user.id)
  if (!isGroupManager(membership)) return res.status(403).json({ error: 'group_manager_required' })
  const storageKey = path.posix.join('group-images', req.file.filename)
  const result = await pool.query(`UPDATE community_groups SET image = $2, updated_at = NOW() WHERE id = $1 AND NOT is_archived RETURNING id`, [groupId, storageKey])
  if (!result.rowCount) return res.status(404).json({ error: 'group_not_found' })
  res.status(201).json({ imageUrl: `/api/group-images/${groupId}` })
}))

app.post('/community/groups/:groupId/join', requireUser, asyncRoute(async (req, res) => {
  const groupId = z.string().uuid().parse(req.params.groupId)
  const { note } = z.object({ note: z.string().trim().max(500).optional().default('') }).parse(req.body ?? {})
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const groupResult = await client.query('SELECT id, owner_id, name, access_mode FROM community_groups WHERE id = $1 AND NOT is_archived FOR UPDATE', [groupId])
    const group = groupResult.rows[0]
    const existingMembership = await groupMembership(client, groupId, req.user.id)
    if (!group || (group.access_mode === 'private' && existingMembership?.status !== 'invited')) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'group_not_found' }) }
    if (existingMembership?.status === 'banned') { await client.query('ROLLBACK'); return res.status(403).json({ error: 'group_join_blocked' }) }
    const blocked = await client.query('SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)', [req.user.id, group.owner_id])
    if (blocked.rowCount) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'group_join_blocked' }) }
    const active = group.access_mode === 'open' || existingMembership?.status === 'invited'
    const status = active ? 'active' : 'requested'
    await client.query(`
      INSERT INTO community_group_members (group_id, user_id, role, status, request_note, joined_at, updated_at)
      VALUES ($1, $2, 'member', $3, $4, CASE WHEN $3 = 'active' THEN NOW() ELSE NULL END, NOW())
      ON CONFLICT (group_id, user_id) DO UPDATE SET role = CASE WHEN community_group_members.status = 'active' THEN community_group_members.role ELSE 'member' END, status = EXCLUDED.status, request_note = EXCLUDED.request_note, joined_at = CASE WHEN EXCLUDED.status = 'active' THEN NOW() ELSE community_group_members.joined_at END, updated_at = NOW()`,
      [groupId, req.user.id, status, note],
    )
    if (active) await notifyGroupMembers(client, { groupId, actorId: req.user.id, type: 'group_joined', title: 'Neues Gruppenmitglied', body: `${req.user.name} ist ${group.name} beigetreten.`, targetTab: 'members' })
    else {
      const managers = await client.query("SELECT user_id FROM community_group_members WHERE group_id = $1 AND status = 'active' AND role IN ('owner', 'admin')", [groupId])
      await notifyGroupMembers(client, { groupId, actorId: req.user.id, type: 'group_join_request', title: 'Neue Beitrittsanfrage', body: `${req.user.name} möchte ${group.name} beitreten.`, targetTab: 'members', recipientIds: managers.rows.map((row) => row.user_id) })
    }
    await client.query('COMMIT')
    void flushPushDeliveries().catch((error) => console.error('Push-Zustellung fehlgeschlagen:', error))
    res.json({ status })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}))

app.post('/community/groups/:groupId/leave', requireUser, asyncRoute(async (req, res) => {
  const groupId = z.string().uuid().parse(req.params.groupId)
  const membership = await groupMembership(pool, groupId, req.user.id)
  if (!membership || membership.status !== 'active') return res.status(404).json({ error: 'group_membership_not_found' })
  if (membership.role === 'owner') return res.status(400).json({ error: 'group_owner_must_transfer' })
  await pool.query("UPDATE community_group_members SET status = 'left', updated_at = NOW() WHERE group_id = $1 AND user_id = $2", [groupId, req.user.id])
  res.status(204).end()
}))

app.post('/community/groups/:groupId/ownership', requireUser, asyncRoute(async (req, res) => {
  const groupId = z.string().uuid().parse(req.params.groupId)
  const { userId } = z.object({ userId: z.string().uuid() }).parse(req.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const membership = await groupMembership(client, groupId, req.user.id)
    if (membership?.role !== 'owner' || membership.status !== 'active') { await client.query('ROLLBACK'); return res.status(403).json({ error: 'group_owner_required' }) }
    const target = await groupMembership(client, groupId, userId)
    if (!target || target.status !== 'active') { await client.query('ROLLBACK'); return res.status(404).json({ error: 'group_member_not_found' }) }
    await client.query('UPDATE community_groups SET owner_id = $2, updated_at = NOW() WHERE id = $1', [groupId, userId])
    await client.query("UPDATE community_group_members SET role = 'owner', updated_at = NOW() WHERE group_id = $1 AND user_id = $2", [groupId, userId])
    await client.query("UPDATE community_group_members SET role = 'admin', updated_at = NOW() WHERE group_id = $1 AND user_id = $2", [groupId, req.user.id])
    await client.query('COMMIT')
    res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}))

app.get('/community/groups/:groupId/members', requireUser, asyncRoute(async (req, res) => {
  const groupId = z.string().uuid().parse(req.params.groupId)
  const membership = await groupMembership(pool, groupId, req.user.id)
  if (!membership || membership.status !== 'active') return res.status(403).json({ error: 'group_membership_required' })
  const members = await pool.query(`
    SELECT m.user_id, m.role, m.status, m.request_note, m.joined_at, m.created_at, u.name, u.username, u.image
      FROM community_group_members m JOIN users u ON u.id = m.user_id
     WHERE m.group_id = $1 AND (m.status = 'active' OR ($2::boolean AND m.status IN ('requested', 'invited')))
     ORDER BY CASE m.status WHEN 'requested' THEN 0 WHEN 'invited' THEN 1 ELSE 2 END, CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name`, [groupId, isGroupManager(membership)])
  res.json({ members: members.rows })
}))

app.post('/community/groups/:groupId/invitations', requireUser, asyncRoute(async (req, res) => {
  const groupId = z.string().uuid().parse(req.params.groupId)
  const { userId } = z.object({ userId: z.string().uuid() }).parse(req.body)
  if (userId === req.user.id) return res.status(400).json({ error: 'cannot_invite_self' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const membership = await groupMembership(client, groupId, req.user.id)
    if (!isGroupManager(membership)) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'group_manager_required' }) }
    const group = await client.query('SELECT name FROM community_groups WHERE id = $1 AND NOT is_archived', [groupId])
    if (!group.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'group_not_found' }) }
    const target = await client.query('SELECT id FROM users WHERE id = $1', [userId])
    if (!target.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'user_not_found' }) }
    const blocked = await client.query('SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)', [req.user.id, userId])
    if (blocked.rowCount) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'group_invite_blocked' }) }
    await client.query(`
      INSERT INTO community_group_members (group_id, user_id, role, status, invited_by, updated_at)
      VALUES ($1, $2, 'member', 'invited', $3, NOW())
      ON CONFLICT (group_id, user_id) DO UPDATE SET status = CASE WHEN community_group_members.status = 'active' THEN 'active' ELSE 'invited' END, invited_by = EXCLUDED.invited_by, updated_at = NOW()`,
      [groupId, userId, req.user.id])
    await notifyGroupMembers(client, { groupId, actorId: req.user.id, type: 'group_invitation', title: 'Einladung zu einer Gruppe', body: `${req.user.name} hat dich in ${group.rows[0].name} eingeladen.`, targetTab: 'overview', recipientIds: [userId] })
    await client.query('COMMIT')
    void flushPushDeliveries().catch((error) => console.error('Push-Zustellung fehlgeschlagen:', error))
    res.status(201).end()
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}))

app.post('/community/groups/:groupId/members/:userId/approve', requireUser, asyncRoute(async (req, res) => {
  const groupId = z.string().uuid().parse(req.params.groupId)
  const userId = z.string().uuid().parse(req.params.userId)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const manager = await groupMembership(client, groupId, req.user.id)
    if (!isGroupManager(manager)) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'group_manager_required' }) }
    const group = await client.query('SELECT name FROM community_groups WHERE id = $1 AND NOT is_archived', [groupId])
    const target = await client.query("UPDATE community_group_members SET status = 'active', joined_at = NOW(), updated_at = NOW() WHERE group_id = $1 AND user_id = $2 AND status IN ('requested', 'invited') RETURNING user_id", [groupId, userId])
    if (!target.rowCount || !group.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'group_request_not_found' }) }
    await notifyGroupMembers(client, { groupId, actorId: req.user.id, type: 'group_joined', title: 'Beitritt bestätigt', body: `Dein Beitritt zu ${group.rows[0].name} wurde bestätigt.`, targetTab: 'overview', recipientIds: [userId] })
    await client.query('COMMIT')
    void flushPushDeliveries().catch((error) => console.error('Push-Zustellung fehlgeschlagen:', error))
    res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}))

app.post('/community/groups/:groupId/members/:userId/decline', requireUser, asyncRoute(async (req, res) => {
  const groupId = z.string().uuid().parse(req.params.groupId)
  const userId = z.string().uuid().parse(req.params.userId)
  const manager = await groupMembership(pool, groupId, req.user.id)
  if (!isGroupManager(manager)) return res.status(403).json({ error: 'group_manager_required' })
  const result = await pool.query("UPDATE community_group_members SET status = 'left', updated_at = NOW() WHERE group_id = $1 AND user_id = $2 AND status IN ('requested', 'invited') RETURNING user_id", [groupId, userId])
  if (!result.rowCount) return res.status(404).json({ error: 'group_request_not_found' })
  res.status(204).end()
}))

app.patch('/community/groups/:groupId/members/:userId/role', requireUser, asyncRoute(async (req, res) => {
  const groupId = z.string().uuid().parse(req.params.groupId)
  const userId = z.string().uuid().parse(req.params.userId)
  const { role } = z.object({ role: z.enum(['admin', 'member']) }).parse(req.body)
  const manager = await groupMembership(pool, groupId, req.user.id)
  if (manager?.role !== 'owner' || manager.status !== 'active') return res.status(403).json({ error: 'group_owner_required' })
  const result = await pool.query("UPDATE community_group_members SET role = $3, updated_at = NOW() WHERE group_id = $1 AND user_id = $2 AND status = 'active' AND role <> 'owner' RETURNING user_id, role", [groupId, userId, role])
  if (!result.rowCount) return res.status(404).json({ error: 'group_member_not_found' })
  res.json({ member: result.rows[0] })
}))

app.delete('/community/groups/:groupId/members/:userId', requireUser, asyncRoute(async (req, res) => {
  const groupId = z.string().uuid().parse(req.params.groupId)
  const userId = z.string().uuid().parse(req.params.userId)
  const manager = await groupMembership(pool, groupId, req.user.id)
  if (!isGroupManager(manager)) return res.status(403).json({ error: 'group_manager_required' })
  const result = await pool.query("UPDATE community_group_members SET status = 'banned', updated_at = NOW() WHERE group_id = $1 AND user_id = $2 AND status = 'active' AND role <> 'owner' RETURNING user_id", [groupId, userId])
  if (!result.rowCount) return res.status(404).json({ error: 'group_member_not_found' })
  res.status(204).end()
}))

app.patch('/community/groups/:groupId/notifications', requireUser, asyncRoute(async (req, res) => {
  const groupId = z.string().uuid().parse(req.params.groupId)
  const { level } = z.object({ level: z.enum(groupNotificationLevels) }).parse(req.body)
  const result = await pool.query("UPDATE community_group_members SET notification_level = $3, updated_at = NOW() WHERE group_id = $1 AND user_id = $2 AND status = 'active' RETURNING notification_level", [groupId, req.user.id, level])
  if (!result.rowCount) return res.status(404).json({ error: 'group_membership_not_found' })
  res.json({ notificationLevel: result.rows[0].notification_level })
}))

app.get('/community/groups/:groupId/messages', requireUser, asyncRoute(async (req, res) => {
  const groupId = z.string().uuid().parse(req.params.groupId)
  const membership = await groupMembership(pool, groupId, req.user.id)
  if (!membership || membership.status !== 'active') return res.status(403).json({ error: 'group_membership_required' })
  await pool.query(`INSERT INTO community_group_message_reads (group_id, user_id, last_read_at) VALUES ($1, $2, NOW()) ON CONFLICT (group_id, user_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at`, [groupId, req.user.id])
  const messages = await pool.query(`
    SELECT message.id, message.body, message.created_at, message.deleted_at, message.user_id, (message.user_id = $2) AS is_own, user_record.name AS user_name, user_record.username, user_record.image
      FROM community_group_messages message JOIN users user_record ON user_record.id = message.user_id
     WHERE message.group_id = $1
     ORDER BY message.created_at DESC LIMIT 100`, [groupId, req.user.id])
  res.json({ messages: messages.rows.reverse() })
}))

app.post('/community/groups/:groupId/messages', requireUser, asyncRoute(async (req, res) => {
  const groupId = z.string().uuid().parse(req.params.groupId)
  const input = groupMessageSchema.parse(req.body)
  const membership = await groupMembership(pool, groupId, req.user.id)
  if (!membership || membership.status !== 'active') return res.status(403).json({ error: 'group_membership_required' })
  const [group, created] = await Promise.all([
    pool.query('SELECT name FROM community_groups WHERE id = $1 AND NOT is_archived', [groupId]),
    pool.query('INSERT INTO community_group_messages (group_id, user_id, body) VALUES ($1, $2, $3) RETURNING id, body, created_at', [groupId, req.user.id, input.body]),
  ])
  if (!group.rowCount) return res.status(404).json({ error: 'group_not_found' })
  await notifyGroupMembers(pool, { groupId, actorId: req.user.id, type: 'group_message', title: `Neue Nachricht in ${group.rows[0].name}`, body: `${req.user.name}: ${input.body}`, targetTab: 'chat', importance: 'message' })
  void flushPushDeliveries().catch((error) => console.error('Push-Zustellung fehlgeschlagen:', error))
  res.status(201).json({ message: { ...created.rows[0], user_id: req.user.id, is_own: true, user_name: req.user.name, username: req.user.username, image: req.user.image } })
}))

app.delete('/community/groups/:groupId/messages/:messageId', requireUser, asyncRoute(async (req, res) => {
  const groupId = z.string().uuid().parse(req.params.groupId)
  const messageId = z.string().uuid().parse(req.params.messageId)
  const membership = await groupMembership(pool, groupId, req.user.id)
  if (!membership || membership.status !== 'active') return res.status(403).json({ error: 'group_membership_required' })
  const result = await pool.query(`
    UPDATE community_group_messages SET deleted_at = NOW()
     WHERE id = $1 AND group_id = $2 AND deleted_at IS NULL
       AND ($3::boolean OR user_id = $4)
     RETURNING id`, [messageId, groupId, isGroupManager(membership), req.user.id])
  if (!result.rowCount) return res.status(404).json({ error: 'group_message_not_found' })
  res.status(204).end()
}))

app.get('/community/groups/:groupId/events', requireUser, asyncRoute(async (req, res) => {
  const groupId = z.string().uuid().parse(req.params.groupId)
  const membership = await groupMembership(pool, groupId, req.user.id)
  if (!membership || membership.status !== 'active') return res.status(403).json({ error: 'group_membership_required' })
  const events = await pool.query(`
    SELECT p.id, p.starts_at, p.ends_at, p.note, p.capacity, p.status, p.created_at, p.user_id, p.group_event_series_id,
           s.id AS spot_id, s.name AS spot_name, s.district, s.address,
           u.name AS user_name, u.image AS user_image,
           (SELECT COUNT(*)::int FROM planned_visit_rsvps r WHERE r.planned_visit_id = p.id AND r.response = 'going') AS going_count,
           (SELECT COUNT(*)::int FROM planned_visit_rsvps r WHERE r.planned_visit_id = p.id AND r.response = 'interested') AS interested_count,
           (SELECT COUNT(*)::int FROM planned_visit_rsvps r WHERE r.planned_visit_id = p.id AND r.response = 'waitlisted') AS waitlisted_count,
           (SELECT response FROM planned_visit_rsvps r WHERE r.planned_visit_id = p.id AND r.user_id = $2) AS my_response,
           (p.user_id = $2 OR EXISTS (SELECT 1 FROM community_group_members manager WHERE manager.group_id = p.group_id AND manager.user_id = $2 AND manager.status = 'active' AND manager.role IN ('owner', 'admin'))) AS can_manage
      FROM planned_visits p
      JOIN spots s ON s.id = p.spot_id
      JOIN users u ON u.id = p.user_id
     WHERE p.group_id = $1 AND p.status = 'scheduled' AND p.starts_at >= NOW() - INTERVAL '4 hours'
     ORDER BY p.starts_at ASC LIMIT 80`, [groupId, req.user.id])
  res.json({ events: events.rows })
}))

app.post('/community/groups/:groupId/events', requireUser, asyncRoute(async (req, res) => {
  const groupId = z.string().uuid().parse(req.params.groupId)
  const input = groupEventSchema.parse(req.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const membership = await groupMembership(client, groupId, req.user.id)
    if (!isGroupManager(membership)) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'group_manager_required' }) }
    const [group, spot] = await Promise.all([
      client.query('SELECT name FROM community_groups WHERE id = $1 AND NOT is_archived', [groupId]),
      client.query("SELECT id, name FROM spots WHERE id = $1 AND status = 'active'", [input.spotId]),
    ])
    if (!group.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'group_not_found' }) }
    if (!spot.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'spot_not_found' }) }
    let seriesId = null
    if (input.recurrence) {
      const series = await client.query(`
        INSERT INTO community_group_event_series (group_id, created_by, frequency, repeat_until)
        VALUES ($1, $2, $3, $4)
        RETURNING id`, [groupId, req.user.id, input.recurrence.frequency, input.recurrence.repeatUntil])
      seriesId = series.rows[0].id
    }
    const occurrences = []
    const start = new Date(input.startsAt)
    const end = input.endsAt ? new Date(input.endsAt) : null
    const repeatUntil = input.recurrence ? new Date(`${input.recurrence.repeatUntil}T23:59:59.999Z`) : null
    for (let index = 0; index < 30; index += 1) {
      const occurrenceStart = new Date(start)
      if (index > 0 && input.recurrence) {
        if (input.recurrence.frequency === 'weekly') occurrenceStart.setUTCDate(occurrenceStart.getUTCDate() + index * 7)
        if (input.recurrence.frequency === 'biweekly') occurrenceStart.setUTCDate(occurrenceStart.getUTCDate() + index * 14)
        if (input.recurrence.frequency === 'monthly') occurrenceStart.setUTCMonth(occurrenceStart.getUTCMonth() + index)
      }
      if (index > 0 && !input.recurrence) break
      if (repeatUntil && occurrenceStart > repeatUntil) break
      const occurrenceEnd = end ? new Date(end.getTime() + occurrenceStart.getTime() - start.getTime()) : null
      const created = await client.query(`
        INSERT INTO planned_visits (user_id, spot_id, starts_at, ends_at, note, visibility, group_id, group_event_series_id, capacity)
        VALUES ($1, $2, $3, $4, $5, 'private', $6, $7, $8)
        RETURNING id, starts_at, ends_at, note, capacity`,
        [req.user.id, input.spotId, occurrenceStart, occurrenceEnd, input.note, groupId, seriesId, input.capacity ?? null],
      )
      occurrences.push(created.rows[0])
      if (!input.recurrence) break
    }
    await notifyGroupMembers(client, {
      groupId, actorId: req.user.id, type: 'group_event_created', title: 'Neuer Gruppentermin',
      body: `${req.user.name} hat einen Termin bei ${spot.rows[0].name} geplant.`, targetTab: 'events',
      plannedVisitId: occurrences[0]?.id ?? null, payload: { spotName: spot.rows[0].name, occurrences: occurrences.length },
    })
    await client.query('COMMIT')
    void flushPushDeliveries().catch((error) => console.error('Push-Zustellung fehlgeschlagen:', error))
    res.status(201).json({ events: occurrences, seriesId })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}))

app.patch('/community/groups/:groupId/events/:eventId', requireUser, asyncRoute(async (req, res) => {
  const groupId = z.string().uuid().parse(req.params.groupId)
  const eventId = z.string().uuid().parse(req.params.eventId)
  const input = groupEventUpdateSchema.parse(req.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const membership = await groupMembership(client, groupId, req.user.id)
    if (!isGroupManager(membership)) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'group_manager_required' }) }
    const existing = await client.query(`SELECT p.*, s.name AS spot_name FROM planned_visits p JOIN spots s ON s.id = p.spot_id WHERE p.id = $1 AND p.group_id = $2 AND p.status = 'scheduled' FOR UPDATE`, [eventId, groupId])
    const event = existing.rows[0]
    if (!event) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'group_event_not_found' }) }
    const next = groupEventSchema.omit({ recurrence: true }).parse({
      spotId: input.spotId ?? event.spot_id,
      startsAt: input.startsAt ?? new Date(event.starts_at).toISOString(),
      endsAt: input.endsAt === undefined ? (event.ends_at ? new Date(event.ends_at).toISOString() : null) : input.endsAt,
      note: input.note ?? event.note,
      capacity: input.capacity === undefined ? event.capacity : input.capacity,
    })
    const spot = await client.query("SELECT id, name FROM spots WHERE id = $1 AND status = 'active'", [next.spotId])
    if (!spot.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'spot_not_found' }) }
    const updated = await client.query(`
      UPDATE planned_visits SET spot_id = $3, starts_at = $4, ends_at = $5, note = $6, capacity = $7, updated_at = NOW()
       WHERE id = $1 AND group_id = $2
       RETURNING id, starts_at, ends_at, note, capacity`, [eventId, groupId, next.spotId, next.startsAt, next.endsAt, next.note, next.capacity ?? null])
    await notifyGroupMembers(client, {
      groupId, actorId: req.user.id, type: 'group_event_updated', title: 'Gruppentermin geändert',
      body: `${req.user.name} hat den Termin bei ${spot.rows[0].name} geändert.`, targetTab: 'events', plannedVisitId: eventId,
      payload: { spotName: spot.rows[0].name },
    })
    await client.query('COMMIT')
    void flushPushDeliveries().catch((error) => console.error('Push-Zustellung fehlgeschlagen:', error))
    res.json({ event: updated.rows[0] })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}))

app.post('/community/groups/:groupId/events/:eventId/cancel', requireUser, asyncRoute(async (req, res) => {
  const groupId = z.string().uuid().parse(req.params.groupId)
  const eventId = z.string().uuid().parse(req.params.eventId)
  const { reason } = plannedVisitCancelSchema.parse(req.body ?? {})
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const membership = await groupMembership(client, groupId, req.user.id)
    if (!isGroupManager(membership)) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'group_manager_required' }) }
    const event = await client.query(`SELECT p.starts_at, s.name AS spot_name FROM planned_visits p JOIN spots s ON s.id = p.spot_id WHERE p.id = $1 AND p.group_id = $2 AND p.status = 'scheduled' FOR UPDATE`, [eventId, groupId])
    if (!event.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'group_event_not_found' }) }
    await client.query("UPDATE planned_visits SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = $3, updated_at = NOW() WHERE id = $1 AND group_id = $2", [eventId, groupId, reason])
    await notifyGroupMembers(client, {
      groupId, actorId: req.user.id, type: 'group_event_cancelled', title: 'Gruppentermin abgesagt',
      body: `${event.rows[0].spot_name} wurde abgesagt.`, targetTab: 'events', plannedVisitId: eventId,
      payload: { spotName: event.rows[0].spot_name, reason },
    })
    await client.query('COMMIT')
    void flushPushDeliveries().catch((error) => console.error('Push-Zustellung fehlgeschlagen:', error))
    res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}))

app.post('/community/groups/:groupId/events/:eventId/rsvp', requireUser, asyncRoute(async (req, res) => {
  const groupId = z.string().uuid().parse(req.params.groupId)
  const eventId = z.string().uuid().parse(req.params.eventId)
  const { response } = z.object({ response: z.enum(['going', 'interested']) }).parse(req.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const membership = await groupMembership(client, groupId, req.user.id)
    if (!membership || membership.status !== 'active') { await client.query('ROLLBACK'); return res.status(403).json({ error: 'group_membership_required' }) }
    const eventResult = await client.query(`SELECT p.id, p.user_id, p.capacity, s.name AS spot_name FROM planned_visits p JOIN spots s ON s.id = p.spot_id WHERE p.id = $1 AND p.group_id = $2 AND p.status = 'scheduled' FOR UPDATE`, [eventId, groupId])
    const event = eventResult.rows[0]
    if (!event) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'group_event_not_found' }) }
    const existing = await client.query('SELECT response FROM planned_visit_rsvps WHERE planned_visit_id = $1 AND user_id = $2 FOR UPDATE', [eventId, req.user.id])
    let savedResponse = response
    if (response === 'going' && event.capacity && existing.rows[0]?.response !== 'going') {
      const going = await client.query("SELECT COUNT(*)::int AS count FROM planned_visit_rsvps WHERE planned_visit_id = $1 AND response = 'going'", [eventId])
      if (going.rows[0].count >= event.capacity) savedResponse = 'waitlisted'
    }
    const saved = await client.query(`
      INSERT INTO planned_visit_rsvps (planned_visit_id, user_id, response)
      VALUES ($1, $2, $3)
      ON CONFLICT (planned_visit_id, user_id) DO UPDATE SET response = EXCLUDED.response, updated_at = NOW()
      RETURNING response`, [eventId, req.user.id, savedResponse])
    const promotedUserId = existing.rows[0]?.response === 'going' && savedResponse !== 'going'
      ? await promoteGroupWaitlist(client, eventId)
      : null
    const responseLabel = savedResponse === 'going' ? 'zugesagt' : savedResponse === 'waitlisted' ? 'auf die Warteliste gesetzt' : 'interessiert'
    await notifyGroupMembers(client, {
      groupId, actorId: req.user.id, type: 'group_event_updated', title: 'Neue Terminantwort',
      body: `${req.user.name} hat für ${event.spot_name} ${responseLabel}.`, targetTab: 'events', plannedVisitId: eventId,
      payload: { spotName: event.spot_name, response: savedResponse }, recipientIds: [event.user_id],
    })
    if (promotedUserId) await notifyGroupMembers(client, { groupId, type: 'group_event_updated', title: 'Du rückst nach', body: 'Ein Platz in einem Gruppentermin ist frei geworden.', targetTab: 'events', plannedVisitId: eventId, recipientIds: [promotedUserId] })
    await client.query('COMMIT')
    void flushPushDeliveries().catch((error) => console.error('Push-Zustellung fehlgeschlagen:', error))
    res.json({ rsvp: saved.rows[0] })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}))

app.delete('/community/groups/:groupId/events/:eventId/rsvp', requireUser, asyncRoute(async (req, res) => {
  const groupId = z.string().uuid().parse(req.params.groupId)
  const eventId = z.string().uuid().parse(req.params.eventId)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const membership = await groupMembership(client, groupId, req.user.id)
    if (!membership || membership.status !== 'active') { await client.query('ROLLBACK'); return res.status(403).json({ error: 'group_membership_required' }) }
    const event = await client.query('SELECT id, user_id, capacity, group_id FROM planned_visits WHERE id = $1 AND group_id = $2 AND status = \'scheduled\' FOR UPDATE', [eventId, groupId])
    if (!event.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'group_event_not_found' }) }
    const removed = await client.query('DELETE FROM planned_visit_rsvps WHERE planned_visit_id = $1 AND user_id = $2 RETURNING response', [eventId, req.user.id])
    const promotedUserId = removed.rows[0]?.response === 'going' ? await promoteGroupWaitlist(client, eventId) : null
    if (promotedUserId) await notifyGroupMembers(client, { groupId, type: 'group_event_updated', title: 'Du rückst nach', body: 'Ein Platz in einem Gruppentermin ist frei geworden.', targetTab: 'events', plannedVisitId: eventId, recipientIds: [promotedUserId] })
    await client.query('COMMIT')
    if (promotedUserId) void flushPushDeliveries().catch((error) => console.error('Push-Zustellung fehlgeschlagen:', error))
    res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}))

app.get('/community/groups/:groupId/events/:eventId/rsvps', requireUser, asyncRoute(async (req, res) => {
  const groupId = z.string().uuid().parse(req.params.groupId)
  const eventId = z.string().uuid().parse(req.params.eventId)
  const membership = await groupMembership(pool, groupId, req.user.id)
  if (!membership || membership.status !== 'active') return res.status(403).json({ error: 'group_membership_required' })
  const event = await pool.query('SELECT id FROM planned_visits WHERE id = $1 AND group_id = $2', [eventId, groupId])
  if (!event.rowCount) return res.status(404).json({ error: 'group_event_not_found' })
  const rsvps = await pool.query(`
    SELECT u.id, u.name, u.username, u.image, r.response
      FROM planned_visit_rsvps r JOIN users u ON u.id = r.user_id
     WHERE r.planned_visit_id = $1
     ORDER BY CASE r.response WHEN 'going' THEN 0 WHEN 'waitlisted' THEN 1 ELSE 2 END, u.name`, [eventId])
  res.json({ rsvps: rsvps.rows })
}))

app.get('/community/groups/:groupId/polls', requireUser, asyncRoute(async (req, res) => {
  const groupId = z.string().uuid().parse(req.params.groupId)
  const membership = await groupMembership(pool, groupId, req.user.id)
  if (!membership || membership.status !== 'active') return res.status(403).json({ error: 'group_membership_required' })
  const polls = await pool.query(`
    SELECT poll.id, poll.question, poll.kind, poll.closes_at, poll.closed_at, poll.created_at, poll.created_by,
           creator.name AS created_by_name
      FROM community_group_polls poll JOIN users creator ON creator.id = poll.created_by
     WHERE poll.group_id = $1
     ORDER BY (poll.closed_at IS NOT NULL OR (poll.closes_at IS NOT NULL AND poll.closes_at <= NOW())), poll.created_at DESC
     LIMIT 20`, [groupId])
  const result = []
  for (const poll of polls.rows) {
    const options = await pool.query(`
      SELECT option.id, option.label, option.spot_id, option.starts_at, option.position,
             COUNT(vote.user_id)::int AS vote_count,
             EXISTS(SELECT 1 FROM community_group_poll_votes own_vote WHERE own_vote.poll_id = option.poll_id AND own_vote.option_id = option.id AND own_vote.user_id = $2) AS voted_by_me
        FROM community_group_poll_options option
        LEFT JOIN community_group_poll_votes vote ON vote.option_id = option.id
       WHERE option.poll_id = $1
       GROUP BY option.id
       ORDER BY option.position, option.label`, [poll.id, req.user.id])
    result.push({ ...poll, options: options.rows, is_closed: Boolean(poll.closed_at) || (poll.closes_at && new Date(poll.closes_at) <= new Date()) })
  }
  res.json({ polls: result, canManage: isGroupManager(membership) })
}))

app.post('/community/groups/:groupId/polls', requireUser, asyncRoute(async (req, res) => {
  const groupId = z.string().uuid().parse(req.params.groupId)
  const input = groupPollSchema.parse(req.body)
  if (input.closesAt && new Date(input.closesAt) <= new Date()) return res.status(400).json({ error: 'poll_close_must_be_future' })
  if (input.kind === 'spot' && input.options.some((option) => !option.spotId)) return res.status(400).json({ error: 'poll_spot_required' })
  if (input.kind === 'date' && input.options.some((option) => !option.startsAt)) return res.status(400).json({ error: 'poll_date_required' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const membership = await groupMembership(client, groupId, req.user.id)
    if (!isGroupManager(membership)) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'group_manager_required' }) }
    const group = await client.query('SELECT name FROM community_groups WHERE id = $1 AND NOT is_archived', [groupId])
    if (!group.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'group_not_found' }) }
    if (input.kind === 'spot') {
      const spotIds = input.options.map((option) => option.spotId)
      const spots = await client.query("SELECT id FROM spots WHERE id = ANY($1::uuid[]) AND status = 'active'", [spotIds])
      if (spots.rowCount !== new Set(spotIds).size) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'spot_not_found' }) }
    }
    const poll = await client.query(`
      INSERT INTO community_group_polls (group_id, created_by, question, kind, closes_at)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, question, kind, closes_at, created_at`, [groupId, req.user.id, input.question, input.kind, input.closesAt ?? null])
    const options = []
    for (const [position, option] of input.options.entries()) {
      const created = await client.query(`
        INSERT INTO community_group_poll_options (poll_id, label, spot_id, starts_at, position)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, label, spot_id, starts_at, position`, [poll.rows[0].id, option.label, option.spotId ?? null, option.startsAt ?? null, position])
      options.push(created.rows[0])
    }
    await notifyGroupMembers(client, { groupId, actorId: req.user.id, type: 'group_poll_created', title: 'Neue Abstimmung', body: `${req.user.name} hat in ${group.rows[0].name} eine Abstimmung gestartet.`, targetTab: 'polls', payload: { pollId: poll.rows[0].id } })
    await client.query('COMMIT')
    void flushPushDeliveries().catch((error) => console.error('Push-Zustellung fehlgeschlagen:', error))
    res.status(201).json({ poll: { ...poll.rows[0], options } })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}))

app.post('/community/groups/:groupId/polls/:pollId/vote', requireUser, asyncRoute(async (req, res) => {
  const groupId = z.string().uuid().parse(req.params.groupId)
  const pollId = z.string().uuid().parse(req.params.pollId)
  const { optionId } = z.object({ optionId: z.string().uuid() }).parse(req.body)
  const membership = await groupMembership(pool, groupId, req.user.id)
  if (!membership || membership.status !== 'active') return res.status(403).json({ error: 'group_membership_required' })
  const poll = await pool.query(`
    SELECT id FROM community_group_polls
     WHERE id = $1 AND group_id = $2 AND closed_at IS NULL AND (closes_at IS NULL OR closes_at > NOW())`, [pollId, groupId])
  if (!poll.rowCount) return res.status(409).json({ error: 'poll_closed' })
  const option = await pool.query('SELECT id FROM community_group_poll_options WHERE id = $1 AND poll_id = $2', [optionId, pollId])
  if (!option.rowCount) return res.status(404).json({ error: 'poll_option_not_found' })
  await pool.query(`
    INSERT INTO community_group_poll_votes (poll_id, option_id, user_id)
    VALUES ($1, $2, $3)
    ON CONFLICT (poll_id, user_id) DO UPDATE SET option_id = EXCLUDED.option_id, created_at = NOW()`, [pollId, optionId, req.user.id])
  res.status(204).end()
}))

app.post('/community/groups/:groupId/polls/:pollId/close', requireUser, asyncRoute(async (req, res) => {
  const groupId = z.string().uuid().parse(req.params.groupId)
  const pollId = z.string().uuid().parse(req.params.pollId)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const membership = await groupMembership(client, groupId, req.user.id)
    if (!isGroupManager(membership)) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'group_manager_required' }) }
    const [group, poll] = await Promise.all([
      client.query('SELECT name FROM community_groups WHERE id = $1', [groupId]),
      client.query('UPDATE community_group_polls SET closed_at = NOW() WHERE id = $1 AND group_id = $2 AND closed_at IS NULL RETURNING question', [pollId, groupId]),
    ])
    if (!group.rowCount || !poll.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'poll_not_found' }) }
    await notifyGroupMembers(client, { groupId, actorId: req.user.id, type: 'group_poll_closed', title: 'Abstimmung beendet', body: `Die Abstimmung „${poll.rows[0].question}“ wurde beendet.`, targetTab: 'polls', payload: { pollId } })
    await client.query('COMMIT')
    void flushPushDeliveries().catch((error) => console.error('Push-Zustellung fehlgeschlagen:', error))
    res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
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
      (SELECT COUNT(*)::int FROM friend_requests WHERE recipient_id = $1 AND status = 'pending') AS pending_requests,
      (SELECT COUNT(*)::int FROM notifications WHERE user_id = $1 AND category = 'groups' AND in_app_visible AND read_at IS NULL) AS unread_groups
  `, [req.user.id])
  res.json(result.rows[0])
}))

app.get('/social/friends', requireUser, asyncRoute(async (req, res) => {
  const result = await pool.query(`
    SELECT u.id, u.name, u.username, u.image,
      (SELECT COUNT(DISTINCT v.spot_id)::int FROM visits v WHERE v.user_id = u.id) AS unique_spots,
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

app.get('/social/friend-suggestions', requireUser, asyncRoute(async (req, res) => {
  const result = await pool.query(`
    WITH my_friends AS (
      SELECT outgoing.followed_id AS friend_id
        FROM follows outgoing
        JOIN follows incoming
          ON incoming.follower_id = outgoing.followed_id
         AND incoming.followed_id = outgoing.follower_id
         AND incoming.status = 'accepted'
       WHERE outgoing.follower_id = $1
         AND outgoing.status = 'accepted'
    ), mutual_candidates AS (
      SELECT candidate.id,
             candidate.name,
             candidate.username,
             candidate.image,
             (SELECT COUNT(DISTINCT visit.spot_id)::int FROM visits visit WHERE visit.user_id = candidate.id) AS unique_spots,
             COUNT(DISTINCT my_friends.friend_id)::int AS mutual_friend_count
        FROM my_friends
        JOIN follows from_friend
          ON from_friend.follower_id = my_friends.friend_id
         AND from_friend.status = 'accepted'
        JOIN follows to_friend
          ON to_friend.follower_id = from_friend.followed_id
         AND to_friend.followed_id = my_friends.friend_id
         AND to_friend.status = 'accepted'
        JOIN users candidate ON candidate.id = from_friend.followed_id
       WHERE candidate.id <> $1
         AND NOT EXISTS (
           SELECT 1
             FROM follows direct_outgoing
             JOIN follows direct_incoming
               ON direct_incoming.follower_id = direct_outgoing.followed_id
              AND direct_incoming.followed_id = direct_outgoing.follower_id
              AND direct_incoming.status = 'accepted'
            WHERE direct_outgoing.follower_id = $1
              AND direct_outgoing.followed_id = candidate.id
              AND direct_outgoing.status = 'accepted'
         )
         AND NOT EXISTS (
           SELECT 1 FROM friend_requests request
            WHERE request.status = 'pending'
              AND ((request.sender_id = $1 AND request.recipient_id = candidate.id)
                OR (request.sender_id = candidate.id AND request.recipient_id = $1))
         )
         AND NOT EXISTS (
           SELECT 1 FROM friend_suggestion_dismissals dismissal
            WHERE dismissal.user_id = $1 AND dismissal.suggested_user_id = candidate.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM blocks block
            WHERE (block.blocker_id = $1 AND block.blocked_id = candidate.id)
               OR (block.blocker_id = candidate.id AND block.blocked_id = $1)
         )
       GROUP BY candidate.id
    )
    SELECT *
      FROM mutual_candidates
     ORDER BY mutual_friend_count DESC, name ASC, id ASC
     LIMIT 2
  `, [req.user.id])
  res.json({ suggestions: result.rows })
}))

app.post('/social/friend-suggestions/:userId/dismiss', requireUser, asyncRoute(async (req, res) => {
  const suggestedUserId = z.string().uuid().parse(req.params.userId)
  if (suggestedUserId === req.user.id) return res.status(400).json({ error: 'cannot_dismiss_self' })
  const target = await pool.query('SELECT id FROM users WHERE id = $1', [suggestedUserId])
  if (!target.rowCount) return res.status(404).json({ error: 'user_not_found' })
  await pool.query(
    `INSERT INTO friend_suggestion_dismissals (user_id, suggested_user_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, suggested_user_id) DO NOTHING`,
    [req.user.id, suggestedUserId],
  )
  res.status(204).end()
}))

app.get('/social/friend-requests', requireUser, asyncRoute(async (req, res) => {
  const [incoming, outgoing] = await Promise.all([
    pool.query(`SELECT r.id, r.created_at, u.id AS user_id, u.name, u.username, u.image FROM friend_requests r JOIN users u ON u.id = r.sender_id WHERE r.recipient_id = $1 AND r.status = 'pending' ORDER BY r.created_at DESC`, [req.user.id]),
    pool.query(`SELECT r.id, r.created_at, u.id AS user_id, u.name, u.username, u.image FROM friend_requests r JOIN users u ON u.id = r.recipient_id WHERE r.sender_id = $1 AND r.status = 'pending' ORDER BY r.created_at DESC`, [req.user.id]),
  ])
  res.json({ incoming: incoming.rows, outgoing: outgoing.rows })
}))

app.get('/social/discover', requireUser, asyncRoute(async (req, res) => {
  const input = z.object({ q: z.string().trim().max(64) }).parse(req.query)
  const query = input.q.replace(/^@+/, '')
  if (query.length < 2) return res.status(400).json({ error: 'search_query_too_short' })
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`
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
      await createNotifications(client, {
        recipientIds: [targetId], actorId: req.user.id, type: 'friend_accepted', category: 'friendships',
        payload: { userId: req.user.id }, title: 'Freundschaft bestätigt', body: `${req.user.name} hat eure Freundschaft bestätigt.`, targetUrl: '/friends',
      })
      await client.query('COMMIT')
      void flushPushDeliveries().catch((error) => console.error('Push-Zustellung fehlgeschlagen:', error))
      return res.status(201).json({ status: 'accepted' })
    }
    const request = await client.query("INSERT INTO friend_requests (sender_id, recipient_id, status, created_at, responded_at) VALUES ($1, $2, 'pending', NOW(), NULL) ON CONFLICT (sender_id, recipient_id) DO UPDATE SET status = 'pending', created_at = NOW(), responded_at = NULL RETURNING id, status, created_at", [req.user.id, targetId])
    await createNotifications(client, {
      recipientIds: [targetId], actorId: req.user.id, type: 'friend_request', category: 'friendships',
      payload: { requestId: request.rows[0].id }, title: 'Neue Freundschaftsanfrage', body: `${req.user.name} möchte mit dir befreundet sein.`, targetUrl: '/friends?tab=requests',
    })
    await client.query('COMMIT')
    void flushPushDeliveries().catch((error) => console.error('Push-Zustellung fehlgeschlagen:', error))
    res.status(201).json({ request: request.rows[0] })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

app.delete('/social/friends/:userId', requireUser, asyncRoute(async (req, res) => {
  const targetId = z.string().uuid().parse(req.params.userId)
  if (targetId === req.user.id) return res.status(400).json({ error: 'cannot_unfriend_self' })
  if (!await areFriends(req.user.id, targetId)) return res.status(404).json({ error: 'friendship_not_found' })
  await pool.query(
    `DELETE FROM follows
      WHERE status = 'accepted'
        AND ((follower_id = $1 AND followed_id = $2) OR (follower_id = $2 AND followed_id = $1))`,
    [req.user.id, targetId],
  )
  res.status(204).end()
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
    await createNotifications(client, {
      recipientIds: [senderId], actorId: req.user.id, type: 'friend_accepted', category: 'friendships',
      payload: { userId: req.user.id }, title: 'Freundschaft bestätigt', body: `${req.user.name} hat deine Anfrage angenommen.`, targetUrl: '/friends',
    })
    await client.query('COMMIT')
    void flushPushDeliveries().catch((error) => console.error('Push-Zustellung fehlgeschlagen:', error))
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
    SELECT j.id, j.body, j.visibility, j.created_at, v.visited_at, v.spot_id, s.name AS spot_name, s.district,
           u.id AS user_id, u.name AS user_name, u.username, u.image AS user_image,
           (j.user_id = $1) AS is_owner,
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
     WHERE j.user_id = $1
        OR (
          j.visibility = 'public'
          OR (j.visibility = 'followers' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followed_id = j.user_id AND f.status = 'accepted'))
          OR (j.visibility = 'friends' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followed_id = j.user_id AND f.status = 'accepted') AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = j.user_id AND f.followed_id = $1 AND f.status = 'accepted'))
        )
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = j.user_id) OR (b.blocker_id = j.user_id AND b.blocked_id = $1))
     GROUP BY j.id, v.id, s.id, u.id
     ORDER BY v.visited_at DESC, j.created_at DESC, j.id DESC
     LIMIT 30
  `, [req.user.id])
  res.json({ entries: result.rows })
}))

app.get('/social/map-activity', requireUser, asyncRoute(async (req, res) => {
  res.set('Cache-Control', 'private, no-store')
  const bounds = z.object({
    west: z.coerce.number().gte(-180).lte(180),
    south: z.coerce.number().gte(-90).lte(90),
    east: z.coerce.number().gte(-180).lte(180),
    north: z.coerce.number().gte(-90).lte(90),
  }).refine((value) => value.west < value.east && value.south < value.north, { message: 'Ungültiger Kartenausschnitt.' }).parse(req.query)
  const result = await pool.query(`
    WITH visible_activities AS (
      SELECT j.id, j.body, j.created_at, v.visited_at, v.spot_id,
             u.id AS user_id, u.name AS user_name, u.image AS user_image,
             s.name AS spot_name, ST_Y(s.coordinates::geometry) AS latitude, ST_X(s.coordinates::geometry) AS longitude
        FROM journal_entries j
        JOIN visits v ON v.id = j.visit_id
        JOIN spots s ON s.id = v.spot_id
        JOIN users u ON u.id = j.user_id
       WHERE s.status = 'active'
         AND s.coordinates && ST_MakeEnvelope($2, $3, $4, $5, 4326)::geography
         AND v.visited_at >= CURRENT_DATE - INTERVAL '6 days'
         AND (
           j.user_id = $1
           OR j.visibility = 'public'
           OR (j.visibility = 'followers' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followed_id = j.user_id AND f.status = 'accepted'))
           OR (j.visibility = 'friends' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followed_id = j.user_id AND f.status = 'accepted') AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = j.user_id AND f.followed_id = $1 AND f.status = 'accepted'))
         )
         AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = j.user_id) OR (b.blocker_id = j.user_id AND b.blocked_id = $1))
    ), latest_activities AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY user_id, spot_id ORDER BY visited_at DESC, created_at DESC, id DESC) AS visit_rank
        FROM visible_activities
    )
    SELECT activity.id, activity.body, activity.created_at, activity.visited_at, activity.spot_id,
           activity.user_id, activity.user_name, activity.user_image, activity.spot_name, activity.latitude, activity.longitude,
           COALESCE((SELECT json_agg(json_build_object('id', m.id, 'contentType', m.content_type)) FROM media m WHERE m.journal_entry_id = activity.id), '[]') AS media
      FROM latest_activities activity
     WHERE activity.visit_rank = 1
     ORDER BY activity.visited_at DESC, activity.created_at DESC, activity.id DESC
     LIMIT 24
  `, [req.user.id, bounds.west, bounds.south, bounds.east, bounds.north])
  res.json({ activities: result.rows })
}))

app.get('/social/spots/:spotId/visitors', requireUser, asyncRoute(async (req, res) => {
  const spotId = z.string().uuid().parse(req.params.spotId)
  const result = await pool.query(`
    SELECT u.id, u.name, u.username, u.image, MAX(v.visited_at) AS last_visited_at
      FROM journal_entries j
      JOIN visits v ON v.id = j.visit_id
      JOIN users u ON u.id = j.user_id
     WHERE v.spot_id = $2
       AND (
         j.user_id = $1
         OR j.visibility = 'public'
         OR (j.visibility = 'followers' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followed_id = j.user_id AND f.status = 'accepted'))
         OR (j.visibility = 'friends' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followed_id = j.user_id AND f.status = 'accepted') AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = j.user_id AND f.followed_id = $1 AND f.status = 'accepted'))
       )
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = j.user_id) OR (b.blocker_id = j.user_id AND b.blocked_id = $1))
     GROUP BY u.id
     ORDER BY MAX(v.visited_at) DESC, u.name
     LIMIT 12
  `, [req.user.id, spotId])
  res.json({ visitors: result.rows })
}))

app.get('/social/feed/summary', requireUser, asyncRoute(async (req, res) => {
  const result = await pool.query(`
    WITH last_seen AS (
      SELECT COALESCE((SELECT last_seen_at FROM social_feed_reads WHERE user_id = $1), TIMESTAMPTZ 'epoch') AS value
    )
    SELECT (
      (SELECT COUNT(*) FROM entry_likes l JOIN journal_entries j ON j.id = l.journal_entry_id, last_seen WHERE j.user_id = $1 AND l.user_id <> $1 AND l.created_at > last_seen.value)
      + (SELECT COUNT(*) FROM entry_comments c JOIN journal_entries j ON j.id = c.journal_entry_id, last_seen WHERE j.user_id = $1 AND c.user_id <> $1 AND c.created_at > last_seen.value)
    )::int AS unread_feed,
    (SELECT COUNT(*)::int FROM notifications n WHERE n.user_id = $1 AND n.in_app_visible AND n.read_at IS NULL AND n.category IN ('plans', 'reminders')) AS unread_plans
  `, [req.user.id])
  res.json(result.rows[0])
}))

app.post('/social/feed/seen', requireUser, asyncRoute(async (req, res) => {
  await pool.query(`INSERT INTO social_feed_reads (user_id, last_seen_at) VALUES ($1, NOW()) ON CONFLICT (user_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`, [req.user.id])
  res.status(204).end()
}))

app.get('/social/planned-visits', requireUser, asyncRoute(async (req, res) => {
  const filters = z.object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    response: z.enum(['going', 'interested']).optional(),
    scope: z.enum(['all', 'friends', 'groups', 'mine']).default('all'),
  }).parse(req.query)
  const from = filters.from ?? new Date(Date.now() - 2 * 60 * 60 * 1000)
  const to = filters.to ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
  if (to <= from || to.getTime() - from.getTime() > 370 * 24 * 60 * 60 * 1000) return res.status(400).json({ error: 'invalid_plan_range' })
  const result = await pool.query(`
    SELECT p.id, p.starts_at, p.ends_at, p.note, p.visibility, p.created_at, p.user_id, p.group_id, p.capacity,
           s.id AS spot_id, s.name AS spot_name, s.district, s.address,
           u.name AS user_name, u.username, u.image AS user_image,
           group_record.name AS group_name,
           CASE WHEN group_record.image IS NULL THEN NULL ELSE '/api/group-images/' || group_record.id END AS group_image_url,
           (p.user_id = $1) AS is_owner,
           (EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followed_id = p.user_id AND f.status = 'accepted') AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = p.user_id AND f.followed_id = $1 AND f.status = 'accepted')) AS is_friend,
           (SELECT COUNT(*)::int FROM planned_visit_rsvps r WHERE r.planned_visit_id = p.id AND r.response = 'going') AS going_count,
           (SELECT COUNT(*)::int FROM planned_visit_rsvps r WHERE r.planned_visit_id = p.id AND r.response = 'interested') AS interested_count,
           (SELECT COUNT(*)::int FROM planned_visit_rsvps r WHERE r.planned_visit_id = p.id AND r.response = 'waitlisted') AS waitlisted_count,
           (SELECT response FROM planned_visit_rsvps r WHERE r.planned_visit_id = p.id AND r.user_id = $1) AS my_response
      FROM planned_visits p
      JOIN spots s ON s.id = p.spot_id
      JOIN users u ON u.id = p.user_id
      LEFT JOIN community_groups group_record ON group_record.id = p.group_id
     WHERE p.status = 'scheduled'
       AND p.starts_at >= $2
       AND p.starts_at < $3
       AND (
         (p.group_id IS NOT NULL AND EXISTS (SELECT 1 FROM community_group_members membership WHERE membership.group_id = p.group_id AND membership.user_id = $1 AND membership.status = 'active'))
         OR (p.group_id IS NULL AND (
           p.user_id = $1
           OR p.visibility = 'public'
           OR (p.visibility = 'followers' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followed_id = p.user_id AND f.status = 'accepted'))
           OR (p.visibility = 'friends' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followed_id = p.user_id AND f.status = 'accepted') AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = p.user_id AND f.followed_id = $1 AND f.status = 'accepted'))
         ))
       )
       AND ($4::text IS NULL OR EXISTS (SELECT 1 FROM planned_visit_rsvps r WHERE r.planned_visit_id = p.id AND r.user_id = $1 AND r.response = $4))
       AND ($5 <> 'friends' OR (p.group_id IS NULL AND (p.user_id = $1 OR (EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followed_id = p.user_id AND f.status = 'accepted') AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = p.user_id AND f.followed_id = $1 AND f.status = 'accepted')))))
       AND ($5 <> 'groups' OR p.group_id IS NOT NULL)
       AND ($5 <> 'mine' OR p.user_id = $1 OR EXISTS (SELECT 1 FROM planned_visit_rsvps r WHERE r.planned_visit_id = p.id AND r.user_id = $1 AND r.response = 'going'))
       AND (p.group_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = p.user_id) OR (b.blocker_id = p.user_id AND b.blocked_id = $1)))
     ORDER BY p.starts_at ASC
     LIMIT 120
  `, [req.user.id, from, to, filters.response ?? null, filters.scope])
  res.json({ plannedVisits: result.rows })
}))

app.get('/social/map-plans', requireUser, asyncRoute(async (req, res) => {
  const bounds = z.object({
    global: z.coerce.boolean().optional(),
    west: z.coerce.number().finite().optional(),
    south: z.coerce.number().finite().optional(),
    east: z.coerce.number().finite().optional(),
    north: z.coerce.number().finite().optional(),
  }).refine((value) => value.global || [value.west, value.south, value.east, value.north].every((coordinate) => coordinate !== undefined), { message: 'map_bounds_required' }).parse(req.query)
  if (!bounds.global && (bounds.west >= bounds.east || bounds.south >= bounds.north)) return res.status(400).json({ error: 'invalid_map_bounds' })
  const result = await pool.query(`
    SELECT p.id, p.starts_at, p.ends_at, p.note, p.visibility, p.created_at, p.user_id,
           s.id AS spot_id, s.name AS spot_name, s.district, s.address,
           ST_Y(s.coordinates::geometry) AS latitude, ST_X(s.coordinates::geometry) AS longitude,
           u.name AS user_name, u.username, u.image AS user_image,
           (p.user_id = $1) AS is_owner,
           (SELECT COUNT(*)::int FROM planned_visit_rsvps r WHERE r.planned_visit_id = p.id AND r.response = 'going') AS going_count,
           (SELECT COUNT(*)::int FROM planned_visit_rsvps r WHERE r.planned_visit_id = p.id AND r.response = 'interested') AS interested_count,
           COALESCE((
             SELECT json_agg(json_build_object('user_id', attendee.id, 'user_name', attendee.name, 'user_image', attendee.image, 'response', r.response) ORDER BY r.response, attendee.name)
               FROM planned_visit_rsvps r
               JOIN users attendee ON attendee.id = r.user_id
              WHERE r.planned_visit_id = p.id
           ), '[]'::json) AS attendees,
           (SELECT response FROM planned_visit_rsvps r WHERE r.planned_visit_id = p.id AND r.user_id = $1) AS my_response
      FROM planned_visits p
      JOIN spots s ON s.id = p.spot_id
      JOIN users u ON u.id = p.user_id
     WHERE p.status = 'scheduled'
       AND p.starts_at > NOW()
       AND p.starts_at < NOW() + INTERVAL '90 days'
       AND ($2::boolean OR s.coordinates && ST_MakeEnvelope($3, $5, $4, $6, 4326)::geography)
       AND (
         p.user_id = $1
         OR p.visibility = 'public'
         OR (p.visibility = 'followers' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followed_id = p.user_id AND f.status = 'accepted'))
         OR (p.visibility = 'friends' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followed_id = p.user_id AND f.status = 'accepted') AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = p.user_id AND f.followed_id = $1 AND f.status = 'accepted'))
       )
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = p.user_id) OR (b.blocker_id = p.user_id AND b.blocked_id = $1))
     ORDER BY p.starts_at ASC
     LIMIT 80
  `, [req.user.id, bounds.global ?? false, bounds.west ?? 0, bounds.east ?? 0, bounds.south ?? 0, bounds.north ?? 0])
  res.json({ plannedVisits: result.rows })
}))

app.get('/notifications', requireUser, asyncRoute(async (req, res) => {
  const { unreadOnly } = z.object({ unreadOnly: z.coerce.boolean().optional() }).parse(req.query)
  const result = await pool.query(`
    SELECT n.id, n.type, n.category, n.title, n.body, n.target_url, n.payload, n.created_at, n.read_at, n.planned_visit_id,
           u.name AS actor_name, u.image AS actor_image,
           p.status AS plan_status, p.starts_at, s.name AS spot_name
      FROM notifications n
      LEFT JOIN users u ON u.id = n.actor_id
      LEFT JOIN planned_visits p ON p.id = n.planned_visit_id
      LEFT JOIN spots s ON s.id = p.spot_id
     WHERE n.user_id = $1 AND n.in_app_visible AND ($2::boolean IS NOT TRUE OR n.read_at IS NULL)
     ORDER BY n.created_at DESC
     LIMIT 40
  `, [req.user.id, unreadOnly ?? false])
  res.json({ notifications: result.rows })
}))

app.get('/notifications/summary', requireUser, asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS unread_count
       FROM notifications
      WHERE user_id = $1 AND in_app_visible AND read_at IS NULL`,
    [req.user.id],
  )
  res.json(result.rows[0])
}))

app.post('/notifications/read', requireUser, asyncRoute(async (req, res) => {
  const { plannedOnly, ids } = z.object({
    plannedOnly: z.boolean().optional(),
    ids: z.array(z.string().uuid()).min(1).max(40).optional(),
  }).parse(req.body ?? {})
  if (plannedOnly && ids) return res.status(400).json({ error: 'invalid_notification_read_scope' })
  const scope = plannedOnly
    ? " AND type IN ('plan_rsvp', 'plan_updated', 'plan_cancelled', 'plan_reminder')"
    : ids
      ? ' AND id = ANY($2::uuid[])'
      : ''
  const parameters = ids ? [req.user.id, ids] : [req.user.id]
  await pool.query(`UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND in_app_visible AND read_at IS NULL${scope}`, parameters)
  res.status(204).end()
}))

app.post('/notifications/:notificationId/read', requireUser, asyncRoute(async (req, res) => {
  const id = z.string().uuid().parse(req.params.notificationId)
  await pool.query('UPDATE notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2 AND in_app_visible AND read_at IS NULL', [id, req.user.id])
  res.status(204).end()
}))

app.get('/social/planned-visits/calendar', requireUser, asyncRoute(async (req, res) => {
  const { month } = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).parse(req.query)
  const from = new Date(`${month}-01T00:00:00.000Z`)
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1))
  const result = await pool.query(`
    SELECT (p.starts_at AT TIME ZONE 'Europe/Berlin')::date AS day,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE p.user_id = $1)::int AS own_count,
           COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM planned_visit_rsvps r WHERE r.planned_visit_id = p.id AND r.user_id = $1 AND r.response = 'going'))::int AS going_count,
           COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM planned_visit_rsvps r WHERE r.planned_visit_id = p.id AND r.user_id = $1 AND r.response = 'interested'))::int AS interested_count
      FROM planned_visits p
     WHERE p.status = 'scheduled' AND p.starts_at >= $2 AND p.starts_at < $3
       AND ((p.group_id IS NOT NULL AND EXISTS (SELECT 1 FROM community_group_members membership WHERE membership.group_id = p.group_id AND membership.user_id = $1 AND membership.status = 'active')) OR (p.group_id IS NULL AND (p.user_id = $1 OR p.visibility = 'public' OR (p.visibility = 'followers' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followed_id = p.user_id AND f.status = 'accepted')) OR (p.visibility = 'friends' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followed_id = p.user_id AND f.status = 'accepted') AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = p.user_id AND f.followed_id = $1 AND f.status = 'accepted')))))
       AND (p.group_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = p.user_id) OR (b.blocker_id = p.user_id AND b.blocked_id = $1)))
     GROUP BY day ORDER BY day
  `, [req.user.id, from, to])
  res.json({ days: result.rows })
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

app.patch('/planned-visits/:planId', requireUser, asyncRoute(async (req, res) => {
  const planId = z.string().uuid().parse(req.params.planId)
  const input = plannedVisitUpdateSchema.parse(req.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existing = await client.query(`
      SELECT p.*, s.name AS spot_name
        FROM planned_visits p JOIN spots s ON s.id = p.spot_id
       WHERE p.id = $1 AND p.user_id = $2 AND p.group_id IS NULL AND p.status = 'scheduled'
       FOR UPDATE
    `, [planId, req.user.id])
    const plan = existing.rows[0]
    if (!plan) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'planned_visit_not_found' }) }
    const next = plannedVisitInputSchema.parse({
      spotId: input.spotId ?? plan.spot_id,
      startsAt: input.startsAt ?? new Date(plan.starts_at).toISOString(),
      endsAt: input.endsAt === undefined ? (plan.ends_at ? new Date(plan.ends_at).toISOString() : null) : input.endsAt,
      note: input.note ?? plan.note,
      visibility: input.visibility ?? plan.visibility,
    })
    const spot = await client.query('SELECT id, name FROM spots WHERE id = $1 AND status = \'active\'', [next.spotId])
    if (!spot.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'spot_not_found' }) }
    const result = await client.query(`
      UPDATE planned_visits
         SET spot_id = $3, starts_at = $4, ends_at = $5, note = $6, visibility = $7, updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING id, spot_id, starts_at, ends_at, note, visibility, status, updated_at
    `, [planId, req.user.id, next.spotId, next.startsAt, next.endsAt, next.note, next.visibility])
    const changed = plan.spot_id !== next.spotId || new Date(plan.starts_at).getTime() !== new Date(next.startsAt).getTime() || (plan.ends_at ? new Date(plan.ends_at).getTime() : null) !== (next.endsAt ? new Date(next.endsAt).getTime() : null) || plan.note !== next.note
    if (changed) {
      await notifyPlanUsers(client, planId, req.user.id, 'plan_updated', {
        spotName: spot.rows[0].name,
        startsAt: next.startsAt,
        previousSpotName: plan.spot_name,
        previousStartsAt: plan.starts_at,
      }, await planRsvpUsers(client, planId))
    }
    await client.query('COMMIT')
    if (changed) void flushPushDeliveries().catch((error) => console.error('Push-Zustellung fehlgeschlagen:', error))
    res.json({ plannedVisit: result.rows[0] })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}))

app.post('/planned-visits/:planId/cancel', requireUser, asyncRoute(async (req, res) => {
  const planId = z.string().uuid().parse(req.params.planId)
  const { reason } = plannedVisitCancelSchema.parse(req.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const plan = await client.query(`
      SELECT p.id, p.starts_at, s.name AS spot_name
        FROM planned_visits p JOIN spots s ON s.id = p.spot_id
       WHERE p.id = $1 AND p.user_id = $2 AND p.group_id IS NULL AND p.status = 'scheduled'
       FOR UPDATE
    `, [planId, req.user.id])
    if (!plan.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'planned_visit_not_found' }) }
    await client.query(`UPDATE planned_visits SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = $3, updated_at = NOW() WHERE id = $1 AND user_id = $2`, [planId, req.user.id, reason])
    const item = plan.rows[0]
    await notifyPlanUsers(client, planId, req.user.id, 'plan_cancelled', { spotName: item.spot_name, startsAt: item.starts_at, reason }, await planRsvpUsers(client, planId))
    await client.query('COMMIT')
    void flushPushDeliveries().catch((error) => console.error('Push-Zustellung fehlgeschlagen:', error))
    res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}))

app.post('/planned-visits/:planId/complete', requireUser, asyncRoute(async (req, res) => {
  const planId = z.string().uuid().parse(req.params.planId)
  const { journalEntryId } = z.object({ journalEntryId: z.string().uuid().optional() }).parse(req.body)
  const result = await pool.query(`
    UPDATE planned_visits p
       SET status = 'completed', completed_at = NOW(), journal_entry_id = $3, updated_at = NOW()
     WHERE p.id = $1 AND p.user_id = $2 AND p.group_id IS NULL AND p.status = 'scheduled'
       AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM journal_entries j WHERE j.id = $3 AND j.user_id = $2))
     RETURNING id, status, completed_at
  `, [planId, req.user.id, journalEntryId ?? null])
  if (!result.rowCount) return res.status(404).json({ error: 'planned_visit_not_found' })
  res.json({ plannedVisit: result.rows[0] })
}))

app.post('/planned-visits/:planId/rsvp', requireUser, asyncRoute(async (req, res) => {
  const planId = z.string().uuid().parse(req.params.planId)
  const input = z.object({ response: z.enum(['going', 'interested']) }).parse(req.body)
  const plan = await pool.query('SELECT id, user_id, visibility, status FROM planned_visits WHERE id = $1 AND group_id IS NULL', [planId])
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
  const details = await pool.query(
    `SELECT p.starts_at, s.name AS spot_name
       FROM planned_visits p JOIN spots s ON s.id = p.spot_id
      WHERE p.id = $1`,
    [planId],
  )
  await createNotifications(pool, {
    recipientIds: [item.user_id], actorId: req.user.id, type: 'plan_rsvp', category: 'plans', plannedVisitId: planId,
    payload: { response: input.response, spotName: details.rows[0].spot_name, startsAt: details.rows[0].starts_at },
    title: 'Neue Zusage', body: `${req.user.name} ist bei ${details.rows[0].spot_name} ${input.response === 'going' ? 'dabei' : 'interessiert'}.`,
    targetUrl: `/social?section=plans&plan=${encodeURIComponent(planId)}`,
  })
  void flushPushDeliveries().catch((error) => console.error('Push-Zustellung fehlgeschlagen:', error))
  res.json({ rsvp: result.rows[0] })
}))

app.delete('/planned-visits/:planId/rsvp', requireUser, asyncRoute(async (req, res) => {
  const planId = z.string().uuid().parse(req.params.planId)
  await pool.query(`DELETE FROM planned_visit_rsvps r USING planned_visits p
                     WHERE r.planned_visit_id = p.id AND r.planned_visit_id = $1 AND r.user_id = $2 AND p.group_id IS NULL`, [planId, req.user.id])
  res.status(204).end()
}))

app.get('/planned-visits/:planId/rsvps', requireUser, asyncRoute(async (req, res) => {
  const planId = z.string().uuid().parse(req.params.planId)
  const plan = await pool.query('SELECT user_id, visibility, status FROM planned_visits WHERE id = $1 AND group_id IS NULL', [planId])
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
  await createNotifications(pool, {
    recipientIds: [entry.user_id], actorId: req.user.id, type: 'entry_comment', category: 'comments',
    payload: { entryId: entry.id, commentId: result.rows[0].id }, title: 'Neuer Kommentar', body: `${req.user.name} hat deinen Beitrag kommentiert.`, targetUrl: `/social?entry=${encodeURIComponent(entry.id)}`,
  })
  void flushPushDeliveries().catch((error) => console.error('Push-Zustellung fehlgeschlagen:', error))
  res.status(201).json({ comment: { ...result.rows[0], user_id: req.user.id, user_name: req.user.name, username: req.user.username } })
}))

app.post('/social/entries/:entryId/like', requireUser, asyncRoute(async (req, res) => {
  const entry = await getViewableEntry(req.user.id, req.params.entryId)
  if (!entry) return res.status(404).json({ error: 'entry_not_found' })
  const like = await pool.query('INSERT INTO entry_likes (journal_entry_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING journal_entry_id', [entry.id, req.user.id])
  if (like.rowCount) {
    await createNotifications(pool, {
      recipientIds: [entry.user_id], actorId: req.user.id, type: 'entry_like', category: 'reactions',
      payload: { entryId: entry.id }, title: 'Neue Reaktion', body: `${req.user.name} gefällt dein Beitrag.`, targetUrl: `/social?entry=${encodeURIComponent(entry.id)}`,
    })
    void flushPushDeliveries().catch((error) => console.error('Push-Zustellung fehlgeschlagen:', error))
  }
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
  await createNotifications(pool, {
    recipientIds: [req.params.userId], actorId: req.user.id, type: 'direct_message', category: 'messages',
    payload: { messageId: result.rows[0].id, senderId: req.user.id }, title: 'Neue Nachricht', body: `${req.user.name} hat dir geschrieben.`, targetUrl: `/friends?message=${encodeURIComponent(req.user.id)}`,
  })
  void flushPushDeliveries().catch((error) => console.error('Push-Zustellung fehlgeschlagen:', error))
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

app.get('/geocoding/search', requireUser, asyncRoute(async (req, res) => {
  const input = z.object({ q: z.string().trim().min(3).max(160) }).parse(req.query)
  const cacheKey = input.q.toLocaleLowerCase('de-DE')
  const cached = geocodingCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return res.json({ results: cached.results })

  const delay = Math.max(0, 1000 - (Date.now() - lastGeocodingRequestAt))
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
  lastGeocodingRequestAt = Date.now()

  const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=de&q=${encodeURIComponent(input.q)}`, {
    headers: { 'User-Agent': 'BoulderO/1.0 (+https://bouldero.de)', Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) return res.status(502).json({ error: 'geocoding_unavailable' })
  const payload = await response.json()
  const results = (Array.isArray(payload) ? payload : [])
    .map((item) => ({ latitude: Number(item.lat), longitude: Number(item.lon), label: String(item.display_name ?? '') }))
    .filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude) && item.label)
    .map((item) => ({ ...item, latitude: item.latitude.toFixed(6), longitude: item.longitude.toFixed(6) }))

  geocodingCache.set(cacheKey, { results, expiresAt: Date.now() + 5 * 60 * 1000 })
  if (geocodingCache.size > 100) geocodingCache.delete(geocodingCache.keys().next().value)
  res.json({ results })
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

app.get('/admin/auth-audit', ...requireSuperAdmin, asyncRoute(async (req, res) => {
  const limit = z.coerce.number().int().min(1).max(500).parse(req.query.limit ?? 100)
  const [result, stats] = await Promise.all([
    pool.query(
      `SELECT id, event_type, user_id, user_name, user_email, created_at
         FROM auth_audit_events
        ORDER BY created_at DESC
        LIMIT $1`,
      [limit],
    ),
    pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM users) AS registered_users,
        (SELECT COUNT(*)::int FROM journal_entries) AS journal_entries,
        (SELECT COUNT(*)::int FROM spots WHERE status = 'active') AS active_spots
    `),
  ])
  res.json({ events: result.rows, stats: stats.rows[0] })
}))

app.get('/admin/users', ...requireSuperAdmin, asyncRoute(async (req, res) => {
  const limit = z.coerce.number().int().min(1).max(1000).parse(req.query.limit ?? 1000)
  const [result, count] = await Promise.all([
    pool.query(
      `SELECT u.id, u.name, u.username, u.email, u.image, u.role, u.created_at,
            (SELECT MAX(a.created_at)
               FROM auth_audit_events a
              WHERE a.user_id = u.id AND a.event_type = 'login') AS last_login_at
       FROM users u
      ORDER BY u.created_at DESC, u.name ASC
      LIMIT $1`,
      [limit],
    ),
    pool.query('SELECT COUNT(*)::int AS total FROM users'),
  ])
  res.json({ users: result.rows, total: count.rows[0].total })
}))

app.get('/admin/spots/export', ...requireSuperAdmin, asyncRoute(async (req, res) => {
  const includeArchived = z.enum(['true', 'false']).parse(req.query.includeArchived ?? 'false') === 'true'
  const result = await pool.query(`
    SELECT id, name, district, address, website, opening_hours, area_sqm, image_url,
           source, source_external_id, source_license, status, created_at, updated_at,
           ST_Y(coordinates::geometry) AS latitude,
           ST_X(coordinates::geometry) AS longitude
      FROM spots
     WHERE status = 'active' OR $1::boolean
     ORDER BY name ASC
  `, [includeArchived])

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'BoulderO'
  workbook.created = new Date()
  const sheet = workbook.addWorksheet('Hallen')
  sheet.columns = [
    { header: 'id', key: 'id', width: 38 },
    { header: 'name', key: 'name', width: 32 },
    { header: 'district', key: 'district', width: 22 },
    { header: 'address', key: 'address', width: 42 },
    { header: 'website', key: 'website', width: 42 },
    { header: 'opening_hours', key: 'opening_hours', width: 30 },
    { header: 'area_sqm', key: 'area_sqm', width: 24 },
    { header: 'latitude', key: 'latitude', width: 15 },
    { header: 'longitude', key: 'longitude', width: 15 },
    { header: 'image_url', key: 'image_url', width: 52 },
    { header: 'image_export_path', key: 'image_export_path', width: 42 },
    { header: 'source', key: 'source', width: 20 },
    { header: 'source_external_id', key: 'source_external_id', width: 28 },
    { header: 'source_license', key: 'source_license', width: 28 },
    { header: 'status', key: 'status', width: 14 },
    { header: 'created_at', key: 'created_at', width: 24 },
    { header: 'updated_at', key: 'updated_at', width: 24 },
  ]
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFF4F9E9' } }
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF153243' } }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: 'A1', to: 'Q1' }

  const localImages = []
  for (const spot of result.rows) {
    let imageExportPath = ''
    if (spot.image_url?.startsWith('upload:')) {
      const storageKey = spot.image_url.slice('upload:'.length)
      const absolutePath = path.resolve(uploadRoot, storageKey)
      const imageDirectory = path.resolve(uploadRoot, 'spot-images')
      if (absolutePath.startsWith(`${imageDirectory}${path.sep}`)) {
        const extension = path.extname(storageKey).toLowerCase() || '.jpg'
        imageExportPath = `bilder/${spot.id}${extension}`
        localImages.push({ absolutePath, archivePath: imageExportPath })
      }
    }
    sheet.addRow({ ...spot, image_export_path: imageExportPath })
  }
  const xlsx = await workbook.xlsx.writeBuffer()

  res.attachment(includeArchived ? 'bouldero-hallen-export-inklusive-archiv.zip' : 'bouldero-hallen-export-aktiv.zip')
  const archive = new ZipArchive({ zlib: { level: 9 } })
  archive.on('error', (error) => res.destroy(error))
  archive.pipe(res)
  archive.append(Buffer.from(xlsx), { name: 'bouldero-hallen.xlsx' })
  for (const image of localImages) {
    try {
      archive.append(await fs.readFile(image.absolutePath), { name: image.archivePath })
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  await archive.finalize()
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

app.post('/admin/spots/import/preview', ...requireSuperAdmin, spotImportUpload.single('file'), asyncRoute(async (req, res) => {
  let rows
  try {
    rows = await parseAdminSpotImport(req.file)
  } catch (error) {
    return res.status(400).json({ error: error.message, missing: error.missing })
  }
  const candidates = await findImportCandidates(rows)
  res.json({ rows: rows.map((row) => {
    const rowCandidates = candidates.get(row.rowNumber) ?? []
    const safeUpdateTargetId = rowCandidates.length === 1 && ['id', 'source_external_id'].includes(rowCandidates[0].match_type)
      ? rowCandidates[0].id
      : null
    return { ...row, candidates: rowCandidates, safeUpdateTargetId }
  }) })
}))

app.post('/admin/spots/import/apply', ...requireSuperAdmin, spotImportUpload.single('file'), asyncRoute(async (req, res) => {
  let rows
  try {
    rows = await parseAdminSpotImport(req.file)
  } catch (error) {
    return res.status(400).json({ error: error.message, missing: error.missing })
  }
  let decisions
  try {
    decisions = z.array(z.object({
      rowNumber: z.number().int().positive(),
      action: z.enum(['create', 'update', 'skip']),
      targetId: z.string().uuid().optional(),
    })).max(500).parse(JSON.parse(req.body.decisions ?? '[]'))
  } catch {
    return res.status(400).json({ error: 'csv_decisions_invalid' })
  }
  const decisionsByRow = new Map(decisions.map((decision) => [decision.rowNumber, decision]))
  const candidates = await findImportCandidates(rows)
  const client = await pool.connect()
  let created = 0
  let updated = 0
  let skipped = 0
  try {
    await client.query('BEGIN')
    for (const row of rows) {
      const decision = decisionsByRow.get(row.rowNumber) ?? { action: 'skip' }
      if (!row.input || decision.action === 'skip') { skipped += 1; continue }
      if (row.error) throw new Error(`Zeile ${row.rowNumber}: ${row.error}`)
      const input = row.input
      if (decision.action === 'create') {
        await client.query(
          `INSERT INTO spots (name, district, address, website, opening_hours, area_sqm, coordinates, source, source_external_id, status)
           VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($8, $7), 4326)::geography, $9, $10, 'active')`,
          [input.name, input.district, input.address, input.website ?? null, input.openingHours ?? null, input.areaSqm ?? null, input.latitude, input.longitude, row.source ?? 'admin-import', row.sourceExternalId],
        )
        created += 1
      } else {
        if (!decision.targetId) throw new Error(`Zeile ${row.rowNumber}: Zielhalle fehlt.`)
        const validTargetIds = new Set((candidates.get(row.rowNumber) ?? []).map((candidate) => candidate.id))
        if (!validTargetIds.has(decision.targetId)) throw new Error(`Zeile ${row.rowNumber}: Die ausgewählte Zielhalle passt nicht zu dieser Importzeile.`)
        const result = await client.query(
          `UPDATE spots
              SET name = $2, district = $3, address = $4,
                  website = COALESCE($5, website), opening_hours = COALESCE($6, opening_hours),
                  area_sqm = COALESCE($7, area_sqm),
                  coordinates = ST_SetSRID(ST_MakePoint($9, $8), 4326)::geography, updated_at = NOW()
            WHERE id = $1
            RETURNING id`,
          [decision.targetId, input.name, input.district, input.address, input.website ?? null, input.openingHours ?? null, input.areaSqm ?? null, input.latitude, input.longitude],
        )
        if (!result.rowCount) throw new Error(`Zeile ${row.rowNumber}: Zielhalle existiert nicht mehr.`)
        updated += 1
      }
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  res.status(201).json({ created, updated, skipped })
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
    visitedAt: z.string().date().optional(),
  }).parse(req.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const entry = await client.query(
      `SELECT j.id, v.id AS visit_id
         FROM journal_entries j
         JOIN visits v ON v.id = j.visit_id
        WHERE j.id = $1 AND j.user_id = $2
        FOR UPDATE`,
      [req.params.entryId, req.user.id],
    )
    if (!entry.rowCount) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'journal_entry_not_found' })
    }
    if (input.visitedAt) {
      await client.query('UPDATE visits SET visited_at = $2::date WHERE id = $1', [entry.rows[0].visit_id, input.visitedAt])
    }
    const result = await client.query(
      `UPDATE journal_entries
          SET body = COALESCE($3, body), visibility = COALESCE($4, visibility), updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING id, body, visibility, updated_at`,
      [req.params.entryId, req.user.id, input.body ?? null, input.visibility ?? null],
    )
    await client.query('COMMIT')
    res.json({ journalEntry: { ...result.rows[0], visited_at: input.visitedAt ?? null } })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}))

app.delete('/visits/:visitId', requireUser, asyncRoute(async (req, res) => {
  const client = await pool.connect()
  let storageKeys = []
  try {
    await client.query('BEGIN')
    const visit = await client.query('SELECT id FROM visits WHERE id = $1 AND user_id = $2 FOR UPDATE', [req.params.visitId, req.user.id])
    if (!visit.rowCount) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'visit_not_found' })
    }
    const media = await client.query(
      `DELETE FROM media
        WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE visit_id = $1)
        RETURNING storage_key`,
      [req.params.visitId],
    )
    storageKeys = media.rows.map((row) => row.storage_key)
    await client.query('DELETE FROM visits WHERE id = $1 AND user_id = $2', [req.params.visitId, req.user.id])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
  await Promise.all(storageKeys.map(async (storageKey) => {
    const absolutePath = path.resolve(uploadRoot, storageKey)
    if (absolutePath.startsWith(path.resolve(uploadRoot))) await fs.unlink(absolutePath).catch(() => undefined)
  }))
  res.status(204).end()
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
void schedulePlanReminders().catch((error) => console.error('Planungserinnerungen konnten nicht geplant werden:', error))
const planReminderInterval = setInterval(() => {
  void schedulePlanReminders().catch((error) => console.error('Planungserinnerungen konnten nicht geplant werden:', error))
}, 5 * 60_000)
planReminderInterval.unref()
if (pushConfigured) {
  void flushPushDeliveries().catch((error) => console.error('Ausstehende Push-Zustellungen konnten nicht gestartet werden:', error))
  const pushDeliveryInterval = setInterval(() => {
    void flushPushDeliveries().catch((error) => console.error('Push-Zustellung fehlgeschlagen:', error))
  }, 60_000)
  pushDeliveryInterval.unref()
}
app.listen(port, () => console.log(`BoulderO API listening on ${port}`))
