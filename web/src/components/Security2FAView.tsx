import {
  AlertCircle,
  CheckCircle2,
  Clock,
  KeyRound,
  Lock,
  LogOut,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Timer,
  Users,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useAppDispatch } from '../store/hooks';
import { showToast } from '../store/slices/uiSlice';

interface TokenSettings {
  session_lifetime_minutes: number;
  refresh_token_expiry_days: number;
  sliding_expiration: boolean;
  max_concurrent_sessions: number;
  updated_at?: number;
}

export const Security2FAView: React.FC = () => {
  const dispatch = useAppDispatch();

  // Token & Session Settings State
  const [tokenSettings, setTokenSettings] = useState<TokenSettings>({
    session_lifetime_minutes: 10080,
    refresh_token_expiry_days: 30,
    sliding_expiration: true,
    max_concurrent_sessions: 5,
  });
  const [activeSessionsCount, setActiveSessionsCount] = useState<number>(1);
  const [isLoadingTokenSettings, setIsLoadingTokenSettings] = useState(true);
  const [isSpinningTokenSettings, setIsSpinningTokenSettings] = useState(false);
  const [isSavingTokenSettings, setIsSavingTokenSettings] = useState(false);
  const [tokenSettingsSuccess, setTokenSettingsSuccess] = useState<string | null>(null);
  const [tokenSettingsError, setTokenSettingsError] = useState<string | null>(null);
  const [revokeOtherSessions, setRevokeOtherSessions] = useState(false);
  const [isRevokingAll, setIsRevokingAll] = useState(false);
  const [customMinutes, setCustomMinutes] = useState<string>('');
  const [isCustomPreset, setIsCustomPreset] = useState<boolean>(false);

  const fetchTokenSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/token-settings');
      if (res.ok) {
        const data = await res.json();
        if (data.settings) {
          setTokenSettings(data.settings);
          const knownPresets = [60, 480, 1440, 4320, 10080, 20160, 43200];
          if (!knownPresets.includes(data.settings.session_lifetime_minutes)) {
            setIsCustomPreset(true);
            setCustomMinutes(String(data.settings.session_lifetime_minutes));
          }
        }
        if (typeof data.active_sessions === 'number') {
          setActiveSessionsCount(data.active_sessions);
        }
      }
    } catch (err) {
      console.error('Failed to load token settings:', err);
    } finally {
      setIsLoadingTokenSettings(false);
    }
  }, []);

  useEffect(() => {
    fetchTokenSettings();
  }, [fetchTokenSettings]);

  const handleRefreshTokens = async () => {
    if (isSpinningTokenSettings || isLoadingTokenSettings) return;
    setIsSpinningTokenSettings(true);
    const minTimer = new Promise((resolve) => setTimeout(resolve, 650));
    try {
      await fetchTokenSettings();
      await minTimer;
      dispatch(showToast({ message: 'Token settings refreshed', type: 'success' }));
    } catch (err) {
      console.error(err);
      dispatch(showToast({ message: 'Failed to refresh token settings', type: 'error' }));
    } finally {
      setIsSpinningTokenSettings(false);
    }
  };

  const handleSaveTokenSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingTokenSettings(true);
    setTokenSettingsSuccess(null);
    setTokenSettingsError(null);

    const lifetimeMinutes = isCustomPreset
      ? Math.max(5, Number.parseInt(customMinutes, 10) || 60)
      : tokenSettings.session_lifetime_minutes;

    const payload = {
      session_lifetime_minutes: lifetimeMinutes,
      refresh_token_expiry_days: tokenSettings.refresh_token_expiry_days,
      sliding_expiration: tokenSettings.sliding_expiration,
      max_concurrent_sessions: tokenSettings.max_concurrent_sessions,
      revoke_other_sessions: revokeOtherSessions,
    };

    try {
      const res = await fetch('/api/admin/token-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || 'Failed to update token settings');
      }

      const data = await res.json();
      setTokenSettings(data.settings);
      setTokenSettingsSuccess(
        `Token settings saved successfully!${
          data.revoked_sessions > 0 ? ` ${data.revoked_sessions} other session(s) revoked.` : ''
        }`
      );
      setRevokeOtherSessions(false);
      fetchTokenSettings();
      setTimeout(() => setTokenSettingsSuccess(null), 5000);
    } catch (err: any) {
      setTokenSettingsError(err.message || 'Error saving settings');
    } finally {
      setIsSavingTokenSettings(false);
    }
  };

  const handleRevokeAllSessions = async () => {
    if (
      !confirm(
        'Revoke all other active user sessions immediately? All other signed-in devices will be forced to log in again.'
      )
    ) {
      return;
    }

    setIsRevokingAll(true);
    setTokenSettingsSuccess(null);
    setTokenSettingsError(null);

    try {
      const res = await fetch('/api/admin/token-settings/revoke-all', {
        method: 'POST',
      });
      if (!res.ok) {
        throw new Error('Failed to revoke sessions');
      }
      const data = await res.json();
      setTokenSettingsSuccess(`Successfully revoked ${data.revoked_count || 0} active session(s).`);
      fetchTokenSettings();
      setTimeout(() => setTokenSettingsSuccess(null), 5000);
    } catch (err: any) {
      setTokenSettingsError(err.message || 'Error revoking sessions');
    } finally {
      setIsRevokingAll(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 dark:bg-slate-950 overflow-y-auto p-6 md:p-8">
      <div className="max-w-5xl mx-auto w-full space-y-6 pb-12">
        {/* Header */}
        <div className="flex items-center gap-3 pb-6 border-b border-slate-200 dark:border-slate-800">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-500 text-white flex items-center justify-center shadow-md shadow-amber-500/20 flex-shrink-0">
            <ShieldCheck className="w-6 h-6 flex-shrink-0" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              System Security & Session Policy
            </h1>
            <p className="text-xs text-slate-400">
              Configure global session lifetimes, token expiration policies, and active concurrency
              limits
            </p>
          </div>
        </div>

        {/* Token & Session Policy Card (Admin) */}
        <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800 gap-3">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-cyan-500 text-white flex items-center justify-center flex-shrink-0 shadow-md shadow-indigo-500/20">
                <Timer className="w-5 h-5 flex-shrink-0" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Token & Session Lifetime Policy
                  </h2>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700 flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    <span>
                      {activeSessionsCount} Active{' '}
                      {activeSessionsCount === 1 ? 'Session' : 'Sessions'}
                    </span>
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Configure how long users stay signed in and adjust refresh token expiration and
                  sliding window policies.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-auto">
              <button
                type="button"
                onClick={handleRefreshTokens}
                disabled={isSpinningTokenSettings || isLoadingTokenSettings}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all active:scale-95 disabled:opacity-50"
                title="Refresh Token Settings"
              >
                <RefreshCw
                  className={`w-4 h-4 transition-transform duration-300 ${
                    isSpinningTokenSettings || isLoadingTokenSettings
                      ? 'animate-spin text-indigo-500'
                      : ''
                  }`}
                />
              </button>
              <button
                type="button"
                onClick={handleRevokeAllSessions}
                disabled={isRevokingAll}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 border border-rose-200 dark:border-rose-900/60 rounded-xl transition-all active:scale-95 disabled:opacity-50"
                title="Force logout all other devices"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{isRevokingAll ? 'Revoking...' : 'Revoke All Sessions'}</span>
              </button>
            </div>
          </div>

          {tokenSettingsSuccess && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 rounded-xl text-xs flex items-center gap-2 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
              <span>{tokenSettingsSuccess}</span>
            </div>
          )}

          {tokenSettingsError && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 rounded-xl text-xs flex items-center gap-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0" />
              <span>{tokenSettingsError}</span>
            </div>
          )}

          <form onSubmit={handleSaveTokenSettings} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Session Lifetime Setting */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Session Expiration Lifetime</span>
                </label>
                <p className="text-[11px] text-slate-400">
                  How long before a user session expires and requires re-authentication.
                </p>
                <select
                  value={isCustomPreset ? 'custom' : tokenSettings.session_lifetime_minutes}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'custom') {
                      setIsCustomPreset(true);
                      setCustomMinutes(String(tokenSettings.session_lifetime_minutes));
                    } else {
                      setIsCustomPreset(false);
                      setTokenSettings((prev) => ({
                        ...prev,
                        session_lifetime_minutes: Number.parseInt(val, 10),
                      }));
                    }
                  }}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 font-medium focus:outline-none focus:ring-2 focus:ring-slate-900/25 dark:focus:ring-white/30 focus:border-slate-900 dark:focus:border-white"
                >
                  <option value={60}>1 Hour (High Security / Strict)</option>
                  <option value={480}>8 Hours (Standard Workday)</option>
                  <option value={1440}>24 Hours (1 Day)</option>
                  <option value={4320}>3 Days</option>
                  <option value={10080}>7 Days (Default Standard)</option>
                  <option value={20160}>14 Days (Two Weeks)</option>
                  <option value={43200}>30 Days (Extended)</option>
                  <option value="custom">Custom Minutes...</option>
                </select>

                {isCustomPreset && (
                  <div className="pt-1.5 flex items-center gap-2">
                    <input
                      type="number"
                      min={5}
                      max={525600}
                      value={customMinutes}
                      onChange={(e) => setCustomMinutes(e.target.value)}
                      placeholder="Minutes (e.g. 120)"
                      className="w-36 px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:ring-2 focus:ring-slate-900/25 dark:focus:ring-white/30 focus:border-slate-900 dark:focus:border-white"
                    />
                    <span className="text-[11px] text-slate-500">minutes</span>
                  </div>
                )}
              </div>

              {/* Refresh Token Expiration */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 text-cyan-500" />
                  <span>Refresh Token Maximum Expiry</span>
                </label>
                <p className="text-[11px] text-slate-400">
                  Maximum total lifespan of inactive session refresh before hard cutoff.
                </p>
                <select
                  value={tokenSettings.refresh_token_expiry_days}
                  onChange={(e) =>
                    setTokenSettings((prev) => ({
                      ...prev,
                      refresh_token_expiry_days: Number.parseInt(e.target.value, 10),
                    }))
                  }
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 font-medium focus:outline-none focus:ring-2 focus:ring-slate-900/25 dark:focus:ring-white/30 focus:border-slate-900 dark:focus:border-white"
                >
                  <option value={7}>7 Days</option>
                  <option value={14}>14 Days</option>
                  <option value={30}>30 Days (Recommended)</option>
                  <option value={60}>60 Days</option>
                  <option value={90}>90 Days (Quarterly)</option>
                  <option value={180}>180 Days (Half Year)</option>
                  <option value={365}>365 Days (1 Year)</option>
                </select>
              </div>
            </div>

            {/* Sliding Session Expiration & Max Concurrent Sessions */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-violet-500" />
                  <span>Max Concurrent Sessions per User</span>
                </label>
                <p className="text-[11px] text-slate-400">
                  Limit active logins per account across multiple devices or browsers.
                </p>
                <select
                  value={tokenSettings.max_concurrent_sessions}
                  onChange={(e) =>
                    setTokenSettings((prev) => ({
                      ...prev,
                      max_concurrent_sessions: Number.parseInt(e.target.value, 10),
                    }))
                  }
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 font-medium focus:outline-none focus:ring-2 focus:ring-slate-900/25 dark:focus:ring-white/30 focus:border-slate-900 dark:focus:border-white"
                >
                  <option value={1}>1 Session (Strict Single-Device Only)</option>
                  <option value={3}>3 Sessions</option>
                  <option value={5}>5 Sessions (Default)</option>
                  <option value={10}>10 Sessions</option>
                  <option value={0}>Unlimited Concurrent Sessions</option>
                </select>
              </div>

              <div className="flex flex-col justify-center space-y-2">
                <label className="flex items-start gap-2.5 cursor-pointer pt-3">
                  <input
                    type="checkbox"
                    checked={tokenSettings.sliding_expiration}
                    onChange={(e) =>
                      setTokenSettings((prev) => ({
                        ...prev,
                        sliding_expiration: e.target.checked,
                      }))
                    }
                    className="w-4 h-4 text-slate-900 dark:text-white rounded border-slate-300 dark:border-slate-700 mt-0.5 focus:ring-slate-900/25 dark:focus:ring-white/30"
                  />
                  <div>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      Enable Sliding Session Renewal
                    </span>
                    <p className="text-[11px] text-slate-400">
                      Active browsing automatically extends the expiration window up to the refresh
                      token ceiling.
                    </p>
                  </div>
                </label>
              </div>
            </div>

            {/* Revoke other sessions on save checkbox */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-600 dark:text-slate-400">
                <input
                  type="checkbox"
                  checked={revokeOtherSessions}
                  onChange={(e) => setRevokeOtherSessions(e.target.checked)}
                  className="w-3.5 h-3.5 text-slate-900 dark:text-white rounded border-slate-300 dark:border-slate-700 focus:ring-slate-900/25 dark:focus:ring-white/30"
                />
                <span>Invalidate all other existing user sessions when saving</span>
              </label>

              <button
                type="submit"
                disabled={isSavingTokenSettings}
                className="btn-primary px-5 py-2 text-xs font-bold rounded-xl shadow-md cursor-pointer disabled:opacity-50 transition-all active:scale-95 self-start sm:self-auto"
              >
                {isSavingTokenSettings ? 'Saving Policy...' : 'Save Token Policy'}
              </button>
            </div>
          </form>
        </div>

        {/* Security Architecture & Storage Policy */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1">
            <div className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-indigo-500" />
              <span>Password Encryption</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Passwords are salted and hashed with modern <strong>Bcrypt</strong>. Plaintext
              passwords are never stored or logged.
            </p>
          </div>

          <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1">
            <div className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-emerald-500" />
              <span>Brute-Force Shield</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Automated in-memory rate limiting throttles suspicious credential stuffing and
              password-spraying attempts.
            </p>
          </div>

          <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1">
            <div className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-violet-500" />
              <span>Two-Factor Authentication</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Individual users manage their own RFC 6238 TOTP authenticator and backup recovery
              codes directly in their User Settings.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
