import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { isAdminTelegramId } from "../_shared/admin.ts"

const sendMessage = async (botToken: string, body: Record<string, unknown>) => {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`Telegram API ${response.status}: ${await response.text()}`)
  }
}

serve(async (req) => {
  try {
    const webhookSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? ''
    if (
      webhookSecret &&
      req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== webhookSecret
    ) {
      return new Response('Unauthorized', { status: 401 })
    }

    const update = await req.json()
    const messageText = String(update?.message?.text ?? '')
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
    const miniAppUrl = (Deno.env.get('MINI_APP_URL') ?? '').replace(/\/+$/, '')
    const channelUrl = Deno.env.get('TELEGRAM_CHANNEL_URL') ?? 'https://t.me/mochi_otp'
    const customerServiceUrl = Deno.env.get('TELEGRAM_CS_URL') ?? 'https://t.me/mochi_otp_support'

    if (update?.message && messageText.startsWith('/admin')) {
      const chatId = update.message.chat.id
      const telegramId = update.message.from?.id

      if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN belum dikonfigurasi')
      if (!miniAppUrl) throw new Error('MINI_APP_URL belum dikonfigurasi')

      if (!isAdminTelegramId(telegramId)) {
        await sendMessage(botToken, {
          chat_id: chatId,
          text: `Akses admin ditolak.\n\nTelegram ID kamu: ${telegramId ?? 'tidak ditemukan'}\nTambahkan ID ini ke whitelist admin.`,
        })
      } else {
        await sendMessage(botToken, {
          chat_id: chatId,
          text: 'Akses admin terverifikasi. Klik tombol di bawah untuk membuka panel admin.',
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: 'BUKA PANEL ADMIN',
                  web_app: { url: `${miniAppUrl}/admin` },
                },
              ],
            ],
          },
        })
      }
    } else if (update?.message && messageText.startsWith('/start')) {
      const chatId = update.message.chat.id
      const firstName = update.message.from?.first_name || 'Bosku'

      if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN belum dikonfigurasi')
      if (!miniAppUrl) throw new Error('MINI_APP_URL belum dikonfigurasi')

      await sendMessage(botToken, {
        chat_id: chatId,
        text: `Halo ${firstName}! Selamat datang di MOCHI OTP.\n\nKlik tombol di bawah untuk membuka aplikasi.`,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'BUKA MOCHI OTP',
                web_app: { url: miniAppUrl },
              },

            ],
            [
              {
                text: 'CHANNEL MOCHI',
                url: channelUrl,
              },
              {
                text: 'CS MOCHI',
                url: customerServiceUrl,
              }
            ]
          ],
        },
      })
    }

    return new Response('OK', { status: 200 })
  } catch (error) {
    console.error(error)
    return new Response('Error', { status: 500 })
  }
})
