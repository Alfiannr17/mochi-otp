import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import WebApp from '../lib/telegram';
import QRCode from 'qrcode';
import MochiButton from '../components/MochiButton';
import { ArrowLeftIcon } from '../components/Icons';
import { useMochiDialog } from '../hooks/useMochiDialog';
import { supabase } from '../lib/supabase';
import { sanitizePublicError } from '../lib/publicError';
import MochiLoader from '../components/MochiLoader';

const DEPOSIT_LIFETIME_MS = 30 * 60 * 1000;
const DEPOSIT_STATUS_POLL_MS = 10_000;

const getTimeLeft = (invoice) => {
  const createdAt = new Date(invoice?.createdAt).getTime();
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

export default function PaymentQris() {
  const navigate = useNavigate();
  const dialog = useMochiDialog();
  const [searchParams] = useSearchParams();
  const amount = Number(searchParams.get('amount'));
  const telegramUser = WebApp.initDataUnsafe?.user;
  const userId = telegramUser?.id;
  const username = telegramUser?.username || telegramUser?.first_name;
  const createStarted = useRef(false);

  const [invoice, setInvoice] = useState(null);
  const [qrUrl, setQrUrl] = useState('');
  const [timeLeft, setTimeLeft] = useState(1800);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!Number.isInteger(amount) || amount < 1000) {
      navigate('/deposit', { replace: true });
      return;
    }
    if (createStarted.current) return;
    createStarted.current = true;

    const createInvoice = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('create-qris', {
          body: { userId, amount, username },
        });

        if (error) throw new Error(await getFunctionErrorMessage(error, 'Gagal membuat transaksi QRIS.'));
        if (data?.error) throw new Error(sanitizePublicError(data.error, 'Gagal membuat transaksi QRIS.'));

        const qrDataUrl = await QRCode.toDataURL(data.qrString, {
          width: 320,
          margin: 2,
          color: { dark: '#000000', light: '#FFFFFF' },
        });

        setInvoice(data);
        setQrUrl(qrDataUrl);
        setTimeLeft(getTimeLeft(data));
      } catch (error) {
        setErrorMessage(sanitizePublicError(error.message, 'Gagal membuat transaksi QRIS.'));
      } finally {
        setLoading(false);
      }
    };

    createInvoice();
  }, [amount, navigate, userId, username]);

  const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
    const remainingSeconds = (seconds % 60).toString().padStart(2, '0');
    return `${minutes}:${remainingSeconds}`;
  };

  const checkPaymentStatus = useCallback(async ({ silent = false } = {}) => {
    if (!invoice?.orderId) return;
    if (!silent) setChecking(true);

    try {
      const { data, error } = await supabase.functions.invoke('check-qris', {
        body: { orderId: invoice.orderId, userId },
      });

      if (error) throw new Error(await getFunctionErrorMessage(error, 'Gagal memeriksa status pembayaran.'));
      if (data?.error) throw new Error(sanitizePublicError(data.error, 'Gagal memeriksa status pembayaran.'));

      if (data.status === 'success' || data.status === 'canceled') {
        if (data.status === 'success') WebApp.HapticFeedback?.notificationOccurred('success');
        const currentDeposit = data.deposit || {};
        navigate(`/deposit/history/${invoice.orderId}`, {
          replace: true,
          state: {
            deposit: {
              order_id: invoice.orderId,
              user_id: userId,
              amount: invoice.amount,
              status: data.status,
              created_at: invoice.createdAt || new Date().toISOString(),
              qr_string: invoice.qrString,
              fee: invoice.fee,
              total_payment: invoice.totalPayment,
              promo_name: invoice.promoName,
              bonus_amount: invoice.bonusAmount,
              total_credit: invoice.totalCredit,
              ...currentDeposit,
            },
          },
        });
      } else if (!silent) {
        await dialog.alert(`Pembayaran masih berstatus ${data.status || 'pending'}.`, {
          title: 'Status Pembayaran',
        });
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
  }, [dialog, invoice, navigate, userId]);

  useEffect(() => {
    if (!invoice) return undefined;
    let expiryRequested = false;
    const updateTimeLeft = () => {
      const nextTimeLeft = getTimeLeft(invoice);
      setTimeLeft(nextTimeLeft);
      if (nextTimeLeft === 0 && !expiryRequested) {
        expiryRequested = true;
        checkPaymentStatus({ silent: true });
      }
    };
    updateTimeLeft();
    const timer = window.setInterval(updateTimeLeft, 1000);
    return () => window.clearInterval(timer);
  }, [checkPaymentStatus, invoice]);

  useEffect(() => {
    if (!invoice?.orderId) return undefined;
    const runVisibleCheck = () => {
      if (document.visibilityState === 'visible') checkPaymentStatus({ silent: true });
    };
    const interval = window.setInterval(runVisibleCheck, DEPOSIT_STATUS_POLL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') checkPaymentStatus({ silent: true });
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [checkPaymentStatus, invoice?.orderId]);

  if (loading) {
    return <MochiLoader message="Membuat QRIS pembayaran..." />;
  }

  if (errorMessage || !invoice) {
    return (
      <div className="pb-8">
        <div className="border-2 border-black rounded-xl bg-red-300 p-6 font-black shadow-neo mb-6">
          {errorMessage || 'Invoice QRIS tidak tersedia.'}
        </div>
        <MochiButton onClick={() => navigate('/deposit')}>Kembali ke Deposit</MochiButton>
      </div>
    );
  }

  return (
    <div className="pb-8">
      <button
        type="button"
        onClick={() => navigate('/deposit')}
        className="inline-flex items-center gap-2 border-2 border-black rounded-lg bg-white px-3 py-2 font-black text-xs shadow-neo active:translate-y-1 active:shadow-none mb-5"
      >
        <ArrowLeftIcon className="w-4 h-4" />
        Kembali
      </button>

      <div className="border-2 border-black rounded-xl bg-white shadow-neo p-4 relative overflow-hidden mb-6">
        <div className="absolute top-1/2 -left-4 w-8 h-8 bg-mochi-bg border-2 border-black rounded-full -translate-y-1/2" />
        <div className="absolute top-1/2 -right-4 w-8 h-8 bg-mochi-bg border-2 border-black rounded-full -translate-y-1/2" />

        <p className="text-center text-xs font-bold mb-2">
          {timeLeft > 0 ? `Selesaikan pembayaran dalam ${formatTime(timeLeft)}` : 'Waktu pembayaran telah habis'}
        </p>

        <div className="flex justify-center mb-2">
          <span className="bg-mochi-green text-[10px] font-bold px-3 py-1 border-2 border-black rounded-full shadow-neo">
            Total Pembayaran
          </span>
        </div>

        <h2 className="text-center text-3xl font-bold mb-4">RP.{Number(invoice.totalPayment).toLocaleString('id-ID')}</h2>

        <div className="border-2 border-black rounded-xl p-4 bg-white flex justify-center items-center max-w-[280px] mx-auto shadow-neo mb-6">
          <img src={qrUrl} alt="Kode QRIS pembayaran" className="w-full h-auto" />
        </div>

        <div className="space-y-1 text-xs border-t-2 border-dashed border-black pt-4 font-mono">
          <div className="flex justify-between gap-4">
            <span>Order ID</span>
            <span className="font-bold text-right break-all">{invoice.orderId}</span>
          </div>
          <div className="flex justify-between">
            <span>Nominal Deposit</span>
            <span className="font-bold">Rp.{Number(invoice.amount).toLocaleString('id-ID')}</span>
          </div>
          <div className="flex justify-between">
            <span>Biaya Penanganan</span>
            <span className="font-bold">Rp.{Number(invoice.fee).toLocaleString('id-ID')}</span>
          </div>
          {Number(invoice.bonusAmount) > 0 && (
            <>
              <div className="flex justify-between gap-4 text-purple-600">
                <span>Promo Aktif</span>
                <span className="font-bold text-right">{invoice.promoName || 'Bonus Top Up'}</span>
              </div>
              <div className="flex justify-between text-purple-600">
                <span>Bonus Top Up</span>
                <span className="font-bold">+ Rp.{Number(invoice.bonusAmount).toLocaleString('id-ID')}</span>
              </div>
            </>
          )}
          <div className="flex justify-between border-t-2 border-black pt-2 mt-2">
            <span className="font-black">Total Saldo Masuk</span>
            <span className="font-black text-green-600">
              Rp.{Number(invoice.totalCredit ?? invoice.amount).toLocaleString('id-ID')}
            </span>
          </div>
        </div>
      </div>

      <MochiButton onClick={() => checkPaymentStatus()} className="mb-4">
        {checking ? 'Memeriksa...' : 'Cek Status Pembayaran'}
      </MochiButton>

      <div className="text-center">
        <button type="button" onClick={() => navigate('/deposit/history')} className="font-bold text-sm underline">Lihat Riwayat Deposit</button>
      </div>
    </div>
  );
}
