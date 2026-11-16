import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle,
  Copy,
  Globe,
  KeyRound,
  Lock,
  Mail,
  RotateCcw,
  Server,
  ShieldAlert,
  User,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import { copyTextToClipboard } from '../utils/clipboard';
import { AntManEmailGraphic } from './AntManEmailGraphic';

interface FirstTimeSetupWizardProps {
  onComplete: (user: any) => void;
  defaultDomain?: string;
  defaultHostname?: string;
}

const STORAGE_DRAFT_KEY = 'micromail_setup_draft';

export const FirstTimeSetupWizard: React.FC<FirstTimeSetupWizardProps> = ({
  onComplete,
  defaultDomain = 'yourdomain.com',
  defaultHostname = 'mail.yourdomain.com',
}) => {
  // Check URL query parameters for auto-passed token
  const getInitialToken = (): string => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.search);
    return params.get('setup_token') || params.get('token') || '';
  };

  // Restore saved draft if available
  const getInitialDraft = () => {
    if (typeof window === 'undefined') return null;
    try {
      const saved = localStorage.getItem(STORAGE_DRAFT_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn('Failed to parse setup draft:', e);
    }
    return null;
  };

  const draft = getInitialDraft();

  const [step, setStep] = useState<number>(0);
  const [setupToken, setSetupToken] = useState<string>(draft?.setupToken || getInitialToken());
  const [isTokenVerified, setIsTokenVerified] = useState<boolean>(draft?.isTokenVerified || false);
  const [adminEmail, setAdminEmail] = useState<string>(draft?.adminEmail || '');
  const [displayName, setDisplayName] = useState<string>(draft?.displayName || '');
  const [adminPassword, setAdminPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [mailDomain, setMailDomain] = useState<string>(
    draft?.mailDomain || (defaultDomain === 'localhost' ? '' : defaultDomain)
  );
  const [mailHostname, setMailHostname] = useState<string>(
    draft?.mailHostname || (defaultHostname === 'mail.localhost' ? '' : defaultHostname)
  );

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [dkimValue, setDkimValue] = useState<string>('');
  const [isVerifyingToken, setIsVerifyingToken] = useState<boolean>(false);
  const [isResetting, setIsResetting] = useState<boolean>(false);

  // Auto-save draft on changes to make setup resumable
  useEffect(() => {
    const data = {
      step,
      setupToken,
      isTokenVerified,
      adminEmail,
      displayName,
      mailDomain,
      mailHostname,
    };
    try {
      localStorage.setItem(STORAGE_DRAFT_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Failed to save setup draft:', e);
    }
  }, [step, setupToken, isTokenVerified, adminEmail, displayName, mailDomain, mailHostname]);

  useEffect(() => {
    fetch('/api/system/dkim')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.dns_record) {
          setDkimValue(data.dns_record);
        }
      })
      .catch((err) => console.error(err));
  }, []);

  const copyToClipboard = async (text: string, keyName: string) => {
    await copyTextToClipboard(text);
    setCopiedKey(keyName);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  // Verify setup token against backend
  const verifyToken = async (tok = setupToken): Promise<boolean> => {
    if (!tok.trim()) {
      setError('Please enter the security token from your server logs.');
      return false;
    }
    setIsVerifyingToken(true);
    setError(null);

    try {
      const res = await fetch('/api/setup/verify-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tok.trim() }),
      });

      if (!res.ok) {
        throw new Error(
          'Invalid setup security token. Check your container console logs or /data/setup_token.'
        );
      }

      setIsTokenVerified(true);
      return true;
    } catch (err: any) {
      setIsTokenVerified(false);
      setError(err.message || 'Token verification failed');
      return false;
    } finally {
      setIsVerifyingToken(false);
    }
  };

  const handleStep1Next = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // 1. Enforce setup token verification to prevent hijacking
    if (!isTokenVerified) {
      const valid = await verifyToken();
      if (!valid) return;
    }

    if (!adminEmail || !adminPassword) {
      setError('Email and password are required');
      return;
    }
    if (adminPassword.length < 6) {
      setError('Password must be at least 6 characters long');
      return;
    }
    if (adminPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    // Auto-suggest domain if not set
    if (!mailDomain && adminEmail.includes('@')) {
      const dom = adminEmail.split('@')[1];
      setMailDomain(dom);
      setMailHostname(`mail.${dom}`);
    }

    setStep(2);
  };

  const handleStep2Next = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!mailDomain) {
      setError('Mail domain is required (e.g. yourcompany.com)');
      return;
    }
    if (!mailHostname) {
      setMailHostname(`mail.${mailDomain}`);
    }
    setStep(3);
  };

  const handleResetSetup = async () => {
    if (
      !confirm(
        'Reset setup wizard? This will wipe your draft and generate a fresh security token on the server.'
      )
    ) {
      return;
    }

    setIsResetting(true);
    try {
      const res = await fetch('/api/setup/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setup_token: setupToken }),
      });

      localStorage.removeItem(STORAGE_DRAFT_KEY);
      setStep(1);
      setSetupToken('');
      setIsTokenVerified(false);
      setAdminEmail('');
      setDisplayName('');
      setAdminPassword('');
      setConfirmPassword('');
      setMailDomain('');
      setMailHostname('');
      setError(null);

      if (res.ok) {
        const data = await res.json();
        if (data.token) {
          setSetupToken(data.token);
        }
      }
    } catch (err: any) {
      console.error('Reset error:', err);
    } finally {
      setIsResetting(false);
    }
  };

  const handleFinalSubmit = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/setup/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          setup_token: setupToken.trim(),
          admin_email: adminEmail,
          admin_password: adminPassword,
          display_name: displayName || 'Administrator',
          mail_domain: mailDomain,
          mail_hostname: mailHostname || `mail.${mailDomain}`,
        }),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || 'Initialization failed');
      }

      const data = await res.json();
      localStorage.removeItem(STORAGE_DRAFT_KEY);
      onComplete(data.user);
    } catch (err: any) {
      setError(err.message || 'Setup failed');
      setIsSubmitting(false);
    }
  };

  if (step === 0) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col items-center justify-center p-6 sm:p-10 overflow-y-auto">
        {/* Subtle Background Glow */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(255,255,255,0.08),rgba(255,255,255,0))] pointer-events-none" />

        {/* Top Bar: Brand tag */}
        <div className="w-full max-w-4xl flex items-center justify-start absolute top-6 left-6 sm:top-10 sm:left-10 z-10">
          <div className="flex items-center gap-2.5">
            <img
              src="/micromail-icon.png"
              alt="MicroMail"
              className="w-8 h-8 rounded-xl border border-slate-800 object-cover"
            />
            <span className="font-bold text-sm tracking-tight text-white">MicroMail</span>
          </div>
        </div>

        {/* Center: Hero Graphic, Title, Tagline & CTA */}
        <div className="max-w-xl w-full mx-auto flex flex-col items-center text-center space-y-6 my-auto py-8 relative z-10 animate-view-fade">
          {/* Ant-Man Email Animation Graphic (Pure White) */}
          <AntManEmailGraphic />

          {/* MicroMail Title */}
          <div className="space-y-3">
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-black text-white tracking-tight flex items-center justify-center">
              MicroMail
            </h1>

            {/* Tagline */}
            <p className="text-base sm:text-lg text-slate-300 font-medium tracking-wide max-w-md mx-auto">
              "A tiny footprint for big conversations."
            </p>
          </div>

          {/* Call to Action Button */}
          <div className="pt-4 flex flex-col items-center w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="btn-primary w-full sm:w-auto px-8 py-3.5 text-sm sm:text-base font-bold rounded-2xl flex items-center justify-center gap-2.5 shadow-2xl transition-all cursor-pointer group"
            >
              <span>Get Started</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-6 md:p-8 space-y-6 relative z-10 animate-in fade-in zoom-in-95 duration-200">
        {/* Header with Title and Reset Button */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <img
              src="/micromail-icon.png"
              alt="MicroMail"
              className="w-10 h-10 rounded-xl shadow-lg border border-slate-700 object-cover flex-shrink-0"
            />
            <div>
              <h2 className="text-xl font-extrabold text-white tracking-tight flex items-center gap-2">
                MicroMail Setup
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 uppercase tracking-widest">
                  First Time
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">Inbox zero in seconds.</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {step === 1 && (
              <button
                type="button"
                onClick={() => setStep(0)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                title="Return to Welcome Landing Page"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Welcome</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleResetSetup}
              disabled={isResetting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-xl transition-colors"
              title="Wipe draft and start fresh"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${isResetting ? 'animate-spin' : ''}`} />
              <span>Reset</span>
            </button>
          </div>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center justify-between px-2">
          {[
            { num: 1, title: 'Security & Admin' },
            { num: 2, title: 'Domain & Host' },
            { num: 3, title: 'DNS & Review' },
          ].map((s) => (
            <div key={s.num} className="flex items-center gap-2">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  step === s.num
                    ? 'bg-white text-slate-950 shadow-md shadow-white/30 ring-4 ring-white/20'
                    : step > s.num
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-800 text-slate-500'
                }`}
              >
                {step > s.num ? <Check className="w-3.5 h-3.5" /> : s.num}
              </div>
              <span
                className={`text-xs font-semibold hidden sm:inline ${
                  step === s.num ? 'text-white' : 'text-slate-500'
                }`}
              >
                {s.title}
              </span>
            </div>
          ))}
        </div>

        {error && (
          <div className="p-3.5 bg-rose-950/50 border border-rose-800/80 rounded-xl text-xs text-rose-300 flex items-start gap-2.5 animate-in fade-in">
            <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}

        {/* STEP 1: Anti-Hijacking Security Token & Admin Account */}
        {step === 1 && (
          <form onSubmit={handleStep1Next} className="space-y-4">
            {/* Anti-Hijacking Token Gate */}
            <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-400" />
                  <label className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                    Server Security Token
                  </label>
                </div>
                {isTokenVerified && (
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                    <CheckCircle className="w-3.5 h-3.5" />
                    Verified
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                To prevent unauthorized external visitors from hijacking your server, enter the
                security token printed in your server logs or saved in{' '}
                <code className="text-white bg-slate-900 border border-slate-700 px-1.5 py-0.5 rounded font-mono font-semibold">
                  /data/setup_token
                </code>
                .
              </p>

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <KeyRound className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="password"
                    value={setupToken}
                    onChange={(e) => {
                      setSetupToken(e.target.value);
                      setIsTokenVerified(false);
                    }}
                    placeholder="Enter 32-character token"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-white"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => verifyToken()}
                  disabled={isVerifyingToken || !setupToken.trim()}
                  className="px-3.5 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 rounded-xl border border-slate-700 transition-colors"
                >
                  {isVerifyingToken ? 'Verifying...' : 'Verify'}
                </button>
              </div>
            </div>

            <div className="space-y-3 pt-1">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Admin Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="email"
                    required
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    placeholder="admin@yourdomain.com"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Display Name
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Administrator"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                    <input
                      type="password"
                      required
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                    <input
                      type="password"
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-white"
                    />
                  </div>
                </div>
              </div>
            </div>

            <button
              type="submit"
              className="w-full btn-primary font-bold text-sm py-2.5 rounded-xl flex items-center justify-center gap-2 mt-2 cursor-pointer shadow-lg"
            >
              <span>Next: Domain Settings</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        )}

        {/* STEP 2: Domain & Hostname */}
        {step === 2 && (
          <form onSubmit={handleStep2Next} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Mail Domain (Root Domain)
              </label>
              <div className="relative">
                <Globe className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  type="text"
                  required
                  value={mailDomain}
                  onChange={(e) => {
                    const dom = e.target.value;
                    setMailDomain(dom);
                    if (!mailHostname || mailHostname.startsWith('mail.')) {
                      setMailHostname(`mail.${dom}`);
                    }
                  }}
                  placeholder="yourcompany.com"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-white"
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                This is the domain used in user email addresses (@yourcompany.com).
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Mail Hostname (FQDN for MX & PTR)
              </label>
              <div className="relative">
                <Server className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  type="text"
                  required
                  value={mailHostname}
                  onChange={(e) => setMailHostname(e.target.value)}
                  placeholder="mail.yourcompany.com"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-white"
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                The fully-qualified domain name (FQDN) that your MX and PTR records point to.
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="w-1/3 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs rounded-xl flex items-center justify-center gap-2 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
              <button
                type="submit"
                className="flex-1 btn-primary font-bold text-sm py-2.5 rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-lg"
              >
                <span>Next: Review DNS Records</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </form>
        )}

        {/* STEP 3: Review DNS Records & Finalize */}
        {step === 3 && (
          <div className="space-y-4">
            <p className="text-xs text-slate-300 leading-relaxed">
              Add the following standard DNS records to your domain registrar (Cloudflare,
              Namecheap, Route53, etc.) to ensure 10/10 inbox deliverability.
            </p>

            <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
              {/* MX Record */}
              <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white">MX Record</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(`10 ${mailHostname}`, 'mx')}
                    className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-slate-800 hover:text-white text-slate-400 transition-all active:scale-90"
                    title="Copy MX"
                  >
                    {copiedKey === 'mx' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <div className="font-mono text-[11px] text-slate-300 truncate">
                  Host: @ | Priority: 10 | Target: {mailHostname}
                </div>
              </div>

              {/* SPF Record */}
              <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-400">SPF (TXT) Record</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(`v=spf1 mx a:${mailHostname} ~all`, 'spf')}
                    className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-slate-800 hover:text-white text-slate-400 transition-all active:scale-90"
                    title="Copy SPF"
                  >
                    {copiedKey === 'spf' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <div className="font-mono text-[11px] text-slate-300 truncate">
                  Host: @ | Value: v=spf1 mx a:{mailHostname} ~all
                </div>
              </div>

              {/* DMARC Record */}
              <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sky-400">DMARC (TXT) Record</span>
                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(
                        `v=DMARC1; p=quarantine; rua=mailto:postmaster@${mailDomain}`,
                        'dmarc'
                      )
                    }
                    className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-slate-800 hover:text-white text-slate-400 transition-all active:scale-90"
                    title="Copy DMARC"
                  >
                    {copiedKey === 'dmarc' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <div className="font-mono text-[11px] text-slate-300 truncate">
                  Host: _dmarc | Value: v=DMARC1; p=quarantine; rua=mailto:postmaster@{mailDomain}
                </div>
              </div>

              {/* DKIM Record */}
              {dkimValue && (
                <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white">DKIM (TXT) Record</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(dkimValue, 'dkim')}
                      className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-slate-800 hover:text-white text-slate-400 transition-all active:scale-90"
                      title="Copy DKIM"
                    >
                      {copiedKey === 'dkim' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                  <div className="font-mono text-[11px] text-slate-300 break-all line-clamp-2">
                    Host: default._domainkey | Value: {dkimValue}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="w-1/3 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs rounded-xl flex items-center justify-center gap-2 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
              <button
                type="button"
                onClick={handleFinalSubmit}
                disabled={isSubmitting}
                className="flex-1 btn-primary font-bold text-sm py-2.5 rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-lg disabled:opacity-50"
              >
                <span>
                  {isSubmitting ? 'Initializing MicroMail...' : 'Complete Setup & Launch'}
                </span>
                <Check className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
