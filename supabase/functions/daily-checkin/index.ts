import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { validateTelegramInitData } from "../_shared/telegram.ts"

const CHECKIN_COOLDOWN_MS = 24 * 60 * 60 * 1000

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const getNextCheckInAt = (createdAt?: string | null) =>
  createdAt
    ? new Date(new Date(createdAt).getTime() + CHECKIN_COOLDOWN_MS).toISOString()
    : null

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { initData, action = 'status' } = await req.json()
    if (!initData || typeof initData !== 'string') {
      return jsonResponse({ error: 'Data autentikasi Telegram tidak tersedia.' }, 400)
    }
    if (!['status', 'claim'].includes(action)) {
      return jsonResponse({ error: 'Aksi saldo harian tidak valid.' }, 400)
    }

    const telegramUser = await validateTelegramInitData(initData)
    const userId = Number(telegramUser.id)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    if (action === 'claim') {
      const [{ data: user, error: userError }, { data: lastCheckIn, error: checkInError }] = await Promise.all([
        supabase.from('users').select('balance').eq('id', userId).maybeSingle(),
        supabase
          .from('checkin')
          .select('created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])

      if (userError) throw userError
      if (checkInError) throw checkInError
      if (!user) return jsonResponse({ error: 'Akun Telegram belum terdaftar di sistem.' }, 404)

      const nextCheckInAt = getNextCheckInAt(lastCheckIn?.created_at)
      if (nextCheckInAt && new Date(nextCheckInAt).getTime() > Date.now()) {
        return jsonResponse({
          success: false,
          error: 'Saldo harian belum tersedia. Tunggu sampai 24 jam sejak klaim terakhir.',
          balance: Number(user.balance || 0),
          nextCheckInAt,
        }, 429)
      }

      const randomValue = crypto.getRandomValues(new Uint32Array(1))[0]
      const bonus = (randomValue % 201) + 50
      const currentBalance = Number(user.balance || 0)
      const { data: insertedCheckIn, error: insertError } = await supabase
        .from('checkin')
        .insert({ user_id: userId, amount: bonus })
        .select('id, created_at')
        .single()

      if (insertError) throw insertError

      let balanceUpdate = supabase
        .from('users')
        .update({ balance: currentBalance + bonus })
        .eq('id', userId)

      balanceUpdate = user.balance == null
        ? balanceUpdate.is('balance', null)
        : balanceUpdate.eq('balance', user.balance)

      const { data: updatedUser, error: balanceError } = await balanceUpdate
        .select('balance')
        .maybeSingle()

      if (balanceError || !updatedUser) {
        const { error: rollbackError } = await supabase
          .from('checkin')
          .delete()
          .eq('id', insertedCheckIn.id)
          .eq('user_id', userId)

        if (rollbackError) throw rollbackError
        if (balanceError) throw balanceError

        return jsonResponse({
          error: 'Saldo berubah saat check-in diproses. Silakan coba lagi.',
        }, 409)
      }

      return jsonResponse({
        success: true,
        bonus,
        balance: Number(updatedUser.balance || 0),
        nextCheckInAt: getNextCheckInAt(insertedCheckIn.created_at),
      })
    }

    const [{ data: user, error: userError }, { data: lastCheckIn, error: checkInError }] = await Promise.all([
      supabase.from('users').select('balance').eq('id', userId).maybeSingle(),
      supabase
        .from('checkin')
        .select('created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    if (userError) throw userError
    if (checkInError) throw checkInError
    if (!user) return jsonResponse({ error: 'Akun Telegram belum terdaftar di sistem.' }, 404)

    const lastCheckInAt = lastCheckIn?.created_at ?? null
    const nextCheckInAt = getNextCheckInAt(lastCheckInAt)

    return jsonResponse({
      success: true,
      balance: Number(user.balance || 0),
      canCheckIn: !nextCheckInAt || new Date(nextCheckInAt).getTime() <= Date.now(),
      lastCheckInAt,
      nextCheckInAt,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Saldo harian gagal diproses.'
    const isAuthError = message.includes('Telegram') || message.includes('autentikasi')
    return jsonResponse({ error: message }, isAuthError ? 401 : 500)
  }
})
