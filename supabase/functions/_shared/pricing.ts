const SPECIAL_SERVICES = new Set(['wa', 'tg', 'tele', 'whatsapp', 'telegram'])
const DEFAULT_SMSBOWER_USD_TO_IDR_RATE = 18_000

const getSmsBowerUsdToIdrRate = () => {
  const configuredRate = Number(Deno.env.get('SMSBOWER_USD_TO_IDR_RATE'))
  return Number.isSafeInteger(configuredRate) && configuredRate > 0
    ? configuredRate
    : DEFAULT_SMSBOWER_USD_TO_IDR_RATE
}

const getMargin = (serviceCode: string) =>
  SPECIAL_SERVICES.has(serviceCode.toLowerCase()) ? 1000 : 600

export const calculateUsdMochiPrice = (serviceCode: string, usdPrice: number) =>
  Math.ceil(Number(usdPrice) * getSmsBowerUsdToIdrRate()) + getMargin(serviceCode)

export const calculateIdrMochiPrice = (serviceCode: string, idrPrice: number) =>
  Math.ceil(Number(idrPrice)) + getMargin(serviceCode)
