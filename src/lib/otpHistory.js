const RESEND_PENDING_CODE = '__MOCHI_WAITING_RESEND__';
const OTP_STATE_PREFIX = '__MOCHI_OTP_STATE__:';

export const parseOtpState = (value) => {
  const smsCode = String(value ?? '');
  if (!smsCode) return { codes: [], messages: [], waiting: false };
  if (smsCode === RESEND_PENDING_CODE) return { codes: [], messages: [], waiting: true };

  if (smsCode.startsWith(OTP_STATE_PREFIX)) {
    try {
      const state = JSON.parse(smsCode.slice(OTP_STATE_PREFIX.length));
      const codes = Array.isArray(state?.codes)
        ? state.codes.map((code) => String(code)).filter(Boolean)
        : [];
      return {
        codes,
        messages: codes.map((_, index) => {
          const message = Array.isArray(state?.messages) ? String(state.messages[index] ?? '').trim() : '';
          return message || null;
        }),
        waiting: Boolean(state?.waiting),
      };
    } catch {
      return { codes: [], messages: [], waiting: false };
    }
  }

  return { codes: [smsCode], messages: [null], waiting: false };
};

export const getLatestOtp = (value) => {
  const { codes } = parseOtpState(value);
  return codes.at(-1) || null;
};
