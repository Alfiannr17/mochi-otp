import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { isAdminTelegramId } from "../_shared/admin.ts"
import { parseOtpState } from "../_shared/otp-history.ts"
import { sendTelegramMessage } from "../_shared/telegram-notify.ts"
import {
  calculateMochiPrice,
  fetchSmsJson,
  normalizeCountries,
  normalizePricesV2,
  normalizeServices,
} from "../_shared/smsbower.ts"
import { calculateIdrMochiPrice } from "../_shared/pricing.ts"
import { getSmsCodeCatalog, getSmsCodeProducts } from "../_shared/smscode.ts"
import { getFeatureSetting, getProviderFeatureKey } from "../_shared/feature-settings.ts"

const formatRupiah = (value: unknown) =>
  `Rp.${Number(value || 0).toLocaleString('id-ID')}`

const BOT_ORDER_LIMIT = 8
const PROVIDERS = {
  b: { id: 'smsbower', name: 'Server 1' },
  c: { id: 'smscode', name: 'Server 2' },
} as const

const PREFERRED_COUNTRIES = [
  'indonesia',
  'united states',
  'malaysia',
  'thailand',
  'vietnam',
  'philippines',
  'singapore',
  'india',
]

const PREFERRED_SERVICES = [
  'whatsapp',
  'telegram',
  'shopee',
  'tiktok',
  'google',
  'facebook',
  'instagram',
  'grab',
]

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

const answerCallbackQuery = async (botToken: string, callbackQueryId: string, text?: string) => {
  if (!botToken || !callbackQueryId) return
  await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    }),
  }).catch(() => null)
}

const getSupabase = () => createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

type ProviderKey = keyof typeof PROVIDERS

const isProviderKey = (value: string): value is ProviderKey =>
  value === 'b' || value === 'c'

const getProvider = (providerKey: ProviderKey) => PROVIDERS[providerKey]

const getProviderKeyFromNumber = (value: string) =>
  value === '2' ? 'c' as const : 'b' as const

