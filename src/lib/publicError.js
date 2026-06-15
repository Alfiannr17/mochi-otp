const includesAny = (value, patterns) => patterns.some((pattern) => value.includes(pattern));

export const sanitizePublicError = (message, fallback = 'Server sedang mengalami gangguan. Silakan coba lagi.') => {
  const rawMessage = String(message || '').trim();
  const normalized = rawMessage.toUpperCase();

  if (!rawMessage || normalized.includes('EDGE FUNCTION RETURNED A NON-2XX')) return fallback;

  if (includesAny(normalized, [
    'NO_NUMBERS',
    'NO NUMBER',
    'NO_AVAILABLE',
    'NO AVAILABLE',
    'NO_OFFERS',
    'NO OFFERS',
    'NO_MATCHING_OFFER',
    'NO MATCHING OFFER',
    'OFFER_NOT_FOUND',
    'OFFER NOT FOUND',
    'OUT_OF_STOCK',
  ])) {
    return 'Nomor untuk layanan ini sedang tidak tersedia di Server. Silakan pilih negara atau pilihan harga lain.';
  }
  if (includesAny(normalized, [
    'NO_BALANCE',
    'INSUFFICIENT',
    'NOT ENOUGH BALANCE',
    'BALANCE_TOO_LOW',
    'BALANCE TOO LOW',
    'NOT_ENOUGH_FUNDS',
  ])) {
    return 'Saldo operasional Server sedang tidak cukup. Silakan hubungi admin.';
  }
  if (includesAny(normalized, ['BAD_SERVICE', 'INVALID_SERVICE', 'SERVICE_NOT_FOUND'])) {
    return 'Layanan tidak tersedia di Server. Silakan pilih layanan lain.';
  }
  if (includesAny(normalized, ['BAD_COUNTRY', 'INVALID_COUNTRY', 'COUNTRY_NOT_FOUND'])) {
    return 'Negara tidak tersedia di Server. Silakan pilih negara lain.';
  }
  if (includesAny(normalized, ['MAX_PRICE', 'MIN_PRICE', 'PRICE_CHANGED', 'PRICE TOO HIGH', 'PRICE_TOO_HIGH', 'PRICE_LIMIT_EXCEEDED'])) {
    return 'Harga di Server telah berubah. Silakan pilih ulang layanan.';
  }
  if (includesAny(normalized, ['BAD_KEY', 'API_KEY', 'UNAUTHORIZED', 'FORBIDDEN', 'INVALID TOKEN', 'INVALID CREDENTIAL', 'AUTHENTICATION'])) {
    return 'Server sedang mengalami gangguan autentikasi. Silakan hubungi admin.';
  }
  if (includesAny(normalized, ['VALIDATION', 'INVALID REQUEST', 'UNPROCESSABLE', 'CATALOG_PRODUCT', 'PRODUCT_NOT_FOUND', 'PRODUCT_INACTIVE'])) {
    return 'Pilihan nomor dari Server sudah tidak valid. Silakan kembali dan pilih ulang.';
  }
  if (includesAny(normalized, ['FX_RATE_UNAVAILABLE', 'EXCHANGE RATE'])) {
    return 'Kurs mata uang Server sedang belum tersedia. Silakan coba lagi beberapa saat.';
  }
  if (includesAny(normalized, ['REQUEST_IN_PROGRESS', 'IDEMPOTENCY_KEY_REUSED'])) {
    return 'Permintaan order sebelumnya masih diproses Server. Silakan tunggu sebentar lalu cek riwayat order.';
  }
  if (includesAny(normalized, ['TIMEOUT', 'NETWORK', 'FETCH FAILED', 'HTTP 5'])) {
    return 'Server sedang sulit dihubungi. Silakan coba lagi beberapa saat.';
  }

  const sanitized = rawMessage
    .replace(/SMSBower/gi, 'Server')
    .replace(/SMSCode(?:\.gg)?/gi, 'Server')
    .replace(/Pakasir/gi, 'Server pembayaran');

  if (sanitized.includes('_') && /^[A-Z0-9_:\s.-]+$/i.test(sanitized)) return fallback;
  return sanitized;
};
