import { useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { HomeIcon, HistoryIcon, OrderIcon, UserIcon, WalletIcon } from './Icons';
import { useTelegramAuth } from '../hooks/useTelegramAuth';
import { MochiDialogProvider } from './MochiDialog';
import { fetchUserData } from '../lib/userData';
import MochiLoader from './MochiLoader';
import { primeOtpNotificationSound, syncOtpNotifications } from '../lib/otpNotification';

export default function UserLayout() {
  const { errorMessage, loading } = useTelegramAuth();
  const location = useLocation();
  const orderSyncInFlight = useRef(false);
  const depositSyncInFlight = useRef(false);
  const navItems = [
    { label: 'Home', path: '/home', icon: HomeIcon },
    { label: 'Order', path: '/order', icon: OrderIcon },
    { label: 'History', path: '/history', icon: HistoryIcon },
    { label: 'Deposit', path: '/deposit', icon: WalletIcon },
    { label: 'Profile', path: '/profile', icon: UserIcon },
  ];

  useEffect(() => {
    if (loading || errorMessage) return undefined;

    const unlockAudio = () => {
      primeOtpNotificationSound();
    };
    document.addEventListener('pointerdown', unlockAudio, { once: true });
    document.addEventListener('touchstart', unlockAudio, { once: true });

    const syncOrders = () => {
      if (location.pathname.startsWith('/orders/') || orderSyncInFlight.current) return;
      orderSyncInFlight.current = true;
      fetchUserData('orders')
        .then((result) => syncOtpNotifications(result.orders || []))
        .catch((error) => console.error('Gagal menyinkronkan order:', error))
        .finally(() => {
          orderSyncInFlight.current = false;
        });
    };

    const syncDeposits = () => {
      if (depositSyncInFlight.current) return;
      depositSyncInFlight.current = true;
      fetchUserData('deposits')
        .catch((error) => console.error('Gagal menyinkronkan deposit:', error))
        .finally(() => {
          depositSyncInFlight.current = false;
        });
    };

    const initialOrderSync = window.setTimeout(syncOrders, 0);
    const initialDepositSync = window.setTimeout(syncDeposits, 0);
    const orderInterval = window.setInterval(syncOrders, 7000);
    const depositInterval = window.setInterval(syncDeposits, 30000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncOrders();
        syncDeposits();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearTimeout(initialOrderSync);
      window.clearTimeout(initialDepositSync);
      window.clearInterval(orderInterval);
      window.clearInterval(depositInterval);
      document.removeEventListener('visibilitychange', handleVisibility);
      document.removeEventListener('pointerdown', unlockAudio);
      document.removeEventListener('touchstart', unlockAudio);
    };
  }, [errorMessage, loading, location.pathname]);

  if (loading) {
    return (
      <div className="bg-mochi-bg min-h-screen font-mono text-black">
        <MochiLoader fullScreen message="Menghubungkan akun Telegram..." />
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="bg-mochi-bg min-h-screen p-6 flex items-center justify-center font-mono text-black">
        <div className="border-2 border-black rounded-xl bg-red-300 p-6 text-center shadow-neo">
          <h1 className="text-xl font-black mb-3">Akun Telegram Tidak Terdeteksi</h1>
          <p className="text-sm font-bold mb-4">{errorMessage}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="bg-mochi-green border-2 border-black rounded-xl px-5 py-2 font-black shadow-neo active:translate-y-1 active:shadow-none"
          >
            Coba Lagi
          </button>
        </div>
      </div>
    );
  }

  return (
    <MochiDialogProvider>
      <div className="bg-mochi-bg min-h-screen w-full max-w-full overflow-x-hidden font-mono text-black pb-24">
        <main className="p-4 w-full max-w-full overflow-x-hidden">
          <Outlet />
        </main>

        <nav className="fixed bottom-0 left-0 right-0 z-50 bg-mochi-bg border-t-2 border-black grid grid-cols-5 py-3">
          {navItems.map(({ label, path, icon: Icon }) => (
            <NavLink key={path} to={path} className="min-w-0 flex flex-col items-center gap-1">
              {({ isActive }) => (
                <>
                  <div className={`w-10 h-10 border-2 border-black rounded-full flex items-center justify-center shadow-neo ${isActive ? 'bg-mochi-green' : 'bg-white'}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] font-bold">{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>
    </MochiDialogProvider>
  );
}
