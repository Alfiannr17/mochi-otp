import { completeDeposit, getPakasirTransaction } from "./pakasir.ts"
import { presentDeposit } from "./deposit-meta.ts"

export const DEPOSIT_LIFETIME_MS = 30 * 60 * 1000

const cancelDeposit = async (supabase: any, deposit: any) => {
  const { error } = await supabase
    .from('deposits')
    .update({ status: 'canceled' })
    .eq('order_id', deposit.order_id)
    .eq('status', 'pending')

  if (error) throw error
  return presentDeposit(supabase, { ...deposit, status: 'canceled' })
}

export const syncDepositStatus = async (supabase: any, deposit: any) => {
  if (!deposit) return deposit
  if (deposit.status !== 'pending') return presentDeposit(supabase, deposit)

  const createdAt = new Date(deposit.created_at).getTime()
  const isExpired = Number.isFinite(createdAt) &&
    Date.now() >= createdAt + DEPOSIT_LIFETIME_MS

  try {
    const transaction = await getPakasirTransaction(deposit.order_id, Number(deposit.amount))
    const remoteStatus = String(transaction?.status ?? 'pending').toLowerCase()

    if (remoteStatus === 'completed') {
      await completeDeposit(supabase, deposit.order_id, Number(deposit.amount))
      return presentDeposit(supabase, { ...deposit, status: 'success' }, transaction)
    }

    if (isExpired) {
      return cancelDeposit(supabase, deposit)
    }
  } catch (error) {
    console.error(`Gagal menyinkronkan deposit ${deposit.order_id}:`, error)
  }

  return presentDeposit(supabase, deposit)
}
