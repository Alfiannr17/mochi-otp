import { useCallback, useState, useEffect } from 'react';
import { adminApi } from '../../lib/adminApi';
import { WalletIcon } from '../../components/Icons';
import AdminFilterBar from '../../components/admin/AdminFilterBar';
import MochiLoader from '../../components/MochiLoader';
import AdminPagination from '../../components/admin/AdminPagination';

const PAGE_SIZE = 20;

const formatUserLabel = (userId, user) => {
  const username = String(user?.username || '').trim().replace(/^@+/, '');
  if (username) return `@${username}`;
  if (user?.display_name) return user.display_name;
  return `ID: ${userId || '-'}`;
};

export default function AdminDeposits() {
  const [deposits, setDeposits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: PAGE_SIZE,
    total: 0,
    totalPages: 1,
  });

  const loadDeposits = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      const result = await adminApi('deposits.list', {
        page,
        pageSize: PAGE_SIZE,
        search,
        status: statusFilter,
      });
      setDeposits(result.deposits || []);
      setPagination(result.pagination || {
        page,
        pageSize: PAGE_SIZE,
        total: result.deposits?.length || 0,
        totalPages: 1,
      });
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => {
    const timeout = window.setTimeout(loadDeposits, 0);
    return () => window.clearTimeout(timeout);
  }, [loadDeposits]);

  const getStatusColor = (status) => {
    if (status === 'success') return 'bg-mochi-green';
    if (status === 'expired' || status === 'failed' || status === 'canceled') return 'bg-red-400 text-white';
    return 'bg-yellow-300';
  };

  const handleSearchChange = (value) => {
    setSearch(value);
    setPage(1);
  };

  const handleStatusChange = (value) => {
    setStatusFilter(value);
    setPage(1);
  };

  return (
    <div className="pb-8">
      <h1 className="text-3xl font-black mb-6 flex items-center gap-2"><WalletIcon className="w-8 h-8" /> Data Deposit & Pakasir</h1>
      {errorMessage && <div className="mb-5 border-2 border-black rounded-xl bg-red-300 p-4 font-bold shadow-neo">{errorMessage}</div>}
      <AdminFilterBar
        search={search}
        onSearchChange={handleSearchChange}
        placeholder="Cari order ID, user, atau nominal..."
        filter={statusFilter}
        onFilterChange={handleStatusChange}
        options={[
          { value: 'all', label: 'Semua Status' },
          { value: 'pending', label: 'Pending' },
          { value: 'success', label: 'Sukses' },
          { value: 'canceled', label: 'Dibatalkan' },
          { value: 'expired', label: 'Kedaluwarsa' },
          { value: 'failed', label: 'Gagal' },
        ]}
        resultCount={pagination.total}
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
              <tr><td colSpan="5"><MochiLoader compact message="Memuat data deposit..." /></td></tr>
            ) : deposits.length === 0 ? (
              <tr><td colSpan="5" className="p-8 text-center font-bold">Deposit tidak ditemukan.</td></tr>
            ) : deposits.map((d) => (
              <tr key={d.order_id} className="border-b-2 border-black last:border-b-0 hover:bg-gray-50">
                <td className="p-3 border-r-2 border-black text-xs font-bold">{d.order_id}</td>
                <td className="p-3 border-r-2 border-black text-xs">
                  {new Date(d.created_at).toLocaleString('id-ID')}
                </td>
                <td className="p-3 border-r-2 border-black font-bold text-xs">
                  {formatUserLabel(d.user_id, d.users)}
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
      <AdminPagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        total={pagination.total}
        pageSize={pagination.pageSize}
        onPageChange={setPage}
      />
    </div>
  );
}
