import { supabase } from './supabase';
import WebApp from './telegram';

const getFunctionErrorMessage = async (error, fallback) => {
  try {
    const payload = await error?.context?.json();
    return payload?.error || payload?.message || error?.message || fallback;
  } catch {
    return error?.message || fallback;
  }
};

export const fetchUserData = async (action, idOrOptions, maybeOptions = {}) => {
  if (!WebApp.initData) {
    throw new Error('Sesi Telegram tidak tersedia. Tutup lalu buka kembali Mini App.');
  }

  const id = typeof idOrOptions === 'object' && idOrOptions !== null ? undefined : idOrOptions;
  const options = typeof idOrOptions === 'object' && idOrOptions !== null
    ? idOrOptions
    : maybeOptions;

  const { data, error } = await supabase.functions.invoke('user-data', {
    body: {
      initData: WebApp.initData,
      action,
      id,
      ...options,
    },
  });

  if (error) throw new Error(await getFunctionErrorMessage(error, 'Gagal mengambil data akun.'));
  if (data?.error) throw new Error(data.error);
  return data;
};
