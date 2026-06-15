import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import {
  calculateMochiPrice,
  fetchSmsJson,
  fetchSmsText,
  normalizePricesV2,
  parseSmsBowerNumberResponse,
} from "../_shared/smsbower.ts"
import { calculateIdrMochiPrice } from "../_shared/pricing.ts"
import {
  cancelSmsCodeOrder,
  createSmsCodeOrder,
  encodeSmsCodeActivationId,
  getSmsCodeProducts,
} from "../_shared/smscode.ts"
import { getPublicProviderError } from "../_shared/public-error.ts"
import { getFeatureSetting, getProviderFeatureKey } from "../_shared/feature-settings.ts"

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
    const {
      userId,
      provider = 'smsbower',
      serviceCode,
      serviceId,
      countryId,
      serviceName,
      basePrice,
      productId,
      catalogProductId,
    } = await req.json()
    const requestedBasePrice = Number(basePrice)

    if (
      !userId ||
      !serviceCode ||
      countryId === undefined ||
      countryId === null
    ) {
      return jsonResponse({ error: 'Data pemesanan tidak lengkap' }, 400)
    }

    if (provider === 'smsbower' && !Number.isFinite(requestedBasePrice)) {
      return jsonResponse({ error: 'Pilihan harga Server tidak valid. Silakan pilih ulang.' }, 400)
    }
    if (provider === 'smscode' && (!serviceId || !productId || !catalogProductId)) {
      return jsonResponse({ error: 'Pilihan layanan Server tidak valid. Silakan pilih ulang.' }, 400)
    }
    if (!['smsbower', 'smscode'].includes(provider)) {
      return jsonResponse({ error: 'Server order tidak valid' }, 400)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )
    const feature = await getFeatureSetting(supabase, getProviderFeatureKey(provider))
    if (!feature.is_active) {
      return jsonResponse({
        error: feature.maintenance_message,
        maintenance: true,
      }, 503)
    }

    let price = 0
    let activationId = ''
    let phoneNumber = ''
    let cancelRemoteOrder: () => Promise<void> = async () => {}

    let smsBowerPrice
    let smsCodeProduct

    if (provider === 'smscode') {
      const products = await getSmsCodeProducts(serviceId, countryId)
      smsCodeProduct = products.find(
        (product: any) =>
          String(product.id) === String(productId) &&
          String(product.catalog_product_id) === String(catalogProductId) &&
          String(product.platform_id) === String(serviceId) &&
          String(product.country_id) === String(countryId) &&
          product.active !== false &&
          Number(product.available) > 0,
      )

      if (!smsCodeProduct) {
        return jsonResponse({
          error: 'Pilihan harga di Server sudah berubah atau stoknya habis. Silakan pilih ulang.',
        }, 409)
      }

      const basePriceIdr = Number(smsCodeProduct.price?.canonical_amount)
      if (!Number.isFinite(basePriceIdr)) {
        return jsonResponse({ error: 'Harga dari Server tidak valid. Silakan pilih ulang.' }, 400)
      }
      if (
        Number.isFinite(requestedBasePrice) &&
        Math.abs(Number(smsCodeProduct.price?.amount) - requestedBasePrice) > 1e-9
      ) {
        return jsonResponse({ error: 'Harga di Server berubah. Silakan pilih ulang layanan.' }, 409)
      }
      price = calculateIdrMochiPrice(serviceCode, basePriceIdr)
    } else {
      const pricesPayload = await fetchSmsJson('getPricesV2', {
        service: serviceCode,
        country: countryId,
      })
      smsBowerPrice = normalizePricesV2(pricesPayload).find(
        (item) =>
          item.serviceCode === String(serviceCode) &&
          item.countryId === String(countryId) &&
          Math.abs(item.basePrice - requestedBasePrice) < 1e-9 &&
          item.stock > 0,
      )

      if (!smsBowerPrice) return jsonResponse({ error: 'Stok nomor sedang kosong' }, 400)
      price = calculateMochiPrice(smsBowerPrice.serviceCode, smsBowerPrice.basePrice)
    }

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('balance')
      .eq('id', userId)
      .single()

    if (userError || !userData) return jsonResponse({ error: 'User tidak ditemukan di sistem' }, 404)

    const currentBalance = Number(userData.balance)
    if (currentBalance < price) return jsonResponse({ error: 'Saldo kamu tidak cukup untuk order ini' }, 400)

    if (provider === 'smscode') {
      const smsCodeOrder = await createSmsCodeOrder(
        smsCodeProduct.id,
        `mochi_${userId}_${crypto.randomUUID().replaceAll('-', '')}`,
      )
      const actualBasePriceIdr = Number(
        smsCodeOrder.amount?.canonical_amount ??
        smsCodeOrder.amount?.canonicalAmount ??
        smsCodeProduct.price?.canonical_amount,
      )
      const actualPrice = calculateIdrMochiPrice(serviceCode, actualBasePriceIdr)

      if (!Number.isFinite(actualBasePriceIdr) || actualPrice > price) {
        await cancelSmsCodeOrder(smsCodeOrder.id).catch(() => null)
        return jsonResponse({ error: 'Harga di Server berubah. Silakan pilih ulang layanan.' }, 409)
      }

      price = actualPrice
      activationId = encodeSmsCodeActivationId(smsCodeOrder.id)
      phoneNumber = String(smsCodeOrder.phone_number ?? '')
      if (!phoneNumber) {
        await cancelSmsCodeOrder(smsCodeOrder.id).catch(() => null)
        return jsonResponse({ error: 'Server tidak mengembalikan nomor telepon. Silakan coba lagi.' }, 502)
      }
      cancelRemoteOrder = async () => {
        const canceledOrder = await cancelSmsCodeOrder(smsCodeOrder.id)
        if (String(canceledOrder?.status).toUpperCase() !== 'CANCELED') {
          throw new Error('Server menolak pembatalan order')
        }
      }
    } else {
      const smsText = await fetchSmsText('getNumberV2', {
        service: serviceCode,
        country: countryId,
        maxPrice: smsBowerPrice.priceKey,
        minPrice: smsBowerPrice.priceKey,
        userID: userId,
      })

      const remoteOrder = parseSmsBowerNumberResponse(smsText)
      activationId = remoteOrder.activationId
      phoneNumber = remoteOrder.phoneNumber
      cancelRemoteOrder = async () => {
        const response = await fetchSmsText('setStatus', { status: 8, id: activationId })
        if (response !== 'ACCESS_CANCEL') {
          throw new Error(`Server menolak pembatalan: ${response}`)
        }
      }
    }

    const { data: existingActivation } = await supabase
      .from('orders')
      .select('*')
      .eq('user_id', userId)
      .eq('activation_id', activationId)
      .maybeSingle()

    if (existingActivation) return jsonResponse({ success: true, order: existingActivation })

    const newBalance = currentBalance - price
    const { error: updateError } = await supabase
      .from('users')
      .update({ balance: newBalance })
      .eq('id', userId)

    if (updateError) {
      const canceled = await cancelRemoteOrder().then(() => true).catch(() => false)
      return jsonResponse({
        error: canceled
          ? 'Saldo gagal diproses dan nomor pusat sudah dibatalkan. Silakan coba lagi.'
          : `Nomor sudah dipesan di server pusat tetapi saldo gagal diproses. Hubungi admin dengan ID aktivasi ${activationId}.`,
        remoteOrderCreated: !canceled,
        activationId: canceled ? undefined : activationId,
      }, 500)
    }

    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .insert({
        user_id: userId,
        service_name: serviceName || String(serviceCode).toUpperCase(),
        phone_number: phoneNumber,
        activation_id: activationId,
        status: 'active',
        price,
      })
      .select()
      .single()

    if (orderError) {
      const { data: existingOrder } = await supabase
        .from('orders')
        .select('*')
        .eq('user_id', userId)
        .eq('activation_id', activationId)
        .maybeSingle()

      if (existingOrder) return jsonResponse({ success: true, order: existingOrder })

      const { data: recoveredOrder } = await supabase
        .from('orders')
        .insert({
          user_id: userId,
          service_name: serviceName || String(serviceCode).toUpperCase(),
          phone_number: phoneNumber,
          activation_id: activationId,
          status: 'active',
          price,
        })
        .select()
        .maybeSingle()

      if (recoveredOrder) return jsonResponse({ success: true, order: recoveredOrder })

      await supabase.from('users').update({ balance: currentBalance }).eq('id', userId)
      const canceled = await cancelRemoteOrder().then(() => true).catch(() => false)

      return jsonResponse({
        error: canceled
          ? 'Order lokal gagal disimpan dan nomor pusat sudah dibatalkan. Silakan coba lagi.'
          : `Nomor sudah dipesan di server pusat tetapi gagal disimpan. Hubungi admin dengan ID aktivasi ${activationId}.`,
        remoteOrderCreated: !canceled,
        activationId: canceled ? undefined : activationId,
      }, 500)
    }

    return jsonResponse({ success: true, order: orderData })
  } catch (error) {
    console.error('buy-number provider error:', error)
    return jsonResponse({
      error: getPublicProviderError(error, 'Order gagal diproses oleh Server. Silakan coba lagi.'),
    }, 500)
  }
})
