import { useMemo, useState, useEffect } from 'react';
import { adminApi } from '../../lib/adminApi';
import { WalletIcon } from '../../components/Icons';
import AdminFilterBar from '../../components/admin/AdminFilterBar';

export default function AdminDeposits() {
  const [deposits, setDeposits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    let active = true;

    const loadDeposits = async () => {
      try {
        const result = await adminApi('deposits.list');
        if (active) setDeposits(result.deposits);
      } catch (error) {
        if (active) setErrorMessage(error.message);
      } finally {
        if (active) setLoading(false);
      }
    };

    loadDeposits();
    return () => {
      active = false;
    };
  }, []);

  const getStatusColor = (status) => {
    if (status === 'success') return 'bg-mochi-green';
    if (status === 'expired' || status === 'failed' || status === 'canceled') return 'bg-red-400 text-white';
    return 'bg-yellow-300';
  };

  const filteredDeposits = useMemo(() => {
    const query = search.trim().toLowerCase();
    return deposits.filter((deposit) => {
      const matchesSearch = !query || [
        deposit.order_id,
        deposit.user_id,
        deposit.users?.username,
        deposit.amount,
      ].some((value) => String(value ?? '').toLowerCase().includes(query));
      return matchesSearch && (statusFilter === 'all' || deposit.status === statusFilter);
    });
  }, [deposits, search, statusFilter]);

  return (
    <div className="pb-8">
      <h1 className="text-3xl font-black mb-6 flex items-center gap-2"><WalletIcon className="w-8 h-8" /> Data Deposit & Pakasir</h1>
      {errorMessage && <div className="mb-5 border-2 border-black rounded-xl bg-red-300 p-4 font-bold shadow-neo">{errorMessage}</div>}
      <AdminFilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder="Cari order ID, user, atau nominal..."
        filter={statusFilter}
        onFilterChange={setStatusFilter}
        options={[
          { value: 'all', label: 'Semua Status' },
          { value: 'pending', label: 'Pending' },
          { value: 'success', label: 'Sukses' },
          { value: 'canceled', label: 'Dibatalkan' },
          { value: 'expired', label: 'Kedaluwarsa' },
          { value: 'failed', label: 'Gagal' },
        ]}
        resultCount={filteredDeposits.length}
      />
      
      <div className="border-2 border-black rounded-xl bg-white shadow-neo overflow-x-auto">
        <table className="w-full text-left border-collapse font-mono">
          <thead>
            <tr className="bg-mochi-green border-b-2 border-black text-sm">
              <th className="p-3 border-r-2 border-black font-black">Order ID</th>
              <th className="p-3 border-r-2 border-black font-black whitespace-nowrap">Tgl & Waktu</th>
              <th className="p-3 border-r-2 border-black font-black">Username</th>
              <th className="p-3 border-r-2 border-black font-black">Nominal</th>
              <th className="p-3 font-black text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="5" className="p-8 text-center font-bold">Memuat data deposit...</td></tr>
            ) : filteredDeposits.length === 0 ? (
              <tr><td colSpan="5" className="p-8 text-center font-bold">Deposit tidak ditemukan.</td></tr>
            ) : filteredDeposits.map((d) => (
              <tr key={d.order_id} className="border-b-2 border-black last:border-b-0 hover:bg-gray-50">
                <td className="p-3 border-r-2 border-black text-xs font-bold">{d.order_id}</td>
                <td className="p-3 border-r-2 border-black text-xs">
                  {new Date(d.created_at).toLocaleString('id-ID')}
                </td>
                <td className="p-3 border-r-2 border-black font-bold text-xs">
                  {d.users?.username || d.users?.id || d.user_id || 'Unknown'}
                </td>
                <td className="p-3 border-r-2 border-black font-black text-green-600 text-sm">
                  Rp.{Number(d.amount).toLocaleString('id-ID')}
                </td>
                <td className="p-3 text-center">
                  <span className={`px-2 py-1 border-2 border-black rounded font-bold text-[10px] uppercase shadow-neo ${getStatusColor(d.status)}`}>
                    {d.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
