import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { parseOtpState } from "../_shared/otp-history.ts"
import { syncOrderProviderStatus } from "../_shared/order-sync.ts"

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
      .select('id, activation_id, status, sms_code, created_at')
      .eq('id', orderId)
      .single()

    if (orderError || !order || String(order.activation_id) !== String(activationId)) {
      return jsonResponse({ error: 'Order tidak ditemukan' }, 404)
    }

    const { order: syncedOrder, providerError } = await syncOrderProviderStatus(supabase, order)
    const otpState = parseOtpState(syncedOrder.sms_code)

    if (syncedOrder.status === 'completed') {
      return jsonResponse({ status: 'completed', codes: otpState.codes, messages: otpState.messages })
    }
    if (syncedOrder.status === 'canceled') {
      return jsonResponse({ status: 'canceled', codes: otpState.codes, messages: otpState.messages })
    }
    if (otpState.codes.length > 0 && !otpState.waiting) {
      return jsonResponse({
        status: 'success',
        code: otpState.codes.at(-1),
        codes: otpState.codes,
        message: otpState.messages.at(-1),
        messages: otpState.messages,
      })
    }
    if (providerError) return jsonResponse({ error: providerError, retryable: true }, 503)
    return jsonResponse({ status: 'waiting', codes: otpState.codes, messages: otpState.messages })
  } catch (error) {
    console.error('check-sms provider error:', error)
    return jsonResponse({
      error: 'Status order gagal diperiksa. Sistem akan mencoba kembali.',
      retryable: true,
    }, 500)
  }
})
