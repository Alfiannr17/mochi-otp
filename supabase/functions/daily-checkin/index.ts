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

const jakartaDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const getCheckInDate = (date: Date) => jakartaDateFormatter.format(date)

const getNextCheckInAt = (lastCheckInAt?: string | null) =>
  lastCheckInAt
    ? new Date(new Date(lastCheckInAt).getTime() + CHECKIN_COOLDOWN_MS).toISOString()
    : null

const getPublicCheckInError = (message: string) => {
  const normalized = message.toLowerCase()

  if (normalized.includes('last_checkin') && normalized.includes('does not exist')) {
    return 'Tabel checkins belum memiliki kolom last_checkin. Sesuaikan struktur database saldo harian.'
  }
  if (normalized.includes('checkin_date') && normalized.includes('does not exist')) {
    return 'Tabel checkins belum memiliki kolom checkin_date. Sesuaikan struktur database saldo harian.'
  }
  if (normalized.includes('checkin') || normalized.includes('column') || normalized.includes('schema cache')) {
    return 'Fitur saldo harian belum sesuai dengan struktur database. Hubungi admin.'
  }
  if (normalized.includes('permission') || normalized.includes('row-level security') || normalized.includes('rls')) {
    return 'Fitur saldo harian belum memiliki izin database. Hubungi admin.'
  }
  if (normalized.includes('duplicate') || normalized.includes('unique')) {
    return 'Saldo harian sudah pernah diproses. Silakan buka ulang halaman.'
  }
  if (normalized.includes('telegram') || normalized.includes('autentikasi')) {
    return message
  }

  return 'Saldo harian gagal diproses.'
}

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
          .from('checkins')
          .select('last_checkin')
          .eq('user_id', userId)
          .order('last_checkin', { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle(),
      ])

      if (userError) throw userError
      if (checkInError) throw checkInError
      if (!user) return jsonResponse({ error: 'Akun Telegram belum terdaftar di sistem.' }, 404)

      const nextCheckInAt = getNextCheckInAt(lastCheckIn?.last_checkin)
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
      const claimedAt = new Date()
      const claimedAtIso = claimedAt.toISOString()
      const { data: insertedCheckIn, error: insertError } = await supabase
        .from('checkins')
        .insert({
          user_id: userId,
          amount: bonus,
          last_checkin: claimedAtIso,
          checkin_date: getCheckInDate(claimedAt),
        })
        .select('id, last_checkin')
        .single()

      if (insertError) throw insertError
      if (!insertedCheckIn) throw new Error('Check-in berhasil dibuat tetapi data insert tidak terbaca.')

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
        const rollbackQuery = supabase
          .from('checkins')
          .delete()
          .eq('user_id', userId)
        const { error: rollbackError } = insertedCheckIn?.id != null
          ? await rollbackQuery.eq('id', insertedCheckIn.id)
          : await rollbackQuery.eq('last_checkin', insertedCheckIn?.last_checkin ?? claimedAtIso)

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
        nextCheckInAt: getNextCheckInAt(insertedCheckIn.last_checkin ?? claimedAtIso),
      })
    }

    const [{ data: user, error: userError }, { data: lastCheckIn, error: checkInError }] = await Promise.all([
      supabase.from('users').select('balance').eq('id', userId).maybeSingle(),
      supabase
        .from('checkins')
        .select('last_checkin')
        .eq('user_id', userId)
        .order('last_checkin', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
    ])

    if (userError) throw userError
    if (checkInError) throw checkInError
    if (!user) return jsonResponse({ error: 'Akun Telegram belum terdaftar di sistem.' }, 404)

    const lastCheckInAt = lastCheckIn?.last_checkin ?? null
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
    console.error('daily-checkin error:', error)
    return jsonResponse({ error: getPublicCheckInError(message) }, isAuthError ? 401 : 500)
  }
})
