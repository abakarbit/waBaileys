const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('baileys')
const pino = require('pino')
const express = require('express')
const fs = require('fs')
const path = require('path')
const { Boom } = require('@hapi/boom')
const QRCode = require('qrcode')
const crypto = require('crypto')

// ===== CONFIG (dengan validasi) =====
const AUTH_BASE = process.env.AUTH_DIR || '/app/auth_info'
const LOG_LEVEL = process.env.LOG_LEVEL || 'info'
const PORT = parseInt(process.env.PORT || '3000')
const API_KEY = process.env.API_KEY || ''
const REQUIRE_API_KEY = process.env.REQUIRE_API_KEY !== 'false' // default true
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*' // ganti dengan domain spesifik di prod
const TRUST_PROXY = process.env.TRUST_PROXY || '' // 'true' atau jumlah hops

// ===== WEBHOOK CONFIG =====
const WEBHOOK_URL = process.env.WEBHOOK_URL || '' // URL untuk menerima webhook callback
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '' // Secret untuk HMAC signature webhook

// ===== USER CONFIG =====
const DEFAULT_USERNAME = process.env.DEFAULT_USERNAME || 'admin'
const DEFAULT_PASSWORD = process.env.DEFAULT_PASSWORD || ''
const DEFAULT_DISPLAY_NAME = process.env.DISPLAY_NAME || 'WhatsApp Bot'

const PAIRING_TTL = 5 * 60 * 1000
const MAX_RECONNECT_DELAY = 5 * 60 * 1000
const RECONNECT_BASE_DELAY = 3000
const SSE_HEARTBEAT_INTERVAL = 20000
const PAIRING_REQUEST_TIMEOUT = 30000
const MAX_LOG_ENTRIES = 500
const MAX_MESSAGE_LENGTH = 65536
const MAX_BODY_SIZE = '100kb'

// ===== VALIDASI STARTUP =====
if (REQUIRE_API_KEY && !API_KEY) {
  console.error('')
  console.error('╔══════════════════════════════════════════════════════════╗')
  console.error('║  ERROR: API_KEY tidak dikonfigurasi!                   ║')
  console.error('║                                                       ║')
  console.error('║  Set API_KEY di .env atau environment variable.        ║')
  console.error('║  Atau set REQUIRE_API_KEY=false untuk development.     ║')
  console.error('╚══════════════════════════════════════════════════════════╝')
  console.error('')
  process.exit(1)
}

// Trust proxy akan dipasang ke app Express setelah app dibuat (line ~490)

// ===== LOGGER =====
const logger = pino({
  level: LOG_LEVEL,
  transport: { target: 'pino/file', options: { destination: '/dev/stdout' } },
})

// ===== LOG STORE (in-memory, untuk dashboard SSE) =====
const logStore = []
const logClients = new Set()

function removeLogClient(res) {
  logClients.delete(res)
}

function emitLog(level, msg, err) {
  if (level === 'error') {
    logger.error({ err: err || undefined }, msg)
  } else if (level === 'warn') {
    logger.warn(msg)
  } else {
    logger.info(msg)
  }

  const entry = { time: Date.now(), level, msg }
  logStore.push(entry)
  if (logStore.length > MAX_LOG_ENTRIES) logStore.shift()

  for (const res of logClients) {
    try {
      res.write(`data: ${JSON.stringify(entry)}\n\n`)
    } catch (e) {
      removeLogClient(res)
    }
  }
}

// ===== WEBHOOK =====
async function sendWebhook(event, data) {
  if (!WEBHOOK_URL) return
  try {
    const payload = JSON.stringify({ event, data, time: Date.now() })
    const signature = WEBHOOK_SECRET
      ? crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex')
      : ''
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'User-Agent': 'waBaileys/1.0',
      },
      body: payload,
    })
  } catch (err) {
    emitLog('warn', `[Webhook] Gagal kirim event "${event}": ${err.message}`)
  }
}

// ===== VALIDASI =====
function isValidPhone(phone) {
  return typeof phone === 'string' && /^\d{8,15}$/.test(phone)
}

function sanitizePhone(phone) {
  return String(phone).replace(/[^\d+]/g, '').replace(/^\+/, '')
}

function isValidJid(jid) {
  return typeof jid === 'string' &&
    jid.length > 5 &&
    (jid.includes('@s.whatsapp.net') || jid.includes('@g.us') || /^\d+$/.test(jid))
}

function sanitizeMessage(msg) {
  if (typeof msg !== 'string') return ''
  if (msg.length > MAX_MESSAGE_LENGTH) return msg.slice(0, MAX_MESSAGE_LENGTH)
  return msg
}

// ===== RECONNECT STATE TRACKER =====
const reconnectState = new Map()

