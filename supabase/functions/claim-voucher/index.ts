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

    if (!voucher.is_active) {
      return jsonResponse({ error: 'Voucher sudah tidak aktif.' }, 400)
    }

    if (voucher.current_usage >= voucher.max_usage) {
      return jsonResponse({ error: 'Kuota klaim voucher sudah habis.' }, 400)
    }

    // 2. Cek apakah user sudah pernah klaim voucher ini sebelumnya
    const { data: alreadyClaimed } = await supabase
      .from('voucher_claims')
      .select('id')
      .eq('user_id', userId)
      .eq('voucher_code', voucher.code)
      .maybeSingle()

    if (alreadyClaimed) {
      return jsonResponse({ error: 'Kamu sudah pernah mengklaim voucher ini.' }, 400)
    }

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('balance')
      .eq('id', userId)
      .maybeSingle()

    if (userError || !userData) {
      return jsonResponse({ error: 'Akun Telegram belum terdaftar di sistem.' }, 404)
    }

    // 3. PROSES KLAIM: Jalankan operasi (Update kuota, catat klaim, tambah saldo)
    
    // Tambah angka penggunaan voucher (+1)
    const { error: usageError } = await supabase
      .from('vouchers')
      .update({ current_usage: voucher.current_usage + 1 })
      .eq('code', voucher.code)
      .eq('current_usage', voucher.current_usage)

    if (usageError) throw usageError

    // Catat histori klaim ke voucher_claims
    const { error: claimError } = await supabase
      .from('voucher_claims')
      .insert({ user_id: userId, voucher_code: voucher.code })

    if (claimError) {
      await supabase
        .from('vouchers')
        .update({ current_usage: voucher.current_usage })
        .eq('code', voucher.code)
        .eq('current_usage', voucher.current_usage + 1)

      if (claimError.code === '23505') {
        return jsonResponse({ error: 'Kamu sudah pernah mengklaim voucher ini.' }, 400)
      }
      throw claimError
    }

    const newBalance = Number(userData?.balance || 0) + Number(voucher.amount)
    
    const { error: balanceError } = await supabase
      .from('users')
      .update({ balance: newBalance })
      .eq('id', userId)

    if (balanceError) throw balanceError

    return jsonResponse({ success: true, amount: voucher.amount })

  } catch (error) {
    return jsonResponse({ error: error.message || 'Voucher gagal diproses.' }, 500)
  }
})
