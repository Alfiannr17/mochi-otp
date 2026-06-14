import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { syncDepositStatus } from "../_shared/deposit-lifecycle.ts"
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
    const { orderId, userId } = await req.json()
    if (!orderId || !userId) return jsonResponse({ error: 'Data deposit tidak lengkap' }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { data: deposit, error: depositError } = await supabase
      .from('deposits')
      .select('order_id, amount, status, user_id, payment_url, created_at')
      .eq('order_id', orderId)
      .single()

    if (depositError || !deposit || String(deposit.user_id) !== String(userId)) {
      return jsonResponse({ error: 'Deposit tidak ditemukan' }, 404)
    }

    const currentDeposit = await syncDepositStatus(supabase, deposit)
    return jsonResponse({ status: currentDeposit.status, deposit: currentDeposit })
  } catch (error) {
    console.error('check-qris payment server error:', error)
    return jsonResponse({
      error: getPublicProviderError(error, 'Status pembayaran gagal diperiksa. Silakan coba lagi.'),
    }, 500)
  }
})