function getReconnectDelay(phone) {
  const state = reconnectState.get(phone) || { attempts: 0, lastAttempt: 0 }
  return Math.min(RECONNECT_BASE_DELAY * Math.pow(2, state.attempts), MAX_RECONNECT_DELAY)
}

function recordReconnectAttempt(phone) {
  const state = reconnectState.get(phone) || { attempts: 0, lastAttempt: 0 }
  state.attempts += 1
  state.lastAttempt = Date.now()
  reconnectState.set(phone, state)
}

function resetReconnectState(phone) {
  reconnectState.delete(phone)
}

// ===== SESSION MANAGER =====
class SessionManager {
  constructor() {
    this.sessions = new Map()
    this.pairingLocks = new Map()
  }

  async startSession(phone) {
    const authDir = path.join(AUTH_BASE, phone)
    fs.mkdirSync(authDir, { recursive: true })

    const { state, saveCreds } = await useMultiFileAuthState(authDir)
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
      version,
      logger: pino({ level: 'warn' }),
      auth: state,
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      emitOwnEvents: false,
      shouldSyncHistoryMessage: () => false,
      defaultQueryTimeoutMs: 30_000,
      browser: ['HasAlertBot', 'Chrome', '1.0.0'],
    })

    const session = {
      sock, state, phone,
      connected: false,
      saveCreds,
      _removed: false,
      pairingInfo: null,
      pairingLock: null,
      qrData: null,
    }
    this.sessions.set(phone, session)

    sock.ev.on('creds.update', saveCreds)

    // Webhook: pesan masuk
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (!messages || messages.length === 0) return
      for (const msg of messages) {
        // Skip pesan dari bot sendiri
        if (msg.key?.fromMe) continue
        const text = msg.message?.conversation
          || msg.message?.extendedTextMessage?.text
          || msg.message?.imageMessage?.caption
          || ''
        sendWebhook('message.incoming', {
          phone,
          from: msg.key?.remoteJid,
          fromMe: msg.key?.fromMe,
          text,
          type: msg.message ? Object.keys(msg.message)[0] : null,
          id: msg.key?.id,
          timestamp: msg.messageTimestamp,
          pushName: msg.pushName,
        })
      }
    })

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        try {
          session.qrData = await QRCode.toDataURL(qr)
          emitPairingEvent(phone, { qr: session.qrData, status: 'qr' })
          emitLog('info', `[${phone}] QR code siap discan`)
        } catch (err) {
          emitLog('error', `[${phone}] Gagal generate QR: ${err.message}`)
        }
      }
      if (connection === 'open') {
        session.connected = true
        session.pairingInfo = null
        session.qrData = null
        resetReconnectState(phone)
        emitPairingEvent(phone, {
          code: null, time: null, expiresAt: null, qr: null,
          status: 'paired', connected: true, registered: true,
        })
        emitLog('info', `[${phone}] Terhubung`)
        sendWebhook('connection.open', { phone, jid: sock.user?.id })
      }

      if (connection === 'close') {
        session.connected = false
        if (session._removed || !this.sessions.has(phone)) {
          emitLog('info', `[${phone}] Session dihapus, skip reconnect`)
          return
        }

        const statusCode = lastDisconnect?.error?.output?.statusCode
        const isRegistered = session.state.creds?.registered
        const isLoggedOut = statusCode === DisconnectReason.loggedOut
        const isUnauthorized = [401, 403, 419].includes(statusCode)
        const shouldReconnect = !isLoggedOut || isUnauthorized

        emitLog('warn', `[${phone}] Disconnected (code: ${statusCode}, registered: ${isRegistered}, reconnect: ${shouldReconnect})`)
        sendWebhook('connection.close', { phone, statusCode, reason: lastDisconnect?.error?.message, willReconnect: shouldReconnect })

        if (isUnauthorized && !isRegistered) {
          emitLog('warn', `[${phone}] Pairing belum selesai. Pairing ulang di dashboard`)
          return
        }

        if (shouldReconnect) {
          const delay = getReconnectDelay(phone)
          recordReconnectAttempt(phone)
          emitLog('info', `[${phone}] Reconnect dalam ${Math.round(delay / 1000)}s (attempt ${reconnectState.get(phone)?.attempts})`)
          setTimeout(() => {
            if (this.sessions.has(phone) && !session._removed) {
              this.startSession(phone)
            }
          }, delay)
        } else {
          emitLog('warn', `[${phone}] Logged out permanent, hapus auth`)
          this._cleanupAuth(phone)
          this.sessions.delete(phone)
          resetReconnectState(phone)
        }
      }
    })

    return session
  }

  getSession(phone) {
    return this.sessions.get(phone) || null
  }

  listSessions() {
    return Array.from(this.sessions.values()).map((s) => ({
      phone: s.phone,
      connected: s.connected,
      registered: s.state.creds?.registered || false,
      jid: s.sock?.user?.id || null,
      pairing: s.pairingInfo,
    }))
  }

  countSessions() {
    return this.sessions.size
  }

  _cleanupAuth(phone) {
    const authDir = path.join(AUTH_BASE, phone)
    try {
      if (fs.existsSync(authDir)) {
        fs.rmSync(authDir, { recursive: true, force: true })
      }
    } catch (e) {
      emitLog('error', `[${phone}] Gagal hapus auth dir: ${e.message}`)
    }
  }

  _safeEndSocket(session) {
    try {
      if (session.sock) {
        session.sock.end(new Error('Session removed'))
      }
    } catch (e) {
      // abaikan
    }
  }

  async removeSession(phone) {
    emitLog('info', `[${phone}] Menghapus session...`)
    const session = this.sessions.get(phone)
    this.sessions.delete(phone)
    resetReconnectState(phone)

    if (session) {
      session._removed = true
      this._safeEndSocket(session)
    }

    this._cleanupAuth(phone)
    emitLog('info', `[${phone}] Auth dihapus, siap pairing ulang`)
    emitPairingEvent(phone, {
      code: null, time: null, expiresAt: null, qr: null,
      status: 'removed', connected: false, registered: false,
    })
  }

  async requestPairing(phone) {
    if (this.pairingLocks.has(phone)) {
      throw new Error('Sedang ada request pairing aktif untuk nomor ini. Tunggu sejenak.')
    }

    // Restart session jika sudah ada, biar socket segar
    const existing = this.sessions.get(phone)
    if (existing) {
      existing._removed = true
      this._safeEndSocket(existing)
      this.sessions.delete(phone)
      resetReconnectState(phone)
    }

    await this.startSession(phone)
    const session = this.sessions.get(phone)
    if (!session) {
      throw new Error('Gagal membuat session')
    }

    if (session.state.creds?.registered) {
      throw new Error('Session sudah terdaftar, tidak perlu pairing ulang')
    }

    const MAX_RETRIES = 3
    const RETRY_DELAY = 4000

    const lockPromise = (async () => {
      try {
        let lastError = null

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            if (!this.sessions.has(phone) || session._removed) {
              emitLog('info', `[${phone}] Session mati, restart untuk pairing (attempt ${attempt}/${MAX_RETRIES})`)
              await this.startSession(phone)
              await new Promise((r) => setTimeout(r, 2000))
              session = this.sessions.get(phone)
              if (!session) {
                throw new Error('Gagal restart session')
              }
            }

            const code = await Promise.race([
              session.sock.requestPairingCode(phone),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Request pairing code timeout')), PAIRING_REQUEST_TIMEOUT)
              ),
            ])

            const formatted = code.match(/.{1,4}/g)?.join('-') || code
            const now = Date.now()
            session.pairingInfo = {
              code: formatted,
              time: now,
              expiresAt: now + PAIRING_TTL,
            }

            emitLog('info', `[${phone}] Pairing code: ${formatted}`)
            emitLog('info', `[${phone}] Buka WA > Perangkat Tertaut > Masukkan kode: ${formatted}`)
            emitPairingEvent(phone, session.pairingInfo)
            return { code: formatted, info: session.pairingInfo }
          } catch (err) {
            lastError = err
            const msg = err?.message || String(err)
            const isRetryable = msg.includes('Connection Closed')
              || msg.includes('timeout')
              || msg.includes('closed')
              || msg.includes('EOF')
              || msg.includes('socket')

            if (attempt < MAX_RETRIES && isRetryable) {
              emitLog('warn', `[${phone}] Pairing attempt ${attempt}/${MAX_RETRIES} gagal: ${msg}. Coba lagi...`)
              await new Promise((r) => setTimeout(r, RETRY_DELAY))
              continue
            }

            throw err
          }
        }

        throw lastError || new Error('Gagal pairing setelah beberapa percobaan')
      } catch (err) {
        const msg = err?.message || String(err)
        emitLog('error', `[${phone}] Pairing gagal: ${msg}`)
        if (session && !session._removed) {
          session._removed = true
          this.sessions.delete(phone)
          this._cleanupAuth(phone)
        }
        throw new Error(`Gagal pairing: ${msg}. Coba lagi dari dashboard.`)
      } finally {
        this.pairingLocks.delete(phone)
      }
    })()

    this.pairingLocks.set(phone, lockPromise)
    return lockPromise
  }

  async startQRPairing(phone) {
    if (this.pairingLocks.has(phone)) {
      throw new Error('Sedang ada proses pairing aktif untuk nomor ini.')
    }

    // Jika session sudah ada, end socket lama agar QR baru muncul
    const existing = this.sessions.get(phone)
    if (existing) {
      existing._removed = true
      this._safeEndSocket(existing)
      this.sessions.delete(phone)
      resetReconnectState(phone)
      // Jangan hapus auth biar tetap bisa pairing ulang
    }

    await this.startSession(phone)
    const session = this.sessions.get(phone)
    if (!session) {
      throw new Error('Gagal membuat session')
    }

    if (session.state.creds?.registered) {
      throw new Error('Session sudah terdaftar, tidak perlu pairing ulang')
    }

    const lockPromise = (async () => {
      try {
        const qrData = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('QR code timeout. Coba lagi.'))
          }, PAIRING_REQUEST_TIMEOUT)

          const interval = setInterval(() => {
            const s = this.sessions.get(phone)
            if (!s || s._removed) {
              clearInterval(interval)
              clearTimeout(timeout)
              reject(new Error('Session dihapus saat menunggu QR'))
              return
            }
            if (s.connected) {
              clearInterval(interval)
              clearTimeout(timeout)
              reject(new Error('Session sudah terhubung'))
              return
            }
            if (s.qrData) {
              clearInterval(interval)
              clearTimeout(timeout)
              resolve(s.qrData)
            }
          }, 500)
        })

        emitLog('info', `[${phone}] QR code siap — scan dari WhatsApp`)
        return { qr: qrData }
      } catch (err) {
        const msg = err?.message || String(err)
        emitLog('error', `[${phone}] QR pairing gagal: ${msg}`)
        if (session && !session._removed) {
          session._removed = true
          this.sessions.delete(phone)
          this._cleanupAuth(phone)
        }
        throw new Error(`Gagal QR pairing: ${msg}`)
      } finally {
        this.pairingLocks.delete(phone)
      }
    })()

    this.pairingLocks.set(phone, lockPromise)
    return lockPromise
  }
}

