import { useEffect, useRef } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { HomeIcon, HistoryIcon, OrderIcon, UserIcon, WalletIcon } from './Icons';
import { useTelegramAuth } from '../hooks/useTelegramAuth';
import { MochiDialogProvider } from './MochiDialog';
import { fetchUserData } from '../lib/userData';

export default function UserLayout() {
  const { errorMessage, loading } = useTelegramAuth();
  const syncInFlight = useRef(false);
  const navItems = [
    { label: 'Home', path: '/home', icon: HomeIcon },
    { label: 'Order', path: '/order', icon: OrderIcon },
    { label: 'History', path: '/history', icon: HistoryIcon },
    { label: 'Deposit', path: '/deposit', icon: WalletIcon },
    { label: 'Profile', path: '/profile', icon: UserIcon },
  ];

  useEffect(() => {
    if (loading || errorMessage) return undefined;

    const syncLifecycle = () => {
      if (syncInFlight.current) return;
      syncInFlight.current = true;
      Promise.allSettled([
        fetchUserData('orders'),
        fetchUserData('deposits'),
      ]).then((results) => {
        results.forEach((result) => {
          if (result.status === 'rejected') {
            console.error('Gagal menyinkronkan lifecycle:', result.reason);
          }
        });
      }).finally(() => {
        syncInFlight.current = false;
      });
    };
    const initialSync = window.setTimeout(syncLifecycle, 0);
    const interval = window.setInterval(syncLifecycle, 30000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') syncLifecycle();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearTimeout(initialSync);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [errorMessage, loading]);

  if (loading) {
    return (
      <div className="bg-mochi-bg min-h-screen p-6 flex items-center justify-center font-mono text-black">
        <div className="border-2 border-black rounded-xl bg-white p-6 text-center font-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
          Menghubungkan akun Telegram...
        </div>
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
