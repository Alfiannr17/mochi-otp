import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { requireAdminTelegramUser } from "../_shared/admin.ts"
import { FEATURE_DEFAULTS, getFeatureSettings } from "../_shared/feature-settings.ts"

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

const sanitizeSearch = (value: unknown) =>
  String(value ?? '')
    .trim()
    .replace(/[,%()]/g, ' ')
    .slice(0, 100)

const getPagination = (payload: Record<string, unknown> = {}) => {
  const page = Math.max(1, Number.isSafeInteger(Number(payload.page)) ? Number(payload.page) : 1)
  const requestedPageSize = Number.isSafeInteger(Number(payload.pageSize))
    ? Number(payload.pageSize)
    : 20
  const pageSize = Math.min(100, Math.max(5, requestedPageSize))
  const from = (page - 1) * pageSize
  return {
    page,
    pageSize,
    from,
    to: from + pageSize - 1,
  }
}

const getPagedResponse = (
  data: unknown[] | null,
  count: number | null,
  page: number,
  pageSize: number,
) => {
  const total = count ?? 0
  return {
    rows: data ?? [],
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  }
}

const DEPOSIT_SUCCESS_STATUSES = [
  'success',
  'SUCCESS',
  'sukses',
  'SUKSES',
  'berhasil',
  'BERHASIL',
  'completed',
  'COMPLETED',
  'complete',
  'COMPLETE',
  'paid',
  'PAID',
  'settlement',
  'SETTLEMENT',
  'settled',
  'SETTLED',
]

const DEPOSIT_PENDING_STATUSES = ['pending', 'PENDING', 'unpaid', 'UNPAID', 'process', 'PROCESS']

const DEPOSIT_CANCELED_STATUSES = [
  'canceled',
  'CANCELED',
  'cancelled',
  'CANCELLED',
  'expired',
  'EXPIRED',
  'failed',
  'FAILED',
]

const applyStatusOr = (query: any, statuses: string[]) =>
  query.or(statuses.map((status) => `status.eq.${status}`).join(','))

const applyDepositStatusFilter = (query: any, status: string) => {
  if (status === 'all') return query
  if (status === 'success') return applyStatusOr(query, DEPOSIT_SUCCESS_STATUSES)
  if (status === 'pending') return applyStatusOr(query, DEPOSIT_PENDING_STATUSES)
  if (status === 'canceled') return applyStatusOr(query, DEPOSIT_CANCELED_STATUSES)
  return query.eq('status', status)
}

const fetchAllRows = async (
  supabase: any,
  table: string,
  columns: string,
  orderColumn?: string,
  ascending = false,
  filterQuery: (query: any) => any = (query) => query,
) => {
  const pageSize = 1000
  const rows = []

  for (let from = 0; ; from += pageSize) {
    let query = filterQuery(supabase
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1))

    if (orderColumn) query = query.order(orderColumn, { ascending })
    const { data, error } = await query

    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < pageSize) break
  }

  return rows
}

const countRows = async (
  supabase: any,
  table: string,
  filterQuery: (query: any) => any = (query) => query,
) => {
  const { count, error } = await filterQuery(
    supabase.from(table).select('*', { count: 'exact', head: true }),
  )
  if (error) throw error
  return count ?? 0
}

const sumRows = async (
  supabase: any,
  table: string,
  column: string,
  filterQuery: (query: any) => any = (query) => query,
) => {
  const rows = await fetchAllRows(supabase, table, column, undefined, false, filterQuery)
  return rows.reduce((total, row) => total + Number(row?.[column] || 0), 0)
}

