export const RESEND_PENDING_CODE = '__MOCHI_WAITING_RESEND__'
const OTP_STATE_PREFIX = '__MOCHI_OTP_STATE__:'

export type OtpState = {
  codes: string[]
  waiting: boolean
}

export const parseOtpState = (value: unknown): OtpState => {
  const smsCode = String(value ?? '')
  if (!smsCode) return { codes: [], waiting: false }
  if (smsCode === RESEND_PENDING_CODE) return { codes: [], waiting: true }

  if (smsCode.startsWith(OTP_STATE_PREFIX)) {
    try {
      const state = JSON.parse(smsCode.slice(OTP_STATE_PREFIX.length))
      return {
        codes: Array.isArray(state?.codes)
          ? state.codes.map((code: unknown) => String(code)).filter(Boolean)
          : [],
        waiting: Boolean(state?.waiting),
      }
    } catch {
      return { codes: [], waiting: false }
    }
  }

  return { codes: [smsCode], waiting: false }
}

export const serializeOtpState = (state: OtpState) =>
  `${OTP_STATE_PREFIX}${JSON.stringify({
    codes: state.codes.map((code) => String(code)).filter(Boolean),
    waiting: Boolean(state.waiting),
  })}`

export const appendOtpCode = (value: unknown, code: string) => {
  const state = parseOtpState(value)
  const normalizedCode = String(code).trim()
  if (!normalizedCode || state.codes.at(-1) === normalizedCode) return state

  return {
    codes: [...state.codes, normalizedCode],
    waiting: false,
  }
}