const sessionManager = new SessionManager()

// ===== PAIRING EVENT STREAM =====
const pairingClients = new Set()

function removePairingClient(res) {
  pairingClients.delete(res)
}

function emitPairingEvent(phone, info) {
  const session = sessionManager.getSession(phone)
  const enriched = {
    phone,
    code: info.code ?? session?.pairingInfo?.code ?? null,
    time: info.time ?? session?.pairingInfo?.time ?? null,
    expiresAt: info.expiresAt ?? session?.pairingInfo?.expiresAt ?? null,
    qr: info.qr ?? session?.qrData ?? null,
    connected: session?.connected || false,
    registered: session?.state?.creds?.registered || false,
    ...info,
  }
  const data = JSON.stringify(enriched)
  for (const res of pairingClients) {
    try {
      res.write(`data: ${data}\n\n`)
    } catch (e) {
      removePairingClient(res)
    }
  }
}

// ===== EXPRESS APP =====
const app = express()

// Trust proxy — agar req.ip akurat di belakang reverse proxy
if (TRUST_PROXY) {
  const hops = parseInt(TRUST_PROXY) || 1
  app.set('trust proxy', hops)
}

// Body parser dengan limit
app.use(express.json({ limit: MAX_BODY_SIZE }))

// ===== SECURITY HEADERS =====
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Referrer-Policy', 'same-origin')
  res.setHeader('X-DNS-Prefetch-Control', 'off')
  if (req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  next()
})

