export const RESEND_PENDING_CODE = '__MOCHI_WAITING_RESEND__'
const OTP_STATE_PREFIX = '__MOCHI_OTP_STATE__:'

export type OtpState = {
  codes: string[]
  messages: (string | null)[]
  waiting: boolean
}

const normalizeMessage = (value: unknown) => {
  const message = String(value ?? '').trim()
  return message || null
}

export const parseOtpState = (value: unknown): OtpState => {
  const smsCode = String(value ?? '')
  if (!smsCode) return { codes: [], messages: [], waiting: false }
  if (smsCode === RESEND_PENDING_CODE) return { codes: [], messages: [], waiting: true }

  if (smsCode.startsWith(OTP_STATE_PREFIX)) {
    try {
      const state = JSON.parse(smsCode.slice(OTP_STATE_PREFIX.length))
      const codes = Array.isArray(state?.codes)
        ? state.codes.map((code: unknown) => String(code)).filter(Boolean)
        : []
      return {
        codes,
        messages: codes.map((_: string, index: number) =>
          normalizeMessage(Array.isArray(state?.messages) ? state.messages[index] : null)
        ),
        waiting: Boolean(state?.waiting),
      }
    } catch {
      return { codes: [], messages: [], waiting: false }
    }
  }

  return { codes: [smsCode], messages: [null], waiting: false }
}

export const serializeOtpState = (state: OtpState) =>
  `${OTP_STATE_PREFIX}${JSON.stringify({
    codes: state.codes.map((code) => String(code)).filter(Boolean),
    messages: state.codes.map((_, index) => normalizeMessage(state.messages?.[index])),
    waiting: Boolean(state.waiting),
  })}`

export const appendOtpCode = (value: unknown, code: string, message: unknown = null) => {
  const state = parseOtpState(value)
  const normalizedCode = String(code).trim()
  const normalizedMessage = normalizeMessage(message)
  if (!normalizedCode) return state

  if (state.codes.at(-1) === normalizedCode) {
    const messages = [...state.messages]
    if (normalizedMessage) messages[messages.length - 1] = normalizedMessage
    return { ...state, messages }
  }

  return {
    codes: [...state.codes, normalizedCode],
    messages: [...state.messages, normalizedMessage],
    waiting: false,
  }
}
