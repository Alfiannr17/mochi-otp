import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { appendOrderOtpFromWebhook } from "../_shared/provider-webhook.ts"
import { sendOtpTelegramNotification } from "../_shared/telegram-notify.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-signature',
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const bytesToHex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

const safeEqual = (left: string, right: string) => {
  if (left.length !== right.length) return false
  let result = 0
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return result === 0
}

const verifySignature = async (rawBody: string, header: string | null, secret: string) => {
  if (!secret) return true
  const signature = String(header ?? '').trim().replace(/^sha256=/i, '')
  if (!/^[0-9a-f]+$/i.test(signature)) return false

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  return safeEqual(bytesToHex(digest), signature.toLowerCase())
}

const getOrderByActivation = async (supabase: any, activationVariants: string[]) => {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .in('activation_id', activationVariants)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data
}

const updateProviderStatus = async (supabase: any, activationVariants: string[], status: string) => {
  const order = await getOrderByActivation(supabase, activationVariants)
  if (!order) return { updated: false }

  if (status === 'completed') {
    const { error } = await supabase
      .from('orders')
      .update({ status: 'completed' })
      .eq('id', order.id)
      .eq('status', 'active')
    if (error) throw error
    return { updated: true }
  }

  if (status === 'canceled') {
    const { error } = await supabase
      .from('orders')
      .update({ status: 'canceled' })
      .eq('id', order.id)
      .eq('status', 'active')
    if (error) throw error
    return { updated: true }
  }

  return { updated: false }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method === 'GET') return jsonResponse({ ok: true, service: 'smscode-webhook' })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const rawBody = await req.text()
    const webhookSecret = Deno.env.get('SMSCODE_WEBHOOK_SECRET') ?? ''
    const isValid = await verifySignature(
      rawBody,
      req.headers.get('x-webhook-signature'),
      webhookSecret,
    )
    if (!isValid) return jsonResponse({ error: 'Invalid signature' }, 401)

    const payload = JSON.parse(rawBody)
    const event = String(payload?.event ?? '')
    const data = payload?.data ?? {}
    const orderId = String(data?.order_id ?? data?.id ?? '').trim()
    const activationVariants = [orderId, `smscode:${orderId}`]

    if (!orderId) return jsonResponse({ error: 'Order ID tidak tersedia' }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    if (event !== 'order.otp_received') {
      if (event === 'order.completed') {
        await updateProviderStatus(supabase, activationVariants, 'completed')
      } else if (event === 'order.canceled' || event === 'order.expired') {
        await updateProviderStatus(supabase, activationVariants, 'canceled')
      }
      return jsonResponse({ ok: true, ignored: event || 'unknown_event' })
    }

    const code = String(data?.otp_code ?? data?.sms_code ?? '').trim()
    const message = String(data?.otp_message ?? data?.sms_message ?? data?.message ?? '').trim()
    if (!code) return jsonResponse({ error: 'Kode OTP tidak tersedia' }, 400)

    const result = await appendOrderOtpFromWebhook(
      supabase,
      activationVariants,
      { code, message },
    )

    if (!result.ok) {
      console.warn('smscode webhook ignored:', result.reason, payload)
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
      messages: result.messages,
    })
  } catch (error) {
    console.error('smscode webhook error:', error)
    return jsonResponse({ error: 'Webhook SMSCode gagal diproses' }, 500)
  }
})