// ===== CORS — configurable via env =====
app.use((req, res, next) => {
  const origin = CORS_ORIGIN === '*' ? '*' : CORS_ORIGIN
  if (origin === '*') {
    res.header('Access-Control-Allow-Origin', '*')
  } else if (origin.includes(req.headers.origin || '')) {
    res.header('Access-Control-Allow-Origin', req.headers.origin)
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key')
  res.header('Access-Control-Expose-Headers', 'X-Request-Id')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// Generate request ID untuk tracing
app.use((req, res, next) => {
  req.requestId = crypto.randomUUID().slice(0, 8)
  res.setHeader('X-Request-Id', req.requestId)
  next()
})

// ===== SESSION MANAGER (dashboard login sessions) =====
const dashboardSessions = new Map() // token -> { username, displayName, createdAt }

const SESSION_TTL = 24 * 60 * 60 * 1000 // 24 jam

function createSession() {
  // Buat session baru untuk dashboard
  const token = crypto.randomUUID()
  const session = {
    token,
    username: DEFAULT_USERNAME,
    displayName: DEFAULT_DISPLAY_NAME,
    createdAt: Date.now(),
  }
  dashboardSessions.set(token, session)

  // Cleanup sessions expired
  setTimeout(() => dashboardSessions.delete(token), SESSION_TTL)

  return session
}

function getSession(token) {
  if (!token) return null
  const session = dashboardSessions.get(token)
  if (!session) return null
  // Extend session setiap kali diakses — 24 jam dari aktivitas terakhir
  session.createdAt = Date.now()
  return session
}

// Periodik cleanup session expired (setiap jam)
setInterval(() => {
  const now = Date.now()
  for (const [token, session] of dashboardSessions) {
    if (now - session.createdAt > SESSION_TTL) dashboardSessions.delete(token)
  }
}, 60 * 60 * 1000)

// ===== AUTH MIDDLEWARE ====
// Support: Authorization: Bearer <key> atau X-API-Key: <key>
// Untuk session dashboard: Authorization: Bearer <session_token>
function requireAuth(req, res, next) {
  const auth = req.headers.authorization || ''
  const apiKeyHeader = req.headers['x-api-key'] || ''
  const queryKey = req.query.token || ''
  const credentials = auth.replace(/^Bearer\s+/i, '') || apiKeyHeader || queryKey

  if (!credentials) {
    return res.status(401).json({ error: 'Unauthorized. Sertakan API_KEY atau session token.' })
  }

  // Cek apakah ini session token dashboard
  const session = getSession(credentials)
  if (session) {
    req.user = { username: session.username, displayName: session.displayName }
    req.authType = 'session'
    return next()
  }

  // Cek apakah ini API_KEY langsung
  if (credentials === API_KEY) {
    req.user = { username: DEFAULT_USERNAME, displayName: DEFAULT_DISPLAY_NAME }
    req.authType = 'apikey'
    return next()
  }

  return res.status(401).json({ error: 'Unauthorized. API_KEY atau session token tidak valid.' })
}

// ── LOGIN ──
app.post('/api/login', (req, res) => {
  const { username, password } = req.body

  if (!username || !password) {
    return res.status(400).json({ error: 'username dan password wajib diisi' })
  }

  // Cek kredensial
  if (username !== DEFAULT_USERNAME) {
    return res.status(401).json({ error: 'Username tidak terdaftar' })
  }

  if (DEFAULT_PASSWORD && password !== DEFAULT_PASSWORD) {
    return res.status(401).json({ error: 'Password salah' })
  }

  if (!DEFAULT_PASSWORD) {
    // Fallback: jika DEFAULT_PASSWORD belum dikonfigurasi, gunakan API_KEY sebagai password
    if (password !== API_KEY) {
      return res.status(401).json({ error: 'Password salah' })
    }
  }

  const session = createSession()
  res.json({
    success: true,
    token: session.token,
    user: {
      username: session.username,
      displayName: session.displayName,
    },
  })
})

// ── GET CURRENT USER ──
app.get('/api/me', requireAuth, (req, res) => {
  res.json({
    user: req.user,
    authType: req.authType,
  })
})

// ── UPDATE DISPLAY NAME ──
app.put('/api/me', (req, res) => {
  const auth = req.headers.authorization || ''
  const credentials = auth.replace(/^Bearer\s+/i, '')

  const session = getSession(credentials)
  if (!session) return res.status(401).json({ error: 'Session tidak valid. Login ulang.' })

  const { displayName } = req.body
  if (!displayName || typeof displayName !== 'string' || displayName.trim().length === 0) {
    return res.status(400).json({ error: 'displayName wajib diisi' })
  }

  session.displayName = displayName.trim().slice(0, 50)
  res.json({
    success: true,
    user: {
      username: session.username,
      displayName: session.displayName,
    },
  })
})

// ── LOGOUT ──
app.post('/api/logout', (req, res) => {
  const auth = req.headers.authorization || ''
  const credentials = auth.replace(/^Bearer\s+/i, '')
  if (dashboardSessions.has(credentials)) {
    dashboardSessions.delete(credentials)
  }
  res.json({ success: true, message: 'Logged out' })
})

// ===== RATE LIMITER =====
const rateLimitMap = new Map()
function rateLimit(maxRequests, windowMs) {
  return function (req, res, next) {
    const key = `${req.ip}:${req.path}`
    const now = Date.now()
    const entry = rateLimitMap.get(key) || { count: 0, resetAt: now + windowMs }

    if (now > entry.resetAt) {
      entry.count = 0
      entry.resetAt = now + windowMs
    }

    entry.count += 1
    rateLimitMap.set(key, entry)

    if (entry.count > maxRequests) {
      return res.status(429).json({ error: 'Terlalu banyak request. Coba lagi nanti.' })
    }
    next()
  }
}

// Periodik cleanup rate limit map (setiap 10 menit)
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key)
  }
}, 10 * 60 * 1000)

