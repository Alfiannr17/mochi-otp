import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { validateTelegramInitData } from "../_shared/telegram.ts"
import { syncDepositStatus } from "../_shared/deposit-lifecycle.ts"
import { syncOrderProviderStatus } from "../_shared/order-sync.ts"
import { getFeatureSettings } from "../_shared/feature-settings.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const parsePositiveInt = (value: unknown, fallback: number, max: number) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(1, Math.floor(parsed)))
}

const applyDepositStatusFilter = (query: any, status: string) => {
  if (!status || status === 'all') return query
  if (status === 'success') {
    return query.or('status.eq.success,status.eq.SUCCESS,status.eq.sukses,status.eq.SUKSES,status.eq.completed,status.eq.COMPLETED,status.eq.complete,status.eq.COMPLETE,status.eq.paid,status.eq.PAID,status.eq.settlement,status.eq.SETTLEMENT,status.eq.settled,status.eq.SETTLED')
  }
  if (status === 'canceled') {
    return query.or('status.eq.canceled,status.eq.CANCELED,status.eq.cancelled,status.eq.CANCELLED,status.eq.expired,status.eq.EXPIRED,status.eq.failed,status.eq.FAILED')
  }
  if (status === 'pending') {
    return query.or('status.eq.pending,status.eq.PENDING,status.eq.unpaid,status.eq.UNPAID,status.eq.process,status.eq.PROCESS')
  }
  return query.eq('status', status)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { initData, action, id, page: rawPage, pageSize: rawPageSize, status: rawStatus, sync } = await req.json()
    if (!initData || typeof initData !== 'string') {
      return jsonResponse({ error: 'Data autentikasi Telegram tidak tersedia' }, 400)
    }

    if (!['orders', 'order', 'deposits', 'deposit', 'features'].includes(action)) {
      return jsonResponse({ error: 'Aksi data tidak valid' }, 400)
    }

    if (['order', 'deposit'].includes(action) && !id) {
      return jsonResponse({ error: 'ID data tidak tersedia' }, 400)
    }

    const telegramUser = await validateTelegramInitData(initData)
    const userId = Number(telegramUser.id)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    if (action === 'features') {
      return jsonResponse({
        success: true,
        features: await getFeatureSettings(supabase),
      })
    }

    if (action === 'orders') {
      const page = parsePositiveInt(rawPage, 1, 100000)
      const pageSize = parsePositiveInt(rawPageSize, 20, 50)
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1
      const status = String(rawStatus ?? 'all').toLowerCase()

      let query = supabase
        .from('orders')
        .select('*', { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(from, to)

      if (status !== 'all') query = query.eq('status', status)

      const { data, error, count } = await query

      if (error) throw error
      const shouldSync = sync !== false
      const orders = shouldSync
        ? await Promise.all((data ?? []).map(async (order) => {
          if (order.status !== 'active') return order
          return (await syncOrderProviderStatus(supabase, order)).order
        }))
        : data ?? []
      return jsonResponse({
        success: true,
        orders,
        page,
        pageSize,
        total: count ?? orders.length,
      })
    }

    if (action === 'order') {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle()

      if (error) throw error
      if (!data) return jsonResponse({ error: 'Order tidak ditemukan' }, 404)
      return jsonResponse({
        success: true,
        order: data.status === 'active'
          ? (await syncOrderProviderStatus(supabase, data)).order
          : data,
      })
    }

    if (action === 'deposits') {
      const page = parsePositiveInt(rawPage, 1, 100000)
      const pageSize = parsePositiveInt(rawPageSize, 20, 50)
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1
      const status = String(rawStatus ?? 'all').toLowerCase()

      let query = supabase
        .from('deposits')
        .select('*', { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(from, to)

      query = applyDepositStatusFilter(query, status)

      const { data, error, count } = await query

      if (error) throw error
      const deposits = []
      for (const deposit of data ?? []) {
        deposits.push(sync === false ? deposit : await syncDepositStatus(supabase, deposit))
      }
      return jsonResponse({
        success: true,
        deposits,
        page,
        pageSize,
        total: count ?? deposits.length,
      })
    }

    const { data, error } = await supabase
      .from('deposits')
      .select('*')
      .eq('order_id', id)
      .eq('user_id', userId)
      .maybeSingle()

    if (error) throw error
    if (!data) return jsonResponse({ error: 'Deposit tidak ditemukan' }, 404)
    return jsonResponse({ success: true, deposit: await syncDepositStatus(supabase, data) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal mengambil data user'
    const isAuthError = message.includes('Telegram') || message.includes('autentikasi')
    return jsonResponse({ error: message }, isAuthError ? 401 : 500)
  }
})