const trimLabel = (value: unknown, max = 24) => {
  const text = String(value ?? '').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

const buildMiniAppButton = (miniAppUrl: string) => ({
  text: 'BUKA MINI APP',
  web_app: { url: miniAppUrl },
})

const getBotCatalog = async (providerKey: ProviderKey) => {
  if (providerKey === 'c') return await getSmsCodeCatalog()

  const [countriesPayload, servicesPayload] = await Promise.all([
    fetchSmsJson('getCountries'),
    fetchSmsJson('getServicesList'),
  ])

  return {
    countries: normalizeCountries(countriesPayload),
    services: normalizeServices(servicesPayload),
  }
}

const sortPreferred = (items: any[], preferredNames: string[]) => {
  const preferred = new Map(preferredNames.map((name, index) => [name, index]))
  return [...items].sort((left, right) => {
    const leftName = String(left.name ?? '').toLowerCase()
    const rightName = String(right.name ?? '').toLowerCase()
    const leftRank = preferredNames.find((name) => leftName.includes(name))
    const rightRank = preferredNames.find((name) => rightName.includes(name))
    const leftScore = leftRank ? preferred.get(leftRank) ?? 999 : 999
    const rightScore = rightRank ? preferred.get(rightRank) ?? 999 : 999
    return leftScore - rightScore || leftName.localeCompare(rightName)
  })
}

const sendOrderServerMenu = async (chatId: number | string, miniAppUrl: string) => {
  await sendTelegramMessage(
    chatId,
    [
      '<b>Order OTP via Bot</b>',
      '',
      'Pilih server dulu, lalu pilih negara, layanan, dan harga/stok.',
      '',
      'Pencarian cepat:',
      '<code>/negara1 indonesia</code>',
      '<code>/negara2 united</code>',
      '<code>/layanan1 whatsapp</code>',
      '<code>/layanan2 telegram</code>',
    ].join('\n'),
    {
      inline_keyboard: [
        [
          { text: 'Server 1', callback_data: 'ord:s:b' },
          { text: 'Server 2', callback_data: 'ord:s:c' },
        ],
        [buildMiniAppButton(miniAppUrl)],
      ],
    },
  )
}

const sendCountryMenu = async (
  supabase: any,
  chatId: number | string,
  providerKey: ProviderKey,
  miniAppUrl: string,
  query = '',
) => {
  const provider = getProvider(providerKey)
  const feature = await getFeatureSetting(supabase, getProviderFeatureKey(provider.id))
  if (!feature.is_active) {
    await sendTelegramMessage(chatId, `${provider.name} sedang maintenance.\n\n${escapeHtml(feature.maintenance_message)}`)
    return
  }

  const catalog = await getBotCatalog(providerKey)
  const normalizedQuery = query.trim().toLowerCase()
  const countries = normalizedQuery
    ? catalog.countries.filter((country: any) =>
      String(country.name).toLowerCase().includes(normalizedQuery)
    )
    : sortPreferred(catalog.countries, PREFERRED_COUNTRIES)

  const buttons = countries.slice(0, BOT_ORDER_LIMIT).map((country: any) => [
    {
      text: trimLabel(country.name, 32),
      callback_data: `ord:c:${providerKey}:${country.id}`,
    },
  ])

  await sendTelegramMessage(
    chatId,
    [
      `<b>${provider.name}</b>`,
      '',
      query
        ? `Hasil negara untuk: <code>${escapeHtml(query)}</code>`
        : 'Pilih negara atau lewati untuk melihat stok dari semua negara.',
    ].join('\n'),
    {
      inline_keyboard: [
        [{ text: 'Lewati Negara', callback_data: `ord:c:${providerKey}:all` }],
        ...buttons,
        [
          { text: 'Pilih Server', callback_data: 'ord:menu' },
          buildMiniAppButton(miniAppUrl),
        ],
      ],
    },
  )
}

const sendServiceMenu = async (
  chatId: number | string,
  providerKey: ProviderKey,
  countryId: string,
  miniAppUrl: string,
  query = '',
) => {
  const provider = getProvider(providerKey)
  const catalog = await getBotCatalog(providerKey)
  const normalizedQuery = query.trim().toLowerCase()
  const services = normalizedQuery
    ? catalog.services.filter((service: any) =>
      String(service.name).toLowerCase().includes(normalizedQuery) ||
      String(service.code ?? '').toLowerCase().includes(normalizedQuery)
    )
    : sortPreferred(catalog.services, PREFERRED_SERVICES)

  const buttons = services.slice(0, BOT_ORDER_LIMIT).map((service: any) => {
    const serviceId = providerKey === 'c' ? service.id : service.code
    return [{
      text: trimLabel(service.name, 32),
      callback_data: `ord:v:${providerKey}:${countryId}:${serviceId}`,
    }]
  })

  await sendTelegramMessage(
    chatId,
    [
      `<b>${provider.name}</b>`,
      '',
      query
        ? `Hasil layanan untuk: <code>${escapeHtml(query)}</code>`
        : 'Pilih layanan OTP.',
      '',
      'Kalau layanan tidak ada di daftar, gunakan pencarian:',
      `<code>/layanan${providerKey === 'c' ? '2' : '1'} telegram</code>`,
    ].join('\n'),
    {
      inline_keyboard: [
        ...buttons,
        [
          { text: 'Pilih Negara', callback_data: `ord:s:${providerKey}` },
          buildMiniAppButton(miniAppUrl),
        ],
      ],
    },
  )
}

const sendPriceMenu = async (
  chatId: number | string,
  providerKey: ProviderKey,
  countryId: string,
  serviceRef: string,
  miniAppUrl: string,
) => {
  const provider = getProvider(providerKey)
  const catalog = await getBotCatalog(providerKey)
  const countryMap = Object.fromEntries(
    catalog.countries.map((country: any) => [String(country.id), country.name]),
  )

  if (providerKey === 'c') {
    const service = catalog.services.find((item: any) => String(item.id) === String(serviceRef))
    if (!service) {
      await sendTelegramMessage(chatId, 'Layanan tidak ditemukan. Silakan pilih ulang.')
      return
    }

    const productsPayload = await getSmsCodeProducts(service.id, countryId === 'all' ? undefined : countryId)
    const products = productsPayload
      .filter((product: any) =>
        product.active !== false &&
        Number(product.available) > 0 &&
        String(product.platform_id) === String(service.id) &&
        (countryId === 'all' || String(product.country_id) === String(countryId))
      )
      .map((product: any) => {
        const basePriceIdr = Number(product.price?.canonical_amount)
        return {
          productId: String(product.id),
          catalogProductId: String(product.catalog_product_id),
          countryId: String(product.country_id),
          serviceId: String(product.platform_id),
          serviceCode: String(service.code ?? service.id),
          serviceName: String(service.name ?? service.code ?? service.id),
          basePriceIdr,
          stock: Number(product.available),
          countryName: countryMap[String(product.country_id)] ?? `Country ${product.country_id}`,
          mochiPrice: calculateIdrMochiPrice(String(service.code ?? service.id), basePriceIdr),
        }
      })
      .filter((product: any) =>
        Number.isFinite(product.basePriceIdr) &&
        Number.isFinite(product.mochiPrice)
      )
      .sort((a: any, b: any) => Number(a.mochiPrice) - Number(b.mochiPrice))
      .slice(0, BOT_ORDER_LIMIT)

    await sendProductsMessage(chatId, providerKey, products, miniAppUrl)
    return
  }

  const service = catalog.services.find((item: any) => String(item.code) === String(serviceRef))
  if (!service) {
    await sendTelegramMessage(chatId, 'Layanan tidak ditemukan. Silakan pilih ulang.')
    return
  }

  const pricesPayload = await fetchSmsJson('getPricesV2', {
    service: service.code,
    country: countryId === 'all' ? undefined : countryId,
  })
  const products = normalizePricesV2(pricesPayload)
    .filter((price) =>
      price.stock > 0 &&
      price.serviceCode === String(service.code) &&
      (countryId === 'all' || price.countryId === String(countryId))
    )
    .map((price) => ({
      ...price,
      serviceName: String(service.name ?? price.serviceCode),
      countryName: countryMap[price.countryId] ?? `Country ${price.countryId}`,
      mochiPrice: calculateMochiPrice(price.serviceCode, price.basePrice),
    }))
    .sort((a, b) =>
      Number(a.mochiPrice) - Number(b.mochiPrice) ||
      Number(a.basePrice) - Number(b.basePrice)
    )
    .slice(0, BOT_ORDER_LIMIT)

  await sendProductsMessage(chatId, providerKey, products, miniAppUrl)
}

const sendProductsMessage = async (
  chatId: number | string,
  providerKey: ProviderKey,
  products: any[],
  miniAppUrl: string,
) => {
  if (!products.length) {
    await sendTelegramMessage(
      chatId,
      'Stok nomor untuk layanan ini sedang kosong. Coba negara/layanan lain atau buka Mini App.',
      { inline_keyboard: [[buildMiniAppButton(miniAppUrl)]] },
    )
    return
  }

  const provider = getProvider(providerKey)
  const firstProduct = products[0]
  const buttons = products.map((product) => {
    const callbackData = providerKey === 'c'
      ? `ord:b:c:${product.countryId}:${product.serviceId}:${product.productId}:${product.catalogProductId}`
      : `ord:b:b:${product.countryId}:${product.serviceCode}:${product.basePrice}`
    return [{
      text: `${formatRupiah(product.mochiPrice)} | Stok ${product.stock} | ${trimLabel(product.countryName, 16)}`,
      callback_data: callbackData,
    }]
  })

  await sendTelegramMessage(
    chatId,
    [
      `<b>${provider.name} - ${escapeHtml(firstProduct.serviceName)}</b>`,
      '',
      'Pilih harga/stok untuk order nomor.',
      'Setelah order berhasil, OTP akan dikirim otomatis ke bot dan tampil di Mini App.',
    ].join('\n'),
    {
      inline_keyboard: [
        ...buttons,
        [buildMiniAppButton(miniAppUrl)],
      ],
    },
  )
}

const buyBotProduct = async (
  supabase: any,
  chatId: number | string,
  telegramUser: any,
  providerKey: ProviderKey,
  parts: string[],
  miniAppUrl: string,
) => {
  const user = await getUser(supabase, telegramUser)
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '')
  if (!supabaseUrl) throw new Error('SUPABASE_URL belum dikonfigurasi')

  let body: Record<string, unknown>

  if (providerKey === 'c') {
    const [countryId, serviceId, productId, catalogProductId] = parts
    const catalog = await getSmsCodeCatalog()
    const service = catalog.services.find((item: any) => String(item.id) === String(serviceId))
    if (!service) throw new Error('Layanan Server 2 tidak ditemukan')

    body = {
      userId: user.id,
      provider: 'smscode',
      serviceCode: String(service.code ?? service.id),
      serviceId,
      countryId,
      serviceName: String(service.name ?? service.code ?? service.id),
      productId,
      catalogProductId,
    }
  } else {
    const [countryId, serviceCode, basePrice] = parts
    const catalog = await getBotCatalog('b')
    const service = catalog.services.find((item: any) => String(item.code) === String(serviceCode))
    body = {
      userId: user.id,
      provider: 'smsbower',
      serviceCode,
      countryId,
      serviceName: String(service?.name ?? serviceCode).toUpperCase(),
      basePrice: Number(basePrice),
    }
  }

  await sendTelegramMessage(chatId, 'Order sedang diproses. Mohon tunggu sebentar...')

  const response = await fetch(`${supabaseUrl}/functions/v1/buy-number`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || payload?.error || !payload?.order) {
    throw new Error(payload?.error || `Order gagal diproses (HTTP ${response.status})`)
  }

  const order = payload.order
  await sendTelegramMessage(
    chatId,
    [
      '<b>Order Berhasil</b>',
      '',
      `Layanan: <b>${escapeHtml(order.service_name)}</b>`,
      `Nomor: <code>${escapeHtml(order.phone_number)}</code>`,
      `Harga: <b>${escapeHtml(formatRupiah(order.price))}</b>`,
      '',
      'Masukkan nomor ke aplikasi tujuan. OTP akan dikirim otomatis ke bot ini saat masuk.',
    ].join('\n'),
    {
      inline_keyboard: [
        [
          {
            text: 'BUKA ORDER AKTIF',
            web_app: { url: `${miniAppUrl}/orders/${order.id}` },
          },
        ],
        [{ text: 'ORDER LAGI', callback_data: 'ord:menu' }],
      ],
    },
  )
}

