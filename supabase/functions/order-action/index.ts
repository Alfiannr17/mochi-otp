import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { fetchSmsText } from "../_shared/smsbower.ts"
import {
  finishSmsCodeOrder,
  parseActivationId,
  resendSmsCodeOrder,
} from "../_shared/smscode.ts"
import { parseOtpState, serializeOtpState } from "../_shared/otp-history.ts"
import { getPublicProviderError } from "../_shared/public-error.ts"

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
    const { orderId, activationId, action } = await req.json()
    if (!orderId || !activationId || !['finish', 'resend'].includes(action)) {
      return jsonResponse({ error: 'Aksi order tidak valid' }, 400)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('status, activation_id, sms_code')
      .eq('id', orderId)
      .single()

    if (orderError || !order || String(order.activation_id) !== String(activationId)) {
      return jsonResponse({ error: 'Order tidak ditemukan' }, 404)
    }
    if (order.status === 'canceled') return jsonResponse({ error: 'Order sudah dibatalkan' }, 400)
    if (order.status === 'completed') return jsonResponse({ success: true, status: 'completed' })
    const otpState = parseOtpState(order.sms_code)
    if (action === 'resend' && otpState.codes.length === 0) {
      return jsonResponse({ error: 'OTP pertama belum diterima' }, 400)
    }
    if (action === 'resend' && otpState.waiting) {
      return jsonResponse({ error: 'Permintaan OTP baru masih diproses' }, 400)
    }

    const remoteActivation = parseActivationId(activationId)

    if (remoteActivation.provider === 'smscode') {
      if (action === 'finish') await finishSmsCodeOrder(remoteActivation.id)
      else await resendSmsCodeOrder(remoteActivation.id)
    } else {
      const expectedResponse = action === 'finish' ? 'ACCESS_ACTIVATION' : 'ACCESS_RETRY_GET'
      const response = await fetchSmsText('setStatus', {
        id: remoteActivation.id,
        status: action === 'finish' ? 6 : 3,
      })

      if (response !== expectedResponse) {
        return jsonResponse({
          error: getPublicProviderError(response, 'Server menolak permintaan order. Silakan coba lagi.'),
        }, 400)
      }
    }

    if (action === 'finish') {
      const { error } = await supabase
        .from('orders')
        .update({ status: 'completed' })
        .eq('id', orderId)
        .eq('status', 'active')
      if (error) throw error
      return jsonResponse({ success: true, status: 'completed' })
    }

    const { error } = await supabase
      .from('orders')
      .update({ sms_code: serializeOtpState({ ...otpState, waiting: true }) })
      .eq('id', orderId)
      .eq('status', 'active')
    if (error) throw error

    return jsonResponse({ success: true, status: 'waiting' })
  } catch (error) {
    console.error('order-action provider error:', error)
    return jsonResponse({
      error: getPublicProviderError(error, 'Aksi order gagal diproses oleh Server. Silakan coba lagi.'),
    }, 500)
  }
})
