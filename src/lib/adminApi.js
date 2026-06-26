import { supabase } from './supabase';
import WebApp from './telegram';

const getFunctionErrorMessage = async (error) => {
  try {
    const payload = error?.context?.clone
      ? await error.context.clone().json()
      : await error?.context?.json?.();
    return payload?.error || payload?.message || error?.message;
  } catch {
    return error?.message;
  }
};

export const adminApi = async (action, payload = {}) => {
  if (!WebApp.initData) {
    throw new Error('Panel admin harus dibuka melalui tombol /admin di bot Telegram.');
  }

  const { data, error } = await supabase.functions.invoke('admin-api', {
    body: { initData: WebApp.initData, action, payload },
  });

  if (error) throw new Error((await getFunctionErrorMessage(error)) || 'Aksi admin gagal.');
  if (data?.error) throw new Error(data.error);
  return data;
};