const buildMainKeyboard = (miniAppUrl: string, channelUrl: string, customerServiceUrl: string) => ({
  inline_keyboard: [
    [
      {
        text: 'BUKA MOCHI OTP',
        web_app: { url: miniAppUrl },
      },
    ],
    [
      { text: 'ORDER OTP VIA BOT', callback_data: 'ord:menu' },
    ],
    [
      { text: 'CEK SALDO', callback_data: 'bot_balance' },
      { text: 'ORDER AKTIF', callback_data: 'bot_orders' },
    ],
    [
      { text: 'CHECK-IN HARIAN', callback_data: 'bot_checkin' },
    ],
    [
      { text: 'CHANNEL MOCHI', url: channelUrl },
      { text: 'CS MOCHI', url: customerServiceUrl },
    ],
  ],
})

const ensureUser = async (supabase: any, telegramUser: any) => {
  const userId = Number(telegramUser?.id)
  if (!Number.isFinite(userId)) return null

  const username =
    String(telegramUser?.username ?? '').slice(0, 64) ||
    [telegramUser?.first_name, telegramUser?.last_name].filter(Boolean).join(' ').slice(0, 64) ||
    null

  const { data, error } = await supabase
    .from('users')
    .upsert({
      id: userId,
      username,
    }, { onConflict: 'id' })
    .select('*')
    .single()

  if (error) throw error
  return data
}

