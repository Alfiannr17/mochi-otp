import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { appendOrderOtpFromWebhook } from "../_shared/provider-webhook.ts"
import { sendOtpTelegramNotification } from "../_shared/telegram-notify.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const readPayload = async (req: Request) => {
  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) return await req.json()

  const formData = await req.formData().catch(() => null)
  if (!formData) return {}
  return Object.fromEntries(formData.entries())
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method === 'GET') return jsonResponse({ ok: true, service: 'smsbower-webhook' })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const webhookSecret = Deno.env.get('SMSBOWER_WEBHOOK_SECRET') ?? ''
    if (
      webhookSecret &&
      req.headers.get('x-webhook-secret') !== webhookSecret &&
      new URL(req.url).searchParams.get('secret') !== webhookSecret
    ) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }

    const payload = await readPayload(req)
    const activationRaw = payload?.activationId ?? payload?.activation ?? payload?.id
    const code = String(payload?.code ?? payload?.sms_code ?? '').trim()
    const message = String(payload?.text ?? payload?.sms_text ?? payload?.message ?? '').trim()

    if (!activationRaw || !code) {
      return jsonResponse({ error: 'Payload OTP tidak lengkap' }, 400)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const activationId = String(activationRaw).trim()
    const result = await appendOrderOtpFromWebhook(
      supabase,
      [activationId],
      { code, message },
    )

    if (!result.ok) {
      console.warn('smsbower webhook ignored:', result.reason, payload)
      return jsonResponse({ ok: true, ignored: result.reason })
    }

    if (result.isNewCode) {
      sendOtpTelegramNotification(result.order, code, message)
        .then((notification) => {
          if (!notification.ok && !notification.skipped) {
            console.error('telegram otp notification failed:', notification.error)
          }
        })
        .catch((error) => console.error('telegram otp notification error:', error))
    }

    return jsonResponse({
      ok: true,
      orderId: result.order.id,
      codes: result.codes,
    })
  } catch (error) {
    console.error('smsbower webhook error:', error)
    return jsonResponse({ error: 'Webhook SMSBower gagal diproses' }, 500)
  }
})
