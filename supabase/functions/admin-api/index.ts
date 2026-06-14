import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { requireAdminTelegramUser } from "../_shared/admin.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const asPositiveNumber = (value: unknown, label: string) => {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} harus lebih dari 0`)
  return number
}

const asPositiveInteger = (value: unknown, label: string) => {
  const number = asPositiveNumber(value, label)
  if (!Number.isSafeInteger(number)) throw new Error(`${label} harus berupa angka bulat`)
  return number
}

const asNonNegativeNumber = (value: unknown, label: string) => {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} tidak boleh kurang dari 0`)
  return number
}

const asNonNegativeInteger = (value: unknown, label: string) => {
  const number = asNonNegativeNumber(value, label)
  if (!Number.isSafeInteger(number)) throw new Error(`${label} harus berupa angka bulat`)
  return number
}

const fetchAllRows = async (
  supabase: any,
  table: string,
  columns: string,
  orderColumn?: string,
  ascending = false,
) => {
  const pageSize = 1000
  const rows = []

  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1)

    if (orderColumn) query = query.order(orderColumn, { ascending })
    const { data, error } = await query

    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < pageSize) break
  }

  return rows
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { initData, action, payload = {} } = await req.json()
    if (!initData || typeof initData !== 'string') {
      return jsonResponse({ error: 'Panel admin harus dibuka melalui tombol /admin di bot Telegram' }, 401)
    }

    const telegramUser = await requireAdminTelegramUser(initData)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    if (action === 'verify') {
      return jsonResponse({
        success: true,
        admin: {
          id: telegramUser.id,
          username: telegramUser.username ?? '',
          first_name: telegramUser.first_name ?? '',
        },
      })
    }

    if (action === 'dashboard.summary') {
      const [users, orders, deposits, vouchers] = await Promise.all([
        fetchAllRows(supabase, 'users', 'id,is_banned'),
        fetchAllRows(supabase, 'orders', 'id,status,created_at'),
        fetchAllRows(supabase, 'deposits', 'order_id,status,amount,created_at'),
        fetchAllRows(supabase, 'vouchers', 'code,is_active,current_usage'),
      ])

      const startOfToday = new Date()
      startOfToday.setHours(0, 0, 0, 0)
      const isToday = (value: unknown) => {
        const time = new Date(String(value ?? '')).getTime()
        return Number.isFinite(time) && time >= startOfToday.getTime()
      }

      return jsonResponse({
        success: true,
        summary: {
          users: {
            total: users.length,
            banned: users.filter((user) => user.is_banned).length,
          },
          orders: {
            total: orders.length,
            active: orders.filter((order) => order.status === 'active').length,
            completed: orders.filter((order) => order.status === 'completed').length,
            canceled: orders.filter((order) => order.status === 'canceled').length,
            today: orders.filter((order) => isToday(order.created_at)).length,
          },
          deposits: {
            total: deposits.length,
            pending: deposits.filter((deposit) => deposit.status === 'pending').length,
            success: deposits.filter((deposit) => deposit.status === 'success').length,
            successAmount: deposits
              .filter((deposit) => deposit.status === 'success')
              .reduce((total, deposit) => total + Number(deposit.amount || 0), 0),
            today: deposits.filter((deposit) => isToday(deposit.created_at)).length,
          },
          vouchers: {
            total: vouchers.length,
            active: vouchers.filter((voucher) => voucher.is_active).length,
            claimed: vouchers.reduce(
              (total, voucher) => total + Number(voucher.current_usage || 0),
              0,
            ),
          },
        },
      })
    }

    if (action === 'users.list') {
      const users = await fetchAllRows(supabase, 'users', '*', 'joined_at')
      return jsonResponse({ success: true, users })
    }

    if (action === 'users.toggleBan') {
      const userId = Number(payload.id)
      if (!Number.isSafeInteger(userId)) throw new Error('ID user tidak valid')
      const { data, error } = await supabase
        .from('users')
        .update({ is_banned: Boolean(payload.isBanned) })
        .eq('id', userId)
        .select('*')
        .single()
      if (error) throw error
      return jsonResponse({ success: true, user: data })
    }

    if (action === 'users.adjustBalance') {
      const userId = Number(payload.id)
      const amount = asPositiveInteger(payload.amount, 'Nominal saldo')
      const adjustment = String(payload.adjustment ?? '')
      if (!Number.isSafeInteger(userId)) throw new Error('ID user tidak valid')
      if (!['add', 'subtract'].includes(adjustment)) throw new Error('Aksi saldo tidak valid')

      const { data: currentUser, error: currentError } = await supabase
        .from('users')
        .select('balance')
        .eq('id', userId)
        .single()

      if (currentError || !currentUser) throw new Error('User tidak ditemukan')

      const currentBalance = Number(currentUser.balance || 0)
      const nextBalance = adjustment === 'add'
        ? currentBalance + amount
        : currentBalance - amount

      if (!Number.isSafeInteger(nextBalance)) throw new Error('Hasil saldo tidak valid')
      if (nextBalance < 0) throw new Error('Saldo user tidak mencukupi untuk dikurangi')

      const { data, error } = await supabase
        .from('users')
        .update({ balance: nextBalance })
        .eq('id', userId)
        .eq('balance', currentBalance)
        .select('*')
        .maybeSingle()

      if (error) throw error
      if (!data) throw new Error('Saldo user baru saja berubah. Silakan ulangi aksi.')
      return jsonResponse({ success: true, user: data })
    }

    if (action === 'orders.list') {
      const orders = await fetchAllRows(
        supabase,
        'orders',
        '*, users(id,username)',
        'created_at',
      )
      return jsonResponse({ success: true, orders })
    }

    if (action === 'deposits.list') {
      const deposits = await fetchAllRows(
        supabase,
        'deposits',
        '*, users(id,username)',
        'created_at',
      )
      return jsonResponse({ success: true, deposits })
    }

    if (action === 'vouchers.list') {
      const [vouchers, promos] = await Promise.all([
        fetchAllRows(supabase, 'vouchers', '*', 'created_at'),
        fetchAllRows(supabase, 'promo_settings', '*', 'created_at'),
      ])
      return jsonResponse({ success: true, vouchers, promos })
    }

    if (action === 'vouchers.create') {
      const code = String(payload.code ?? '').trim().toUpperCase()
      const batch = String(payload.batch ?? '').trim()
      if (!code) throw new Error('Kode voucher wajib diisi')
      if (!batch) throw new Error('Nama batch wajib diisi')

      const { data, error } = await supabase
        .from('vouchers')
        .insert({
          code,
          batch,
          amount: asPositiveNumber(payload.amount, 'Nominal voucher'),
          max_usage: asPositiveInteger(payload.max_usage, 'Batas penggunaan'),
        })
        .select('*')
        .single()
      if (error) throw error
      return jsonResponse({ success: true, voucher: data })
    }

    if (action === 'vouchers.toggle') {
      const code = String(payload.code ?? '').trim().toUpperCase()
      if (!code) throw new Error('Kode voucher tidak valid')
      const { data, error } = await supabase
        .from('vouchers')
        .update({ is_active: Boolean(payload.isActive) })
        .eq('code', code)
        .select('*')
        .single()
      if (error) throw error
      return jsonResponse({ success: true, voucher: data })
    }

    if (action === 'vouchers.updateMaxUsage') {
      const code = String(payload.code ?? '').trim().toUpperCase()
      const maxUsage = asPositiveInteger(payload.max_usage, 'Batas penggunaan')
      if (!code) throw new Error('Kode voucher tidak valid')

      const { data: currentVoucher, error: currentError } = await supabase
        .from('vouchers')
        .select('current_usage')
        .eq('code', code)
        .single()

      if (currentError || !currentVoucher) throw new Error('Voucher tidak ditemukan')
      if (maxUsage < Number(currentVoucher.current_usage || 0)) {
        throw new Error('Batas penggunaan tidak boleh lebih kecil dari jumlah klaim saat ini')
      }

      const { data, error } = await supabase
        .from('vouchers')
        .update({ max_usage: maxUsage })
        .eq('code', code)
        .select('*')
        .single()
      if (error) throw error
      return jsonResponse({ success: true, voucher: data })
    }

    if (action === 'promo.save') {
      const promoName = String(payload.promo_name ?? '').trim()
      const percentage = asNonNegativeInteger(payload.percentage, 'Persentase promo')
      if (!promoName) throw new Error('Nama promo wajib diisi')
      if (percentage > 100) throw new Error('Persentase promo maksimal 100%')

      const promo = {
        promo_name: promoName,
        percentage,
        min_deposit: asNonNegativeInteger(payload.min_deposit, 'Minimal deposit'),
        max_bonus: asNonNegativeInteger(payload.max_bonus, 'Maksimal bonus'),
        is_active: Boolean(payload.is_active),
      }

      const promoId = Number(payload.id)
      const query = Number.isSafeInteger(promoId)
        ? supabase.from('promo_settings').update(promo).eq('id', promoId)
        : supabase.from('promo_settings').insert(promo)
      const { data, error } = await query.select('*').single()
      if (error) throw error
      return jsonResponse({ success: true, promo: data })
    }

    if (action === 'promo.toggle') {
      const promoId = Number(payload.id)
      if (!Number.isSafeInteger(promoId)) throw new Error('ID promo tidak valid')

      const { data, error } = await supabase
        .from('promo_settings')
        .update({ is_active: Boolean(payload.isActive) })
        .eq('id', promoId)
        .select('*')
        .single()
      if (error) throw error
      return jsonResponse({ success: true, promo: data })
    }

    return jsonResponse({ error: 'Aksi admin tidak valid' }, 400)
  } catch (error) {
    console.error(error)
    const message = error instanceof Error ? error.message : 'Aksi admin gagal'
    const isAuthError =
      message.includes('Telegram') ||
      message.includes('admin ditolak') ||
      message.includes('autentikasi')
    return jsonResponse({ error: message }, isAuthError ? 403 : 500)
  }
})
