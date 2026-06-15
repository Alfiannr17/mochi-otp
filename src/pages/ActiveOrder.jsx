import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import WebApp from '../lib/telegram';
import MochiButton from '../components/MochiButton';
import { ArrowLeftIcon, CopyIcon } from '../components/Icons';
import { useMochiDialog } from '../hooks/useMochiDialog';
import { supabase } from '../lib/supabase';
import { fetchUserData } from '../lib/userData';
import { sanitizePublicError } from '../lib/publicError';
import { parseOtpState } from '../lib/otpHistory';
import MochiLoader from '../components/MochiLoader';
import { markOtpCodesSeen, notifyNewOtpCodes } from '../lib/otpNotification';

const ORDER_LIFETIME_MS = 25 * 60 * 1000;
const SERVER2_CANCEL_DELAY_MS = 2 * 60 * 1000;

const getTimeLeft = (order) => {
  const createdAt = new Date(order?.created_at).getTime();
  if (!Number.isFinite(createdAt)) return 0;
  return Math.max(0, Math.ceil((createdAt + ORDER_LIFETIME_MS - Date.now()) / 1000));
};

const getCancelWaitLeft = (order) => {
  if (!String(order?.activation_id || '').startsWith('smscode:')) return 0;
  const createdAt = new Date(order?.created_at).getTime();
  if (!Number.isFinite(createdAt)) return 0;
  return Math.max(0, Math.ceil((createdAt + SERVER2_CANCEL_DELAY_MS - Date.now()) / 1000));
};

const formatTime = (seconds) => {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainingSeconds = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
};

const getFunctionErrorMessage = async (error, fallback) => {
  try {
    const payload = await error?.context?.json();
    return sanitizePublicError(payload?.error || payload?.message || error?.message, fallback);
  } catch {
    return sanitizePublicError(error?.message, fallback);
  }
};

