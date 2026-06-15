import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { fetchSmsText } from "../_shared/smsbower.ts"
import { cancelSmsCodeOrder, parseActivationId } from "../_shared/smscode.ts"
import { cancelAndRefundOrder } from "../_shared/order-expiry.ts"
import { parseOtpState } from "../_shared/otp-history.ts"
import { getPublicProviderError } from "../_shared/public-error.ts"

const SERVER2_CANCEL_DELAY_MS = 2 * 60 * 1000

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { orderId, activationId } = await req.json()
    if (!orderId || !activationId) return jsonResponse({ error: 'Data order tidak lengkap' }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('status, activation_id, sms_code, created_at')
      .eq('id', orderId)
      .single()

    if (orderError || !order || String(order.activation_id) !== String(activationId)) {
      return jsonResponse({ error: 'Order tidak ditemukan' }, 404)
    }
    if (order.status !== 'active') return jsonResponse({ error: 'Order ini tidak bisa dibatalkan lagi' }, 400)
    if (parseOtpState(order.sms_code).codes.length > 0) {
      return jsonResponse({ error: 'Refund tidak tersedia karena OTP sudah diterima' }, 400)
    }

    const remoteActivation = parseActivationId(activationId)
    if (remoteActivation.provider === 'smscode') {
      const createdAt = new Date(order.created_at).getTime()
      const cancelAvailableAt = createdAt + SERVER2_CANCEL_DELAY_MS
      if (Number.isFinite(createdAt) && Date.now() < cancelAvailableAt) {
        const retryAfterSeconds = Math.ceil((cancelAvailableAt - Date.now()) / 1000)
        return jsonResponse({
          error: `Refund Server 2 baru tersedia setelah 2 menit. Tunggu ${retryAfterSeconds} detik lagi.`,
          retryAfterSeconds,
        }, 400)
      }

      const canceled = await cancelSmsCodeOrder(remoteActivation.id)
      if (String(canceled?.status).toUpperCase() !== 'CANCELED') {
        return jsonResponse({ error: 'Server menolak pembatalan order. Silakan coba lagi.' }, 400)
      }
    } else {
      const cancelResponse = await fetchSmsText('setStatus', { status: 8, id: remoteActivation.id })
      if (cancelResponse !== 'ACCESS_CANCEL') {
        return jsonResponse({ error: getPublicProviderError(cancelResponse, 'Server menolak pembatalan order. Silakan coba lagi.') }, 400)
      }
    }

    const refunded = await cancelAndRefundOrder(supabase, orderId)
    if (!refunded) return jsonResponse({ error: 'Order sudah diproses sebelumnya' }, 400)
    return jsonResponse({ success: true, message: 'Refund berhasil' })
  } catch (error) {
    console.error('cancel-order provider error:', error)
    return jsonResponse({
      error: getPublicProviderError(error, 'Pembatalan order gagal diproses oleh Server. Silakan coba lagi.'),
    }, 500)
  }
})
