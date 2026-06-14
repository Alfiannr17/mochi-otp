const includesAny = (value, patterns) => patterns.some((pattern) => value.includes(pattern));

export const sanitizePublicError = (message, fallback = 'Server sedang mengalami gangguan. Silakan coba lagi.') => {
  const rawMessage = String(message || '').trim();
  const normalized = rawMessage.toUpperCase();

  if (!rawMessage || normalized.includes('EDGE FUNCTION RETURNED A NON-2XX')) return fallback;

  if (includesAny(normalized, ['NO_NUMBERS', 'NO NUMBER', 'NO AVAILABLE', 'OUT_OF_STOCK'])) {
    return 'Nomor untuk layanan ini sedang tidak tersedia di Server. Silakan pilih negara atau pilihan harga lain.';
  }
  if (includesAny(normalized, ['NO_BALANCE', 'INSUFFICIENT', 'NOT ENOUGH BALANCE'])) {
    return 'Server sedang tidak dapat memproses pesanan saat ini. Silakan coba lagi nanti.';
  }
  if (includesAny(normalized, ['BAD_SERVICE', 'INVALID_SERVICE', 'SERVICE_NOT_FOUND'])) {
    return 'Layanan tidak tersedia di Server. Silakan pilih layanan lain.';
  }
  if (includesAny(normalized, ['BAD_COUNTRY', 'INVALID_COUNTRY', 'COUNTRY_NOT_FOUND'])) {
    return 'Negara tidak tersedia di Server. Silakan pilih negara lain.';
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
