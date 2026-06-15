export const FEATURE_DEFAULTS = {
  server1: {
    feature_key: 'server1',
    is_active: true,
    maintenance_message: 'Server 1 sedang maintenance. Silakan gunakan server lain atau coba lagi nanti.',
  },
  server2: {
    feature_key: 'server2',
    is_active: true,
    maintenance_message: 'Server 2 sedang maintenance. Silakan gunakan server lain atau coba lagi nanti.',
  },
  deposit: {
    feature_key: 'deposit',
    is_active: true,
    maintenance_message: 'Fitur deposit sedang maintenance. Silakan coba lagi nanti.',
  },
} as const

export type FeatureKey = keyof typeof FEATURE_DEFAULTS

export const getProviderFeatureKey = (provider: string): FeatureKey =>
  provider === 'smscode' ? 'server2' : 'server1'

export const getFeatureSettings = async (supabase: any) => {
  const { data, error } = await supabase
    .from('feature_settings')
    .select('feature_key,is_active,maintenance_message,updated_at')

  if (error) {
    console.error('feature_settings read failed, using active defaults:', error)
    return Object.values(FEATURE_DEFAULTS)
  }

  const rows = new Map<string, any>(
    (data ?? []).map((row: any) => [String(row.feature_key), row]),
  )
  return Object.values(FEATURE_DEFAULTS).map((fallback) => {
    const row = rows.get(fallback.feature_key)
    return {
      ...fallback,
      ...row,
      is_active: row?.is_active !== false,
      maintenance_message: String(row?.maintenance_message || fallback.maintenance_message),
    }
  })
}

export const getFeatureSetting = async (supabase: any, featureKey: FeatureKey) => {
  const settings = await getFeatureSettings(supabase)
  return settings.find((setting) => setting.feature_key === featureKey) ?? FEATURE_DEFAULTS[featureKey]
}
