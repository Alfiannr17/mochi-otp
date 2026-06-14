import { useEffect, useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { CloseIcon, DashboardIcon, GiftIcon, MenuIcon, OrderIcon, UsersIcon, WalletIcon } from './Icons';
import { adminApi } from '../lib/adminApi';
import MochiButton from './MochiButton';

export default function AdminLayout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;

    adminApi('verify')
      .then((result) => {
        if (active) setAdmin(result.admin);
      })
      .catch((error) => {
        if (active) setErrorMessage(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

  const menuItems = [
    { path: '/admin/dashboard', name: 'Dashboard', icon: DashboardIcon },
    { path: '/admin/orders', name: 'Data Order', icon: OrderIcon },
    { path: '/admin/deposits', name: 'Deposit & QRIS', icon: WalletIcon },
    { path: '/admin/users', name: 'Manajemen User', icon: UsersIcon },
    { path: '/admin/vouchers', name: 'Voucher & Promo', icon: GiftIcon }
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-mochi-bg font-mono flex items-center justify-center p-5">
        <div className="w-full max-w-md border-4 border-black rounded-2xl bg-white p-8 text-center font-black shadow-neo">
          Memverifikasi akses admin...
        </div>
      </div>
    );
  }

  if (!admin) {
    return (
      <div className="min-h-screen bg-mochi-bg font-mono flex items-center justify-center p-5">
        <div className="w-full max-w-md border-4 border-black rounded-2xl bg-white p-6 shadow-neo">
          <h1 className="text-2xl font-black mb-3">Akses Admin Ditolak</h1>
          <p className="font-bold text-sm mb-6">{errorMessage || 'Telegram ID kamu tidak ada di whitelist admin.'}</p>
          <MochiButton onClick={() => navigate('/home', { replace: true })}>Kembali ke Aplikasi</MochiButton>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-mochi-bg font-mono text-black overflow-hidden">
      {/* Overlay untuk mobile agar bisa ditutup saat klik luar */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/40 z-40 md:hidden backdrop-blur-sm" 
          onClick={toggleSidebar}
        ></div>
      )}

      {/* Responsive Collapsible Sidebar */}
      <aside 
        className={`fixed md:static inset-y-0 left-0 z-50 w-64 bg-white border-r-4 border-black transform transition-transform duration-300 ease-in-out ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        } flex flex-col shadow-neo md:shadow-none`}
      >
        <div className="p-6 border-b-4 border-black flex justify-between items-center bg-mochi-green">
          <h2 className="text-2xl font-black tracking-tighter">MOCHI ADMIN</h2>
          <button className="md:hidden font-bold text-xl active:translate-y-1" onClick={toggleSidebar}><CloseIcon /></button>
        </div>
        
        <nav className="flex-1 p-4 space-y-3 overflow-y-auto">
          {menuItems.map((item) => {
            const isActive = location.pathname === item.path;
            const Icon = item.icon;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setIsSidebarOpen(false)} // Tutup sidebar di mobile setelah klik
                className={`p-3 border-2 border-black rounded-xl font-bold transition-all flex items-center gap-2 ${
                  isActive 
                    ? 'bg-mochi-green shadow-neo translate-x-[-2px] translate-y-[-2px]' 
                    : 'bg-white hover:bg-gray-100 hover:shadow-neo hover:-translate-y-1'
                }`}
              >
                <Icon className="w-5 h-5" /> {item.name}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Area Konten Utama */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header Mobile untuk membuka sidebar */}
        <header className="md:hidden bg-mochi-green border-b-4 border-black p-4 flex items-center justify-between shadow-neo z-30 relative">
          <button 
            onClick={toggleSidebar} 
            className="font-bold border-2 border-black bg-white px-3 py-1 rounded shadow-neo active:translate-y-1 active:shadow-none transition-all"
          >
            <span className="flex items-center gap-2"><MenuIcon className="w-5 h-5" /> Menu</span>
          </button>
          <h1 className="font-bold text-lg">Panel Admin</h1>
        </header>

        {/* Dynamic Page Content */}
        <main className="flex-1 overflow-auto p-4 md:p-8 bg-mochi-bg">
          <Outlet context={{ admin }} />
        </main>
      </div>
    </div>
  );
}