const getUser = async (supabase: any, telegramUser: any) => {
  const user = await ensureUser(supabase, telegramUser)
  if (!user) throw new Error('User Telegram tidak ditemukan')
  if (user.is_banned) throw new Error('Akun Anda telah diblokir oleh admin.')
  return user
}

const sendStartMenu = async (
  chatId: number | string,
  telegramUser: any,
  miniAppUrl: string,
  channelUrl: string,
  customerServiceUrl: string,
) => {
  const firstName = escapeHtml(telegramUser?.first_name || 'Bosku')
  await sendTelegramMessage(
    chatId,
    [
      `Halo <b>${firstName}</b>! Selamat datang di <b>MOCHI OTP</b>.`,
      '',
      'Mini App dan bot Telegram sekarang berjalan bareng.',
      'Gunakan tombol di bawah untuk order OTP via bot, buka Mini App, cek saldo, check-in, atau lihat order aktif.',
    ].join('\n'),
    buildMainKeyboard(miniAppUrl, channelUrl, customerServiceUrl),
  )
}

const sendBalance = async (supabase: any, chatId: number | string, telegramUser: any) => {
  const user = await getUser(supabase, telegramUser)
  await sendTelegramMessage(
    chatId,
    [
      '<b>Saldo Akun</b>',
      '',
      `ID Telegram: <code>${escapeHtml(user.id)}</code>`,
      `Username: <b>@${escapeHtml(user.username || 'tidak_tersedia')}</b>`,
      `Saldo: <b>${escapeHtml(formatRupiah(user.balance))}</b>`,
    ].join('\n'),
  )
}