export default function ActiveOrder() {
  const location = useLocation();
  const navigate = useNavigate();
  const dialog = useMochiDialog();
  const { orderId } = useParams();
  const [order, setOrder] = useState(location.state?.order || null);
  const [loading, setLoading] = useState(!location.state?.order);
  const [timeLeft, setTimeLeft] = useState(() => getTimeLeft(location.state?.order));
  const [cancelWaitLeft, setCancelWaitLeft] = useState(
    () => getCancelWaitLeft(location.state?.order),
  );
  const [otpCodes, setOtpCodes] = useState(() => parseOtpState(location.state?.order?.sms_code).codes);
  const [otpMessages, setOtpMessages] = useState(
    () => parseOtpState(location.state?.order?.sms_code).messages,
  );
  const [waitingForOtp, setWaitingForOtp] = useState(
    () => parseOtpState(location.state?.order?.sms_code).waiting,
  );
  const [isCanceled, setIsCanceled] = useState(location.state?.order?.status === 'canceled');
  const [isCompleted, setIsCompleted] = useState(location.state?.order?.status === 'completed');
  const [isCanceling, setIsCanceling] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [pollMessage, setPollMessage] = useState('');
  const expiryRequested = useRef(false);
  const pollInFlight = useRef(false);
  const hasReceivedOtp = otpCodes.length > 0;
  const isServer2 = String(order?.activation_id || '').startsWith('smscode:');
  const hasMissingServer2Message = isServer2 &&
    otpCodes.some((_, index) => !otpMessages[index]);
  const refundLocked = cancelWaitLeft > 0;

  useEffect(() => {
    if (!order?.id) return;
    markOtpCodesSeen(order.id, parseOtpState(order.sms_code).codes);
  }, [order?.id, order?.sms_code]);

  useEffect(() => {
    if (order || !orderId) return;
    let active = true;

    const loadOrder = async () => {
      try {
        const data = await fetchUserData('order', orderId);
        if (!active) return;

        setOrder(data.order);
        setTimeLeft(getTimeLeft(data.order));
        setCancelWaitLeft(getCancelWaitLeft(data.order));
        const otpState = parseOtpState(data.order.sms_code);
        setOtpCodes(otpState.codes);
        setOtpMessages(otpState.messages);
        setWaitingForOtp(otpState.waiting);
        setIsCanceled(data.order.status === 'canceled');
        setIsCompleted(data.order.status === 'completed');
        setLoadError('');
      } catch (error) {
        if (active) setLoadError(error.message || 'Order tidak dapat dimuat.');
      } finally {
        if (active) setLoading(false);
      }
    };

    loadOrder();
    return () => {
      active = false;
    };
  }, [navigate, order, orderId]);

  const checkSmsStatus = useCallback(async () => {
    if (
      pollInFlight.current ||
      !order ||
      (!waitingForOtp && hasReceivedOtp && !hasMissingServer2Message) ||
      isCanceled ||
      isCompleted
    ) return;

    pollInFlight.current = true;
    try {
      const { data, error } = await supabase.functions.invoke('check-sms', {
        body: {
          orderId: order.id,
          activationId: order.activation_id,
        },
      });

      if (error) throw new Error(await getFunctionErrorMessage(error, 'Gagal memeriksa SMS.'));
      if (data?.error) throw new Error(sanitizePublicError(data.error, 'Gagal memeriksa SMS.'));

      if (data.status === 'success') {
        const nextOtpCodes = data.codes || [...otpCodes, data.code].filter(Boolean);
        const nextOtpMessages = data.messages || otpMessages;
        const hasNewOtp = await notifyNewOtpCodes(order.id, nextOtpCodes);
        setOtpCodes(nextOtpCodes);
        setOtpMessages(nextOtpMessages);
        setWaitingForOtp(false);
        setPollMessage('');
        if (hasNewOtp) WebApp.HapticFeedback?.notificationOccurred('success');
      } else if (data.status === 'completed') {
        setOtpCodes(data.codes || otpCodes);
        setOtpMessages(data.messages || otpMessages);
        setIsCompleted(true);
        setPollMessage('');
      } else if (data.status === 'canceled') {
        setOtpCodes(data.codes || otpCodes);
        setOtpMessages(data.messages || otpMessages);
        setIsCanceled(true);
        setPollMessage('');
        dialog.alert(data.refunded === false
          ? 'Pesanan telah berakhir dan tidak dapat digunakan lagi.'
          : data.expired
            ? 'Masa aktif nomor telah habis. Order dibatalkan dan saldo dikembalikan.'
            : 'Pesanan dibatalkan oleh server pusat. Saldo dikembalikan.', {
          title: 'Order Dibatalkan',
          type: 'error',
        });
      } else {
        setOtpCodes(data.codes || otpCodes);
        setOtpMessages(data.messages || otpMessages);
        setPollMessage('');
      }
    } catch (error) {
      console.error('Gagal cek SMS:', error);
      setPollMessage('Koneksi ke Server terganggu. Sistem tetap mencoba otomatis...');
    } finally {
      pollInFlight.current = false;
    }
  }, [
    dialog,
    hasMissingServer2Message,
    hasReceivedOtp,
    isCanceled,
    isCompleted,
    order,
    otpCodes,
    otpMessages,
    waitingForOtp,
  ]);

  const handleCancelOrder = useCallback(async () => {
    if (!order || isCanceling || isCanceled || hasReceivedOtp) return;
    setIsCanceling(true);

    try {
      const { data, error } = await supabase.functions.invoke('cancel-order', {
        body: {
          orderId: order.id,
          activationId: order.activation_id,
        },
      });

      if (error) throw new Error(await getFunctionErrorMessage(error, 'Gagal membatalkan order.'));
      if (data?.error) throw new Error(sanitizePublicError(data.error, 'Gagal membatalkan order.'));

      setIsCanceled(true);
      await dialog.alert('Order dibatalkan. Saldo telah dikembalikan.', {
        title: 'Refund Berhasil',
      });
      navigate('/history');
    } catch (error) {
      await dialog.alert(sanitizePublicError(error.message, 'Gagal membatalkan order.'), {
        title: 'Refund Gagal',
        type: 'error',
      });
    } finally {
      setIsCanceling(false);
    }
  }, [dialog, hasReceivedOtp, isCanceled, isCanceling, navigate, order]);

  const runOrderAction = useCallback(async (action) => {
    if (!order || isCanceled || isFinishing || isResending) return;

    const setBusy = action === 'finish' ? setIsFinishing : setIsResending;
    setBusy(true);

    try {
      const { data, error } = await supabase.functions.invoke('order-action', {
        body: {
          orderId: order.id,
          activationId: order.activation_id,
          action,
        },
      });

      if (error) {
        throw new Error(await getFunctionErrorMessage(error, 'Aksi order gagal diproses.'));
      }
      if (data?.error) throw new Error(sanitizePublicError(data.error, 'Aksi order gagal diproses.'));

      if (action === 'resend') {
        setWaitingForOtp(true);
        await dialog.alert('Permintaan OTP baru berhasil dikirim. Silakan tunggu SMS berikutnya.', {
          title: 'OTP Baru Diminta',
        });
        return;
      }

      WebApp.HapticFeedback?.notificationOccurred('success');
      await dialog.alert('Order telah diselesaikan.', { title: 'Order Selesai' });
      navigate('/history');
    } catch (error) {
      await dialog.alert(sanitizePublicError(error.message, 'Aksi order gagal diproses.'), {
        title: 'Aksi Gagal',
        type: 'error',
      });
    } finally {
      setBusy(false);
    }
  }, [dialog, isCanceled, isFinishing, isResending, navigate, order]);

  const handleFinishOrder = useCallback(async () => {
    const agreed = await dialog.confirm(
      'Selesaikan order ini? Nomor tidak dapat digunakan lagi setelah selesai.',
      { title: 'Selesaikan Order', confirmText: 'Selesai' },
    );
    if (agreed) runOrderAction('finish');
  }, [dialog, runOrderAction]);

  const handleRefundOrder = useCallback(async () => {
    if (refundLocked) {
      await dialog.alert(
        `Refund Server 2 baru tersedia setelah 2 menit. Tunggu ${formatTime(cancelWaitLeft)} lagi.`,
        { title: 'Refund Belum Tersedia', type: 'error' },
      );
      return;
    }

    const agreed = await dialog.confirm(
      'Batalkan order dan kembalikan saldo? Refund tidak tersedia setelah OTP diterima.',
      { title: 'Konfirmasi Refund', confirmText: 'Refund' },
    );
    if (agreed) handleCancelOrder();
  }, [cancelWaitLeft, dialog, handleCancelOrder, refundLocked]);

  const handleResendOtp = useCallback(async () => {
    const agreed = await dialog.confirm('Minta kode OTP baru ke nomor ini?', {
      title: 'Minta OTP Lagi',
      confirmText: 'Minta OTP',
    });
    if (agreed) runOrderAction('resend');
  }, [dialog, runOrderAction]);

  useEffect(() => {
    if (
      !order ||
      (!waitingForOtp && hasReceivedOtp && !hasMissingServer2Message) ||
      isCanceled ||
      isCompleted
    ) return undefined;
    const initialPoll = window.setTimeout(checkSmsStatus, 0);
    const pollInterval = window.setInterval(checkSmsStatus, 5000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') checkSmsStatus();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearTimeout(initialPoll);
      window.clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [
    checkSmsStatus,
    hasMissingServer2Message,
    hasReceivedOtp,
    isCanceled,
    isCompleted,
    order,
    waitingForOtp,
  ]);

  useEffect(() => {
    if (!order || isCanceled || isCompleted) return undefined;
    const updateTimeLeft = () => {
      const nextTimeLeft = getTimeLeft(order);
      setTimeLeft(nextTimeLeft);
      setCancelWaitLeft(getCancelWaitLeft(order));

      if (nextTimeLeft > 0) expiryRequested.current = false;
      if (nextTimeLeft === 0 && !expiryRequested.current) {
        expiryRequested.current = true;
        fetchUserData('order', order.id)
          .then((data) => {
            setOrder(data.order);
            const otpState = parseOtpState(data.order.sms_code);
            notifyNewOtpCodes(data.order.id, otpState.codes);
            setOtpCodes(otpState.codes);
            setOtpMessages(otpState.messages);
            setWaitingForOtp(otpState.waiting);
            setIsCanceled(data.order.status === 'canceled');
            setIsCompleted(data.order.status === 'completed');
          })
          .catch((error) => console.error('Gagal menyelesaikan lifecycle order:', error));
      }
    };
    updateTimeLeft();
    const timer = window.setInterval(updateTimeLeft, 1000);
    return () => window.clearInterval(timer);
  }, [isCanceled, isCompleted, order]);

  const copyToClipboard = async (text) => {
    await navigator.clipboard.writeText(text);
    WebApp.HapticFeedback?.impactOccurred('light');
    await dialog.alert('Nomor berhasil disalin ke clipboard!', { title: 'Berhasil Disalin' });
  };

  if (loading) return <MochiLoader message="Memuat order..." />;
  if (loadError) {
    return (
      <div className="border-2 border-black rounded-xl bg-red-300 p-6 text-center shadow-neo">
        <p className="font-black mb-2">Order gagal dimuat.</p>
        <p className="text-xs font-bold mb-5">{loadError}</p>
        <MochiButton onClick={() => navigate('/history')}>Kembali ke Riwayat</MochiButton>
      </div>
    );
  }
  if (!order) return null;
  const displayedPhoneNumber = String(order.phone_number).startsWith('+')
    ? String(order.phone_number)
    : `+${order.phone_number}`;

  return (
    <div className="pb-8">
      <div className="flex items-center gap-2 mb-1">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="border-2 border-black rounded bg-white p-1 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-1 active:shadow-none"
          >
            <ArrowLeftIcon className="w-6 h-6" />
          </button>

      <h1 className="text-2xl font-black ">Status Order</h1>
      </div>
      <p className="text-xs mb-6">Tunggu hingga SMS OTP masuk ke nomor ini.</p>
        
      <div className="border-2 border-black rounded-xl bg-white shadow-neo p-6 mb-6 text-center relative overflow-hidden">
        <div className="inline-block bg-mochi-green border-2 border-black rounded-full px-4 py-1 font-bold text-xs mb-4 shadow-neo">
          {order.service_name}
        </div>

        <p className="text-xs font-bold text-gray-500 mb-1">Nomor Handphone</p>
        <button
          type="button"
          onClick={() => copyToClipboard(order.phone_number)}
          className="mx-auto text-3xl font-black mb-6 flex items-center gap-2 hover:scale-105 transition-transform"
        >
          {displayedPhoneNumber}
          <CopyIcon className="w-6 h-6" />
        </button>

        <div className="border-t-2 border-dashed border-black pt-6">
          <p className="text-xs font-bold text-gray-500 mb-2">Kode OTP (SMS)</p>
          {otpCodes.length > 0 ? (
            <div className="space-y-3">
              {otpCodes.map((code, index) => (
                <button
                  type="button"
                  key={`${code}-${index}`}
                  onClick={() => copyToClipboard(code)}
                  className="w-full bg-mochi-green border-2 border-black rounded-xl p-4 shadow-neo"
                >
                  <span className="block text-[10px] font-black text-left mb-1">OTP {index + 1}</span>
                  <span className="block text-3xl font-black tracking-widest">{code}</span>
                  {otpMessages[index] && (
                    <span className="block mt-3 border-t-2 border-black pt-3 text-left text-xs font-bold normal-case tracking-normal break-words">
                      <span className="block text-[9px] font-black uppercase text-gray-600 mb-1">Pesan SMS</span>
                      {otpMessages[index]}
                    </span>
                  )}
                </button>
              ))}
              {waitingForOtp && (
                <div className="border-2 border-black rounded-xl p-3 bg-white font-black text-xs shadow-neo">
                  Menunggu SMS berikutnya...
                </div>
              )}
            </div>
          ) : isCanceled ? (
            <div className="bg-red-300 border-2 border-black rounded-xl p-4 text-xl font-black shadow-neo">
              DIBATALKAN
            </div>
          ) : isCompleted ? (
            <div className="bg-mochi-green border-2 border-black rounded-xl p-4 text-xl font-black shadow-neo">
              SELESAI
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div className="flex gap-2">
                <div className="w-4 h-4 bg-black rounded-full animate-bounce" />
                <div className="w-4 h-4 bg-black rounded-full animate-bounce delay-100" />
                <div className="w-4 h-4 bg-black rounded-full animate-bounce delay-200" />
              </div>
              <p className="text-xs font-bold mt-2">Menunggu SMS masuk...</p>
            </div>
          )}
        </div>
      </div>

      {!isCanceled && !isCompleted && (
        <div className="text-center mb-6 font-mono font-bold text-xl">
          Waktu tersisa: {formatTime(timeLeft)}
        </div>
      )}

      {pollMessage && !isCanceled && !isCompleted && (
        <div className="mb-5 border-2 border-black rounded-xl bg-yellow-200 p-3 text-xs font-black shadow-neo">
          {pollMessage}
        </div>
      )}

      {!isCanceled && !isCompleted && (
        hasReceivedOtp ? (
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleResendOtp}
              disabled={isResending || isFinishing || waitingForOtp}
              className="bg-white border-2 border-black rounded-xl py-3 px-2 font-black text-sm shadow-neo active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all disabled:opacity-60"
            >
              {isResending ? 'MEMINTA...' : waitingForOtp ? 'MENUNGGU SMS BARU' : 'MINTA SMS LAGI'}
            </button>

            <button
              type="button"
              onClick={handleFinishOrder}
              disabled={isFinishing || isResending || (isServer2 && waitingForOtp)}
              className="bg-mochi-green border-2 border-black rounded-xl py-3 px-2 font-black text-sm shadow-neo active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all disabled:opacity-60"
            >
              {isFinishing
                ? 'MEMPROSES...'
                : isServer2 && waitingForOtp
                  ? 'TUNGGU OTP BARU'
                  : 'SELESAI'}
            </button>
          </div>
        ) : (
          <div>
            <button
              type="button"
              onClick={handleRefundOrder}
              disabled={isCanceling || isFinishing || refundLocked}
              className="w-full bg-red-400 border-2 border-black rounded-xl py-3 px-2 font-black text-sm shadow-neo active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all disabled:opacity-60"
            >
              {isCanceling
                ? 'MEMPROSES...'
                : refundLocked
                  ? `REFUND (${formatTime(cancelWaitLeft)})`
                  : 'REFUND'}
            </button>
          </div>
        )
      )}

      {isCanceled && (
        <MochiButton onClick={() => navigate('/history')}>Lihat Riwayat</MochiButton>
      )}

      {isCompleted && (
        <MochiButton onClick={() => navigate('/history')}>Kembali ke Riwayat</MochiButton>
      )}
    </div>
  );
}
