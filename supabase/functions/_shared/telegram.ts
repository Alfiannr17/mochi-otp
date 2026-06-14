const encoder = new TextEncoder()
const TELEGRAM_PUBLIC_KEY =
  'e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d'

const createHmac = async (key: Uint8Array, value: string) => {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(value)))
}

const toHex = (value: Uint8Array) =>
  Array.from(value).map((byte) => byte.toString(16).padStart(2, '0')).join('')

const isEqualHex = (left: string, right: string) => {
  if (left.length !== right.length) return false

  let result = 0
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return result === 0
}

const hexToBytes = (value: string) => {
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16)
  }
  return bytes
}

const base64UrlToBytes = (value: string) => {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
}

const verifyTelegramSignature = async (params: URLSearchParams, botId: string) => {
  const signature = params.get('signature')
  if (!signature || !botId) return false

  const dataCheckString = `${botId}:WebAppData\n${[...params.entries()]
    .filter(([key]) => key !== 'hash' && key !== 'signature')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}`

  const publicKey = await crypto.subtle.importKey(
    'raw',
    hexToBytes(TELEGRAM_PUBLIC_KEY),
    { name: 'Ed25519' },
    false,
    ['verify'],
  )

  return crypto.subtle.verify(
    { name: 'Ed25519' },
    publicKey,
    base64UrlToBytes(signature),
    encoder.encode(dataCheckString),
  )
}

export const validateTelegramInitData = async (initData: string) => {
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
  const params = new URLSearchParams(initData)
  const receivedHash = params.get('hash') ?? ''
  const authDate = Number(params.get('auth_date'))

  if (!receivedHash || !Number.isFinite(authDate)) {
    throw new Error('Data autentikasi Telegram tidak lengkap')
  }

  const ageInSeconds = Math.floor(Date.now() / 1000) - authDate
  if (ageInSeconds < 0 || ageInSeconds > 86_400) {
    throw new Error('Sesi Telegram sudah kedaluwarsa. Tutup lalu buka kembali Mini App.')
  }

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  let isValid = false
  if (botToken) {
    const secretKey = await createHmac(encoder.encode('WebAppData'), botToken)
    const calculatedHash = toHex(await createHmac(secretKey, dataCheckString))
    isValid = isEqualHex(calculatedHash, receivedHash.toLowerCase())
  }

  if (!isValid) {
    const botId = Deno.env.get('TELEGRAM_BOT_ID') ?? botToken.split(':')[0] ?? ''
    isValid = await verifyTelegramSignature(params, botId)
  }

  if (!isValid) throw new Error('Tanda tangan Telegram tidak valid')

  const userJson = params.get('user')
  if (!userJson) throw new Error('User Telegram tidak ditemukan')

  const user = JSON.parse(userJson)
  if (!Number.isSafeInteger(Number(user?.id))) throw new Error('ID user Telegram tidak valid')
  return user
}
