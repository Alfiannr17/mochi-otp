import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import {
  calculateMochiPrice,
  fetchSmsJson,
  normalizeCountries,
  normalizePricesV2,
  normalizeServices,
} from "../_shared/smsbower.ts"
import { calculateIdrMochiPrice } from "../_shared/pricing.ts"
import { getSmsCodeCatalog, getSmsCodeProducts } from "../_shared/smscode.ts"
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
    const { action, provider = 'smsbower', serviceCode, serviceId, countryId } = await req.json()
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

    if (provider === 'smscode') {
      if (action === 'getCatalog') {
        const catalog = await getSmsCodeCatalog()
        return jsonResponse({ success: true, provider, ...catalog })
      }

      if (action === 'getPrices') {
        if (!serviceId) return jsonResponse({ error: 'ID layanan wajib diisi' }, 400)

        const [catalog, productsPayload] = await Promise.all([
          getSmsCodeCatalog(),
          getSmsCodeProducts(serviceId, countryId),
        ])
        const countryMap = Object.fromEntries(
          catalog.countries.map((country: any) => [country.id, country.name]),
        )
        const service = catalog.services.find((item: any) => item.id === String(serviceId))

        const products = productsPayload
          .filter((product: any) =>
            product.active !== false &&
            Number(product.available) > 0 &&
            String(product.platform_id) === String(serviceId) &&
            (!countryId || String(product.country_id) === String(countryId))
          )
          .map((product: any) => {
            const basePriceIdr = Number(product.price?.canonical_amount)
            const resolvedServiceCode = String(service?.code ?? serviceCode ?? product.platform_id)

            return {
              provider,
              productId: String(product.id),
              catalogProductId: String(product.catalog_product_id),
              countryId: String(product.country_id),
              serviceId: String(product.platform_id),
              serviceCode: resolvedServiceCode,
              basePrice: Number(product.price?.amount),
              basePriceIdr,
              maxPrice: String(product.price?.amount),
              stock: Number(product.available),
              countryName: countryMap[String(product.country_id)] ?? `Country ${product.country_id}`,
              serviceName: String(service?.name ?? product.name ?? resolvedServiceCode),
              mochiPrice: calculateIdrMochiPrice(resolvedServiceCode, basePriceIdr),
            }
          })
          .filter((product: any) =>
            Number.isFinite(product.basePriceIdr) &&
            Number.isFinite(product.basePrice) &&
            Number.isFinite(product.mochiPrice)
          )

        return jsonResponse({ success: true, provider, products })
      }

      return jsonResponse({ error: 'Action tidak valid' }, 400)
    }

    if (action === 'getCatalog') {
      const [countriesPayload, servicesPayload] = await Promise.all([
        fetchSmsJson('getCountries'),
        fetchSmsJson('getServicesList'),
      ])

      return jsonResponse({
        success: true,
        provider,
        countries: normalizeCountries(countriesPayload),
        services: normalizeServices(servicesPayload),
      })
    }

    if (action === 'getPrices') {
      if (!serviceCode) return jsonResponse({ error: 'Kode layanan wajib diisi' }, 400)

      const [pricesPayload, countriesPayload, servicesPayload] = await Promise.all([
        fetchSmsJson('getPricesV2', { service: serviceCode, country: countryId }),
        fetchSmsJson('getCountries'),
        fetchSmsJson('getServicesList'),
      ])

      const countryMap = Object.fromEntries(
        normalizeCountries(countriesPayload).map((country) => [country.id, country.name]),
      )
      const serviceMap = Object.fromEntries(
        normalizeServices(servicesPayload).map((service) => [service.code, service.name]),
      )

      const products = normalizePricesV2(pricesPayload)
        .filter((price) =>
          price.stock > 0 &&
          price.serviceCode === String(serviceCode) &&
          (!countryId || price.countryId === String(countryId))
        )
        .map((price) => ({
          ...price,
          countryName: countryMap[price.countryId] ?? `Country ${price.countryId}`,
          serviceName: serviceMap[price.serviceCode] ?? price.serviceCode.toUpperCase(),
          mochiPrice: calculateMochiPrice(price.serviceCode, price.basePrice),
        }))

      return jsonResponse({ success: true, provider, products })
    }

    return jsonResponse({ error: 'Action tidak valid' }, 400)
  } catch (error) {
    console.error('sms-catalog provider error:', error)
    return jsonResponse({
      error: getPublicProviderError(error, 'Katalog dari Server gagal dimuat. Silakan coba lagi.'),
    }, 500)
  }
})
