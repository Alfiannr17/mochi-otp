import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"

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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { userId, voucherCode } = await req.json()
    const normalizedCode = String(voucherCode ?? '').trim().toUpperCase()
    if (!userId || !normalizedCode) {
      return jsonResponse({ error: 'Kode voucher dan akun Telegram wajib tersedia.' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 1. Cek apakah voucher valid & aktif
    const { data: voucher, error: vError } = await supabase
      .from('vouchers')
      .select('*')
      .eq('code', normalizedCode)
      .maybeSingle()

    if (vError || !voucher) {
      return jsonResponse({ error: 'Kode voucher tidak ditemukan atau salah.' }, 400)
    }

    if (voucher.is_used) {
      return jsonResponse({ error: 'Voucher sudah digunakan atau sudah tidak aktif.' }, 400)
    }

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('balance')
      .eq('id', userId)
      .maybeSingle()

    if (userError || !userData) {
      return jsonResponse({ error: 'Akun Telegram belum terdaftar di sistem.' }, 404)
    }

    const { data: claimedVoucher, error: usageError } = await supabase
      .from('vouchers')
      .update({
        is_used: true,
        used_by: Number(userId),
        used_at: new Date().toISOString(),
      })
      .eq('id', voucher.id)
      .or('is_used.eq.false,is_used.is.null')
      .select('id')
      .maybeSingle()

    if (usageError) throw usageError
    if (!claimedVoucher) {
      return jsonResponse({ error: 'Voucher baru saja digunakan oleh user lain.' }, 400)
    }

    const newBalance = Number(userData?.balance || 0) + Number(voucher.amount)
    
    const { error: balanceError } = await supabase
      .from('users')
      .update({ balance: newBalance })
      .eq('id', userId)

    if (balanceError) {
      await supabase
        .from('vouchers')
        .update({ is_used: false, used_by: null, used_at: null })
        .eq('id', voucher.id)
        .eq('used_by', Number(userId))
      throw balanceError
    }

    return jsonResponse({ success: true, amount: voucher.amount })

  } catch (error) {
    return jsonResponse({ error: error.message || 'Voucher gagal diproses.' }, 500)
  }
})
