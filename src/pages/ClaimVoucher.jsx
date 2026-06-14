import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MochiButton from '../components/MochiButton';
import { supabase } from '../lib/supabase';
import WebApp from '../lib/telegram';
import { GiftIcon } from '../components/Icons';
import { useMochiDialog } from '../hooks/useMochiDialog';

const getFunctionErrorMessage = async (error, fallback) => {
  try {
    const payload = await error?.context?.json();
    return payload?.error || payload?.message || error?.message || fallback;
  } catch {
    return error?.message || fallback;
  }
};

export default function ClaimVoucher() {
  const navigate = useNavigate();
  const dialog = useMochiDialog();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  const tgUser = WebApp.initDataUnsafe?.user;
  const userId = tgUser?.id;

  const handleClaim = async (e) => {
    e.preventDefault();
    if (!code) return;

    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('claim-voucher', {
        body: { userId: userId, voucherCode: code }
      });

      if (error) throw new Error(await getFunctionErrorMessage(error, 'Gagal mengklaim voucher.'));
      if (data?.error) throw new Error(data.error);

      // Jika Sukses Klaim
      WebApp.HapticFeedback.notificationOccurred('success');
      await dialog.alert(`Kamu berhasil mengklaim saldo gratis senilai Rp.${Number(data.amount).toLocaleString('id-ID')}.`, {
        title: 'Voucher Berhasil',
      });
      setCode('');
      navigate('/profile');

    } catch (error) {
      console.error(error);
      WebApp.HapticFeedback.notificationOccurred('error');
      await dialog.alert(error.message || 'Gagal mengklaim voucher.', {
        title: 'Voucher Gagal',
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pb-8">
      <h1 className="text-2xl font-black mb-1 flex items-center gap-2"><GiftIcon className="w-7 h-7" /> Kode Redeem / Voucher</h1>
      <p className="text-xs mb-6 font-bold text-gray-600">Masukkan kode voucher kamu untuk mendapatkan saldo gratis secara instan.</p>

      <form onSubmit={handleClaim} className="space-y-6">
        <div className="border-2 border-black rounded-xl bg-white shadow-neo p-4">
          <label className="text-xs font-black block mb-2 uppercase tracking-wider">Masukkan Kode Voucher</label>
          <input 
            type="text" 
            placeholder="CONTOH: MOCHICUAN" 
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            disabled={loading}
            className="w-full border-2 border-black rounded-lg py-3 px-4 font-black text-center text-lg tracking-widest outline-none bg-mochi-bg uppercase focus:bg-white transition-colors"
          />
        </div>

        <MochiButton type="submit" className={loading ? 'animate-pulse' : ''}>
          {loading ? 'MEMPROSES KLAIM...' : 'REDEEM KODE VOUCHER'}
        </MochiButton>
      </form>

      <div className="text-center mt-6">
        <button onClick={() => navigate(-1)} className="font-bold text-sm underline">Kembali</button>
      </div>
    </div>
  );
}
