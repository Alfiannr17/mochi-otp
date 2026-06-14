const includesAny = (value: string, patterns: string[]) =>
  patterns.some((pattern) => value.includes(pattern))

export const getPublicProviderError = (
  error: unknown,
  fallback = 'Server sedang mengalami gangguan. Silakan coba lagi beberapa saat.',
) => {
  const rawMessage = error instanceof Error ? error.message : String(error ?? '')
  const message = rawMessage.toUpperCase()

  if (includesAny(message, [
    'NO_NUMBERS',
    'NO NUMBER',
    'NO AVAILABLE',
    'NOT AVAILABLE',
    'OUT_OF_STOCK',
    'OUT OF STOCK',
  ])) {
    return 'Nomor untuk layanan ini sedang tidak tersedia di Server. Silakan pilih negara atau pilihan harga lain.'
  }

  if (includesAny(message, ['NO_BALANCE', 'INSUFFICIENT', 'NOT ENOUGH BALANCE'])) {
    return 'Server sedang tidak dapat memproses pesanan saat ini. Silakan coba lagi nanti.'
  }

  if (includesAny(message, ['BAD_SERVICE', 'INVALID_SERVICE', 'SERVICE_NOT_FOUND'])) {
    return 'Layanan tidak tersedia di Server. Silakan pilih layanan lain.'
  }

  if (includesAny(message, ['BAD_COUNTRY', 'INVALID_COUNTRY', 'COUNTRY_NOT_FOUND'])) {
    return 'Negara tidak tersedia di Server. Silakan pilih negara lain.'
  }

  if (includesAny(message, ['MAX_PRICE', 'MIN_PRICE', 'PRICE_CHANGED', 'PRICE CHANGED', 'PRICE EXCEEDED'])) {
    return 'Harga di Server telah berubah. Silakan pilih ulang layanan.'
  }

  if (includesAny(message, ['BAD_KEY', 'API_KEY', 'UNAUTHORIZED', 'FORBIDDEN', 'INVALID TOKEN'])) {
    return 'Server sedang mengalami gangguan autentikasi. Silakan hubungi admin.'
  }

  if (includesAny(message, ['TOO_MANY', 'RATE LIMIT', 'LIMIT_EXCEEDED', 'LIMIT EXCEEDED'])) {
    return 'Batas permintaan ke Server sedang tercapai. Silakan coba lagi beberapa saat.'
  }

  if (includesAny(message, ['RESEND', 'CANNOT_RESEND', 'CANNOT RESEND', 'RETRY_GET', 'RETRY GET'])) {
    return 'Server belum dapat meminta OTP baru. Silakan coba lagi beberapa saat.'
  }

  if (includesAny(message, ['TIMEOUT', 'TIMED OUT', 'NETWORK', 'FETCH FAILED', 'NO_CONNECTION', 'HTTP 5'])) {
    return 'Server sedang sulit dihubungi. Silakan coba lagi beberapa saat.'
  }

  if (includesAny(message, ['STATUS_CANCEL', 'EXPIRED', 'NO_ACTIVATION', 'ORDER_NOT_FOUND', 'ORDER NOT FOUND'])) {
    return 'Order sudah berakhir di Server.'
  }

  if (includesAny(message, ['CANCEL', 'CANNOT_CANCEL', 'CANNOT CANCEL', 'REFUND'])) {
    return 'Server menolak pembatalan order. Silakan coba lagi beberapa saat.'
  }

  if (includesAny(message, ['BAD_STATUS', 'WRONG_STATUS', 'INVALID_STATUS'])) {
    return 'Status order di Server sudah berubah. Silakan buka ulang riwayat order.'
  }

  if (includesAny(message, ['ACCOUNT_INACTIVE', 'BANNED', 'BLOCKED'])) {
    return 'Server sedang tidak dapat memproses permintaan. Silakan hubungi admin.'
  }

  return fallback
}