// ── Health ──
app.get('/health', (req, res) => {
  const sessions = sessionManager.listSessions()
  res.json({
    status: sessions.some((s) => s.connected) ? 'connected' : 'disconnected',
    uptime: process.uptime(),
    sessionCount: sessionManager.countSessions(),
    sessions,
  })
})

// ── Daftar session ──
app.get('/api/sessions', requireAuth, (req, res) => {
  res.json({ sessions: sessionManager.listSessions() })
})

// ── Pairing (fleksibel: QR atau Pairing Code) ──
app.post('/api/pair', requireAuth, rateLimit(5, 60000), async (req, res) => {
  const rawPhone = req.body.phone
  const method = req.body.method || 'code'
  if (!rawPhone) return res.status(400).json({ error: 'phone wajib diisi' })

  const phone = sanitizePhone(rawPhone)
  if (!isValidPhone(phone)) {
    return res.status(400).json({ error: 'Format nomor tidak valid (hanya digit, 8-15 karakter)' })
  }

  try {
    const existing = sessionManager.getSession(phone)
    if (existing?.state?.creds?.registered) {
      return res.status(409).json({
        error: 'Session sudah terdaftar, tidak perlu pairing ulang',
        registered: true,
        connected: existing.connected,
      })
    }

    if (method === 'qr') {
      const result = await sessionManager.startQRPairing(phone)
      res.json({
        success: true,
        method: 'qr',
        qr: result.qr,
        phone: phone,
        registered: false,
        connected: false,
      })
    } else {
      const result = await sessionManager.requestPairing(phone)
      const session = sessionManager.getSession(phone)
      const info = session?.pairingInfo || { code: result.code, time: Date.now(), expiresAt: Date.now() + PAIRING_TTL }
      res.json({
        success: true,
        method: 'code',
        code: result.code,
        qr: session?.qrData || null,
        time: info.time,
        expiresAt: info.expiresAt,
        ttlSeconds: 300,
        registered: false,
        connected: false,
      })
    }
  } catch (err) {
    const msg = err?.message || String(err)
    const status = msg.includes('Sedang ada request') || msg.includes('proses pairing aktif') ? 429 : 500
    res.status(status).json({ error: msg })
  }
})

