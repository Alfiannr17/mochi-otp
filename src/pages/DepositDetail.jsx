import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import WebApp from '../lib/telegram';
import MochiButton from '../components/MochiButton';
import { ArrowLeftIcon, CheckIcon } from '../components/Icons';
import { useMochiDialog } from '../hooks/useMochiDialog';
import { supabase } from '../lib/supabase';
import { fetchUserData } from '../lib/userData';
import { sanitizePublicError } from '../lib/publicError';
import QRCode from 'qrcode';
import MochiLoader from '../components/MochiLoader';

const DEPOSIT_LIFETIME_MS = 30 * 60 * 1000;

const getTimeLeft = (deposit) => {
  const createdAt = new Date(deposit?.created_at).getTime();
  if (!Number.isFinite(createdAt)) return 0;
  return Math.max(0, Math.ceil((createdAt + DEPOSIT_LIFETIME_MS - Date.now()) / 1000));
};

const getFunctionErrorMessage = async (error, fallback) => {
  try {
    const payload = await error?.context?.json();
    return sanitizePublicError(payload?.error || payload?.message || error?.message, fallback);
  } catch {
    return sanitizePublicError(error?.message, fallback);
  }
};

export default function DepositDetail() {
  const location = useLocation();
  const navigate = useNavigate();
  const { orderId } = useParams();
  const dialog = useMochiDialog();
  const userId = WebApp.initDataUnsafe?.user?.id;
  const [deposit, setDeposit] = useState(location.state?.deposit || null);
  const [checking, setChecking] = useState(false);
  const [loading, setLoading] = useState(!location.state?.deposit);
  const [timeLeft, setTimeLeft] = useState(() => getTimeLeft(location.state?.deposit));
  const [qrUrl, setQrUrl] = useState('');

  useEffect(() => {
    let active = true;
    const loadDeposit = async () => {
      try {
        const data = await fetchUserData('deposit', orderId);
        if (active) {
          setDeposit(data.deposit);
          setTimeLeft(getTimeLeft(data.deposit));
        }
      } catch {
        if (active) setDeposit(null);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadDeposit();
    return () => {
      active = false;
    };
  }, [orderId, userId]);

  useEffect(() => {
    let active = true;

    const renderQr = async () => {
      if (deposit?.status !== 'pending' || !deposit?.qr_string) {
        setQrUrl('');
        return;
      }

      try {
        const dataUrl = await QRCode.toDataURL(deposit.qr_string, {
          width: 320,
          margin: 2,
          color: { dark: '#000000', light: '#FFFFFF' },
        });
        if (active) setQrUrl(dataUrl);
      } catch {
        if (active) setQrUrl('');
      }
    };

    renderQr();
    return () => {
      active = false;
    };
  }, [deposit?.qr_string, deposit?.status]);

  const checkStatus = useCallback(async ({ silent = false } = {}) => {
    if (!deposit) return;
    if (!silent) setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke('check-qris', {
        body: { orderId: deposit.order_id, userId },
      });
      if (error) throw new Error(await getFunctionErrorMessage(error, 'Gagal memeriksa status pembayaran.'));
      if (data?.error) throw new Error(sanitizePublicError(data.error, 'Gagal memeriksa status pembayaran.'));

      setDeposit((current) => ({ ...current, status: data.status, ...(data.deposit || {}) }));
      if (data.status === 'pending' && !silent) {
        await dialog.alert(`Pembayaran masih berstatus ${data.status || 'pending'}.`, {
          title: 'Status Pembayaran',
        });
      } else if (data.status === 'success') {
        WebApp.HapticFeedback?.notificationOccurred('success');
      }
    } catch (error) {
      if (!silent) {
        await dialog.alert(sanitizePublicError(error.message, 'Gagal memeriksa status pembayaran.'), {
          title: 'Pemeriksaan Gagal',
          type: 'error',
        });
      }
    } finally {
      if (!silent) setChecking(false);
    }
  }, [deposit, dialog, userId]);

  useEffect(() => {
    if (!deposit || deposit.status !== 'pending') return undefined;
    const interval = window.setInterval(() => checkStatus({ silent: true }), 5000);
    return () => window.clearInterval(interval);
  }, [checkStatus, deposit]);

  useEffect(() => {
    if (!deposit || deposit.status !== 'pending') return undefined;
    const updateTimeLeft = () => setTimeLeft(getTimeLeft(deposit));
    updateTimeLeft();
    const timer = window.setInterval(updateTimeLeft, 1000);
    return () => window.clearInterval(timer);
  }, [deposit]);

  const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
    const remainingSeconds = (seconds % 60).toString().padStart(2, '0');
    return `${minutes}:${remainingSeconds}`;
  };

  if (loading) return <MochiLoader message="Memuat deposit..." />;
  if (!deposit) return <div className="py-16 text-center font-black">Deposit tidak ditemukan.</div>;

  const isSuccess = deposit.status === 'success';
  const isPending = deposit.status === 'pending';
  const isCanceled = deposit.status === 'canceled';
  const bonusAmount = Number(deposit.bonus_amount || 0);
  const totalCredit = Number(deposit.total_credit ?? Number(deposit.amount) + bonusAmount);

  return (
    <div className="pb-8">
      <button
        type="button"
        onClick={() => navigate('/deposit/history')}
        className="inline-flex items-center gap-2 border-2 border-black rounded-lg bg-white px-3 py-2 font-black text-xs shadow-neo active:translate-y-1 active:shadow-none mb-5"
      >
        <ArrowLeftIcon className="w-4 h-4" />
        Kembali
      </button>

      <div className={`border-2 border-black rounded-2xl p-6 mb-6 text-center shadow-neo ${isSuccess ? 'bg-mochi-green' : isCanceled ? 'bg-red-300' : 'bg-white'}`}>
        {isSuccess && (
          <div className="w-20 h-20 border-2 border-black rounded-full bg-white mx-auto mb-4 flex items-center justify-center shadow-neo">
            <CheckIcon className="w-12 h-12" />
          </div>
        )}
        <h1 className="text-2xl font-black mb-1">
          {isSuccess ? 'Top Up Berhasil!' : isCanceled ? 'Deposit Dibatalkan' : 'Detail Deposit'}
        </h1>
        <p className="text-xs font-bold uppercase">Status: {deposit.status}</p>
      </div>

      {isPending && (
        <div className="border-2 border-black rounded-xl bg-white p-4 shadow-neo mb-6">
          <div className="text-center mb-4">
            <span className="inline-block border-2 border-black rounded-full bg-mochi-green px-3 py-1 text-[10px] font-black shadow-neo mb-3">
              SCAN QRIS UNTUK MEMBAYAR
            </span>
            <p className="text-xs font-bold text-gray-600">
              Deposit masih pending. Scan QRIS berikut sebelum waktu pembayaran habis.
            </p>
          </div>

          {qrUrl ? (
            <div className="border-2 border-black rounded-xl p-4 bg-white flex justify-center items-center max-w-[280px] mx-auto shadow-neo">
              <img src={qrUrl} alt="Kode QRIS pembayaran deposit pending" className="w-full h-auto" />
            </div>
          ) : (
            <div className="border-2 border-dashed border-black rounded-xl bg-mochi-bg p-5 text-center font-bold text-xs">
              QRIS transaksi lama tidak tersedia. Buat deposit baru jika QRIS tidak dapat dimuat.
            </div>
          )}
        </div>
      )}

      <div className="border-2 border-black rounded-xl bg-white p-5 shadow-neo mb-6">
        <div className="text-center border-b-2 border-dashed border-black pb-5 mb-5">
          <p className="text-xs font-bold text-gray-500">Jumlah Deposit</p>
          <p className="text-3xl font-black">Rp.{Number(deposit.amount).toLocaleString('id-ID')}</p>
          {bonusAmount > 0 && (
            <div className="mt-4 border-2 border-black rounded-xl bg-mochi-green p-3 shadow-neo">
              <p className="text-[10px] font-black uppercase">{deposit.promo_name || 'Bonus Top Up'}</p>
              <p className="text-xl font-black text-purple-600">+ Rp.{bonusAmount.toLocaleString('id-ID')}</p>
            </div>
          )}
        </div>
        <div className="space-y-3 text-xs">
          <div>
            <p className="font-bold text-gray-500">Order ID</p>
            <p className="font-black break-all">{deposit.order_id}</p>
          </div>
          <div>
            <p className="font-bold text-gray-500">Tanggal & Waktu</p>
            <p className="font-black">{new Date(deposit.created_at).toLocaleString('id-ID')}</p>
          </div>
          <div>
            <p className="font-bold text-gray-500">Status Pembayaran</p>
            <p className="font-black uppercase">{deposit.status}</p>
          </div>
          {Number(deposit.total_payment) > 0 && (
            <div>
              <p className="font-bold text-gray-500">Total Pembayaran QRIS</p>
              <p className="font-black">Rp.{Number(deposit.total_payment).toLocaleString('id-ID')}</p>
            </div>
          )}
          {bonusAmount > 0 && (
            <div>
              <p className="font-bold text-gray-500">Bonus Top Up</p>
              <p className="font-black text-purple-600">Rp.{bonusAmount.toLocaleString('id-ID')}</p>
            </div>
          )}
          <div className="border-t-2 border-black pt-3">
            <p className="font-bold text-gray-500">Total Saldo Masuk ke Akun</p>
            <p className="font-black text-lg text-green-600">Rp.{totalCredit.toLocaleString('id-ID')}</p>
          </div>
        </div>
      </div>

      {isPending && (
        <div className="text-center mb-6 font-mono font-bold text-xl">
          Waktu tersisa: {formatTime(timeLeft)}
        </div>
      )}

      {isPending && (
        <MochiButton onClick={checkStatus} className="mb-4">
          {checking ? 'Memeriksa...' : 'Cek Status Pembayaran'}
        </MochiButton>
      )}

      <button
        type="button"
        onClick={() => navigate('/deposit/history')}
        className="w-full border-2 border-black rounded-xl bg-white py-3 font-bold shadow-neo active:translate-y-1 active:shadow-none"
      >
        Kembali ke Riwayat Deposit
      </button>
    </div>
  );
}
