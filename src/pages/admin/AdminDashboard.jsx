import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { adminApi } from '../../lib/adminApi';
import { DashboardIcon, GiftIcon, OrderIcon, UsersIcon, WalletIcon } from '../../components/Icons';

const formatRupiah = (value) => `Rp.${Number(value || 0).toLocaleString('id-ID')}`;

export default function AdminDashboard() {
  const { admin } = useOutletContext();
  const [summary, setSummary] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let active = true;
    adminApi('dashboard.summary')
      .then((result) => {
        if (active) setSummary(result.summary);
      })
      .catch((error) => {
        if (active) setErrorMessage(error.message);
      });
    return () => {
      active = false;
    };
  }, []);

  const cards = summary ? [
    { label: 'Total User', value: summary.users.total, detail: `${summary.users.banned} user diblokir`, icon: UsersIcon, color: 'bg-white' },
    { label: 'Order Aktif', value: summary.orders.active, detail: `${summary.orders.today} order hari ini`, icon: OrderIcon, color: 'bg-yellow-300' },
    { label: 'Order Selesai', value: summary.orders.completed, detail: `${summary.orders.total} total order`, icon: DashboardIcon, color: 'bg-mochi-green' },
    { label: 'Deposit Sukses', value: formatRupiah(summary.deposits.successAmount), detail: `${summary.deposits.success} transaksi sukses`, icon: WalletIcon, color: 'bg-mochi-green' },
    { label: 'Deposit Pending', value: summary.deposits.pending, detail: `${summary.deposits.today} dibuat hari ini`, icon: WalletIcon, color: 'bg-yellow-300' },
    { label: 'Voucher Aktif', value: summary.vouchers.active, detail: `${summary.vouchers.claimed} total klaim`, icon: GiftIcon, color: 'bg-white' },
  ] : [];

  return (
    <div className="pb-8">
      <div className="mb-6">
        <h1 className="text-3xl font-black">Ringkasan Dashboard</h1>
        <p className="mt-1 text-sm font-bold text-gray-600">
          Selamat datang, {admin.first_name || admin.username || admin.id}.
        </p>
      </div>

      {errorMessage && <div className="mb-5 border-4 border-black rounded-xl bg-red-300 p-4 font-bold shadow-neo">{errorMessage}</div>}

      {!summary && !errorMessage ? (
        <div className="border-4 border-black rounded-xl bg-white p-8 text-center font-black shadow-neo">Memuat statistik...</div>
      ) : summary ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
          {cards.map(({ label, value, detail, icon: Icon, color }) => (
            <div key={label} className={`border-4 border-black rounded-xl p-5 shadow-neo ${color}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase">{label}</p>
                  <p className="mt-2 text-3xl font-black break-words">{value}</p>
                </div>
                <div className="w-12 h-12 border-2 border-black rounded-full bg-white flex items-center justify-center shadow-neo">
                  <Icon className="w-6 h-6" />
                </div>
              </div>
              <p className="mt-5 border-t-2 border-black pt-3 text-xs font-bold">{detail}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
