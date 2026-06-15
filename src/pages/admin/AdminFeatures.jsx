import { useEffect, useState } from 'react';
import { SettingsIcon } from '../../components/Icons';
import MochiButton from '../../components/MochiButton';
import { adminApi } from '../../lib/adminApi';
import MochiLoader from '../../components/MochiLoader';

const FEATURE_LABELS = {
  server1: {
    name: 'Server 1',
    description: 'Mengatur katalog dan pembuatan order baru melalui Server 1.',
  },
  server2: {
    name: 'Server 2',
    description: 'Mengatur katalog dan pembuatan order baru melalui Server 2.',
  },
  deposit: {
    name: 'Deposit',
    description: 'Mengatur pembuatan transaksi QRIS baru. Riwayat dan pengecekan pembayaran lama tetap berjalan.',
  },
};

export default function AdminFeatures() {
  const [features, setFeatures] = useState([]);
  const [busyKey, setBusyKey] = useState('');
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let active = true;

    adminApi('features.list')
      .then((result) => {
        if (active) setFeatures(result.features || []);
      })
      .catch((error) => {
        if (active) setErrorMessage(error.message);
      });

    return () => {
      active = false;
    };
  }, []);

  const updateDraft = (featureKey, values) => {
    setFeatures((current) => current.map((feature) => (
      feature.feature_key === featureKey ? { ...feature, ...values } : feature
    )));
  };

  const saveFeature = async (feature) => {
    setBusyKey(feature.feature_key);
    setMessage('');
    setErrorMessage('');

    try {
      const result = await adminApi('features.save', {
        feature_key: feature.feature_key,
        is_active: feature.is_active,
        maintenance_message: feature.maintenance_message,
      });
      updateDraft(feature.feature_key, result.feature);
      setMessage(`${FEATURE_LABELS[feature.feature_key].name} berhasil diperbarui.`);
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusyKey('');
    }
  };

  return (
    <div className="pb-8">
      <div className="mb-6">
        <h1 className="text-3xl font-black flex items-center gap-3">
          <SettingsIcon className="w-8 h-8" />
          Fitur & Maintenance
        </h1>
        <p className="mt-2 text-sm font-bold text-gray-600">
          Aktifkan atau hentikan sementara fitur tanpa perlu deploy ulang.
        </p>
      </div>

      {message && <div className="mb-5 border-4 border-black rounded-xl bg-mochi-green p-4 font-bold shadow-neo">{message}</div>}
      {errorMessage && <div className="mb-5 border-4 border-black rounded-xl bg-red-300 p-4 font-bold shadow-neo">{errorMessage}</div>}

      {features.length === 0 && !errorMessage ? (
        <MochiLoader message="Memuat pengaturan fitur..." />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {features.map((feature) => {
            const label = FEATURE_LABELS[feature.feature_key];
            if (!label) return null;

            return (
              <section key={feature.feature_key} className="border-4 border-black rounded-xl bg-white p-5 shadow-neo flex flex-col">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <h2 className="text-xl font-black">{label.name}</h2>
                    <p className="mt-1 text-xs font-bold text-gray-600">{label.description}</p>
                  </div>
                  <span className={`shrink-0 border-2 border-black rounded-full px-3 py-1 text-[10px] font-black uppercase ${feature.is_active ? 'bg-mochi-green' : 'bg-red-300'}`}>
                    {feature.is_active ? 'Aktif' : 'Maintenance'}
                  </span>
                </div>

                <label className="mb-4 flex items-center gap-3 border-2 border-black rounded-xl p-3 cursor-pointer bg-mochi-bg">
                  <input
                    type="checkbox"
                    checked={Boolean(feature.is_active)}
                    onChange={(event) => updateDraft(feature.feature_key, { is_active: event.target.checked })}
                    className="w-5 h-5 accent-mochi-green"
                  />
                  <span className="font-black text-sm">Fitur dapat digunakan user</span>
                </label>

                <label className="text-xs font-black mb-2">Keterangan Maintenance</label>
                <textarea
                  rows="5"
                  value={feature.maintenance_message || ''}
                  onChange={(event) => updateDraft(feature.feature_key, { maintenance_message: event.target.value })}
                  placeholder={`${label.name} sedang maintenance. Silakan coba lagi nanti.`}
                  className="w-full border-2 border-black rounded-xl p-3 font-bold text-sm outline-none focus:bg-mochi-bg resize-y mb-4"
                />

                <MochiButton
                  type="button"
                  disabled={Boolean(busyKey)}
                  onClick={() => saveFeature(feature)}
                  className="mt-auto text-sm disabled:opacity-50"
                >
                  {busyKey === feature.feature_key ? 'Menyimpan...' : 'Simpan Pengaturan'}
                </MochiButton>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
