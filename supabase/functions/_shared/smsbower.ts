import { calculateUsdMochiPrice } from "./pricing.ts"

export const SMSBOWER_API_URL =
  Deno.env.get('SMSBOWER_API_URL') ?? 'https://smsbower.page/stubs/handler_api.php'

const getApiKey = () => {
  const apiKey = Deno.env.get('API_KEY_SMSBOWER') ?? ''
  if (!apiKey) throw new Error('API_KEY_SMSBOWER belum dikonfigurasi')
  return apiKey
}

const createUrl = (action: string, params: Record<string, string | number | undefined> = {}) => {
  const url = new URL(SMSBOWER_API_URL)
  url.searchParams.set('api_key', getApiKey())
  url.searchParams.set('action', action)

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }

  return url
}

export const fetchSmsText = async (
  action: string,
  params: Record<string, string | number | undefined> = {},
) => {
  let response: Response
  try {
    response = await fetch(createUrl(action, params), {
      signal: AbortSignal.timeout(12_000),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error('Server timeout saat memproses permintaan')
    }
    throw error
  }

  const text = (await response.text()).trim()
  if (!response.ok) throw new Error(`SMSBower HTTP ${response.status}: ${text}`)
  return text
}

export const fetchSmsJson = async (
  action: string,
  params: Record<string, string | number | undefined> = {},
) => {
  const text = await fetchSmsText(action, params)

  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Respons SMSBower tidak valid: ${text}`)
  }
}

export const parseSmsBowerNumberResponse = (text: string) => {
  if (text.startsWith('ACCESS_NUMBER:')) {
    const [, activationId, phoneNumber] = text.split(':')
    if (activationId && phoneNumber) return { activationId, phoneNumber }
  }

  try {
    const payload = JSON.parse(text)
    const candidates = [
      payload,
      Array.isArray(payload) ? payload[0] : undefined,
      payload?.data,
      Array.isArray(payload?.data) ? payload.data[0] : undefined,
      payload?.order,
      payload?.activation,
      payload?.data?.order,
      payload?.data?.activation,
    ]

    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object') continue

      const activationId =
        candidate.activationId ??
        candidate.activation_id ??
        candidate.activationID ??
        candidate.id
      const phoneNumber =
        candidate.phoneNumber ??
        candidate.phone_number ??
        candidate.phone ??
        candidate.number

      if (activationId !== undefined && phoneNumber !== undefined) {
        return {
          activationId: String(activationId),
          phoneNumber: String(phoneNumber),
        }
      }
    }

    const message = payload?.error?.message ?? payload?.message ?? payload?.error
    throw new Error(message ? String(message) : text)
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`SMSBower menolak pemesanan: ${text}`)
    }
    throw error
  }
}

export const normalizeCountries = (payload: any) => {
  const source = payload?.countries ?? payload

  return Object.entries(source ?? {})
    .filter(([, country]: [string, any]) => country && typeof country === 'object')
    .map(([id, country]: [string, any]) => ({
      id: String(country.id ?? id),
      name: String(country.eng ?? country.name ?? country.rus ?? `Country ${id}`),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export const normalizeServices = (payload: any) => {
  const source = payload?.services ?? payload
  const entries = Array.isArray(source)
    ? source.map((service: any) => [service.code, service])
    : Object.entries(source ?? {})

  return entries
    .map(([code, service]: [string, any]) => ({
      code: String(service?.code ?? code ?? ''),
      name: String(service?.name ?? service ?? code ?? ''),
    }))
    .filter((service) => service.code && service.name)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export const normalizePrices = (payload: any) => {
  const source = payload?.prices ?? payload
  const prices = []

  for (const [countryId, services] of Object.entries(source ?? {})) {
    if (!services || typeof services !== 'object') continue

    for (const [serviceCode, priceData] of Object.entries(services as Record<string, any>)) {
      const basePrice = Number((priceData as any)?.cost)
      const stock = Number((priceData as any)?.count)
      if (!Number.isFinite(basePrice) || !Number.isFinite(stock)) continue

      prices.push({
        countryId: String(countryId),
        serviceCode: String(serviceCode),
        basePrice,
        stock,
      })
    }
  }

  return prices
}

export const normalizePricesV2 = (payload: any) => {
  const source = payload?.prices ?? payload
  const prices = []

  for (const [countryId, services] of Object.entries(source ?? {})) {
    if (!services || typeof services !== 'object') continue

    for (const [serviceCode, priceTiers] of Object.entries(services as Record<string, any>)) {
      if (!priceTiers || typeof priceTiers !== 'object') continue

      for (const [priceKey, availableStock] of Object.entries(priceTiers as Record<string, any>)) {
        const basePrice = Number(priceKey)
        const stock = Number(availableStock)
        if (!Number.isFinite(basePrice) || !Number.isFinite(stock)) continue

        prices.push({
          countryId: String(countryId),
          serviceCode: String(serviceCode),
          basePrice,
          priceKey: String(priceKey),
          stock,
        })
      }
    }
  }

  return prices
}

export const calculateMochiPrice = (serviceCode: string, basePrice: number) => {
  return calculateUsdMochiPrice(serviceCode, basePrice)
}
