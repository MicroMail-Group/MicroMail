import { KeyRound, LogIn, Mail, RefreshCw, Search, Trash2, UserPlus, Users, X } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppDispatch } from '../store/hooks';
import { showToast } from '../store/slices/uiSlice';

interface UserAccount {
  id: string;
  email: string;
  display_name: string;
  created_at: number;
}

export const AdminAccountsView: React.FC = () => {
  const dispatch = useAppDispatch();
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const [search, setSearch] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Create User Modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  // Change Password Modal
  const [passwordModalUser, setPasswordModalUser] = useState<UserAccount | null>(null);
  const [changedPassword, setChangedPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/admin/users');
      if (res.ok) {
        const data = await res.json();
        setUsers(data || []);
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleRefresh = async () => {
    if (isSpinning || isLoading) return;
    setIsSpinning(true);
    const minTimer = new Promise((resolve) => setTimeout(resolve, 650));
    try {
      await fetchUsers();
      await minTimer;
      dispatch(showToast({ message: 'Accounts list refreshed', type: 'success' }));
    } catch (err) {
      console.error(err);
      dispatch(showToast({ message: 'Failed to refresh accounts list', type: 'error' }));
    } finally {
      setIsSpinning(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: newEmail,
          password: newPassword,
          display_name: newDisplayName || newEmail.split('@')[0],
        }),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || 'Failed to create user');
      }

      setIsCreateOpen(false);
      setNewEmail('');
      setNewPassword('');
      setNewDisplayName('');
      await fetchUsers();
    } catch (err: any) {
      setCreateError(err.message);
    }
  };

  const handleDeleteUser = async (user: UserAccount) => {
    if (
      !confirm(
        `Are you sure you want to delete mailbox "${user.email}"? All emails and blobs will be removed.`
      )
    ) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const txt = await res.text();
        alert(`Error: ${txt}`);
        return;
      }
      await fetchUsers();
    } catch (err) {
      console.error(err);
    }
  };

  const handleSwitchUser = async (user: UserAccount) => {
    try {
      const res = await fetch(`/api/admin/users/${user.id}/switch`, { method: 'POST' });
      if (!res.ok) {
        const txt = await res.text();
        alert(`Error: ${txt}`);
        return;
      }
      window.location.reload();
    } catch (err) {
      console.error('Failed to switch user:', err);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordModalUser) return;
    setPasswordError(null);

    try {
      const res = await fetch(`/api/admin/users/${passwordModalUser.id}/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: changedPassword }),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt);
      }

      setPasswordModalUser(null);
      setChangedPassword('');
      alert('Password updated successfully');
    } catch (err: any) {
      setPasswordError(err.message);
    }
  };

  const filteredUsers = users.filter(
    (u) =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.display_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 dark:bg-slate-950 overflow-y-auto p-6 md:p-8">
      <div className="max-w-5xl mx-auto w-full space-y-6">
        {/* Top Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20 flex-shrink-0">
              <Users className="w-6 h-6 flex-shrink-0" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Mailbox & Account Management
              </h1>
              <p className="text-xs text-slate-400">
                Create and manage individual user email accounts on your domain
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Circle Refresh Button with Hover Tooltip */}
            <div className="relative group">
              <button
                type="button"
                onClick={handleRefresh}
                disabled={isSpinning || isLoading}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all active:scale-95 disabled:opacity-50"
                title="Refresh Mailbox List"
                aria-label="Refresh Mailbox List"
              >
                <RefreshCw
                  className={`w-4 h-4 transition-transform duration-300 ${
                    isSpinning || isLoading ? 'animate-spin text-indigo-500' : ''
                  }`}
                />
              </button>
              <span className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] font-medium px-2 py-0.5 rounded shadow-md whitespace-nowrap z-30">
                Refresh list
              </span>
            </div>

            {/* Circle Create New Mailbox Button with Hover Tooltip */}
            <div className="relative group">
              <button
                type="button"
                onClick={() => setIsCreateOpen(true)}
                aria-label="Create New Mailbox"
                className="w-8 h-8 rounded-full flex items-center justify-center btn-primary shadow-sm transition-all hover:scale-110 active:scale-95"
              >
                <UserPlus className="w-4 h-4" />
              </button>
              <span className="pointer-events-none absolute -bottom-7 right-0 md:left-1/2 md:-translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] font-medium px-2 py-0.5 rounded shadow-md whitespace-nowrap z-30">
                Create New Mailbox
              </span>
            </div>
          </div>
        </div>

        {/* Search Bar Row with Animated Expandable Circle Search Button */}
        <div className="flex items-center justify-between gap-4 min-h-[36px] overflow-hidden">
          <div className="flex items-center gap-2">
            <div
              className={`transition-all duration-300 ease-in-out ${
                isSearchOpen
                  ? 'max-w-0 opacity-0 scale-75 pointer-events-none overflow-hidden'
                  : 'opacity-100 scale-100'
              }`}
            >
              <div className="relative group">
                <button
                  type="button"
                  onClick={() => {
                    setIsSearchOpen(true);
                    setTimeout(() => searchInputRef.current?.focus(), 50);
                  }}
                  aria-label="Filter mailboxes"
                  className="w-8 h-8 rounded-full flex items-center justify-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm transition-all hover:scale-105 active:scale-95"
                >
                  <Search className="w-4 h-4" />
                </button>
                <span className="pointer-events-none absolute -bottom-7 left-0 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] font-medium px-2 py-0.5 rounded shadow-md whitespace-nowrap z-30">
                  Search mailboxes
                </span>
              </div>
            </div>

            <div
              className={`flex items-center gap-2 transition-all duration-300 ease-in-out ${
                isSearchOpen
                  ? 'max-w-xs sm:max-w-sm opacity-100 scale-100'
                  : 'max-w-0 opacity-0 scale-95 pointer-events-none overflow-hidden'
              }`}
            >
              <div className="relative flex items-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-full px-3 py-1.5 shadow-sm w-72 sm:w-80 focus-within:ring-2 focus-within:ring-slate-900/25 dark:focus-within:ring-white/30 focus-within:border-slate-900 dark:focus-within:border-white transition-all">
                <Search className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      if (search) {
                        setSearch('');
                      } else {
                        setIsSearchOpen(false);
                      }
                    }
                  }}
                  placeholder="Filter accounts by email or name..."
                  className="w-full bg-transparent text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 px-2 focus:outline-none"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('');
                      searchInputRef.current?.focus();
                    }}
                    className="w-4 h-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex items-center justify-center transition-colors"
                    title="Clear search"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              <div className="relative group">
                <button
                  type="button"
                  onClick={() => {
                    setIsSearchOpen(false);
                    setSearch('');
                  }}
                  aria-label="Close search"
                  className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all hover:scale-110 active:scale-95"
                >
                  <X className="w-4 h-4" />
                </button>
                <span className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] font-medium px-2 py-0.5 rounded shadow-md whitespace-nowrap z-30">
                  Close search
                </span>
              </div>
            </div>
          </div>

          <span className="text-xs text-slate-400">
            Total Mailboxes:{' '}
            <strong className="text-slate-700 dark:text-slate-200">{filteredUsers.length}</strong>
            {filteredUsers.length !== users.length && (
              <span className="text-slate-400 text-[11px] ml-1">of {users.length}</span>
            )}
          </span>
        </div>

        {/* Accounts Table */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-100 dark:border-slate-800">
                <tr>
                  <th className="p-3.5">Mailbox Email</th>
                  <th className="p-3.5">Display Name</th>
                  <th className="p-3.5">Created Date</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-slate-400">
                      No mailboxes match your query.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => (
                    <tr
                      key={u.id}
                      className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="p-3.5 font-medium font-mono text-slate-900 dark:text-slate-100">
                        <div className="flex items-center gap-2">
                          <Mail className="w-3.5 h-3.5 text-indigo-500" />
                          <span>{u.email}</span>
                          {u.email.toLowerCase().startsWith('postmaster@') && (
                            <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-md">
                              System
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3.5 text-slate-700 dark:text-slate-300">
                        {u.display_name || '—'}
                      </td>
                      <td className="p-3.5 text-slate-400">
                        {new Date(u.created_at * 1000).toLocaleDateString([], {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>
                      <td className="p-3.5 text-right space-x-1">
                        <button
                          type="button"
                          onClick={() => handleSwitchUser(u)}
                          className="w-8 h-8 inline-flex items-center justify-center text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded-full transition-all active:scale-95"
                          title={`Switch session to ${u.email}`}
                        >
                          <LogIn className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPasswordModalUser(u)}
                          className="w-8 h-8 inline-flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-all active:scale-95"
                          title="Change Password"
                        >
                          <KeyRound className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteUser(u)}
                          className="w-8 h-8 inline-flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-full transition-all active:scale-95"
                          title="Delete Account"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Create Mailbox Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-md p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                Create New Mailbox
              </h3>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-all active:scale-95"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {createError && (
              <div className="p-2.5 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 rounded-xl text-xs">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateUser} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Email Address
                </label>
                <input
                  type="text"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="alice@yourdomain.com (or alice)"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/25 dark:focus:ring-white/30 focus:border-slate-900 dark:focus:border-white"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Display Name
                </label>
                <input
                  type="text"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  placeholder="Alice Smith"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/25 dark:focus:ring-white/30 focus:border-slate-900 dark:focus:border-white"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Password
                </label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/25 dark:focus:ring-white/30 focus:border-slate-900 dark:focus:border-white"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 btn-primary text-xs font-medium rounded-lg shadow-sm"
                >
                  Create Mailbox
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {passwordModalUser && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-sm p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                Change Password for {passwordModalUser.email}
              </h3>
              <button
                type="button"
                onClick={() => setPasswordModalUser(null)}
                className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-all active:scale-95"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {passwordError && (
              <div className="p-2.5 bg-rose-50 text-rose-700 rounded-xl text-xs">
                {passwordError}
              </div>
            )}

            <form onSubmit={handleUpdatePassword} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  New Password
                </label>
                <input
                  type="password"
                  required
                  value={changedPassword}
                  onChange={(e) => setChangedPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-none"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPasswordModalUser(null)}
                  className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 btn-primary text-xs font-medium rounded-lg shadow-sm"
                >
                  Update Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