// ── Hapus session ──
app.delete('/api/sessions/:phone', requireAuth, async (req, res) => {
  const phone = sanitizePhone(req.params.phone)
  if (!isValidPhone(phone)) {
    return res.status(400).json({ error: 'Format nomor tidak valid' })
  }
  await sessionManager.removeSession(phone)
  res.json({ message: 'Session dihapus' })
})

// ── Helper: build message content ──
function buildMessageContent(req) {
  const { type, message, image, imageUrl, document, documentUrl, fileName, mimetype } = req.body
  const msgType = type || 'text'

  if (msgType === 'image') {
    // image: bisa base64 string atau URL
    const imgData = image || imageUrl || ''
    if (!imgData) return null
    return {
      image: imgData.startsWith('http') ? { url: imgData } : imgData,
      caption: message || '',
    }
  }

  if (msgType === 'document') {
    const docData = document || documentUrl || ''
    if (!docData) return null
    return {
      document: docData.startsWith('http') ? { url: docData } : docData,
      fileName: fileName || 'document',
      mimetype: mimetype || 'application/octet-stream',
      caption: message || '',
    }
  }

  // Default: text
  return { text: message || '' }
}

// ── Cek nomor WhatsApp ──
app.post('/api/check-number', requireAuth, rateLimit(10, 60000), async (req, res) => {
  const { phone } = req.body
  if (!phone) return res.status(400).json({ error: 'phone wajib diisi' })
  const cleanPhone = sanitizePhone(phone)
  if (!isValidPhone(cleanPhone)) {
    return res.status(400).json({ error: 'Format nomor tidak valid' })
  }

  // Cari session yang terhubung untuk melakukan pengecekan
  const sessions = sessionManager.listSessions()
  const connected = sessions.find((s) => s.connected)
  if (!connected) return res.status(503).json({ error: 'Tidak ada session terhubung untuk cek nomor' })

  try {
    const session = sessionManager.getSession(connected.phone)
    if (!session || !session.sock) throw new Error('Session tidak tersedia')
    const jid = `${cleanPhone}@s.whatsapp.net`
    const [result] = await session.sock.onWhatsApp(jid)
    if (result) {
      res.json({
        success: true,
        jid: result.jid,
        exists: result.exists,
        phone: cleanPhone,
      })
    } else {
      res.json({ success: true, exists: false, phone: cleanPhone })
    }
  } catch (err) {
    emitLog('error', `[check-number] Gagal cek ${cleanPhone}: ${err.message}`, err)
    res.status(500).json({ error: err.message })
  }
})