const sendActiveOrders = async (supabase: any, chatId: number | string, telegramUser: any) => {
  const user = await getUser(supabase, telegramUser)
  const { data, error } = await supabase
    .from('orders')
    .select('id, service_name, phone_number, activation_id, sms_code, price, created_at')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(5)

  if (error) throw error

  if (!data?.length) {
    await sendTelegramMessage(chatId, 'Tidak ada order aktif saat ini.')
    return
  }

  const miniAppUrl = (Deno.env.get('MINI_APP_URL') ?? '').replace(/\/+$/, '')
  const lines = ['<b>Order Aktif</b>', '']

  for (const order of data) {
    const otpState = parseOtpState(order.sms_code)
    lines.push(
      `#${escapeHtml(order.id)} - <b>${escapeHtml(order.service_name)}</b>`,
      `Nomor: <code>${escapeHtml(order.phone_number || '-')}</code>`,
      `Harga: <b>${escapeHtml(formatRupiah(order.price))}</b>`,
      otpState.codes.length
        ? `OTP: <code>${escapeHtml(otpState.codes.join(', '))}</code>`
        : 'OTP: menunggu SMS masuk',
      miniAppUrl ? `<a href="${escapeHtml(`${miniAppUrl}/orders/${order.id}`)}">Buka order di Mini App</a>` : '',
      '',
    )
  }

  await sendTelegramMessage(chatId, lines.filter(Boolean).join('\n'))
}

