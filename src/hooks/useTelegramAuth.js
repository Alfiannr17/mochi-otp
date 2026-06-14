import { useEffect, useState } from 'react';
import WebApp from '../lib/telegram';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  ?.replace(/\/rest\/v1\/?$/i, '')
  .replace(/\/+$/, '');
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const authenticateWithTelegram = async (initData, signal) => {
  const response = await fetch(`${supabaseUrl}/functions/v1/telegram-auth`, {
    method: 'POST',
    signal,
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ initData }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error || `Autentikasi Telegram gagal (HTTP ${response.status}).`);
  }
  return payload;
};

const waitForTelegramContext = async (signal) => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (WebApp.initData && WebApp.initDataUnsafe?.user) {
      return {
        initData: WebApp.initData,
        user: WebApp.initDataUnsafe.user,
      };
    }

    await new Promise((resolve, reject) => {
      const handleAbort = () => {
        window.clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      const timer = window.setTimeout(() => {
        signal.removeEventListener('abort', handleAbort);
        resolve();
      }, 100);
      signal.addEventListener('abort', handleAbort, { once: true });
    });
  }

  const diagnostics = [
    `platform=${WebApp.platform || 'unknown'}`,
    `version=${WebApp.version || 'unknown'}`,
    `iframe=${window.parent !== window ? 'yes' : 'no'}`,
    `launchData=${window.location.hash.includes('tgWebAppData') ? 'yes' : 'no'}`,
  ].join(', ');

  throw new Error(`Telegram membuka halaman ini tanpa data Mini App (${diagnostics}). Gunakan tombol BUKA MOCHI OTP terbaru dari pesan /start.`);
};

export function useTelegramAuth() {
  const [dbUser, setDbUser] = useState(null);
  const [telegramUser, setTelegramUser] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const guardTimer = window.setTimeout(() => {
      if (!active) return;
      controller.abort();
      setErrorMessage('Koneksi autentikasi terlalu lama. Tutup lalu buka kembali Mini App.');
      setLoading(false);
    }, 15_000);

    const authenticateTelegramUser = async () => {
      try {
        WebApp.ready?.();
        WebApp.expand?.();

        const { initData } = await waitForTelegramContext(controller.signal);

        const data = await authenticateWithTelegram(initData, controller.signal);
        if (!active) return;

        window.sessionStorage.setItem('mochi_telegram_user', JSON.stringify(data.telegramUser));
        if (data.telegramUser?.photo_url && WebApp.initDataUnsafe?.user) {
          try {
            WebApp.initDataUnsafe.user.photo_url = data.telegramUser.photo_url;
          } catch {
            // Some Telegram clients expose initDataUnsafe as read-only.
          }
        }
        setDbUser(data.dbUser);
        setTelegramUser(data.telegramUser);
      } catch (error) {
        if (!active || error.name === 'AbortError') return;
        setErrorMessage(error.message || 'Identitas Telegram gagal diverifikasi.');
      } finally {
        if (active) {
          window.clearTimeout(guardTimer);
          setLoading(false);
        }
      }
    };

    authenticateTelegramUser();
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(guardTimer);
    };
  }, []);

  return { dbUser, telegramUser, errorMessage, loading };
}
