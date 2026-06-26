import { appendOtpCode, parseOtpState, serializeOtpState } from "./otp-history.ts"

type WebhookOtpEntry = {
  code: string
  message?: string | null
}

type WebhookOtpResult =
  | {
    ok: true
    order: any
    isNewCode: boolean
    codes: string[]
    messages: (string | null)[]
  }
  | {
    ok: false
    reason: string
  }

const normalizeCode = (value: unknown) => String(value ?? '').trim()

const getOrderByActivation = async (supabase: any, activationVariants: string[]) => {
  const variants = [...new Set(activationVariants.map((item) => String(item).trim()).filter(Boolean))]
  if (variants.length === 0) return null

  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .in('activation_id', variants)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data
}

export const appendOrderOtpFromWebhook = async (
  supabase: any,
  activationVariants: string[],
  entry: WebhookOtpEntry,
): Promise<WebhookOtpResult> => {
  const code = normalizeCode(entry.code)
  if (!code) return { ok: false, reason: 'missing_code' }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const order = await getOrderByActivation(supabase, activationVariants)
    if (!order) return { ok: false, reason: 'order_not_found' }

    const previousState = parseOtpState(order.sms_code)
    const nextState = appendOtpCode(order.sms_code, code, entry.message)
    const serializedState = serializeOtpState(nextState)
    const isNewCode = !previousState.codes.includes(code)

    if (serializedState === order.sms_code) {
      return {
        ok: true,
        order,
        isNewCode,
        codes: nextState.codes,
        messages: nextState.messages,
      }
    }

    let updateQuery = supabase
      .from('orders')
      .update({ sms_code: serializedState })
      .eq('id', order.id)
      .eq('status', 'active')

    updateQuery = order.sms_code === null
      ? updateQuery.is('sms_code', null)
      : updateQuery.eq('sms_code', order.sms_code)

    const { data: updatedOrder, error } = await updateQuery
      .select('*')
      .maybeSingle()

    if (error) throw error
    if (updatedOrder) {
      return {
        ok: true,
        order: updatedOrder,
        isNewCode,
        codes: nextState.codes,
        messages: nextState.messages,
      }
    }
  }

  return { ok: false, reason: 'concurrent_update' }
}

export const maskActivationId = (value: unknown) => {
  const activationId = String(value ?? '')
  if (activationId.length <= 5) return activationId
  return `xxxxxx${activationId.slice(-5)}`
}
