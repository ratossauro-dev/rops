// ========== TELEGRAM NOTIFICATION MODULE ==========
// Sends real-time alerts to Telegram for errors, orders, and transfers.
// Uses Node's built-in fetch — no extra dependencies needed.

const TELEGRAM_API = 'https://api.telegram.org/bot'

let BOT_TOKEN = ''
let CHAT_ID = ''

/**
 * Initialize with credentials from .env
 */
export function initTelegram(token, chatId) {
    BOT_TOKEN = token
    CHAT_ID = chatId
    if (!BOT_TOKEN || !CHAT_ID) {
        console.warn('⚠️ Telegram notifications disabled (missing BOT_TOKEN or CHAT_ID)')
        return false
    }
    console.log('✅ Telegram notifications enabled')
    return true
}

/**
 * Send a raw message to Telegram
 */
async function sendMessage(text) {
    if (!BOT_TOKEN || !CHAT_ID) return
    try {
        const url = `${TELEGRAM_API}${BOT_TOKEN}/sendMessage`
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHAT_ID,
                text,
                parse_mode: 'HTML'
            })
        })
        if (!res.ok) {
            const err = await res.text()
            console.error('Telegram send failed:', err)
        }
    } catch (err) {
        console.error('Telegram send error:', err.message)
    }
}

/**
 * Notify about server errors
 */
export async function notifyError(context, error) {
    const timestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    const msg = [
        `🔴 <b>ERRO NO SERVIDOR</b>`,
        ``,
        `<b>Contexto:</b> ${escapeHtml(context)}`,
        `<b>Erro:</b> ${escapeHtml(String(error))}`,
        `<b>Horário:</b> ${timestamp}`,
    ].join('\n')
    await sendMessage(msg)
}

/**
 * Notify about a new order created
 */
export async function notifyOrder(data) {
    const timestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    const msg = [
        `🟢 <b>NOVA ORDEM CRIADA</b>`,
        ``,
        `<b>Envia:</b> ${data.sendAmount} ${data.sendCoin} (${data.sendNetwork})`,
        `<b>Recebe:</b> ${data.recvAmount} ${data.recvCoin} (${data.recvNetwork})`,
        `<b>Taxa:</b> ${data.exchangeRate}`,
        `<b>Tipo:</b> ${data.rateType}`,
        `<b>Carteira destino:</b>`,
        `<code>${escapeHtml(data.destAddress)}</code>`,
        `<b>Horário:</b> ${timestamp}`,
    ].join('\n')
    await sendMessage(msg)
}

/**
 * Notify when user confirms they sent a transfer
 */
export async function notifyTransferConfirmed(data) {
    const timestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    const msg = [
        `✅ <b>TRANSFERÊNCIA CONFIRMADA PELO USUÁRIO</b>`,
        ``,
        `<b>Moeda enviada:</b> ${data.sendAmount} ${data.sendCoin} (${data.sendNetwork})`,
        `<b>Moeda a receber:</b> ${data.recvAmount} ${data.recvCoin} (${data.recvNetwork})`,
        `<b>Carteira destino:</b>`,
        `<code>${escapeHtml(data.destAddress)}</code>`,
        `<b>Horário:</b> ${timestamp}`,
    ].join('\n')
    await sendMessage(msg)
}

/**
 * Notify server startup
 */
export async function notifyStartup(port, walletCount) {
    const timestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    const msg = [
        `🚀 <b>SERVIDOR INICIADO</b>`,
        ``,
        `<b>Porta:</b> ${port}`,
        `<b>Wallets carregadas:</b> ${walletCount}`,
        `<b>Horário:</b> ${timestamp}`,
    ].join('\n')
    await sendMessage(msg)
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
}
