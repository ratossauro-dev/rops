import express from 'express'
import crypto from 'crypto'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { initTelegram, notifyError, notifyOrder, notifyTransferConfirmed, notifyStartup } from './telegram.js'

// ========== SECURITY: Load .env manually (no dotenv dependency) ==========
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const envPath = join(__dirname, '.env')

const ENV = {}
try {
    const envContent = readFileSync(envPath, 'utf-8')
    envContent.split('\n').forEach(line => {
        line = line.trim()
        if (!line || line.startsWith('#')) return
        const [key, ...rest] = line.split('=')
        ENV[key.trim()] = rest.join('=').trim()
    })
} catch (e) {
    console.error('❌ FATAL: .env file not found at', envPath)
    console.error('Create server/.env with your wallet addresses. See server/.env.example')
    process.exit(1)
}

// ========== SECURITY LAYER 1: Immutable wallet addresses ==========
const WALLETS = Object.freeze(
    Object.fromEntries(
        Object.entries(ENV)
            .filter(([k]) => k.startsWith('WALLET_'))
            .map(([k, v]) => [k, v])
    )
)

const HMAC_SECRET = ENV.HMAC_SECRET
if (!HMAC_SECRET) {
    console.error('❌ FATAL: HMAC_SECRET not set in .env')
    process.exit(1)
}

const ALLOWED_ORIGIN = ENV.ALLOWED_ORIGIN || '*'
const PORT = parseInt(ENV.PORT) || 3001

// Freeze = truly immutable, no way to modify at runtime
Object.freeze(WALLETS)

console.log(`✅ Loaded ${Object.keys(WALLETS).length} wallet addresses (read-only)`)

// ========== TELEGRAM NOTIFICATIONS ==========
initTelegram(ENV.TELEGRAM_BOT_TOKEN, ENV.TELEGRAM_CHAT_ID)

// ========== GLOBAL ERROR HANDLERS ==========
process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught Exception:', err)
    notifyError('Uncaught Exception', err.stack || err.message)
})

process.on('unhandledRejection', (reason) => {
    console.error('💥 Unhandled Rejection:', reason)
    notifyError('Unhandled Promise Rejection', String(reason))
})

// ========== SERVER ==========
const app = express()
app.use(express.json())

// ========== SECURITY LAYER 3: CORS + Helmet-style headers ==========
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('X-XSS-Protection', '1; mode=block')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Content-Security-Policy', "default-src 'self'")

    if (req.method === 'OPTIONS') return res.status(204).end()
    next()
})

// ========== SECURITY LAYER 2: Rate limiting (simple in-memory) ==========
const rateLimitMap = new Map()
const RATE_LIMIT = 10 // max requests per minute
const RATE_WINDOW = 60 * 1000

function checkRateLimit(ip) {
    const now = Date.now()
    const record = rateLimitMap.get(ip) || { count: 0, start: now }

    if (now - record.start > RATE_WINDOW) {
        record.count = 1
        record.start = now
    } else {
        record.count++
    }

    rateLimitMap.set(ip, record)
    return record.count <= RATE_LIMIT
}

// Clean up rate limit map every 5 minutes
setInterval(() => {
    const now = Date.now()
    for (const [ip, record] of rateLimitMap) {
        if (now - record.start > RATE_WINDOW * 2) rateLimitMap.delete(ip)
    }
}, 5 * 60 * 1000)

// ========== SECURITY LAYER 4: HMAC signing ==========
function signAddress(address, coin, network) {
    const data = `${address}:${coin}:${network}`
    return crypto.createHmac('sha256', HMAC_SECRET).update(data).digest('hex')
}

// ========== ROUTE: Read-only address endpoint ==========
app.post('/api/get-deposit-address', (req, res) => {
    const ip = req.ip || req.connection.remoteAddress

    if (!checkRateLimit(ip)) {
        notifyError('Rate Limit', `IP ${ip} exceeded rate limit`)
        return res.status(429).json({ error: 'Too many requests. Try again later.' })
    }

    const { coin, network } = req.body

    if (!coin || !network) {
        notifyError('Bad Request - /api/get-deposit-address', `Missing coin or network from IP ${ip}`)
        return res.status(400).json({ error: 'Missing coin or network' })
    }

    // Sanitize input
    const cleanCoin = String(coin).toUpperCase().replace(/[^A-Z]/g, '')
    const cleanNetwork = String(network).replace(/[^a-zA-Z0-9]/g, '')

    // Look up wallet: try specific network first, then generic
    const key = `WALLET_${cleanCoin}_${cleanNetwork}`
    const genericKey = `WALLET_${cleanCoin}`
    const address = WALLETS[key] || WALLETS[genericKey]

    if (!address) {
        notifyError('Currency Not Found', `${cleanCoin} / ${cleanNetwork} not configured`)
        return res.status(404).json({ error: 'Currency/network not supported' })
    }

    const hmac = signAddress(address, cleanCoin, cleanNetwork)

    res.json({ address, hmac })
})

// ========== ROUTE: Notify new order ==========
app.post('/api/notify-order', (req, res) => {
    const ip = req.ip || req.connection.remoteAddress
    if (!checkRateLimit(ip)) {
        return res.status(429).json({ error: 'Too many requests.' })
    }

    const { sendAmount, sendCoin, sendNetwork, recvAmount, recvCoin, recvNetwork, destAddress, rateType, exchangeRate } = req.body

    if (!sendCoin || !recvCoin || !destAddress) {
        return res.status(400).json({ error: 'Missing order data' })
    }

    notifyOrder({
        sendAmount, sendCoin, sendNetwork,
        recvAmount, recvCoin, recvNetwork,
        destAddress, rateType, exchangeRate
    })

    res.json({ ok: true })
})

// ========== ROUTE: Confirm transfer ==========
app.post('/api/confirm-transfer', (req, res) => {
    const ip = req.ip || req.connection.remoteAddress
    if (!checkRateLimit(ip)) {
        return res.status(429).json({ error: 'Too many requests.' })
    }

    const { sendAmount, sendCoin, sendNetwork, recvAmount, recvCoin, recvNetwork, destAddress } = req.body

    if (!sendCoin || !destAddress) {
        return res.status(400).json({ error: 'Missing transfer data' })
    }

    notifyTransferConfirmed({
        sendAmount, sendCoin, sendNetwork,
        recvAmount, recvCoin, recvNetwork,
        destAddress
    })

    res.json({ ok: true })
})

// ========== BLOCK ALL OTHER METHODS ==========
app.all('/api/get-deposit-address', (req, res) => {
    notifyError('Method Not Allowed', `${req.method} /api/get-deposit-address from IP ${req.ip}`)
    res.status(405).json({ error: 'Method not allowed' })
})

// Block any attempt to modify wallets
app.all('/api/*', (req, res) => {
    res.status(404).json({ error: 'Not found' })
})

app.listen(PORT, () => {
    console.log(`🔒 Secure wallet server running on port ${PORT}`)
    console.log(`🌐 CORS origin: ${ALLOWED_ORIGIN}`)
    notifyStartup(PORT, Object.keys(WALLETS).length)
})
