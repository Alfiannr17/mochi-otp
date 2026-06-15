import { parseOtpState } from './otpHistory';

const OTP_SOUND_URL = '/audio/otp-notification.mp3';
const SEEN_OTP_STORAGE_KEY = 'mochi_seen_otp_codes_v1';

let otpAudio = null;
let audioPrimed = false;

const getAudio = () => {
  if (!otpAudio) {
    otpAudio = new Audio(OTP_SOUND_URL);
    otpAudio.preload = 'auto';
  }
  return otpAudio;
};

const readSeenOtpCodes = () => {
  try {
    return JSON.parse(window.sessionStorage.getItem(SEEN_OTP_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
};

const writeSeenOtpCodes = (seenCodes) => {
  try {
    window.sessionStorage.setItem(SEEN_OTP_STORAGE_KEY, JSON.stringify(seenCodes));
  } catch {
    // Notification audio can still work while storage is unavailable.
  }
};

const normalizeCodes = (codes) => [...new Set(
  (codes || []).map((code) => String(code).trim()).filter(Boolean),
)];

const playOtpSound = async () => {
  try {
    const audio = getAudio();
    audio.muted = false;
    audio.currentTime = 0;
    await audio.play();
    return true;
  } catch (error) {
    console.warn('Notifikasi suara OTP diblokir oleh perangkat:', error);
    return false;
  }
};

export const primeOtpNotificationSound = async () => {
  if (audioPrimed) return;

  try {
    const audio = getAudio();
    audio.muted = true;
    await audio.play();
    audio.pause();
    audio.currentTime = 0;
    audio.muted = false;
    audioPrimed = true;
  } catch {
    // Some Telegram clients unlock audio only after another user interaction.
  }
};

export const markOtpCodesSeen = (orderId, codes = []) => {
  if (!orderId) return;
  const seenCodes = readSeenOtpCodes();
  seenCodes[String(orderId)] = normalizeCodes(codes);
  writeSeenOtpCodes(seenCodes);
};

export const notifyNewOtpCodes = async (orderId, codes = []) => {
  if (!orderId) return false;

  const key = String(orderId);
  const nextCodes = normalizeCodes(codes);
  const seenCodes = readSeenOtpCodes();
  const wasTracked = Object.prototype.hasOwnProperty.call(seenCodes, key);
  const previousCodeList = normalizeCodes(seenCodes[key]);
  const previousCodes = new Set(previousCodeList);
  const hasNewCode = wasTracked && nextCodes.some((code) => !previousCodes.has(code));

  seenCodes[key] = normalizeCodes([...previousCodeList, ...nextCodes]);
  writeSeenOtpCodes(seenCodes);

  if (hasNewCode) await playOtpSound();
  return hasNewCode;
};

export const syncOtpNotifications = async (orders = []) => {
  const seenCodes = readSeenOtpCodes();
  let hasNewCode = false;

  orders.forEach((order) => {
    if (!order?.id) return;
    const key = String(order.id);
    const nextCodes = normalizeCodes(parseOtpState(order.sms_code).codes);

    if (Object.prototype.hasOwnProperty.call(seenCodes, key)) {
      const previousCodeList = normalizeCodes(seenCodes[key]);
      const previousCodes = new Set(previousCodeList);
      if (nextCodes.some((code) => !previousCodes.has(code))) hasNewCode = true;
      seenCodes[key] = normalizeCodes([...previousCodeList, ...nextCodes]);
      return;
    }

    seenCodes[key] = nextCodes;
  });

  writeSeenOtpCodes(seenCodes);
  if (hasNewCode) await playOtpSound();
  return hasNewCode;
};
