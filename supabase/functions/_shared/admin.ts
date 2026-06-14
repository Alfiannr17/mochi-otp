import { validateTelegramInitData } from "./telegram.ts"

const getAdminTelegramIds = () =>
  new Set(
    (Deno.env.get('ADMIN_TELEGRAM_IDS') ?? '')
      .split(/[\s,;]+/)
      .map((value) => value.trim())
      .filter(Boolean),
  )

export const isAdminTelegramId = (telegramId: unknown) =>
  getAdminTelegramIds().has(String(telegramId ?? ''))

export const requireAdminTelegramUser = async (initData: string) => {
  const telegramUser = await validateTelegramInitData(initData)
  if (!isAdminTelegramId(telegramUser.id)) {
    throw new Error('Akses admin ditolak')
  }
  return telegramUser
}
