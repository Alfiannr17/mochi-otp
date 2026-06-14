import {
  encodeDepositMeta,
  getDepositPromoSnapshot,
  parseDepositMeta,
} from "./deposit-meta.ts"

const PAKASIR_API_URL = 'https://app.pakasir.com/api'

const getConfig = () => {
  const project = Deno.env.get('SLUG_PAKASIR') ?? ''
  const apiKey = Deno.env.get('API_KEY_PAKASIR') ?? ''
  if (!project || !apiKey) throw new Error('Konfigurasi Pakasir belum lengkap')
  return { project, apiKey }
}

const parseResponse = async (response: Response) => {
  const text = await response.text()
  let payload

  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`Respons Pakasir tidak valid: ${text}`)
  }

  if (!response.ok || payload?.error) {
    throw new Error(payload?.message ?? payload?.error ?? `Pakasir HTTP ${response.status}`)
  }

  return payload
}

export const createPakasirTransaction = async (orderId: string, amount: number) => {
  const { project, apiKey } = getConfig()
  const response = await fetch(`${PAKASIR_API_URL}/transactioncreate/qris`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project,
      order_id: orderId,
      amount,
      api_key: apiKey,
    }),
  })

  const payload = await parseResponse(response)
  if (!payload?.payment?.payment_number) throw new Error('QR string tidak diterima dari Pakasir')
  return payload.payment
}

export const getPakasirTransaction = async (orderId: string, amount: number) => {
  const { project, apiKey } = getConfig()
  const url = new URL(`${PAKASIR_API_URL}/transactiondetail`)
  url.searchParams.set('project', project)
  url.searchParams.set('amount', String(amount))
  url.searchParams.set('order_id', orderId)
  url.searchParams.set('api_key', apiKey)

  const response = await fetch(url)
  const payload = await parseResponse(response)
  return payload?.transaction
}

export const getPakasirProject = () => getConfig().project

export const completeDeposit = async (supabase: any, orderId: string, expectedAmount: number) => {
  const { data: deposit, error: depositError } = await supabase
    .from('deposits')
    .select('user_id, amount, status, payment_url')
    .eq('order_id', orderId)
    .single()

  if (depositError || !deposit) throw new Error('Deposit tidak ditemukan')
  if (Number(deposit.amount) !== Number(expectedAmount)) throw new Error('Nominal deposit tidak sesuai')
  if (deposit.status === 'success') return { alreadyProcessed: true }
  if (deposit.status !== 'pending') throw new Error(`Deposit berstatus ${deposit.status}`)

  const promoSnapshot = await getDepositPromoSnapshot(supabase, deposit)
  const bonusAmount = Number(promoSnapshot.bonusAmount || 0)
  const currentMeta = parseDepositMeta(deposit.payment_url, Number(deposit.amount))
  const completedMeta = currentMeta.version > 0
    ? deposit.payment_url
    : encodeDepositMeta({
      paymentUrl: currentMeta.paymentUrl,
      qrString: currentMeta.qrString,
      fee: currentMeta.fee,
      totalPayment: currentMeta.totalPayment,
      promoName: promoSnapshot.promoName,
      bonusAmount,
      totalCredit: promoSnapshot.totalCredit,
    })

  const { data: completedDeposit, error: updateError } = await supabase
    .from('deposits')
    .update({ status: 'success', payment_url: completedMeta })
    .eq('order_id', orderId)
    .eq('status', 'pending')
    .select('user_id, amount')
    .maybeSingle()

  if (updateError) throw updateError
  if (!completedDeposit) return { alreadyProcessed: true }

  const { data: user, error: userError } = await supabase
    .from('users')
    .select('balance')
    .eq('id', completedDeposit.user_id)
    .single()

  if (userError || !user) {
    await supabase.from('deposits').update({ status: 'pending' }).eq('order_id', orderId)
    throw new Error('User deposit tidak ditemukan')
  }

  const { error: balanceError } = await supabase
    .from('users')
    .update({
      balance: Number(user.balance) + Number(completedDeposit.amount) + bonusAmount,
    })
    .eq('id', completedDeposit.user_id)

  if (balanceError) {
    await supabase.from('deposits').update({ status: 'pending' }).eq('order_id', orderId)
    throw balanceError
  }

  return {
    alreadyProcessed: false,
    bonusAmount,
    promoName: promoSnapshot.promoName,
    totalCredit: promoSnapshot.totalCredit,
  }
}
