import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import WebApp, { getTelegramUser } from '../lib/telegram';
import MochiButton from '../components/MochiButton';
import { supabase } from '../lib/supabase';
import { GiftIcon, WalletIcon } from '../components/Icons';
import { useMochiDialog } from '../hooks/useMochiDialog';
import MochiLoader from '../components/MochiLoader';

const formatCooldown = (totalSeconds) => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
};

const getFunctionErrorMessage = async (error, fallback) => {
  try {
    const payload = error?.context?.clone
      ? await error.context.clone().json()
      : await error?.context?.json?.();
    return payload?.error || fallback;
  } catch {
    return error?.message || fallback;
  }
};

export default function Profile() {
  const navigate = useNavigate();
  const dialog = useMochiDialog();
  const [balance, setBalance] = useState(0);
  const [nextCheckInAt, setNextCheckInAt] = useState(null);
  const [checkInError, setCheckInError] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [clock, setClock] = useState(0);
  const [showTerms, setShowTerms] = useState(false);
  const [loading, setLoading] = useState(true);
  
  // Ambil data user Telegram
  const tgUser = getTelegramUser();
  const userId = tgUser?.id;
  const secondsUntilCheckIn = nextCheckInAt
    ? Math.max(0, Math.ceil((new Date(nextCheckInAt).getTime() - clock) / 1000))
    : 0;
  const canCheckIn = !checkInError && secondsUntilCheckIn === 0;

  useEffect(() => {
    let active = true;

    const loadProfile = async () => {
      try {
        let hasLoadedUserBalance = false;
        const { data: userData } = userId
          ? await supabase.from('users').select('balance').eq('id', userId).maybeSingle()
          : { data: null };

        if (!active) return;
        if (userData) {
          hasLoadedUserBalance = true;
          setBalance(Number(userData.balance || 0));
        }

        if (!WebApp.initData) throw new Error('Data autentikasi Telegram tidak tersedia. Buka kembali Mini App dari bot.');
        const { data, error } = await supabase.functions.invoke('daily-checkin', {
          body: { initData: WebApp.initData, action: 'status' },
        });
        if (error) throw new Error(await getFunctionErrorMessage(error, 'Gagal memuat saldo harian.'));

        if (!active) return;
        if (!hasLoadedUserBalance && data?.balance !== undefined) {
          setBalance(Number(data.balance || 0));
        }
        setNextCheckInAt(data?.nextCheckInAt || null);
        setClock(Date.now());
        setCheckInError('');
      } catch (error) {
        if (active) setCheckInError(error.message || 'Gagal memuat saldo harian.');
      } finally {
        if (active) setLoading(false);
      }
    };

    loadProfile();
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!nextCheckInAt) return undefined;

    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [nextCheckInAt]);

  useEffect(() => {
    if (!showTerms) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showTerms]);

  const handleCheckIn = async () => {
    setClaiming(true);
    try {
      const { data, error } = await supabase.functions.invoke('daily-checkin', {
        body: { initData: WebApp.initData, action: 'claim' },
      });
      if (error) throw new Error(await getFunctionErrorMessage(error, 'Saldo harian gagal diproses.'));

      const bonus = Number(data?.bonus || 0);
      setBalance(Number(data?.balance || 0));
      setNextCheckInAt(data?.nextCheckInAt || null);
      setClock(Date.now());
      setCheckInError('');
      await dialog.alert(`Kamu mendapat saldo gratis Rp.${bonus.toLocaleString('id-ID')}. Saldo berikutnya tersedia lagi 24 jam dari sekarang.`, {
        title: 'Check-in Berhasil',
      });
    } catch (error) {
      await dialog.alert(error.message || 'Saldo harian gagal diproses.', {
        title: 'Check-in Gagal',
      });
    } finally {
      setClaiming(false);
    }
  };

  if (loading) return <MochiLoader message="Memuat profile..." />;

  return (
    <div className="pb-8">
      <h1 className="text-2xl font-bold mb-1">Profile Saya</h1>
      <p className="text-xs mb-6">Lihat informasi akun dan saldo kamu.</p>

      {/* Kartu Profil */}
      <div className="border-2 border-black rounded-xl bg-white shadow-neo p-6 flex flex-col items-center mb-6">
        <div className="w-24 h-24 bg-mochi-green border-2 border-black rounded-full mb-4 overflow-hidden flex items-center justify-center shadow-neo">
          {tgUser?.photo_url ? (
            <img
              src={tgUser.photo_url}
              alt={`Foto profil ${tgUser.first_name || 'Telegram'}`}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="font-bold text-2xl">{tgUser?.first_name?.charAt(0) || 'M'}</span>
          )}
        </div>
        <h2 className="text-xl font-bold text-center">
          {[tgUser?.first_name, tgUser?.last_name].filter(Boolean).join(' ') || 'Nama Telegram'}
        </h2>
        <div className="mt-1 text-center text-sm font-bold space-y-0.5">
          <p>Username: @{tgUser?.username || 'tidak_tersedia'}</p>
          <p>Telegram ID: {tgUser?.id || 'tidak_tersedia'}</p>
        </div>
      </div>

      {/* Kartu Saldo */}
      <div className="border-2 border-black rounded-xl bg-white shadow-neo p-4 flex flex-col gap-4 mb-6">
        <div className="bg-mochi-green border-2 border-black rounded-xl p-4 flex items-center gap-4">
          <div className="w-10 h-10 bg-white border-2 border-black rounded flex items-center justify-center">
            <WalletIcon className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold">Saldo Tersedia</p>
            <p className="text-2xl font-bold">Rp.{balance.toLocaleString('id-ID')}</p>
          </div>
        </div>
        <MochiButton onClick={() => navigate('/deposit')}>TOP UP SALDO</MochiButton>
      </div>

      {/* Tombol Check-in */}
      <button 
        onClick={handleCheckIn}
        disabled={!canCheckIn || claiming}
        className={`w-full border-2 border-black rounded-xl py-3 font-bold transition-all ${canCheckIn ? 'bg-white shadow-neo active:translate-y-1 active:shadow-none' : 'bg-gray-200 text-gray-500 cursor-not-allowed'}`}
      >
        {claiming
          ? 'Memproses Saldo Harian...'
          : checkInError
            ? 'Saldo Harian Tidak Tersedia'
            : canCheckIn
              ? 'Ambil Saldo Harian (50-250)'
              : `Tersedia Lagi Dalam ${formatCooldown(secondsUntilCheckIn)}`}
      </button>
      {checkInError && <p className="mt-3 text-xs font-bold text-center text-red-600">{checkInError}</p>}
      {!canCheckIn && !checkInError && nextCheckInAt && (
        <p className="mt-3 text-xs font-bold text-center">
          Klaim berikutnya: {new Date(nextCheckInAt).toLocaleString('id-ID')}
        </p>
      )}

      <button 
        onClick={() => navigate('/claim-voucher')}
        className="w-full mt-4 bg-white border-2 border-black rounded-xl py-3 font-bold shadow-neo hover:bg-gray-50 active:translate-y-1 active:shadow-none transition-all flex items-center justify-center gap-2"
      >
        <GiftIcon className="w-5 h-5" /> Klaim Kode Voucher Promo
      </button>

      <button
        type="button"
        onClick={() => setShowTerms(true)}
        className="w-full mt-4 bg-white border-2 border-black rounded-xl py-3 font-bold shadow-neo hover:bg-gray-50 active:translate-y-1 active:shadow-none transition-all"
      >
        Syarat & Ketentuan Layanan
      </button>

      {showTerms && (
        <div
          className="fixed inset-0 z-[110] bg-black/60 p-4 flex items-center justify-center"
          onClick={() => setShowTerms(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="terms-title"
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-lg max-h-[88vh] border-2 border-black rounded-2xl bg-mochi-bg shadow-neo flex flex-col overflow-hidden"
          >
            <div className="bg-mochi-green border-b-2 border-black p-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase">MochiOTP</p>
                <h2 id="terms-title" className="text-xl font-black">Ketentuan Layanan</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowTerms(false)}
                aria-label="Tutup ketentuan layanan"
                className="w-10 h-10 shrink-0 border-2 border-black rounded-full bg-white font-black text-xl shadow-neo active:translate-y-1 active:shadow-none"
              >
                ×
              </button>
            </div>

            <div className="overflow-y-auto p-5 space-y-6 text-sm">
              <section>
                <h3 className="text-lg font-black mb-3 border-b-2 border-black pb-2">Persyaratan Umum</h3>
                <div className="space-y-3 font-bold">
                  <p>Dengan mendaftar dan menggunakan layanan MochiOTP, Anda secara otomatis menyetujui semua persyaratan layanan kami.</p>
                  <p>Dengan menggunakan layanan MochiOTP, Anda dengan sadar membebaskan MochiOTP dari hukum yang berlaku.</p>
                  <p>Kami berhak mengubah ketentuan layanan tanpa pemberitahuan sebelumnya. Anda diharapkan untuk membaca semua ketentuan layanan kami sebelum melakukan pemesanan.</p>
                  <p>* MochiOTP berhak mengubah syarat dan ketentuan sewaktu-waktu tanpa sepengetahuan Anda.</p>
                  <p>** MochiOTP tidak akan bertanggung jawab jika Anda mengalami kerugian dalam bisnis Anda.</p>
                  <p>*** MochiOTP tidak bertanggung jawab jika Anda mengalami penangguhan akun atau penghapusan postingan yang dilakukan oleh Instagram, Twitter, Facebook, YouTube, dan lainnya karena OTP ini.</p>
                </div>
              </section>

              <section>
                <h3 className="text-lg font-black mb-3 border-b-2 border-black pb-2">Layanan & Pengembalian Dana</h3>
                <div className="space-y-3 font-bold">
                  <p>MochiOTP tidak menjamin keamanan akun yang Anda daftarkan menggunakan nomor MochiOTP.</p>
                  <p>MochiOTP hanya menjamin SMS pertama.</p>
                  <p>MochiOTP tidak menerima permintaan pembatalan/refund setelah SMS pertama diterima. Kami memberikan pengembalian dana hanya jika SMS pertama tidak diterima. Ketentuan ini tidak berlaku untuk nomor di layanan spesial.</p>
                  <p>MochiOTP tidak menerima pengembalian dana setelah melakukan deposit.</p>
                </div>
              </section>

              <section>
                <h3 className="text-lg font-black mb-3 border-b-2 border-black pb-2">Pesanan & Harga</h3>
                <div className="space-y-3 font-bold">
                  <p>Harga yang ditawarkan MochiOTP dapat berubah sewaktu-waktu tanpa pemberitahuan.</p>
                  <p>Pesanan yang telah melewati jangka waktu yang ditentukan tidak dapat diaktifkan kembali.</p>
                </div>
              </section>

              <section>
                <h3 className="text-lg font-black mb-3 border-b-2 border-black pb-2">Pemblokiran</h3>
                <div className="space-y-3 font-bold">
                  <p>MochiOTP tidak akan melakukan pengembalian dana pada akun terblokir.</p>
                  <p>MochiOTP berhak memblokir akun Anda tanpa pemberitahuan jika terindikasi adanya kecurangan.</p>
                  <p>MochiOTP berhak memblokir akun Anda jika Anda menemukan celah/bug di situs kami tetapi tidak melaporkannya.</p>
                </div>
              </section>
            </div>

            <div className="border-t-2 border-black bg-mochi-bg p-4">
              <button
                type="button"
                onClick={() => setShowTerms(false)}
                className="w-full border-2 border-black rounded-xl bg-mochi-green py-3 font-black shadow-neo active:translate-y-1 active:shadow-none"
              >
                Saya Mengerti
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