// ── Helper: kirim pesan dengan deteksi error 463 async ──
async function sendWithErrorCheck(sock, jid, content, phone, timeoutMs = 2000) {
  let matchKey = null
  let errorStatus = null
  let resolveWait = null
  const waitPromise = new Promise(resolve => { resolveWait = resolve })

  const onUpdate = (updates) => {
    for (const update of updates) {
      if (!matchKey) continue
      if (!update.key?.fromMe) continue
      if (update.key?.id !== matchKey.id) continue
      if (update.update?.status !== 0) continue // WAMessageStatus.ERROR
      errorStatus = update.update
      if (resolveWait) resolveWait()
    }
  }

  sock.ev.on('messages.update', onUpdate)
  try {
    const sent = await sock.sendMessage(jid, content)
    matchKey = sent?.key
    if (matchKey) {
      await Promise.race([
        waitPromise,
        new Promise(resolve => setTimeout(resolve, timeoutMs)),
      ])
      if (errorStatus) {
        emitLog('error', `[${phone}] Pesan gagal (error 463): akun dibatasi atau kontak memblokir`)
        throw new Boom('Pesan gagal: Akun WhatsApp bot dibatasi atau kontak memblokir nomor bot. Coba pairing ulang.', {
          statusCode: 403,
          data: { code: 463 },
        })
      }
    }
    return sent
  } finally {
    sock.ev.off('messages.update', onUpdate)
  }
}

// ── Kirim pesan ──
app.post('/api/send', requireAuth, rateLimit(30, 60000), async (req, res) => {
  const { phone, to, message } = req.body
  if (!phone || !to || !message) {
    return res.status(400).json({ error: 'phone, to, dan message wajib diisi' })
  }

  const cleanPhone = sanitizePhone(phone)
  if (!isValidPhone(cleanPhone)) {
    return res.status(400).json({ error: 'Format nomor session tidak valid' })
  }

  const session = sessionManager.getSession(cleanPhone)
  if (!session) return res.status(404).json({ error: 'Session tidak ditemukan' })
  if (!session.connected) return res.status(503).json({ error: 'Session belum terhubung' })

  const cleanTo = to.includes('@') ? to : `${sanitizePhone(to)}@s.whatsapp.net`
  const content = buildMessageContent(req)
  if (!content) return res.status(400).json({ error: 'Konten pesan tidak valid. Untuk image/document, kirim data/base64 atau URL.' })

  try {
    const sent = await sendWithErrorCheck(session.sock, cleanTo, content, cleanPhone)
    emitLog('info', `[${phone}] Pesan terkirim ke ${cleanTo}`)
    res.json({ success: true, id: sent?.key?.id })
  } catch (err) {
    const msg = err?.message || String(err)
    emitLog('error', `[${phone}] Gagal kirim: ${msg}`, err)
    if (msg.includes('463') || msg.includes('tctoken') || msg.includes('restricted')) {
      return res.status(403).json({
        error: 'Pesan gagal: Akun WhatsApp bot dibatasi atau kontak memblokir nomor bot. Coba pairing ulang.',
        code: 463,
      })
    }
    res.status(500).json({ error: msg })
  }
})

// ── Kirim ke grup ──
app.post('/api/send-group', requireAuth, rateLimit(30, 60000), async (req, res) => {
  const { phone, groupJid, message } = req.body
  if (!phone || !groupJid || !message) {
    return res.status(400).json({ error: 'phone, groupJid, dan message wajib diisi' })
  }

  const cleanPhone = sanitizePhone(phone)
  if (!isValidPhone(cleanPhone)) {
    return res.status(400).json({ error: 'Format nomor session tidak valid' })
  }

  const session = sessionManager.getSession(cleanPhone)
  if (!session) return res.status(404).json({ error: 'Session tidak ditemukan' })
  if (!session.connected) return res.status(503).json({ error: 'Session belum terhubung' })

  const jid = groupJid.includes('@') ? groupJid : `${groupJid}@g.us`
  const content = buildMessageContent(req)
  if (!content) return res.status(400).json({ error: 'Konten pesan tidak valid.' })

  try {
    const sent = await sendWithErrorCheck(session.sock, jid, content, cleanPhone)
    emitLog('info', `[${phone}] Pesan grup terkirim ke ${jid}`)
    res.json({ success: true, id: sent?.key?.id })
  } catch (err) {
    const msg = err?.message || String(err)
    emitLog('error', `[${phone}] Gagal kirim grup: ${msg}`, err)
    if (msg.includes('463') || msg.includes('tctoken') || msg.includes('restricted')) {
      return res.status(403).json({
        error: 'Pesan gagal: Akun WhatsApp bot dibatasi atau kontak memblokir nomor bot.',
        code: 463,
      })
    }
    res.status(500).json({ error: msg })
  }
})

