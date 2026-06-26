import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { createPakasirTransaction, getPakasirProject } from "../_shared/pakasir.ts"
import { DEPOSIT_LIFETIME_MS } from "../_shared/deposit-lifecycle.ts"
import { getPublicProviderError } from "../_shared/public-error.ts"
import { encodeDepositMeta } from "../_shared/deposit-meta.ts"
import { getBestDepositPromo } from "../_shared/promo.ts"
import { getFeatureSetting } from "../_shared/feature-settings.ts"

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
    const { userId, amount, username } = await req.json()
    const parsedAmount = Number(amount)

    if (!userId || !Number.isInteger(parsedAmount) || parsedAmount < 1000) {
      return jsonResponse({ error: 'Nominal deposit minimal Rp1.000' }, 400)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )
    const depositFeature = await getFeatureSetting(supabase, 'deposit')
    if (!depositFeature.is_active) {
      return jsonResponse({
        error: depositFeature.maintenance_message,
        maintenance: true,
      }, 503)
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, is_banned')
      .eq('id', userId)
      .maybeSingle()

    if (userError) throw userError
    if (user?.is_banned) return jsonResponse({ error: 'Akun kamu sedang diblokir' }, 403)

    if (!user) {
      const { error: createUserError } = await supabase.from('users').upsert({
        id: userId,
        username: String(username ?? '').slice(0, 64) || null,
        balance: 0,
      }, { onConflict: 'id', ignoreDuplicates: true })

      if (createUserError) throw createUserError
    }

    const orderId = `MOCHI${crypto.randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`
    const payment = await createPakasirTransaction(orderId, parsedAmount)
    const project = getPakasirProject()
    const paymentUrl = `https://app.pakasir.com/pay/${encodeURIComponent(project)}/${parsedAmount}?order_id=${encodeURIComponent(orderId)}&qris_only=1`
    const promo = await getBestDepositPromo(supabase, parsedAmount)
    const bonusAmount = Number(promo?.bonusAmount || 0)
    const fee = Number(payment.fee ?? 0)
    const totalPayment = Number(payment.total_payment ?? parsedAmount)
    const totalCredit = parsedAmount + bonusAmount
    const depositMeta = encodeDepositMeta({
      paymentUrl,
      qrString: payment.payment_number,
      fee,
      totalPayment,
      promoName: promo?.promo_name ?? null,
      bonusAmount,
      totalCredit,
    })

    const { data: depositData, error: insertError } = await supabase
      .from('deposits')
      .insert({
        order_id: orderId,
        user_id: userId,
        amount: parsedAmount,
        status: 'pending',
        payment_url: depositMeta,
      })
      .select('created_at')
      .single()

    if (insertError) throw insertError

    return jsonResponse({
      success: true,
      orderId,
      amount: Number(payment.amount ?? parsedAmount),
      fee,
      totalPayment,
      qrString: payment.payment_number,
      promoName: promo?.promo_name ?? null,
      bonusAmount,
      totalCredit,
      expiredAt: new Date(new Date(depositData.created_at).getTime() + DEPOSIT_LIFETIME_MS).toISOString(),
      createdAt: depositData.created_at,
    })
  } catch (error) {
    console.error('create-qris payment server error:', error)
    return jsonResponse({
      error: getPublicProviderError(error, 'Server pembayaran gagal membuat QRIS. Silakan coba lagi.'),
    }, 500)
  }
})