const fetchPagedRows = async (
  supabase: any,
  table: string,
  columns: string,
  payload: Record<string, unknown>,
  orderColumn: string,
  filterQuery: (query: any, search: string, status: string) => any = (query) => query,
) => {
  const { page, pageSize, from, to } = getPagination(payload)
  const search = sanitizeSearch(payload.search)
  const status = String(payload.status ?? 'all')
  let dataQuery = supabase
    .from(table)
    .select(columns)
    .order(orderColumn, { ascending: false })
    .range(from, to)
  let countQuery = supabase
    .from(table)
    .select('*', { count: 'exact', head: true })

  dataQuery = filterQuery(dataQuery, search, status)
  countQuery = filterQuery(countQuery, search, status)

  const [{ data, error }, { count, error: countError }] = await Promise.all([
    dataQuery,
    countQuery,
  ])
  if (error) throw error
  if (countError) throw countError

  return getPagedResponse(data, count, page, pageSize)
}

const numericSearch = (search: string) => {
  const number = Number(search)
  return Number.isSafeInteger(number) ? number : null
}

const normalizeUsername = (value: unknown) =>
  String(value ?? '').trim().replace(/^@+/, '').slice(0, 64)

const getTelegramProfile = async (userId: number) => {
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
  if (!botToken) return { username: '', display_name: '' }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/getChat?chat_id=${userId}`,
    )
    const payload = await response.json()
    if (!payload?.ok) return { username: '', display_name: '' }

    const chat = payload.result ?? {}
    const username = normalizeUsername(chat.username)
    const displayName = [chat.first_name, chat.last_name]
      .map((part) => String(part ?? '').trim())
      .filter(Boolean)
      .join(' ')
      .slice(0, 96)

    return {
      username,
      display_name: displayName || username,
    }
  } catch {
    return { username: '', display_name: '' }
  }
}

const enrichUserRows = async (supabase: any, rows: any[]) => {
  const enriched = []

  for (const row of rows) {
    const userId = Number(row?.id)
    const username = normalizeUsername(row?.username)
    let displayName = username
    let resolvedUsername = username

    if (!resolvedUsername && Number.isSafeInteger(userId)) {
      const profile = await getTelegramProfile(userId)
      resolvedUsername = profile.username
      displayName = profile.display_name

      if (resolvedUsername) {
        await supabase
          .from('users')
          .update({ username: resolvedUsername })
          .eq('id', userId)
      }
    }

    enriched.push({
      ...row,
      username: resolvedUsername || row?.username || '',
      display_name: displayName || '',
    })
  }

  return enriched
}

const attachUsers = async (supabase: any, rows: any[]) => {
  const userIds = [...new Set(
    rows
      .map((row) => Number(row?.user_id))
      .filter((id) => Number.isSafeInteger(id)),
  )]

  if (userIds.length === 0) return rows

  const { data: users, error } = await supabase
    .from('users')
    .select('id,username')
    .in('id', userIds)

  if (error) throw error

  const enrichedUsers = await enrichUserRows(supabase, users ?? [])
  const userMap = new Map(enrichedUsers.map((user) => [Number(user.id), user]))

  return rows.map((row) => {
    const userId = Number(row?.user_id)
    const user = userMap.get(userId)
    return {
      ...row,
      users: user ?? {
        id: row?.user_id,
        username: '',
        display_name: '',
      },
    }
  })
}

const normalizeVoucher = (voucher: any) => ({
  ...voucher,
  batch: voucher?.batch_id ?? voucher?.batch ?? '',
  is_active: !voucher?.is_used,
  current_usage: voucher?.is_used ? 1 : 0,
  max_usage: 1,
})

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
      const startOfToday = new Date()
      startOfToday.setHours(0, 0, 0, 0)
      const startOfTodayIso = startOfToday.toISOString()

      const [
        usersTotal,
        usersBanned,
        ordersTotal,
        ordersActive,
        ordersCompleted,
        ordersCanceled,
        ordersToday,
        depositsTotal,
        depositsPending,
        depositsSuccess,
        depositsToday,
        vouchersTotal,
        vouchersActive,
        depositsSuccessAmount,
        vouchersClaimed,
      ] = await Promise.all([
        countRows(supabase, 'users'),
        countRows(supabase, 'users', (query) => query.eq('is_banned', true)),
        countRows(supabase, 'orders'),
        countRows(supabase, 'orders', (query) => query.eq('status', 'active')),
        countRows(supabase, 'orders', (query) => query.eq('status', 'completed')),
        countRows(supabase, 'orders', (query) => query.eq('status', 'canceled')),
        countRows(supabase, 'orders', (query) => query.gte('created_at', startOfTodayIso)),
        countRows(supabase, 'deposits'),
        countRows(supabase, 'deposits', (query) => applyDepositStatusFilter(query, 'pending')),
        countRows(supabase, 'deposits', (query) => applyDepositStatusFilter(query, 'success')),
        countRows(supabase, 'deposits', (query) => query.gte('created_at', startOfTodayIso)),
        countRows(supabase, 'vouchers'),
        countRows(supabase, 'vouchers', (query) => query.or('is_used.eq.false,is_used.is.null')),
        sumRows(supabase, 'deposits', 'amount', (query) => applyDepositStatusFilter(query, 'success')),
        countRows(supabase, 'vouchers', (query) => query.eq('is_used', true)),
      ])

      return jsonResponse({
        success: true,
        summary: {
          users: {
            total: usersTotal,
            banned: usersBanned,
          },
          orders: {
            total: ordersTotal,
            active: ordersActive,
            completed: ordersCompleted,
            canceled: ordersCanceled,
            today: ordersToday,
          },
          deposits: {
            total: depositsTotal,
            pending: depositsPending,
            success: depositsSuccess,
            successAmount: depositsSuccessAmount,
            today: depositsToday,
          },
          vouchers: {
            total: vouchersTotal,
            active: vouchersActive,
            claimed: vouchersClaimed,
          },
        },
      })
    }

    if (action === 'features.list') {
      return jsonResponse({
        success: true,
        features: await getFeatureSettings(supabase),
      })
    }

    if (action === 'features.save') {
      const featureKey = String(payload.feature_key ?? '')
      if (!(featureKey in FEATURE_DEFAULTS)) throw new Error('Fitur tidak valid')

      const fallback = FEATURE_DEFAULTS[featureKey as keyof typeof FEATURE_DEFAULTS]
      const maintenanceMessage =
        String(payload.maintenance_message ?? '').trim() || fallback.maintenance_message

      const { data, error } = await supabase
        .from('feature_settings')
        .upsert({
          feature_key: featureKey,
          is_active: Boolean(payload.is_active),
          maintenance_message: maintenanceMessage,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'feature_key' })
        .select('feature_key,is_active,maintenance_message,updated_at')
        .single()

      if (error) throw error
      return jsonResponse({ success: true, feature: data })
    }

    if (action === 'users.list') {
      const result = await fetchPagedRows(
        supabase,
        'users',
        '*',
        payload,
        'id',
        (query, search, status) => {
          const userId = numericSearch(search)
          let nextQuery = query
          if (status === 'active') nextQuery = nextQuery.eq('is_banned', false)
          if (status === 'banned') nextQuery = nextQuery.eq('is_banned', true)
          if (search) {
            const filters = [`username.ilike.%${search}%`]
            if (userId !== null) filters.push(`id.eq.${userId}`)
            nextQuery = nextQuery.or(filters.join(','))
          }
          return nextQuery
        },
      )
      return jsonResponse({
        success: true,
        users: await enrichUserRows(supabase, result.rows),
        pagination: result.pagination,
      })
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
      const result = await fetchPagedRows(
        supabase,
        'orders',
        '*',
        payload,
        'created_at',
        (query, search, status) => {
          const number = numericSearch(search)
          let nextQuery = status === 'all' ? query : query.eq('status', status)
          if (search) {
            const filters = [
              `service_name.ilike.%${search}%`,
              `phone_number.ilike.%${search}%`,
              `activation_id.ilike.%${search}%`,
              `sms_code.ilike.%${search}%`,
            ]
            if (number !== null) {
              filters.push(`id.eq.${number}`, `user_id.eq.${number}`, `price.eq.${number}`)
            }
            nextQuery = nextQuery.or(filters.join(','))
          }
          return nextQuery
        },
      )
      return jsonResponse({
        success: true,
        orders: await attachUsers(supabase, result.rows),
        pagination: result.pagination,
      })
    }

    if (action === 'deposits.list') {
      const result = await fetchPagedRows(
        supabase,
        'deposits',
        '*',
        payload,
        'created_at',
        (query, search, status) => {
          const number = numericSearch(search)
          let nextQuery = applyDepositStatusFilter(query, status)
          if (search) {
            const filters = [`order_id.ilike.%${search}%`]
            if (number !== null) {
              filters.push(`user_id.eq.${number}`, `amount.eq.${number}`)
            }
            nextQuery = nextQuery.or(filters.join(','))
          }
          return nextQuery
        },
      )
      return jsonResponse({
        success: true,
        deposits: await attachUsers(supabase, result.rows),
        pagination: result.pagination,
      })
    }

    if (action === 'vouchers.list') {
      const [vouchers, promos] = await Promise.all([
        fetchPagedRows(
          supabase,
          'vouchers',
          '*',
          payload.vouchers ?? {},
          'created_at',
          (query, search, status) => {
            const number = numericSearch(search)
            let nextQuery = query
            if (status === 'active') nextQuery = nextQuery.or('is_used.eq.false,is_used.is.null')
            if (status === 'inactive') nextQuery = nextQuery.eq('is_used', true)
            if (search) {
              const filters = [
                `code.ilike.%${search}%`,
                `batch_id.ilike.%${search}%`,
              ]
              if (number !== null) {
                filters.push(`amount.eq.${number}`, `id.eq.${number}`, `used_by.eq.${number}`)
              }
              nextQuery = nextQuery.or(filters.join(','))
            }
            return nextQuery
          },
        ),
        fetchPagedRows(
          supabase,
          'promo_settings',
          '*',
          payload.promos ?? {},
          'created_at',
          (query, search, status) => {
            const number = numericSearch(search)
            let nextQuery = query
            if (status === 'active') nextQuery = nextQuery.eq('is_active', true)
            if (status === 'inactive') nextQuery = nextQuery.eq('is_active', false)
            if (search) {
              const filters = [`promo_name.ilike.%${search}%`]
              if (number !== null) {
                filters.push(
                  `percentage.eq.${number}`,
                  `min_deposit.eq.${number}`,
                  `max_bonus.eq.${number}`,
                )
              }
              nextQuery = nextQuery.or(filters.join(','))
            }
            return nextQuery
          },
        ),
      ])
      return jsonResponse({
        success: true,
        vouchers: vouchers.rows.map(normalizeVoucher),
        promos: promos.rows,
        vouchersPagination: vouchers.pagination,
        promosPagination: promos.pagination,
      })
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
          batch_id: batch,
          amount: asPositiveNumber(payload.amount, 'Nominal voucher'),
          is_used: false,
          used_by: null,
          used_at: null,
        })
        .select('*')
        .single()
      if (error) throw error
      return jsonResponse({ success: true, voucher: normalizeVoucher(data) })
    }

    if (action === 'vouchers.toggle') {
      const code = String(payload.code ?? '').trim().toUpperCase()
      if (!code) throw new Error('Kode voucher tidak valid')
      const { data, error } = await supabase
        .from('vouchers')
        .update(Boolean(payload.isActive)
          ? { is_used: false, used_by: null, used_at: null }
          : { is_used: true })
        .eq('code', code)
        .select('*')
        .single()
      if (error) throw error
      return jsonResponse({ success: true, voucher: normalizeVoucher(data) })
    }

    if (action === 'vouchers.updateMaxUsage') {
      const code = String(payload.code ?? '').trim().toUpperCase()
      if (!code) throw new Error('Kode voucher tidak valid')

      const { data, error } = await supabase
        .from('vouchers')
        .select('*')
        .eq('code', code)
        .single()
      if (error) throw error
      return jsonResponse({ success: true, voucher: normalizeVoucher(data) })
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
