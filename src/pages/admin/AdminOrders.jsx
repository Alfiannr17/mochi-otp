import { useMemo, useState, useEffect } from 'react';
import { adminApi } from '../../lib/adminApi';
import { OrderIcon } from '../../components/Icons';
import AdminFilterBar from '../../components/admin/AdminFilterBar';
import { parseOtpState } from '../../lib/otpHistory';
import MochiLoader from '../../components/MochiLoader';

const formatPhoneNumber = (phoneNumber) => {
  if (!phoneNumber) return 'Pending';
  const value = String(phoneNumber);
  return value.startsWith('+') ? value : `+${value}`;
};

const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('id-ID');
};

const formatRupiah = (value) => `Rp.${Number(value || 0).toLocaleString('id-ID')}`;

export default function AdminOrders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    let active = true;
    const fetchOrders = async () => {
      setLoading(true);
      setErrorMessage('');
      try {
        const data = await adminApi('orders.list');
        if (active) {
          setOrders(data.orders || []);
        }
      } catch (error) {
        if (active) {
          setErrorMessage(error.message || 'Gagal memuat data order.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    fetchOrders();
    return () => {
      active = false;
    };
  }, []);

  const getBadgeColor = (status) => {
    if (status === 'completed') return 'bg-mochi-green';
    if (status === 'canceled') return 'bg-red-400 text-white';
    return 'bg-yellow-300';
  };

  const getStatusLabel = (status) => {
    if (status === 'completed') return 'Selesai';
    if (status === 'canceled') return 'Dibatalkan';
    if (status === 'active') return 'Aktif';
    return status || 'Unknown';
  };

  const filteredOrders = useMemo(() => {
    const query = search.trim().toLowerCase();
    return orders.filter((order) => {
      const matchesSearch = !query || [
        order.id,
        order.user_id,
        order.users?.username,
        order.service_name,
        order.phone_number,
        order.sms_code,
        order.activation_id,
      ].some((value) => String(value ?? '').toLowerCase().includes(query));
      return matchesSearch && (statusFilter === 'all' || order.status === statusFilter);
    });
  }, [orders, search, statusFilter]);

  return (
    <div className="pb-8">
      <h1 className="text-3xl font-black mb-6 flex items-center gap-2"><OrderIcon className="w-8 h-8" /> Data Order OTP</h1>
      {errorMessage && <div className="mb-5 border-4 border-black rounded-xl bg-red-300 p-4 font-bold shadow-neo">{errorMessage}</div>}
      <AdminFilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder="Cari order, user, layanan, nomor, atau OTP..."
        filter={statusFilter}
        onFilterChange={setStatusFilter}
        options={[
          { value: 'all', label: 'Semua Status' },
          { value: 'active', label: 'Aktif' },
          { value: 'completed', label: 'Selesai' },
          { value: 'canceled', label: 'Dibatalkan' },
        ]}
        resultCount={filteredOrders.length}
      />
      
      <div className="border-2 border-black rounded-xl bg-white shadow-neo overflow-x-auto">
        <table className="w-full text-left border-collapse font-mono">
          <thead>
            <tr className="bg-mochi-green border-b-2 border-black text-sm">
              <th className="p-3 border-r-2 border-black font-black whitespace-nowrap">Tgl & Waktu</th>
              <th className="p-3 border-r-2 border-black font-black">Username</th>
              <th className="p-3 border-r-2 border-black font-black">Layanan</th>
              <th className="p-3 border-r-2 border-black font-black">Nomor HP</th>
              <th className="p-3 border-r-2 border-black font-black">Kode OTP</th>
              <th className="p-3 font-black text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="6"><MochiLoader compact message="Memuat data order..." /></td></tr>
            ) : filteredOrders.length === 0 ? (
              <tr><td colSpan="6" className="p-8 text-center font-bold">Order tidak ditemukan.</td></tr>
            ) : filteredOrders.map((o) => (
              <tr key={o.id} className="border-b-2 border-black last:border-b-0 hover:bg-gray-50">
                <td className="p-3 border-r-2 border-black text-xs whitespace-nowrap">
                  {formatDate(o.created_at)}
                  <span className="block mt-1 text-[10px] text-gray-500">ID: {o.id}</span>
                </td>
                <td className="p-3 border-r-2 border-black font-bold text-xs">
                  {o.users?.username ? `@${o.users.username}` : o.users?.id || o.user_id || 'Unknown'}
                </td>
                <td className="p-3 border-r-2 border-black font-bold text-xs">
                  {o.service_name} <br/>
                  <span className="text-[10px] font-normal text-gray-500">{formatRupiah(o.price)}</span>
                </td>
                <td className="p-3 border-r-2 border-black font-bold text-xs whitespace-nowrap">
                  {formatPhoneNumber(o.phone_number)}
                </td>
                <td className="p-3 border-r-2 border-black text-sm min-w-[240px]">
                  {parseOtpState(o.sms_code).codes.length === 0 ? (
                    <span className="font-black text-gray-500">
                      {parseOtpState(o.sms_code).waiting ? 'Menunggu SMS baru' : '-'}
                    </span>
                  ) : (
                    <div className="space-y-2">
                      {parseOtpState(o.sms_code).codes.map((code, index) => {
                        const state = parseOtpState(o.sms_code);
                        return (
                          <div key={`${code}-${index}`} className="border-2 border-black rounded-lg bg-mochi-bg p-2">
                            <span className="block font-black text-purple-600 tracking-widest">{code}</span>
                            {state.messages[index] && (
                              <span className="block mt-1 text-[10px] font-bold text-black break-words">
                                {state.messages[index]}
                              </span>
                            )}
                          </div>
                        );
                      })}
                      {parseOtpState(o.sms_code).waiting && (
                        <span className="block text-[10px] font-bold text-gray-500">Menunggu SMS baru...</span>
                      )}
                    </div>
                  )}
                </td>
                <td className="p-3 text-center">
                  <span className={`px-2 py-1 border-2 border-black rounded font-bold text-[10px] uppercase shadow-neo ${getBadgeColor(o.status)}`}>
                    {getStatusLabel(o.status)}
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
