import { fetchSmsText } from "./smsbower.ts"
import {
  cancelSmsCodeOrder,
  finishSmsCodeOrder,
  getSmsCodeOrder,
  parseActivationId,
} from "./smscode.ts"
import {
  appendOtpCode,
  parseOtpState,
  serializeOtpState,
} from "./otp-history.ts"

export const SERVER1_ORDER_LIFETIME_MS = 25 * 60 * 1000
export const SERVER2_ORDER_LIFETIME_MS = 20 * 60 * 1000

export const getOrderLifetimeMs = (order: any) =>
  parseActivationId(order?.activation_id).provider === 'smscode'
    ? SERVER2_ORDER_LIFETIME_MS
    : SERVER1_ORDER_LIFETIME_MS

const saveOtp = async (supabase: any, order: any, code: string, message: unknown = null) => {
  const otpState = appendOtpCode(order.sms_code, code, message)
  const { error } = await supabase
    .from('orders')
    .update({ sms_code: serializeOtpState(otpState) })
    .eq('id', order.id)
    .eq('status', 'active')

  if (error) throw error
  return { ...order, sms_code: serializeOtpState(otpState) }
}

const markCompleted = async (supabase: any, order: any) => {
  const { error } = await supabase
    .from('orders')
    .update({ status: 'completed' })
    .eq('id', order.id)
    .eq('status', 'active')

  if (error) throw error
  return { ...order, status: 'completed' }
}

const finishRemoteOrder = async (order: any) => {
  const remoteActivation = parseActivationId(order.activation_id)

  if (remoteActivation.provider === 'smscode') {
    await finishSmsCodeOrder(remoteActivation.id).catch(() => null)
    return
  }

  await fetchSmsText('setStatus', { status: 6, id: remoteActivation.id }).catch(() => null)
}

export const cancelAndRefundOrder = async (supabase: any, orderId: string | number) => {
  const { data: canceledOrder, error: cancelError } = await supabase
    .from('orders')
    .update({ status: 'canceled' })
    .eq('id', orderId)
    .eq('status', 'active')
    .is('sms_code', null)
    .select('id, user_id, price')
    .maybeSingle()

  if (cancelError) throw cancelError
  if (!canceledOrder) return false

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('balance')
      .eq('id', canceledOrder.user_id)
      .single()

    if (userError || !user) break

    const currentBalance = Number(user.balance)
    const { data: creditedUser, error: balanceError } = await supabase
      .from('users')
      .update({ balance: currentBalance + Number(canceledOrder.price) })
      .eq('id', canceledOrder.user_id)
      .eq('balance', currentBalance)
      .select('id')
      .maybeSingle()

    if (balanceError) break
    if (creditedUser) return true
  }

  await supabase
    .from('orders')
    .update({ status: 'active' })
    .eq('id', orderId)
    .eq('status', 'canceled')

  throw new Error('Refund saldo gagal diproses. Sistem akan mencoba kembali.')
}

const refundExpiredOrder = async (supabase: any, order: any) => {
  const refunded = await cancelAndRefundOrder(supabase, order.id)
  return refunded ? { ...order, status: 'canceled' } : order
}

export const expireOrderIfNeeded = async (supabase: any, order: any) => {
  if (order?.status !== 'active' || !order?.created_at) {
    return order
  }

  const createdAt = new Date(order.created_at).getTime()
  if (!Number.isFinite(createdAt) || Date.now() < createdAt + getOrderLifetimeMs(order)) {
    return order
  }

  if (parseOtpState(order.sms_code).codes.length > 0) {
    await finishRemoteOrder(order)
    return markCompleted(supabase, order)
  }

  const remoteActivation = parseActivationId(order.activation_id)

  try {
    if (remoteActivation.provider === 'smscode') {
      const remoteOrder = await getSmsCodeOrder(remoteActivation.id)
      const remoteStatus = String(remoteOrder?.status ?? '').toUpperCase()

      if (remoteStatus === 'OTP_RECEIVED') {
        if (remoteOrder?.otp_code) {
          const orderWithOtp = await saveOtp(
            supabase,
            order,
            String(remoteOrder.otp_code),
            remoteOrder.otp_message,
          )
          await finishRemoteOrder(orderWithOtp)
          return markCompleted(supabase, orderWithOtp)
        }
        return order
      }

      if (remoteStatus === 'COMPLETED') return markCompleted(supabase, order)
      if (!['ACTIVE', 'CANCELED', 'EXPIRED'].includes(remoteStatus)) return order

      if (remoteStatus === 'ACTIVE') {
        await cancelSmsCodeOrder(remoteActivation.id).catch(() => null)
      }
      return refundExpiredOrder(supabase, order)
    }

    const remoteStatus = await fetchSmsText('getStatus', { id: remoteActivation.id })
    if (remoteStatus.startsWith('STATUS_OK:')) {
      const orderWithOtp = await saveOtp(supabase, order, remoteStatus.slice('STATUS_OK:'.length))
      await finishRemoteOrder(orderWithOtp)
      return markCompleted(supabase, orderWithOtp)
    }

    if (remoteStatus === 'STATUS_CANCEL') return refundExpiredOrder(supabase, order)

    if (
      remoteStatus === 'STATUS_WAIT_CODE' ||
      remoteStatus === 'STATUS_WAIT_RETRY' ||
      remoteStatus === 'STATUS_WAIT_RESEND'
    ) {
      await fetchSmsText('setStatus', { status: 8, id: remoteActivation.id }).catch(() => null)
      return refundExpiredOrder(supabase, order)
    }

    return order
  } catch (error) {
    console.error(`Gagal memproses order kedaluwarsa ${order.id}:`, error)
    return order
  }
}
