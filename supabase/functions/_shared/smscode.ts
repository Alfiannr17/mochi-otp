const SMSCODE_API_URL = 'https://api.smscode.gg/v2'

const getApiToken = () => {
  const token = Deno.env.get('API_KEY_SMSCODE') ?? ''
  if (!token) throw new Error('API_KEY_SMSCODE belum dikonfigurasi')
  return token
}

const parseResponse = async (response: Response) => {
  const text = await response.text()
  let payload

  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`Respons SMSCode tidak valid: ${text}`)
  }

  if (!response.ok || payload?.success === false) {
    throw new Error(
      payload?.error?.message ??
      payload?.message ??
      payload?.error?.code ??
      `SMSCode HTTP ${response.status}`,
    )
  }

  return payload
}

export const fetchSmsCode = async (
  path: string,
  options: {
    method?: string
    query?: Record<string, string | number | undefined>
    body?: Record<string, unknown>
    idempotencyKey?: string
  } = {},
) => {
  const url = new URL(`${SMSCODE_API_URL}${path}`)

  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${getApiToken()}`,
  }

  if (options.body) headers['Content-Type'] = 'application/json'
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey

  let response: Response
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(12_000),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error('Server timeout saat memproses permintaan')
    }
    throw error
  }

  return parseResponse(response)
}

export const getSmsCodeCatalog = async () => {
  const [countriesPayload, servicesPayload] = await Promise.all([
    fetchSmsCode('/catalog/countries'),
    fetchSmsCode('/catalog/services'),
  ])

  return {
    countries: (countriesPayload?.data ?? [])
      .map((country: any) => ({
        id: String(country.id),
        name: String(country.name ?? country.code ?? `Country ${country.id}`),
      }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name)),
    services: (servicesPayload?.data ?? [])
      .filter((service: any) => service.active !== false)
      .map((service: any) => ({
        id: String(service.id),
        code: String(service.code ?? service.id),
        name: String(service.name ?? service.code ?? service.id),
      }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name)),
  }
}

export const getSmsCodeProducts = async (
  serviceId: string | number,
  countryId?: string | number,
) => {
  const payload = await fetchSmsCode('/catalog/products', {
    query: {
      platform_id: serviceId,
      country_id: countryId,
      sort: 'price_asc',
      limit: 10_000,
    },
  })

  return payload?.data ?? []
}

export const createSmsCodeOrder = async (
  catalogProductId: string | number,
  maxPrice: string,
  idempotencyKey: string,
) => {
  const payload = await fetchSmsCode('/orders/create', {
    method: 'POST',
    idempotencyKey,
    body: {
      catalog_product_id: Number(catalogProductId),
      max_price: maxPrice,
      policy: 'cheapest',
      quantity: 1,
    },
  })

  const order = payload?.data?.orders?.[0]
  if (!order) throw new Error('SMSCode tidak mengembalikan nomor')
  return order
}

export const getSmsCodeOrder = async (orderId: string | number) => {
  const payload = await fetchSmsCode(`/orders/${encodeURIComponent(String(orderId))}`)
  return payload?.data
}

export const cancelSmsCodeOrder = async (orderId: string | number) => {
  const payload = await fetchSmsCode('/orders/cancel', {
    method: 'POST',
    body: { id: Number(orderId) },
  })
  return payload?.data
}

export const resendSmsCodeOrder = async (orderId: string | number) => {
  const payload = await fetchSmsCode('/orders/resend', {
    method: 'POST',
    body: { id: Number(orderId) },
  })
  return payload?.data
}

export const finishSmsCodeOrder = async (orderId: string | number) => {
  const payload = await fetchSmsCode('/orders/finish', {
    method: 'POST',
    body: { id: Number(orderId) },
  })
  return payload?.data
}

export const encodeSmsCodeActivationId = (orderId: string | number) => `smscode:${orderId}`

export const parseActivationId = (activationId: string | number) => {
  const value = String(activationId)
  if (value.startsWith('smscode:')) {
    return { provider: 'smscode', id: value.slice('smscode:'.length) }
  }
  return { provider: 'smsbower', id: value }
}