// ── SSE: Log streaming (wajib auth via query param ?token=) ──
app.get('/api/logs', requireAuth, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  logStore.forEach((entry) => {
    res.write(`data: ${JSON.stringify(entry)}\n\n`)
  })

  logClients.add(res)
  req.on('close', () => removeLogClient(res))

  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n')
    } catch (e) {
      clearInterval(heartbeat)
      removeLogClient(res)
    }
  }, SSE_HEARTBEAT_INTERVAL)

  req.on('close', () => clearInterval(heartbeat))
})

// ── SSE: Pairing status stream (wajib auth via query param ?token=) ──
app.get('/api/pairing-stream', requireAuth, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  for (const [, session] of sessionManager.sessions) {
    const data = {
      phone: session.phone,
      code: session.pairingInfo?.code || null,
      time: session.pairingInfo?.time || null,
      expiresAt: session.pairingInfo?.expiresAt || null,
      qr: session.qrData || null,
      connected: session.connected,
      registered: session.state.creds?.registered || false,
      status: session.connected ? 'paired' : (session.qrData ? 'qr' : (session.pairingInfo ? 'pairing' : 'idle')),
    }
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  pairingClients.add(res)
  req.on('close', () => removePairingClient(res))

  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n')
    } catch (e) {
      clearInterval(heartbeat)
      removePairingClient(res)
    }
  }, SSE_HEARTBEAT_INTERVAL)

  req.on('close', () => clearInterval(heartbeat))
})

// ── Cek status pairing per nomor ──
app.get('/api/pairing-status/:phone', requireAuth, (req, res) => {
  const session = sessionManager.getSession(sanitizePhone(req.params.phone))
  if (!session) return res.json({ pairing: null })
  res.json({
    pairing: session.pairingInfo,
    connected: session.connected,
    registered: session.state.creds?.registered || false,
  })
})

// ── Login Page ──
app.get('/login', (req, res) => {
  const filePath = path.join(__dirname, 'login.html')
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('login.html tidak ditemukan')
  }
  res.sendFile(filePath)
})

// ── Dashboard ──
app.get('/dashboard', (req, res) => {
  const filePath = path.join(__dirname, 'dashboard.html')
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('dashboard.html tidak ditemukan')
  }
  res.sendFile(filePath)
})

app.get('/', (req, res) => {
  res.redirect('/login')
})

// ===== START =====
async function restoreExistingSessions() {
  try {
    if (!fs.existsSync(AUTH_BASE)) return
    const dirs = fs.readdirSync(AUTH_BASE)
    let restored = 0
    for (const name of dirs) {
      const credsPath = path.join(AUTH_BASE, name, 'creds.json')
      if (!fs.existsSync(credsPath)) continue
      try {
        const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'))
        if (creds.registered) {
          await sessionManager.startSession(name)
          restored++
        }
      } catch (e) {
        // skip corrupted creds
      }
    }
    if (restored > 0) emitLog('info', `Restored ${restored} WhatsApp session(s) from disk`)
  } catch (e) {
    emitLog('warn', `Session restore: ${e.message}`)
  }
}

app.listen(PORT, '0.0.0.0', async () => {
  emitLog('info', `waBaileys server berjalan di port ${PORT}`)
  emitLog('info', `Dashboard: http://localhost:${PORT}/dashboard`)
  emitLog('info', `API: POST /api/pair, /api/send, /api/send-group`)
  emitLog('info', `CORS origin: ${CORS_ORIGIN}`)
  if (TRUST_PROXY) emitLog('info', `Trust proxy: ${TRUST_PROXY} hop(s)`)
  emitLog('info', `API_KEY: ${API_KEY ? '[TERKONFIGURASI]' : '[TIDAK TERKONFIGURASI]'}`)
  emitLog('info', `Webhook: ${WEBHOOK_URL ? '[TERKONFIGURASI]' : '[TIDAK ADA]'}`)

  // Restore session WhatsApp yang sudah pernah dipair
  await restoreExistingSessions()
})

// ===== GRACEFUL SHUTDOWN =====
async function shutdown(signal) {
  emitLog('info', `${signal} diterima, menghentikan semua session...`)
  for (const [phone, session] of sessionManager.sessions) {
    session._removed = true
    try {
      session.sock.end(new Error('Server shutdown'))
    } catch (e) {
      // abaikan
    }
  }
  setTimeout(() => process.exit(0), 2000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

process.on('uncaughtException', (err) => {
  emitLog('error', `Uncaught exception: ${err.message}`, err)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason)
  const err = reason instanceof Error ? reason : undefined
  emitLog('error', `Unhandled rejection: ${msg}`, err)
})
