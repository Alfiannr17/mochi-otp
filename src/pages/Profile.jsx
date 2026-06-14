import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getTelegramUser } from '../lib/telegram';
import MochiButton from '../components/MochiButton';
import { supabase } from '../lib/supabase';
import { GiftIcon, WalletIcon } from '../components/Icons';
import { useMochiDialog } from '../hooks/useMochiDialog';

export default function Profile() {
  const navigate = useNavigate();
  const dialog = useMochiDialog();
  const [balance, setBalance] = useState(0);
  const [canCheckIn, setCanCheckIn] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  
  // Ambil data user Telegram
  const tgUser = getTelegramUser();
  const userId = tgUser?.id;

  useEffect(() => {
    let active = true;

    const loadProfile = async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [userResult, checkInResult] = await Promise.all([
        supabase.from('users').select('balance').eq('id', userId).single(),
        supabase.from('checkin').select('created_at').eq('user_id', userId).gte('created_at', today.toISOString()).limit(1),
      ]);

      if (!active) return;
      if (userResult.data) setBalance(Number(userResult.data.balance || 0));
      setCanCheckIn(checkInResult.data?.length === 0);
    };

    loadProfile();
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!showTerms) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showTerms]);

  const handleCheckIn = async () => {
    // Random saldo antara 50 - 250
    const bonus = Math.floor(Math.random() * (250 - 50 + 1)) + 50;
    
    // Insert ke tabel checkin & update tabel users (ideal nya menggunakan database function/trigger untuk keamanan, tapi ini versi frontend logic)
    await supabase.from('checkin').insert({ user_id: userId, amount: bonus });
    await supabase.from('users').update({ balance: balance + bonus }).eq('id', userId);
    
    setBalance(prev => prev + bonus);
    setCanCheckIn(false);
    await dialog.alert(`Kamu mendapat saldo gratis Rp.${bonus.toLocaleString('id-ID')}.`, {
      title: 'Check-in Berhasil',
    });
  };

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
        <p className="text-sm">@{tgUser?.username || 'username_tidak_tersedia'}</p>
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
        disabled={!canCheckIn}
        className={`w-full border-2 border-black rounded-xl py-3 font-bold transition-all ${canCheckIn ? 'bg-white shadow-neo active:translate-y-1 active:shadow-none' : 'bg-gray-200 text-gray-500 cursor-not-allowed'}`}
      >
        {canCheckIn ? 'Ambil Saldo Harian (50-250)' : 'Sudah Ambil Saldo Hari Ini'}
      </button>

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
