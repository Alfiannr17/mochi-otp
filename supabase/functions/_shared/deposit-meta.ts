import { getBestDepositPromo } from "./promo.ts"

type DepositMeta = {
  version: number
  paymentUrl: string | null
  qrString: string | null
  fee: number
  totalPayment: number
  promoName: string | null
  bonusAmount: number
  totalCredit: number
}

const asFiniteNumber = (value: unknown, fallback = 0) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export const encodeDepositMeta = (meta: Omit<DepositMeta, 'version'>) =>
  JSON.stringify({ version: 1, ...meta })

export const parseDepositMeta = (value: unknown, amount: number): DepositMeta => {
  const fallback: DepositMeta = {
    version: 0,
    paymentUrl: typeof value === 'string' && value.startsWith('http') ? value : null,
    qrString: null,
    fee: 0,
    totalPayment: amount,
    promoName: null,
    bonusAmount: 0,
    totalCredit: amount,
  }

  if (typeof value !== 'string' || !value.trim().startsWith('{')) return fallback

  try {
    const parsed = JSON.parse(value)
    const bonusAmount = Math.max(0, asFiniteNumber(parsed.bonusAmount))
    return {
      version: asFiniteNumber(parsed.version),
      paymentUrl: typeof parsed.paymentUrl === 'string' ? parsed.paymentUrl : null,
      qrString: typeof parsed.qrString === 'string' ? parsed.qrString : null,
      fee: Math.max(0, asFiniteNumber(parsed.fee)),
      totalPayment: Math.max(amount, asFiniteNumber(parsed.totalPayment, amount)),
      promoName: typeof parsed.promoName === 'string' ? parsed.promoName : null,
      bonusAmount,
      totalCredit: Math.max(amount, asFiniteNumber(parsed.totalCredit, amount + bonusAmount)),
    }
  } catch {
    return fallback
  }
}

export const getDepositPromoSnapshot = async (supabase: any, deposit: any) => {
  const amount = Number(deposit.amount)
  const meta = parseDepositMeta(deposit.payment_url, amount)

  if (meta.version > 0) {
    return {
      promoName: meta.promoName,
      bonusAmount: meta.bonusAmount,
      totalCredit: meta.totalCredit,
    }
  }

  if (deposit.status !== 'pending') {
    return {
      promoName: null,
      bonusAmount: 0,
      totalCredit: amount,
    }
  }

  const promo = await getBestDepositPromo(supabase, amount)
  const bonusAmount = Number(promo?.bonusAmount || 0)
  return {
    promoName: promo?.promo_name ?? null,
    bonusAmount,
    totalCredit: amount + bonusAmount,
  }
}

export const presentDeposit = async (
  supabase: any,
  deposit: any,
  transaction?: any,
) => {
  if (!deposit) return deposit

  const amount = Number(deposit.amount)
  const meta = parseDepositMeta(deposit.payment_url, amount)
  const promo = await getDepositPromoSnapshot(supabase, deposit)
  const remoteQrString =
    transaction?.payment_number ??
    transaction?.qr_string ??
    transaction?.qr_content ??
    null

  return {
    ...deposit,
    payment_url: null,
    qr_string: meta.qrString ?? remoteQrString,
    fee: meta.fee || Math.max(0, asFiniteNumber(transaction?.fee)),
    total_payment:
      meta.totalPayment ||
      Math.max(amount, asFiniteNumber(transaction?.total_payment, amount)),
    promo_name: promo.promoName,
    bonus_amount: promo.bonusAmount,
    total_credit: promo.totalCredit,
  }
}