const claimDailyCheckin = async (supabase: any, chatId: number | string, telegramUser: any) => {
  const user = await getUser(supabase, telegramUser)
  const now = new Date()

  const { data: lastCheckin, error: lastError } = await supabase
    .from('checkins')
    .select('last_checkin')
    .eq('user_id', user.id)
    .order('last_checkin', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lastError) throw lastError

  if (lastCheckin?.last_checkin) {
    const lastDate = new Date(lastCheckin.last_checkin)
    const nextAt = lastDate.getTime() + 24 * 60 * 60 * 1000
    if (Date.now() < nextAt) {
      const remainingMs = nextAt - Date.now()
      const hours = Math.floor(remainingMs / 3600000)
      const minutes = Math.floor((remainingMs % 3600000) / 60000)
      await sendTelegramMessage(
        chatId,
        `Saldo harian belum tersedia. Coba lagi dalam <b>${hours} jam ${minutes} menit</b>.`,
      )
      return
    }
  }

  const amount = Math.floor(Math.random() * (250 - 50 + 1)) + 50
  const claimedAtIso = now.toISOString()
  const { error: insertError } = await supabase
    .from('checkins')
    .insert({
      user_id: user.id,
      amount,
      last_checkin: claimedAtIso,
      checkin_date: claimedAtIso.slice(0, 10),
    })

  if (insertError) throw insertError

  const currentBalance = Number(user.balance || 0)
  const { data: updatedUser, error: balanceError } = await supabase
    .from('users')
    .update({ balance: currentBalance + amount })
    .eq('id', user.id)
    .eq('balance', currentBalance)
    .select('balance')
    .maybeSingle()

  if (balanceError || !updatedUser) {
    try {
      await supabase
        .from('checkins')
        .delete()
        .eq('user_id', user.id)
        .eq('last_checkin', claimedAtIso)
    } catch {
      // Rollback failure should not hide the original balance error.
    }
    throw balanceError || new Error('Saldo gagal diperbarui')
  }

  await sendTelegramMessage(
    chatId,
    [
      '<b>Check-in Berhasil</b>',
      '',
      `Bonus: <b>${escapeHtml(formatRupiah(amount))}</b>`,
      `Saldo sekarang: <b>${escapeHtml(formatRupiah(updatedUser.balance))}</b>`,
      'Saldo harian berikutnya tersedia 24 jam lagi.',
    ].join('\n'),
  )
}

