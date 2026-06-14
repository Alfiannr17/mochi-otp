import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import WebApp from '../lib/telegram';
import MochiButton from '../components/MochiButton';
import { WalletIcon } from '../components/Icons';
import { useMochiDialog } from '../hooks/useMochiDialog';
import { supabase } from '../lib/supabase';

export default function Deposit() {
  const navigate = useNavigate();
  const dialog = useMochiDialog();
  const userId = WebApp.initDataUnsafe?.user?.id;
  const [balance, setBalance] = useState(0);
  const [selectedAmount, setSelectedAmount] = useState(null);
  const [customAmount, setCustomAmount] = useState('');
  const autoNominals = [2000, 5000, 10000, 20000, 50000, 100000];

  useEffect(() => {
    let active = true;

    const loadBalance = async () => {
      const { data } = await supabase.from('users').select('balance').eq('id', userId).single();
      if (active && data) setBalance(Number(data.balance || 0));
    };

    loadBalance();
    return () => {
      active = false;
    };
  }, [userId]);

  const handleContinue = async () => {
    const finalAmount = Number(customAmount || selectedAmount);
    if (!Number.isInteger(finalAmount) || finalAmount < 1000) {
      await dialog.alert('Pilih atau masukkan nominal minimal Rp1.000.', {
        title: 'Nominal Tidak Valid',
        type: 'error',
      });
      return;
    }

    navigate(`/deposit/qris?amount=${finalAmount}`);
  };

  return (
    <div className="pb-8">
      <div className="bg-mochi-green border-2 border-black rounded-xl p-4 flex items-center gap-4 mb-6 shadow-neo">
        <div className="w-10 h-10 bg-white border-2 border-black rounded flex items-center justify-center">
          <WalletIcon className="w-6 h-6" />
        </div>
        <div>
          <p className="text-xs font-bold">Saldo Tersedia</p>
          <p className="text-2xl font-bold">Rp.{balance.toLocaleString('id-ID')}</p>
        </div>
      </div>

      <div className="mb-6">
        <label className="text-xs font-bold block mb-2">Pilih Nominal Otomatis</label>
        <div className="border-2 border-black rounded-xl bg-white shadow-neo p-4 grid grid-cols-2 gap-3">
          {autoNominals.map((nominal) => (
            <button
              type="button"
              key={nominal}
              onClick={() => {
                setSelectedAmount(nominal);
                setCustomAmount('');
              }}
              className={`min-w-0 border-2 border-black rounded-lg py-2 font-bold text-lg transition-all shadow-neo ${selectedAmount === nominal ? 'bg-mochi-green' : 'bg-white'}`}
            >
              Rp.{nominal.toLocaleString('id-ID')}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-6">
        <label className="text-xs font-bold block mb-2">Nominal Custom</label>
        <input
          type="number"
          min="1000"
          step="1000"
          placeholder="Masukkan nominal..."
          value={customAmount}
          onChange={(event) => {
            setCustomAmount(event.target.value);
            setSelectedAmount(null);
          }}
          className="w-full border-2 border-black rounded-xl py-3 px-4 font-bold shadow-neo outline-none"
        />
      </div>

      <p className="text-[10px] mb-6">
        Dengan melanjutkan deposit, Anda menyetujui <span className="text-purple-600">Syarat & Ketentuan</span> serta <span className="text-purple-600">Kebijakan Privasi.</span>
      </p>

      <MochiButton onClick={handleContinue} className="mb-4">Lanjutkan Pembayaran</MochiButton>

      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => navigate(-1)} className="border-2 border-black rounded-xl bg-white py-3 font-bold shadow-neo active:translate-y-1 active:shadow-none">Kembali</button>
        <button type="button" onClick={() => navigate('/deposit/history')} className="border-2 border-black rounded-xl bg-white py-3 font-bold shadow-neo active:translate-y-1 active:shadow-none">Riwayat Deposit</button>
      </div>
    </div>
  );
}
