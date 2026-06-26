import { useCallback, useState, useEffect } from 'react';
import { adminApi } from '../../lib/adminApi';
import MochiButton from '../../components/MochiButton';
import { GiftIcon } from '../../components/Icons';
import AdminFilterBar from '../../components/admin/AdminFilterBar';
import MochiLoader from '../../components/MochiLoader';
import AdminPagination from '../../components/admin/AdminPagination';

const EMPTY_PROMO = {
  promo_name: '',
  percentage: '',
  min_deposit: '',
  max_bonus: '',
  is_active: true,
};

const formatRupiah = (value) => `Rp.${Number(value || 0).toLocaleString('id-ID')}`;
const PAGE_SIZE = 20;

export default function AdminVouchers() {
  const [vouchers, setVouchers] = useState([]);
  const [promos, setPromos] = useState([]);
  const [promoForm, setPromoForm] = useState(EMPTY_PROMO);
  const [editingPromoId, setEditingPromoId] = useState(null);
  const [newVoucher, setNewVoucher] = useState({ code: '', amount: '', batch: '' });
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [promoSearch, setPromoSearch] = useState('');
  const [promoStatusFilter, setPromoStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [promoPage, setPromoPage] = useState(1);
  const [voucherPage, setVoucherPage] = useState(1);
  const [promoPagination, setPromoPagination] = useState({
    page: 1,
    pageSize: PAGE_SIZE,
    total: 0,
    totalPages: 1,
  });
  const [voucherPagination, setVoucherPagination] = useState({
    page: 1,
    pageSize: PAGE_SIZE,
    total: 0,
    totalPages: 1,
  });

  const applyData = useCallback((result) => {
    setVouchers(result.vouchers || []);
    setPromos(result.promos || []);
    setVoucherPagination(result.vouchersPagination || {
      page: voucherPage,
      pageSize: PAGE_SIZE,
      total: result.vouchers?.length || 0,
      totalPages: 1,
    });
    setPromoPagination(result.promosPagination || {
      page: promoPage,
      pageSize: PAGE_SIZE,
      total: result.promos?.length || 0,
      totalPages: 1,
    });
  }, [promoPage, voucherPage]);

  const loadData = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setErrorMessage('');
    try {
      const result = await adminApi('vouchers.list', {
        promos: {
          page: promoPage,
          pageSize: PAGE_SIZE,
          search: promoSearch,
          status: promoStatusFilter,
        },
        vouchers: {
          page: voucherPage,
          pageSize: PAGE_SIZE,
          search,
          status: statusFilter,
        },
      });
      applyData(result);
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [applyData, promoPage, promoSearch, promoStatusFilter, search, statusFilter, voucherPage]);

  useEffect(() => {
    const timeout = window.setTimeout(loadData, 0);
    return () => window.clearTimeout(timeout);
  }, [loadData]);

  const refreshData = async () => {
    await loadData(false);
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
      setNewVoucher({ code: '', amount: '', batch: '' });
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

  const handlePromoSearchChange = (value) => {
    setPromoSearch(value);
    setPromoPage(1);
  };

  const handlePromoStatusChange = (value) => {
    setPromoStatusFilter(value);
    setPromoPage(1);
  };

  const handleVoucherSearchChange = (value) => {
    setSearch(value);
    setVoucherPage(1);
  };

  const handleVoucherStatusChange = (value) => {
    setStatusFilter(value);
    setVoucherPage(1);
  };

  if (loading) return <MochiLoader message="Memuat voucher dan promo..." />;

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
          onSearchChange={handlePromoSearchChange}
          placeholder="Cari nama, persentase, atau nominal promo..."
          filter={promoStatusFilter}
          onFilterChange={handlePromoStatusChange}
          options={[
            { value: 'all', label: 'Semua Promo' },
            { value: 'active', label: 'Promo Aktif' },
            { value: 'inactive', label: 'Promo Nonaktif' },
          ]}
          resultCount={promoPagination.total}
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
              {promos.length === 0 ? (
                <tr><td colSpan="6" className="p-8 text-center font-bold">Promo tidak ditemukan.</td></tr>
              ) : promos.map((promo) => (
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
        <AdminPagination
          page={promoPagination.page}
          totalPages={promoPagination.totalPages}
          total={promoPagination.total}
          pageSize={promoPagination.pageSize}
          onPageChange={setPromoPage}
        />
      </div>

      <div className="border-2 border-black rounded-xl bg-white shadow-neo p-6">
        <h2 className="text-xl font-black mb-4 flex items-center gap-2"><GiftIcon className="w-6 h-6" /> Buat Kode Voucher Baru</h2>
        <form onSubmit={handleCreateVoucher} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-end">
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
          <MochiButton disabled={busy} className="py-2 text-sm w-full disabled:opacity-50">Buat Voucher</MochiButton>
        </form>
      </div>

      <div>
        <h2 className="text-xl font-black mb-4">Daftar Voucher</h2>
        <AdminFilterBar
          search={search}
          onSearchChange={handleVoucherSearchChange}
          placeholder="Cari kode, batch, atau nominal voucher..."
          filter={statusFilter}
          onFilterChange={handleVoucherStatusChange}
          options={[
            { value: 'all', label: 'Semua Voucher' },
            { value: 'active', label: 'Voucher Aktif' },
            { value: 'inactive', label: 'Voucher Nonaktif' },
          ]}
          resultCount={voucherPagination.total}
        />

        <div className="border-2 border-black rounded-xl bg-white shadow-neo overflow-x-auto">
          <table className="w-full text-left border-collapse font-mono">
            <thead>
              <tr className="bg-mochi-green border-b-2 border-black text-sm">
                <th className="p-3 border-r-2 border-black font-black">Kode</th>
                <th className="p-3 border-r-2 border-black font-black">Batch</th>
                <th className="p-3 border-r-2 border-black font-black">Nominal</th>
                <th className="p-3 border-r-2 border-black font-black text-center">Status</th>
                <th className="p-3 font-black text-center">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {vouchers.length === 0 ? (
                <tr><td colSpan="5" className="p-8 text-center font-bold">Voucher tidak ditemukan.</td></tr>
              ) : vouchers.map((voucher) => (
                <tr key={voucher.code} className="border-b-2 border-black last:border-b-0 hover:bg-gray-50">
                  <td className="p-3 border-r-2 border-black font-bold">{voucher.code}</td>
                  <td className="p-3 border-r-2 border-black font-bold">{voucher.batch}</td>
                  <td className="p-3 border-r-2 border-black text-green-600 font-bold">{formatRupiah(voucher.amount)}</td>
                  <td className="p-3 border-r-2 border-black text-center">
                    <span className={`px-2 py-1 border-2 border-black rounded font-black text-[10px] uppercase ${voucher.is_active ? 'bg-mochi-green' : 'bg-gray-300'}`}>
                      {voucher.is_active ? 'Belum Dipakai' : 'Terpakai'}
                    </span>
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
        <AdminPagination
          page={voucherPagination.page}
          totalPages={voucherPagination.totalPages}
          total={voucherPagination.total}
          pageSize={voucherPagination.pageSize}
          onPageChange={setVoucherPage}
        />
      </div>
    </div>
  );
}
