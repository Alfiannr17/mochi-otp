import { useMemo, useState, useEffect } from 'react';
import { adminApi } from '../../lib/adminApi';
import AdminFilterBar from '../../components/admin/AdminFilterBar';

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [balanceDrafts, setBalanceDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [busyUserId, setBusyUserId] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    let active = true;

    const loadUsers = async () => {
      try {
        const result = await adminApi('users.list');
        if (active) setUsers(result.users);
      } catch (error) {
        if (active) setErrorMessage(error.message);
      } finally {
        if (active) setLoading(false);
      }
    };

    loadUsers();
    return () => {
      active = false;
    };
  }, []);

  const toggleBan = async (id, currentStatus) => {
    setBusyUserId(id);
    setMessage('');
    setErrorMessage('');
    try {
      const result = await adminApi('users.toggleBan', { id, isBanned: !currentStatus });
      setUsers((currentUsers) => currentUsers.map((user) => (
        user.id === id ? result.user : user
      )));
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusyUserId(null);
    }
  };

  const adjustBalance = async (user, adjustment) => {
    setBusyUserId(user.id);
    setMessage('');
    setErrorMessage('');
    try {
      const result = await adminApi('users.adjustBalance', {
        id: user.id,
        amount: balanceDrafts[user.id],
        adjustment,
      });
      setUsers((currentUsers) => currentUsers.map((currentUser) => (
        currentUser.id === user.id ? result.user : currentUser
      )));
      setBalanceDrafts((current) => ({ ...current, [user.id]: '' }));
      setMessage(
        `Saldo @${user.username || user.id} berhasil ${
          adjustment === 'add' ? 'ditambahkan' : 'dikurangi'
        }. Saldo sekarang Rp.${Number(result.user.balance).toLocaleString('id-ID')}.`,
      );
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusyUserId(null);
    }
  };

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter((user) => {
      const matchesSearch = !query || [user.id, user.username]
        .some((value) => String(value ?? '').toLowerCase().includes(query));
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'banned' && user.is_banned) ||
        (statusFilter === 'active' && !user.is_banned);
      return matchesSearch && matchesStatus;
    });
  }, [search, statusFilter, users]);

  return (
    <div>
      <h1 className="text-3xl font-black mb-6">Manajemen User</h1>
      {message && <div className="mb-5 border-4 border-black rounded-xl bg-mochi-green p-4 font-bold shadow-neo">{message}</div>}
      {errorMessage && <div className="mb-5 border-4 border-black rounded-xl bg-red-300 p-4 font-bold shadow-neo">{errorMessage}</div>}
      <AdminFilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder="Cari ID atau username..."
        filter={statusFilter}
        onFilterChange={setStatusFilter}
        options={[
          { value: 'all', label: 'Semua User' },
          { value: 'active', label: 'User Aktif' },
          { value: 'banned', label: 'User Diblokir' },
        ]}
        resultCount={filteredUsers.length}
      />
      
      <div className="border-2 border-black rounded-xl bg-white shadow-neo overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-mochi-green border-b-2 border-black text-sm md:text-base">
              <th className="p-4 border-r-2 border-black font-black">ID</th>
              <th className="p-4 border-r-2 border-black font-black">Username</th>
              <th className="p-4 border-r-2 border-black font-black">Saldo</th>
              <th className="p-4 border-r-2 border-black font-black">Atur Saldo</th>
              <th className="p-4 border-r-2 border-black font-black">Gabung</th>
              <th className="p-4 font-black text-center">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="6" className="p-8 text-center font-bold">Memuat data...</td></tr>
            ) : filteredUsers.length === 0 ? (
              <tr><td colSpan="6" className="p-8 text-center font-bold">User tidak ditemukan.</td></tr>
            ) : filteredUsers.map((u) => (
              <tr key={u.id} className="border-b-2 border-black last:border-b-0 hover:bg-gray-50 transition-colors">
                <td className="p-4 border-r-2 border-black font-mono text-xs md:text-sm">{u.id}</td>
                <td className="p-4 border-r-2 border-black font-bold">@{u.username}</td>
                <td className="p-4 border-r-2 border-black font-bold text-green-600">
                  Rp.{Number(u.balance).toLocaleString('id-ID')}
                </td>
                <td className="p-4 border-r-2 border-black">
                  <div className="min-w-[250px]">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="Nominal saldo"
                      value={balanceDrafts[u.id] || ''}
                      onChange={(event) => setBalanceDrafts((current) => ({
                        ...current,
                        [u.id]: event.target.value,
                      }))}
                      className="w-full border-2 border-black rounded-lg px-3 py-2 font-bold outline-none mb-2"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => adjustBalance(u, 'add')}
                        disabled={busyUserId === u.id || !balanceDrafts[u.id]}
                        className="border-2 border-black rounded-lg bg-mochi-green px-3 py-2 font-black text-xs shadow-neo active:translate-y-1 active:shadow-none disabled:opacity-40"
                      >
                        + Tambah
                      </button>
                      <button
                        type="button"
                        onClick={() => adjustBalance(u, 'subtract')}
                        disabled={busyUserId === u.id || !balanceDrafts[u.id]}
                        className="border-2 border-black rounded-lg bg-red-400 text-white px-3 py-2 font-black text-xs shadow-neo active:translate-y-1 active:shadow-none disabled:opacity-40"
                      >
                        - Kurangi
                      </button>
                    </div>
                  </div>
                </td>
                <td className="p-4 border-r-2 border-black text-xs md:text-sm">
                  {new Date(u.joined_at).toLocaleDateString('id-ID')}
                </td>
                <td className="p-4 text-center">
                  <button 
                    onClick={() => toggleBan(u.id, u.is_banned)}
                    disabled={busyUserId === u.id}
                    className={`px-4 py-2 border-2 border-black rounded font-bold shadow-neo active:translate-y-1 active:shadow-none transition-all ${
                      u.is_banned ? 'bg-red-400 text-white' : 'bg-white text-black hover:bg-gray-200'
                    } disabled:opacity-50`}
                  >
                    {u.is_banned ? 'Unban' : 'Ban'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