serve(async (req) => {
  try {
    const webhookSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? ''
    if (
      webhookSecret &&
      req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== webhookSecret
    ) {
      return new Response('Unauthorized', { status: 401 })
    }

    const update = await req.json()
    const message = update?.message ?? update?.callback_query?.message
    const telegramUser = update?.message?.from ?? update?.callback_query?.from
    const chatId = message?.chat?.id
    const messageText = String(update?.message?.text ?? '')
    const callbackData = String(update?.callback_query?.data ?? '')
    const callbackQueryId = String(update?.callback_query?.id ?? '')
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
    const miniAppUrl = (Deno.env.get('MINI_APP_URL') ?? '').replace(/\/+$/, '')
    const channelUrl = Deno.env.get('TELEGRAM_CHANNEL_URL') ?? 'https://t.me/mochi_otp'
    const customerServiceUrl = Deno.env.get('TELEGRAM_CS_URL') ?? 'https://t.me/mochi_otp_support'

    if (!chatId) return new Response('OK', { status: 200 })
    if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN belum dikonfigurasi')
    if (!miniAppUrl) throw new Error('MINI_APP_URL belum dikonfigurasi')

    const supabase = getSupabase()

    if (callbackQueryId) {
      await answerCallbackQuery(botToken, callbackQueryId)
      try {
        if (callbackData === 'bot_balance') {
          await sendBalance(supabase, chatId, telegramUser)
        } else if (callbackData === 'bot_orders') {
          await sendActiveOrders(supabase, chatId, telegramUser)
        } else if (callbackData === 'bot_checkin') {
          await claimDailyCheckin(supabase, chatId, telegramUser)
        } else if (callbackData === 'ord:menu') {
          await sendOrderServerMenu(chatId, miniAppUrl)
        } else if (callbackData.startsWith('ord:')) {
          const [, action, providerKey, ...parts] = callbackData.split(':')
          if (action === 's' && isProviderKey(providerKey)) {
            await sendCountryMenu(supabase, chatId, providerKey, miniAppUrl)
          } else if (action === 'c' && isProviderKey(providerKey)) {
            await sendServiceMenu(chatId, providerKey, parts[0] || 'all', miniAppUrl)
          } else if (action === 'v' && isProviderKey(providerKey)) {
            await sendPriceMenu(chatId, providerKey, parts[0] || 'all', parts[1], miniAppUrl)
          } else if (action === 'b' && isProviderKey(providerKey)) {
            await buyBotProduct(supabase, chatId, telegramUser, providerKey, parts, miniAppUrl)
          }
        }
      } catch (error) {
        console.error('telegram bot callback error:', error)
        await sendTelegramMessage(
          chatId,
          `Aksi bot gagal diproses: ${escapeHtml(error instanceof Error ? error.message : 'Terjadi kesalahan')}`,
          { inline_keyboard: [[buildMiniAppButton(miniAppUrl)]] },
        )
      }
      return new Response('OK', { status: 200 })
    }

    const countrySearchMatch = messageText.match(/^\/negara([12])\s+(.+)/i)
    const serviceSearchMatch = messageText.match(/^\/layanan([12])\s+(.+)/i)

    if (countrySearchMatch) {
      await sendCountryMenu(
        supabase,
        chatId,
        getProviderKeyFromNumber(countrySearchMatch[1]),
        miniAppUrl,
        countrySearchMatch[2],
      )
    } else if (serviceSearchMatch) {
      await sendServiceMenu(
        chatId,
        getProviderKeyFromNumber(serviceSearchMatch[1]),
        'all',
        miniAppUrl,
        serviceSearchMatch[2],
      )
    } else if (messageText.startsWith('/order') || messageText.startsWith('/otp')) {
      await sendOrderServerMenu(chatId, miniAppUrl)
    } else if (messageText.startsWith('/admin')) {
      const telegramId = telegramUser?.id
      if (!isAdminTelegramId(telegramId)) {
        await sendTelegramMessage(
          chatId,
          `Akses admin ditolak.\n\nTelegram ID kamu: <code>${escapeHtml(telegramId ?? 'tidak ditemukan')}</code>\nTambahkan ID ini ke whitelist admin.`,
        )
      } else {
        await sendTelegramMessage(
          chatId,
          'Akses admin terverifikasi. Klik tombol di bawah untuk membuka panel admin.',
          {
            inline_keyboard: [
              [
                {
                  text: 'BUKA PANEL ADMIN',
                  web_app: { url: `${miniAppUrl}/admin` },
                },
              ],
            ],
          },
        )
      }
    } else if (messageText.startsWith('/saldo') || messageText.startsWith('/balance')) {
      await sendBalance(supabase, chatId, telegramUser)
    } else if (messageText.startsWith('/orders') || messageText.startsWith('/orderaktif')) {
      await sendActiveOrders(supabase, chatId, telegramUser)
    } else if (messageText.startsWith('/checkin')) {
      await claimDailyCheckin(supabase, chatId, telegramUser)
    } else if (messageText.startsWith('/start')) {
      await ensureUser(supabase, telegramUser)
      await sendStartMenu(chatId, telegramUser, miniAppUrl, channelUrl, customerServiceUrl)
    } else if (messageText.startsWith('/')) {
      await sendTelegramMessage(
        chatId,
        [
          'Command tersedia:',
          '/start - buka menu utama',
          '/order - order OTP via bot',
          '/negara1 indonesia - cari negara Server 1',
          '/negara2 united - cari negara Server 2',
          '/layanan1 whatsapp - cari layanan Server 1',
          '/layanan2 telegram - cari layanan Server 2',
          '/saldo - cek saldo',
          '/orders - lihat order aktif',
          '/checkin - ambil saldo harian',
          '/admin - buka panel admin',
        ].join('\n'),
      )
    }

    return new Response('OK', { status: 200 })
  } catch (error) {
    console.error(error)
    return new Response('Error', { status: 500 })
  }
})
