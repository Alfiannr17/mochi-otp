import { useCallback, useMemo, useState, useEffect } from 'react';
import { adminApi } from '../../lib/adminApi';
import MochiButton from '../../components/MochiButton';
import { GiftIcon } from '../../components/Icons';
import AdminFilterBar from '../../components/admin/AdminFilterBar';

const EMPTY_PROMO = {
  promo_name: '',
  percentage: '',
  min_deposit: '',
  max_bonus: '',
  is_active: true,
};

const formatRupiah = (value) => `Rp.${Number(value || 0).toLocaleString('id-ID')}`;

export default function AdminVouchers() {
  const [vouchers, setVouchers] = useState([]);
  const [promos, setPromos] = useState([]);
  const [promoForm, setPromoForm] = useState(EMPTY_PROMO);
  const [editingPromoId, setEditingPromoId] = useState(null);
  const [newVoucher, setNewVoucher] = useState({ code: '', amount: '', batch: '', max_usage: 100 });
  const [voucherUsageDrafts, setVoucherUsageDrafts] = useState({});
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [promoSearch, setPromoSearch] = useState('');
  const [promoStatusFilter, setPromoStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const applyData = useCallback((result) => {
    setVouchers(result.vouchers || []);
    setPromos(result.promos || []);
    setVoucherUsageDrafts(Object.fromEntries(
      (result.vouchers || []).map((voucher) => [voucher.code, voucher.max_usage]),
    ));
  }, []);

  useEffect(() => {
    let active = true;

    const loadData = async () => {
      try {
        const result = await adminApi('vouchers.list');
        if (active) applyData(result);
      } catch (error) {
        if (active) setErrorMessage(error.message);
      }
    };

    loadData();
    return () => {
      active = false;
    };
  }, [applyData]);

  const refreshData = async () => {
    const result = await adminApi('vouchers.list');
    applyData(result);
  };

  const startAction = () => {
    setBusy(true);
    setMessage('');
    setErrorMessage('');
  };

  const resetPromoForm = () => {
    setPromoForm(EMPTY_PROMO);
    setEditingPromoId(null);
  };

  const handleSavePromo = async (event) => {
    event.preventDefault();
    startAction();
    try {
      await adminApi('promo.save', {
        ...promoForm,
        id: editingPromoId,
      });
      await refreshData();
      resetPromoForm();
      setMessage(editingPromoId ? 'Promo berhasil diperbarui.' : 'Promo berhasil dibuat.');
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const editPromo = (promo) => {
    setEditingPromoId(promo.id);
    setPromoForm({
      promo_name: promo.promo_name || '',
      percentage: promo.percentage ?? '',
      min_deposit: promo.min_deposit ?? '',
      max_bonus: promo.max_bonus ?? '',
      is_active: Boolean(promo.is_active),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const togglePromoStatus = async (promo) => {
    startAction();
    try {
      await adminApi('promo.toggle', { id: promo.id, isActive: !promo.is_active });
      await refreshData();
      setMessage(`Promo ${promo.promo_name} berhasil ${promo.is_active ? 'dinonaktifkan' : 'diaktifkan'}.`);
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const handleCreateVoucher = async (event) => {
    event.preventDefault();
    startAction();
    try {
      await adminApi('vouchers.create', newVoucher);
      setNewVoucher({ code: '', amount: '', batch: '', max_usage: 100 });
      await refreshData();
      setMessage('Voucher berhasil dibuat.');
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleVoucherStatus = async (code, currentStatus) => {
    startAction();
    try {
      await adminApi('vouchers.toggle', { code, isActive: !currentStatus });
      await refreshData();
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const updateVoucherMaxUsage = async (voucher) => {
    startAction();
    try {
      await adminApi('vouchers.updateMaxUsage', {
        code: voucher.code,
        max_usage: voucherUsageDrafts[voucher.code],
      });
      await refreshData();
      setMessage(`Batas penggunaan voucher ${voucher.code} berhasil diperbarui.`);
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const filteredPromos = useMemo(() => {
    const query = promoSearch.trim().toLowerCase();
    return promos.filter((promo) => {
      const matchesSearch = !query || [
        promo.promo_name,
        promo.percentage,
        promo.min_deposit,
        promo.max_bonus,
      ].some((value) => String(value ?? '').toLowerCase().includes(query));
      const matchesStatus =
        promoStatusFilter === 'all' ||
        (promoStatusFilter === 'active' && promo.is_active) ||
        (promoStatusFilter === 'inactive' && !promo.is_active);
      return matchesSearch && matchesStatus;
    });
  }, [promoSearch, promoStatusFilter, promos]);

  const filteredVouchers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return vouchers.filter((voucher) => {
      const matchesSearch = !query || [
        voucher.code,
        voucher.batch,
        voucher.amount,
      ].some((value) => String(value ?? '').toLowerCase().includes(query));
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && voucher.is_active) ||
        (statusFilter === 'inactive' && !voucher.is_active);
      return matchesSearch && matchesStatus;
    });
  }, [search, statusFilter, vouchers]);

  return (
    <div className="space-y-8 pb-8">
      <h1 className="text-3xl font-black mb-6">Voucher & Promo</h1>
      {message && <div className="border-4 border-black rounded-xl bg-mochi-green p-4 font-bold shadow-neo">{message}</div>}
      {errorMessage && <div className="border-4 border-black rounded-xl bg-red-300 p-4 font-bold shadow-neo">{errorMessage}</div>}

      <div className="border-4 border-black rounded-xl bg-white shadow-neo p-6">
        <h2 className="text-xl font-black mb-4 flex items-center gap-2">
          <GiftIcon className="w-6 h-6" />
          {editingPromoId ? 'Edit Promo Deposit' : 'Buat Promo Deposit'}
        </h2>
        <form onSubmit={handleSavePromo} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <div>
              <label className="text-xs font-bold mb-1 block">Nama Promo</label>
              <input required type="text" value={promoForm.promo_name} onChange={(event) => setPromoForm({ ...promoForm, promo_name: event.target.value })} placeholder="Bonus Topup" className="w-full border-2 border-black rounded p-2 font-bold outline-none" />
            </div>
            <div>
              <label className="text-xs font-bold mb-1 block">Persentase Bonus (%)</label>
              <input required min="0" max="100" type="number" value={promoForm.percentage} onChange={(event) => setPromoForm({ ...promoForm, percentage: event.target.value })} placeholder="20" className="w-full border-2 border-black rounded p-2 font-bold outline-none" />
            </div>
            <div>
              <label className="text-xs font-bold mb-1 block">Minimal Deposit (Rp)</label>
              <input required min="0" type="number" value={promoForm.min_deposit} onChange={(event) => setPromoForm({ ...promoForm, min_deposit: event.target.value })} placeholder="5000" className="w-full border-2 border-black rounded p-2 font-bold outline-none" />
            </div>
            <div>
              <label className="text-xs font-bold mb-1 block">Maksimal Bonus (Rp)</label>
              <input required min="0" type="number" value={promoForm.max_bonus} onChange={(event) => setPromoForm({ ...promoForm, max_bonus: event.target.value })} placeholder="5000" className="w-full border-2 border-black rounded p-2 font-bold outline-none" />
              <p className="text-[10px] font-bold mt-1">Isi 0 untuk bonus tanpa batas.</p>
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={promoForm.is_active} onChange={(event) => setPromoForm({ ...promoForm, is_active: event.target.checked })} className="w-5 h-5 border-2 border-black accent-mochi-green" />
            <span className="font-bold">Langsung aktifkan promo</span>
          </label>
          <div className="flex flex-wrap gap-3">
            <MochiButton disabled={busy} className="py-2 text-sm w-auto px-6 disabled:opacity-50">
              {editingPromoId ? 'Simpan Perubahan' : 'Buat Promo'}
            </MochiButton>
            {editingPromoId && (
              <button type="button" onClick={resetPromoForm} className="border-2 border-black rounded-lg bg-white px-5 py-2 font-black text-sm shadow-neo">
                Batal Edit
              </button>
            )}
          </div>
        </form>
      </div>

      <div>
        <h2 className="text-xl font-black mb-4">Daftar Promo Deposit</h2>
        <AdminFilterBar
          search={promoSearch}
          onSearchChange={setPromoSearch}
          placeholder="Cari nama, persentase, atau nominal promo..."
          filter={promoStatusFilter}
          onFilterChange={setPromoStatusFilter}
          options={[
            { value: 'all', label: 'Semua Promo' },
            { value: 'active', label: 'Promo Aktif' },
            { value: 'inactive', label: 'Promo Nonaktif' },
          ]}
          resultCount={filteredPromos.length}
        />
        <div className="border-2 border-black rounded-xl bg-white shadow-neo overflow-x-auto">
          <table className="w-full text-left border-collapse font-mono">
            <thead>
              <tr className="bg-mochi-green border-b-2 border-black text-sm">
                <th className="p-3 border-r-2 border-black font-black">Promo</th>
                <th className="p-3 border-r-2 border-black font-black">Bonus</th>
                <th className="p-3 border-r-2 border-black font-black">Minimal Deposit</th>
                <th className="p-3 border-r-2 border-black font-black">Maksimal Bonus</th>
                <th className="p-3 border-r-2 border-black font-black text-center">Status</th>
                <th className="p-3 font-black text-center">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filteredPromos.length === 0 ? (
                <tr><td colSpan="6" className="p-8 text-center font-bold">Promo tidak ditemukan.</td></tr>
              ) : filteredPromos.map((promo) => (
                <tr key={promo.id} className="border-b-2 border-black last:border-b-0 hover:bg-gray-50">
                  <td className="p-3 border-r-2 border-black font-bold">{promo.promo_name}</td>
                  <td className="p-3 border-r-2 border-black font-black text-purple-600">{promo.percentage}%</td>
                  <td className="p-3 border-r-2 border-black font-bold">{formatRupiah(promo.min_deposit)}</td>
                  <td className="p-3 border-r-2 border-black font-bold">{Number(promo.max_bonus) > 0 ? formatRupiah(promo.max_bonus) : 'Tanpa batas'}</td>
                  <td className="p-3 border-r-2 border-black text-center">
                    <span className={`px-2 py-1 border-2 border-black rounded font-black text-[10px] uppercase ${promo.is_active ? 'bg-mochi-green' : 'bg-gray-300'}`}>
                      {promo.is_active ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex justify-center gap-2">
                      <button disabled={busy} onClick={() => editPromo(promo)} className="px-3 py-1 border-2 border-black rounded bg-white font-bold shadow-neo text-xs disabled:opacity-50">Edit</button>
                      <button disabled={busy} onClick={() => togglePromoStatus(promo)} className={`px-3 py-1 border-2 border-black rounded font-bold shadow-neo text-xs disabled:opacity-50 ${promo.is_active ? 'bg-red-400 text-white' : 'bg-mochi-green'}`}>
                        {promo.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="border-2 border-black rounded-xl bg-white shadow-neo p-6">
        <h2 className="text-xl font-black mb-4 flex items-center gap-2"><GiftIcon className="w-6 h-6" /> Buat Kode Voucher Baru</h2>
        <form onSubmit={handleCreateVoucher} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 items-end">
          <div>
            <label className="text-xs font-bold mb-1 block">Kode Voucher</label>
            <input required type="text" placeholder="CTH: MOCHIBARU" value={newVoucher.code} onChange={(event) => setNewVoucher({ ...newVoucher, code: event.target.value.toUpperCase() })} className="w-full border-2 border-black rounded p-2 font-bold uppercase" />
          </div>
          <div>
            <label className="text-xs font-bold mb-1 block">Nominal (Rp)</label>
            <input required min="1" type="number" placeholder="5000" value={newVoucher.amount} onChange={(event) => setNewVoucher({ ...newVoucher, amount: event.target.value })} className="w-full border-2 border-black rounded p-2 font-bold" />
          </div>
          <div>
            <label className="text-xs font-bold mb-1 block">Nama Batch</label>
            <input required type="text" placeholder="Event Lebaran" value={newVoucher.batch} onChange={(event) => setNewVoucher({ ...newVoucher, batch: event.target.value })} className="w-full border-2 border-black rounded p-2 font-bold" />
          </div>
          <div>
            <label className="text-xs font-bold mb-1 block">Maksimal Penggunaan</label>
            <input required min="1" type="number" value={newVoucher.max_usage} onChange={(event) => setNewVoucher({ ...newVoucher, max_usage: event.target.value })} className="w-full border-2 border-black rounded p-2 font-bold" />
          </div>
          <MochiButton disabled={busy} className="py-2 text-sm w-full disabled:opacity-50">Buat Voucher</MochiButton>
        </form>
      </div>

      <div>
        <h2 className="text-xl font-black mb-4">Daftar Voucher</h2>
        <AdminFilterBar
          search={search}
          onSearchChange={setSearch}
          placeholder="Cari kode, batch, atau nominal voucher..."
          filter={statusFilter}
          onFilterChange={setStatusFilter}
          options={[
            { value: 'all', label: 'Semua Voucher' },
            { value: 'active', label: 'Voucher Aktif' },
            { value: 'inactive', label: 'Voucher Nonaktif' },
          ]}
          resultCount={filteredVouchers.length}
        />

        <div className="border-2 border-black rounded-xl bg-white shadow-neo overflow-x-auto">
          <table className="w-full text-left border-collapse font-mono">
            <thead>
              <tr className="bg-mochi-green border-b-2 border-black text-sm">
                <th className="p-3 border-r-2 border-black font-black">Kode</th>
                <th className="p-3 border-r-2 border-black font-black">Batch</th>
                <th className="p-3 border-r-2 border-black font-black">Nominal</th>
                <th className="p-3 border-r-2 border-black font-black text-center">Terpakai</th>
                <th className="p-3 border-r-2 border-black font-black">Maksimal Penggunaan</th>
                <th className="p-3 font-black text-center">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filteredVouchers.length === 0 ? (
                <tr><td colSpan="6" className="p-8 text-center font-bold">Voucher tidak ditemukan.</td></tr>
              ) : filteredVouchers.map((voucher) => (
                <tr key={voucher.code} className="border-b-2 border-black last:border-b-0 hover:bg-gray-50">
                  <td className="p-3 border-r-2 border-black font-bold">{voucher.code}</td>
                  <td className="p-3 border-r-2 border-black font-bold">{voucher.batch}</td>
                  <td className="p-3 border-r-2 border-black text-green-600 font-bold">{formatRupiah(voucher.amount)}</td>
                  <td className="p-3 border-r-2 border-black text-center font-bold">{voucher.current_usage}</td>
                  <td className="p-3 border-r-2 border-black">
                    <div className="flex min-w-[190px] gap-2">
                      <input
                        min={Math.max(1, Number(voucher.current_usage || 0))}
                        type="number"
                        value={voucherUsageDrafts[voucher.code] ?? voucher.max_usage}
                        onChange={(event) => setVoucherUsageDrafts((current) => ({ ...current, [voucher.code]: event.target.value }))}
                        className="w-24 border-2 border-black rounded px-2 py-1 font-bold"
                      />
                      <button disabled={busy || Number(voucherUsageDrafts[voucher.code]) === Number(voucher.max_usage)} onClick={() => updateVoucherMaxUsage(voucher)} className="px-3 py-1 border-2 border-black rounded bg-mochi-green font-bold shadow-neo text-xs disabled:opacity-40">
                        Simpan
                      </button>
                    </div>
                  </td>
                  <td className="p-3 text-center">
                    <button disabled={busy} onClick={() => toggleVoucherStatus(voucher.code, voucher.is_active)} className={`px-3 py-1 border-2 border-black rounded font-bold shadow-neo text-xs disabled:opacity-50 ${voucher.is_active ? 'bg-red-400 text-white' : 'bg-gray-300 text-black'}`}>
                      {voucher.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
