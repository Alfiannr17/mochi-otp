import { fetchSmsText } from "./smsbower.ts"
import { getSmsCodeOrder, parseActivationId } from "./smscode.ts"
import { cancelAndRefundOrder, expireOrderIfNeeded } from "./order-expiry.ts"
import { appendOtpCode, parseOtpState, serializeOtpState } from "./otp-history.ts"
import { getPublicProviderError } from "./public-error.ts"

const updateOrder = async (supabase: any, order: any, values: Record<string, unknown>) => {
  const { data, error } = await supabase
    .from('orders')
    .update(values)
    .eq('id', order.id)
    .select('*')
    .single()

  if (error) throw error
  return data
}

const extractSmsCodeOtps = (remoteOrder: any) => {
  const candidates = [
    remoteOrder?.otp_code,
    remoteOrder?.sms_code,
    remoteOrder?.otp,
    remoteOrder?.otp?.code,
    remoteOrder?.sms?.code,
    ...(Array.isArray(remoteOrder?.messages)
      ? remoteOrder.messages.flatMap((message: any) => [
        message?.otp_code,
        message?.sms_code,
        message?.otp,
        message?.code,
      ])
      : []),
  ]

  return candidates
    .filter((code) => ['string', 'number'].includes(typeof code))
    .map((code) => String(code).trim())
    .filter(Boolean)
}

const saveOtpCodes = async (supabase: any, order: any, codes: string[]) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: latestOrder, error: latestError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', order.id)
      .single()

    if (latestError) throw latestError

    let state = parseOtpState(latestOrder.sms_code)
    for (const code of codes) state = appendOtpCode(serializeOtpState(state), code)

    const serializedState = serializeOtpState(state)
    if (serializedState === latestOrder.sms_code) return latestOrder

    let updateQuery = supabase
      .from('orders')
      .update({ sms_code: serializedState })
      .eq('id', order.id)
      .eq('status', 'active')

    updateQuery = latestOrder.sms_code === null
      ? updateQuery.is('sms_code', null)
      : updateQuery.eq('sms_code', latestOrder.sms_code)

    const { data: updatedOrder, error: updateError } = await updateQuery
      .select('*')
      .maybeSingle()

    if (updateError) throw updateError
    if (updatedOrder) return updatedOrder
  }

  throw new Error('Riwayat OTP sedang diperbarui. Sistem akan mencoba kembali.')
}

const cancelOrderFromProvider = async (supabase: any, order: any) => {
  const otpState = parseOtpState(order.sms_code)
  if (otpState.codes.length === 0) {
    const refunded = await cancelAndRefundOrder(supabase, order.id)
    if (refunded) return { ...order, status: 'canceled' }
  }

  return updateOrder(supabase, order, { status: 'canceled' })
}

export const syncOrderProviderStatus = async (supabase: any, originalOrder: any) => {
  const order = await expireOrderIfNeeded(supabase, originalOrder)
  if (order?.status !== 'active') return { order }

  const otpState = parseOtpState(order.sms_code)
  if (otpState.codes.length > 0 && !otpState.waiting) return { order }

  try {
    const remoteActivation = parseActivationId(order.activation_id)

    if (remoteActivation.provider === 'smscode') {
      const remoteOrder = await getSmsCodeOrder(remoteActivation.id)
      const remoteStatus = String(remoteOrder?.status ?? '').toUpperCase()
      const remoteCodes = extractSmsCodeOtps(remoteOrder)
      let syncedOrder = remoteCodes.length > 0
        ? await saveOtpCodes(supabase, order, remoteCodes)
        : order

      if (remoteStatus === 'COMPLETED') {
        syncedOrder = await updateOrder(supabase, syncedOrder, { status: 'completed' })
      } else if (remoteStatus === 'CANCELED' || remoteStatus === 'EXPIRED') {
        syncedOrder = await cancelOrderFromProvider(supabase, syncedOrder)
      }

      return { order: syncedOrder }
    }

    const remoteStatus = await fetchSmsText('getStatus', { id: remoteActivation.id })
    if (remoteStatus.startsWith('STATUS_OK:')) {
      return {
        order: await saveOtpCodes(
          supabase,
          order,
          [remoteStatus.slice('STATUS_OK:'.length)],
        ),
      }
    }

    if (remoteStatus === 'STATUS_CANCEL') {
      return { order: await cancelOrderFromProvider(supabase, order) }
    }

    return { order }
  } catch (error) {
    console.error(`Gagal sinkron status provider order ${order.id}:`, error)
    return {
      order,
      providerError: getPublicProviderError(
        error,
        'Status order belum dapat disinkronkan. Sistem akan mencoba kembali.',
      ),
    }
  }
}
