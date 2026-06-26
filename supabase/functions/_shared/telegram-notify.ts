import { maskActivationId } from "./provider-webhook.ts"

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

type TelegramSendResult =
  | { ok: true }
  | { ok: false; error: string; skipped?: boolean }

export const sendTelegramMessage = async (
  chatId: string | number | null | undefined,
  text: string,
  replyMarkup?: Record<string, unknown>,
): Promise<TelegramSendResult> => {
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
  if (!botToken || !chatId) return { ok: false, skipped: true, error: 'telegram_not_configured' }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  })

  if (!response.ok) {
    return { ok: false, error: await response.text() }
  }

  return { ok: true }
}

export const sendOtpTelegramNotification = async (
  order: any,
  code: string,
  message?: string | null,
): Promise<TelegramSendResult> => {
  const miniAppUrl = (Deno.env.get('MINI_APP_URL') ?? '').replace(/\/+$/, '')
  const orderUrl = miniAppUrl ? `${miniAppUrl}/orders/${order.id}` : ''
  const serviceName = escapeHtml(order.service_name || 'Layanan OTP')
  const phoneNumber = escapeHtml(order.phone_number || '-')
  const activationId = escapeHtml(maskActivationId(order.activation_id))
  const otpCode = escapeHtml(code)
  const smsMessage = String(message ?? '').trim()

  const text = [
    '🔔 <b>OTP Masuk</b>',
    '',
    `📦 Layanan: <b>${serviceName}</b>`,
    `📱 Nomor: <code>${phoneNumber}</code>`,
    `🆔 Aktivasi: <b>${activationId}</b>`,
    `🔐 Kode OTP: <code>${otpCode}</code>`,
    ...(smsMessage ? ['', `💬 Pesan: ${escapeHtml(smsMessage)}`] : []),
  ].join('\n')

  return sendTelegramMessage(
    order.user_id,
    text,
    orderUrl
      ? {
        inline_keyboard: [
          [
            {
              text: 'BUKA ORDER AKTIF',
              web_app: { url: orderUrl },
            },
          ],
        ],
      }
      : undefined,
  )
}
