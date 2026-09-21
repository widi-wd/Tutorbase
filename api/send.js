// Vercel Serverless Function — POST /api/send
// Meneruskan pesan pengunjung (sudah disanitasi) ke channel Telegram via Bot API.
// Token & chat_id HANYA dibaca dari environment variable, tidak pernah ke frontend.

const RATE_WINDOW_MS = 30_000;      // 30 detik antar-pesan per IP
const rate = new Map();             // in-memory, reset saat cold start

const esc = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // ── Rate limiting sederhana (per IP) ────────────────────
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  if (now - (rate.get(ip) || 0) < RATE_WINDOW_MS) {
    return res.status(429).json({ ok: false, error: 'Terlalu cepat' });
  }
  rate.set(ip, now);

  // ── Validasi input ──────────────────────────────────────
  const { name = '', email = '', message = '' } = req.body || {};
  const n = String(name).trim();
  const e = String(email).trim();
  const m = String(message).trim();

  if (!n || !m)                       return res.status(400).json({ ok: false });
  if (n.length > 100)                 return res.status(400).json({ ok: false });
  if (m.length > 4096)                return res.status(400).json({ ok: false });
  if (e && e.length > 200)            return res.status(400).json({ ok: false });

  // ── Format pesan untuk Telegram (parse_mode: HTML) ──────
  const text =
    `<b>Pesan baru dari ${esc(n)}</b>\n\n` +
    `${esc(m)}\n\n` +
    `<i>Email: ${e ? esc(e) : '-'}</i>\n` +
    `<i>Waktu: ${new Date().toISOString()}</i>`;

  // ── Environment variables (JANGAN pernah dicetak ke console) ─
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat  = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) {
    return res.status(500).json({ ok: false, error: 'Server tidak siap' });
  }

  // ── Forward ke Telegram Bot API ─────────────────────────
  try {
    const r = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chat,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      }
    );
    if (!r.ok) return res.status(502).json({ ok: false, error: 'Gagal mengirim pesan' });
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ ok: false, error: 'Gagal mengirim pesan' });
  }
}
