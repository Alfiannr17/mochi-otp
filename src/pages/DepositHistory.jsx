import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchUserData } from '../lib/userData';
import MochiLoader from '../components/MochiLoader';
import { HistoryFilter, HistoryPagination } from '../components/HistoryControls';

const PAGE_SIZE = 10;
const HISTORY_REFRESH_MS = 60_000;
const DEPOSIT_FILTERS = [
  { value: 'all', label: 'Semua Status' },
  { value: 'pending', label: 'Pending' },
  { value: 'success', label: 'Sukses' },
  { value: 'canceled', label: 'Dibatalkan' },
];

const normalizeDepositStatus = (status) => {
  if (['canceled', 'cancelled', 'expired', 'failed'].includes(status)) return 'canceled';
  return status;
};

const statusClass = (status) => {
  if (status === 'success') return 'bg-mochi-green';
  if (normalizeDepositStatus(status) === 'canceled') return 'bg-red-300';
  return 'bg-yellow-300';
};

export default function DepositHistory() {
  const navigate = useNavigate();
  const [deposits, setDeposits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const fetchInFlight = useRef(false);

  const loadDeposits = useCallback(async () => {
    if (fetchInFlight.current) return;
    fetchInFlight.current = true;
    try {
      const data = await fetchUserData('deposits', {
        page,
        pageSize: PAGE_SIZE,
        status: statusFilter,
        sync: false,
      });
      setDeposits(data.deposits || []);
      setTotalCount(Number(data.total || 0));
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error.message || 'Gagal memuat riwayat deposit.');
    } finally {
      setLoading(false);
      fetchInFlight.current = false;
    }
  }, [page, statusFilter]);

  useEffect(() => {
    const initialLoad = window.setTimeout(loadDeposits, 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadDeposits();
    }, HISTORY_REFRESH_MS);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') loadDeposits();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadDeposits]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const effectivePage = Math.min(page, totalPages);

  const handleFilterChange = (value) => {
    setStatusFilter(value);
    setPage(1);
  };

  return (
    <div className="pb-8">
      <h1 className="text-2xl font-black mb-1">Riwayat Deposit</h1>
      <p className="text-xs mb-6">Pantau seluruh pembayaran QRIS kamu.</p>

      {!loading && !errorMessage && deposits.length > 0 && (
        <HistoryFilter
          value={statusFilter}
          onChange={handleFilterChange}
          options={DEPOSIT_FILTERS}
          resultCount={totalCount}
        />
      )}

      {loading ? (
        <MochiLoader message="Memuat riwayat deposit..." />
      ) : errorMessage ? (
        <div className="border-2 border-black rounded-xl bg-red-300 p-5 text-center shadow-neo">
          <p className="font-black mb-3">Riwayat deposit gagal dimuat.</p>
          <p className="text-xs font-bold mb-4">{errorMessage}</p>
          <button
            type="button"
            onClick={loadDeposits}
            className="bg-white border-2 border-black rounded-lg px-5 py-2 font-black shadow-neo"
          >
            COBA LAGI
          </button>
        </div>
      ) : deposits.length === 0 ? (
        <div className="border-2 border-black rounded-xl bg-white p-6 text-center font-black shadow-neo">
          {statusFilter === 'all' ? 'Belum ada riwayat deposit.' : 'Tidak ada deposit dengan status ini.'}
        </div>
      ) : (
        <>
          {deposits.length > 0 ? (
            <div className="space-y-4">
              {deposits.map((deposit) => (
                <button
                  type="button"
                  key={deposit.order_id}
                  onClick={() => navigate(`/deposit/history/${deposit.order_id}`, { state: { deposit } })}
                  className="w-full border-2 border-black rounded-xl bg-white p-4 text-left shadow-neo active:translate-y-1 active:shadow-none"
                >
                  <div className="flex justify-between items-start gap-3 border-b-2 border-black pb-3 mb-3">
                    <div className="min-w-0">
                      <p className="font-black text-lg">Rp.{Number(deposit.amount).toLocaleString('id-ID')}</p>
                      {Number(deposit.bonus_amount) > 0 && (
                        <p className="text-[10px] font-black text-purple-600">
                          Bonus +Rp.{Number(deposit.bonus_amount).toLocaleString('id-ID')} | Saldo masuk Rp.{Number(deposit.total_credit).toLocaleString('id-ID')}
                        </p>
                      )}
                      <p className="text-[10px] font-bold break-all">{deposit.order_id}</p>
                    </div>
                    <span className={`border-2 border-black rounded px-2 py-1 text-[10px] font-black uppercase ${statusClass(deposit.status)}`}>
                      {deposit.status}
                    </span>
                  </div>
                  <p className="text-xs font-bold">{new Date(deposit.created_at).toLocaleString('id-ID')}</p>
                </button>
              ))}
            </div>
          ) : (
            <div className="border-2 border-black rounded-xl bg-white p-6 text-center font-black shadow-neo">
              Tidak ada deposit dengan status ini.
            </div>
          )}
          <HistoryPagination page={effectivePage} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
