export type DepositPromo = {
  id: number
  promo_name: string
  percentage: number
  min_deposit: number
  max_bonus: number
  bonusAmount: number
}

const calculateBonus = (amount: number, percentage: number, maxBonus: number) => {
  const percentageBonus = Math.floor(amount * percentage / 100)
  return maxBonus > 0 ? Math.min(percentageBonus, maxBonus) : percentageBonus
}

export const getBestDepositPromo = async (
  supabase: any,
  amount: number,
): Promise<DepositPromo | null> => {
  const { data: promos, error } = await supabase
    .from('promo_settings')
    .select('id,promo_name,percentage,min_deposit,max_bonus')
    .eq('is_active', true)
    .lte('min_deposit', amount)

  if (error) throw error

  return (promos ?? [])
    .map((promo: any) => {
      const percentage = Math.max(0, Number(promo.percentage) || 0)
      const maxBonus = Math.max(0, Number(promo.max_bonus) || 0)
      return {
        id: Number(promo.id),
        promo_name: String(promo.promo_name ?? 'Promo Deposit'),
        percentage,
        min_deposit: Math.max(0, Number(promo.min_deposit) || 0),
        max_bonus: maxBonus,
        bonusAmount: calculateBonus(amount, percentage, maxBonus),
      }
    })
    .filter((promo: DepositPromo) => promo.bonusAmount > 0)
    .sort((a: DepositPromo, b: DepositPromo) =>
      b.bonusAmount - a.bonusAmount || b.percentage - a.percentage
    )[0] ?? null
}
