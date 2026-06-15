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
};

export const normalizeFeatureSettings = (settings = []) => {
  const normalized = { ...FEATURE_DEFAULTS };

  settings.forEach((setting) => {
    if (!FEATURE_DEFAULTS[setting.feature_key]) return;
    normalized[setting.feature_key] = {
      ...FEATURE_DEFAULTS[setting.feature_key],
      ...setting,
      is_active: setting.is_active !== false,
    };
  });

  return normalized;
};

