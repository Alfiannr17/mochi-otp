import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchUserData } from '../lib/userData';
import { parseOtpState } from '../lib/otpHistory';
import MochiLoader from '../components/MochiLoader';
import { HistoryFilter, HistoryPagination } from '../components/HistoryControls';
import { syncOtpNotifications } from '../lib/otpNotification';

const PAGE_SIZE = 10;
const HISTORY_REFRESH_MS = 30_000;
const ORDER_FILTERS = [
  { value: 'all', label: 'Semua Status' },
  { value: 'active', label: 'Aktif' },
  { value: 'completed', label: 'Selesai' },
  { value: 'canceled', label: 'Dibatalkan' },
];

const getStatusBadge = (status) => {
  if (status === 'active') return 'bg-yellow-300';
  if (status === 'completed') return 'bg-mochi-green';
  return 'bg-red-300';
};

const formatRupiah = (value) => `Rp.${Number(value || 0).toLocaleString('id-ID')}`;

function OrderCard({ order, onOpen }) {
  const isActive = order.status === 'active';
  const otpState = parseOtpState(order.sms_code);

  return (
    <button
      type="button"
      onClick={() => onOpen(order)}
      className={`w-full text-left border-2 border-black rounded-xl shadow-neo p-4 flex flex-col gap-2 active:translate-y-1 active:shadow-none ${
        isActive ? 'bg-yellow-100' : 'bg-white'
      }`}
    >
      <div className="flex justify-between items-center border-b-2 border-black pb-2 gap-3">
        <div className="min-w-0">
          <span className="block font-black text-sm truncate">{order.service_name}</span>
          <span className="text-[9px] font-bold text-purple-600">
            {String(order.activation_id).startsWith('smscode:') ? 'Server 2' : 'Server 1'}
          </span>
        </div>
        <span className={`text-[10px] font-black px-2 py-0.5 border-2 border-black rounded ${getStatusBadge(order.status)}`}>
          {isActive ? 'ACTIVE' : order.status.toUpperCase()}
        </span>
      </div>

      <div className="text-xs space-y-1 font-mono">
        <div className="flex justify-between gap-3">
          <span className="text-gray-600">Nomor HP:</span>
          <span className="font-bold text-right">{order.phone_number || 'Menunggu nomor...'}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-gray-600">Harga:</span>
          <span className="font-black text-right text-purple-700">{formatRupiah(order.price)}</span>
        </div>
        <div className="pt-1">
          <span className="block text-gray-600 mb-2">Kode SMS:</span>
          {otpState.codes.length > 0 ? (
            <div className="space-y-2">
              {otpState.codes.map((code, index) => (
                <div
                  key={`${code}-${index}`}
                  className="w-full border-2 border-black rounded-lg bg-mochi-green p-2 text-center overflow-hidden"
                >
                  <span className="block text-[8px] font-black">OTP {index + 1}</span>
                  <span className="block font-black text-sm text-purple-700">{code}</span>
                  {otpState.messages[index] && (
                    <span className="block mt-2 border-t-2 border-black pt-2 text-left text-[9px] font-bold break-words">
                      <span className="block font-black uppercase text-gray-600 mb-1">Pesan SMS</span>
                      {otpState.messages[index]}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <span className="font-bold text-sm text-gray-400">
              {otpState.waiting ? 'Menunggu OTP baru...' : 'Menunggu SMS masuk...'}
            </span>
          )}
          {otpState.waiting && otpState.codes.length > 0 && (
            <span className="block mt-2 font-bold text-[10px] text-gray-500">Menunggu SMS berikutnya...</span>
          )}
        </div>
        <div className="flex justify-between text-[10px] text-gray-500 pt-1 gap-3">
          <span>ID: {String(order.activation_id).replace(/^smscode:/, '')}</span>
          <span className="text-right">{new Date(order.created_at).toLocaleString('id-ID')}</span>
        </div>
      </div>

      {isActive && (
        <span className="mt-1 bg-mochi-green border-2 border-black rounded-lg py-2 text-center font-black text-xs">
          BUKA ORDER AKTIF
        </span>
      )}
    </button>
  );
}

export default function HistoryOrder() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const fetchInFlight = useRef(false);

  const fetchOrderHistory = useCallback(async () => {
    if (fetchInFlight.current) return;
    fetchInFlight.current = true;
    try {
      const data = await fetchUserData('orders', {
        page,
        pageSize: PAGE_SIZE,
        status: statusFilter,
        sync: false,
      });
      setOrders(data.orders || []);
      setTotalCount(Number(data.total || 0));
      await syncOtpNotifications(data.orders || []);
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error.message || 'Gagal memuat riwayat order.');
    } finally {
      setLoading(false);
      fetchInFlight.current = false;
    }
  }, [page, statusFilter]);

  useEffect(() => {
    const initialLoad = window.setTimeout(fetchOrderHistory, 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchOrderHistory();
    }, HISTORY_REFRESH_MS);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') fetchOrderHistory();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchOrderHistory]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const effectivePage = Math.min(page, totalPages);
  const openOrder = (order) => navigate(`/orders/${order.id}`, { state: { order } });

  const handleFilterChange = (value) => {
    setStatusFilter(value);
    setPage(1);
  };

  return (
    <div className="pb-8">
      <h1 className="text-2xl font-black mb-1">Riwayat Order</h1>
      <p className="text-xs mb-6">Buka kembali order aktif dan pantau kode OTP kamu.</p>

      {!loading && !errorMessage && orders.length > 0 && (
        <HistoryFilter
          value={statusFilter}
          onChange={handleFilterChange}
          options={ORDER_FILTERS}
          resultCount={totalCount}
        />
      )}

      {loading ? (
        <MochiLoader message="Memuat riwayat order..." />
      ) : errorMessage ? (
        <div className="border-2 border-black rounded-xl bg-red-300 p-5 text-center shadow-neo">
          <p className="font-black mb-3">Riwayat order gagal dimuat.</p>
          <p className="text-xs font-bold mb-4">{errorMessage}</p>
          <button
            type="button"
            onClick={fetchOrderHistory}
            className="bg-white border-2 border-black rounded-lg px-5 py-2 font-black shadow-neo"
          >
            COBA LAGI
          </button>
        </div>
      ) : orders.length === 0 ? (
        <div className="border-2 border-black rounded-xl bg-white p-6 text-center shadow-neo">
          <p className="font-bold">Belum ada riwayat transaksi.</p>
        </div>
      ) : (
        <>
          <h2 className="font-black mb-3">Daftar Order ({totalCount})</h2>
          {orders.length > 0 ? (
            <div className="space-y-4">
              {orders.map((order) => (
                <OrderCard key={order.id} order={order} onOpen={openOrder} />
              ))}
            </div>
          ) : (
            <div className="border-2 border-black rounded-xl bg-white p-4 text-center font-bold text-sm shadow-neo">
              Tidak ada order dengan status ini.
            </div>
          )}
          <HistoryPagination page={effectivePage} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
