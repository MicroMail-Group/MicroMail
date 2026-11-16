import {
  Activity,
  AlertTriangle,
  Check,
  Copy,
  Globe,
  RefreshCw,
  Send,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useAppDispatch } from '../store/hooks';
import { showToast } from '../store/slices/uiSlice';
import { copyTextToClipboard } from '../utils/clipboard';

interface CheckItem {
  name: string;
  target: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  details?: string;
}

interface DiagnosticReport {
  domain: string;
  hostname: string;
  timestamp: number;
  port_checks: CheckItem[];
  dns_checks: CheckItem[];
  all_passed: boolean;
}

export const DNSSetupView: React.FC = () => {
  const dispatch = useAppDispatch();
  const [dkimInfo, setDkimInfo] = useState<any>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Diagnostics state
  const [diagnostics, setDiagnostics] = useState<DiagnosticReport | null>(null);
  const [isRunningDiag, setIsRunningDiag] = useState(false);
  const [isSpinningDiag, setIsSpinningDiag] = useState(false);

  // Test Email state
  const [testRecipient, setTestRecipient] = useState('');
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const fetchDkim = useCallback(() => {
    fetch('/api/system/dkim')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setDkimInfo(data))
      .catch((err) => console.error(err));
  }, []);

  const runDiagnosticsProbe = useCallback(async () => {
    setIsRunningDiag(true);
    try {
      const res = await fetch('/api/system/diagnostics');
      if (res.ok) {
        const data = await res.json();
        setDiagnostics(data);
      }
    } catch (err) {
      console.error('Failed to run diagnostics:', err);
    } finally {
      setIsRunningDiag(false);
    }
  }, []);

  const handleManualDiagnostics = async () => {
    if (isRunningDiag || isSpinningDiag) return;
    setIsSpinningDiag(true);
    const minTimer = new Promise((resolve) => setTimeout(resolve, 650));
    try {
      await runDiagnosticsProbe();
      await minTimer;
      dispatch(showToast({ message: 'Diagnostics probe completed', type: 'success' }));
    } catch (err) {
      console.error(err);
      dispatch(showToast({ message: 'Diagnostics probe failed', type: 'error' }));
    } finally {
      setIsSpinningDiag(false);
    }
  };

  useEffect(() => {
    fetchDkim();
    runDiagnosticsProbe();
  }, [runDiagnosticsProbe, fetchDkim]);

  const copyToClipboard = async (text: string, keyName: string) => {
    await copyTextToClipboard(text);
    setCopiedKey(keyName);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const handleSendTestEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testRecipient) return;

    setIsSendingTest(true);
    setTestResult(null);

    try {
      const res = await fetch('/api/system/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testRecipient }),
      });
      const data = await res.json();
      if (data.success) {
        setTestResult({
          success: true,
          message: data.message || `Diagnostic email successfully sent to ${testRecipient}!`,
        });
      } else {
        setTestResult({
          success: false,
          message: data.error || 'Failed to dispatch test email',
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || 'Network error sending test email',
      });
    } finally {
      setIsSendingTest(false);
    }
  };

  const domain = dkimInfo?.domain || 'yourdomain.com';
  const selector = dkimInfo?.selector || 'default';
  const dkimRecord = dkimInfo?.dns_record || 'v=DKIM1; k=rsa; p=...';

  const dnsRows = [
    {
      type: 'A',
      name: 'mail',
      value: '<YOUR_PUBLIC_IP_OR_VPS_RELAY>',
      proxy: 'DNS Only (Grey Cloud)',
      desc: 'Direct SMTP & IMAP IP address',
    },
    {
      type: 'MX',
      name: '@',
      value: `mail.${domain} (Priority 10)`,
      proxy: 'DNS Only (Grey Cloud)',
      desc: 'Routes inbound email traffic to MicroMail port 25',
    },
    {
      type: 'CNAME',
      name: 'mail',
      value: '<TUNNEL_ID>.cfargotunnel.com',
      proxy: 'Proxied (Orange Cloud)',
      desc: 'Cloudflare Tunnel for Webmail & Addon Store HTTP (:8080)',
    },
    {
      type: 'TXT',
      name: '@',
      value: 'v=spf1 mx -all',
      proxy: 'DNS Only',
      desc: 'SPF: Authorizes mail server to send on behalf of domain',
    },
    {
      type: 'TXT',
      name: `${selector}._domainkey`,
      value: dkimRecord,
      proxy: 'DNS Only',
      desc: 'DKIM: Auto-generated 2048-bit RSA public signing key',
    },
    {
      type: 'TXT',
      name: '_dmarc',
      value: `v=DMARC1; p=quarantine; rua=mailto:postmaster@${domain}`,
      proxy: 'DNS Only',
      desc: 'DMARC: Domain spoofing protection policy',
    },
  ];

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 dark:bg-slate-950 overflow-y-auto p-6 md:p-8">
      <div className="max-w-5xl mx-auto w-full space-y-6 pb-12">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-500 text-white flex items-center justify-center shadow-md shadow-sky-500/20 flex-shrink-0">
              <ShieldCheck className="w-6 h-6 flex-shrink-0" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                DNS, Ports & Mail Diagnostics
              </h1>
              <p className="text-xs text-slate-400">
                Verify open ports, DNS propagation, and test live email deliverability for {domain}
              </p>
            </div>
          </div>

          <button
            onClick={handleManualDiagnostics}
            disabled={isRunningDiag || isSpinningDiag}
            className="flex items-center gap-2 px-4 py-2 btn-primary text-xs font-semibold rounded-xl shadow-sm transition-all disabled:opacity-50 self-start md:self-auto"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 transition-transform duration-300 ${
                isRunningDiag || isSpinningDiag ? 'animate-spin' : ''
              }`}
            />
            <span>{isRunningDiag || isSpinningDiag ? 'Probing...' : 'Run Diagnostics Probe'}</span>
          </button>
        </div>

        {/* 1. Live Port Status & Service Health */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
            <Activity className="w-4 h-4 text-indigo-500" />
            <h2>Local Service Listeners & Ports</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {(
              diagnostics?.port_checks || [
                { name: 'Inbound SMTP (:25)', target: ':25', status: 'ok', message: 'Checking...' },
                {
                  name: 'SMTP Submission (:587)',
                  target: ':587',
                  status: 'ok',
                  message: 'Checking...',
                },
                { name: 'IMAPS (:993)', target: ':993', status: 'ok', message: 'Checking...' },
                {
                  name: 'HTTP Webmail (:8080)',
                  target: ':8080',
                  status: 'ok',
                  message: 'Checking...',
                },
              ]
            ).map((p, idx) => {
              const isOk = p.status === 'ok';
              return (
                <div
                  key={idx}
                  className="p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm flex items-center justify-between"
                >
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      {p.name}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono">{p.message}</div>
                  </div>
                  <div
                    className={`w-3 h-3 rounded-full flex-shrink-0 ${
                      isOk ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50' : 'bg-rose-500'
                    }`}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* 2. DNS Verification Probe */}
        {diagnostics?.dns_checks && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
              <Globe className="w-4 h-4 text-sky-500" />
              <h2>Public DNS Reachability & Records</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {diagnostics.dns_checks.map((c, idx) => {
                const isOk = c.status === 'ok';
                const isWarning = c.status === 'warning';

                return (
                  <div
                    key={idx}
                    className="p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm flex items-start gap-3"
                  >
                    <div className="mt-0.5 flex-shrink-0">
                      {isOk ? (
                        <Check className="w-4 h-4 text-emerald-500" />
                      ) : isWarning ? (
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                      ) : (
                        <XCircle className="w-4 h-4 text-rose-500" />
                      )}
                    </div>
                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                          {c.name}
                        </span>
                        <span
                          className={`text-[10px] uppercase font-bold px-1.5 py-0.2 rounded ${
                            isOk
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                              : isWarning
                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                                : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                          }`}
                        >
                          {c.status}
                        </span>
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                        {c.message}
                      </div>
                      {c.details && (
                        <div className="text-[11px] text-slate-400 font-mono break-all pt-0.5">
                          {c.details}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 3. Send Test Email Tool */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 flex items-center justify-center flex-shrink-0">
              <Send className="w-4 h-4 flex-shrink-0" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Outbound Email & DKIM Delivery Test
              </h2>
              <p className="text-xs text-slate-400">
                Send a real test email to verify MX lookup, STARTTLS negotiation, and RSA-2048 DKIM
                signing
              </p>
            </div>
          </div>

          <form onSubmit={handleSendTestEmail} className="flex flex-col sm:flex-row gap-3">
            <input
              type="email"
              required
              value={testRecipient}
              onChange={(e) => setTestRecipient(e.target.value)}
              placeholder="e.g. your-personal-email@gmail.com"
              className="flex-1 px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/25 dark:focus:ring-white/30 focus:border-slate-900 dark:focus:border-white"
            />
            <button
              type="submit"
              disabled={isSendingTest}
              className="flex items-center justify-center gap-2 px-5 py-2 btn-primary text-xs font-semibold rounded-xl shadow-sm transition-all disabled:opacity-50 flex-shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isSendingTest ? 'Sending Test...' : 'Send Test Email'}</span>
            </button>
          </form>

          {testResult && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 ${
                testResult.success
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                  : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
              }`}
            >
              {testResult.success ? (
                <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 flex-shrink-0 mt-0.5" />
              )}
              <div className="leading-relaxed">
                <strong>{testResult.success ? 'Success: ' : 'Delivery Failed: '}</strong>
                {testResult.message}
              </div>
            </div>
          )}
        </div>

        {/* 4. Cloudflare DNS Reference Table */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 font-bold text-sm text-slate-800 dark:text-slate-200">
            Recommended Cloudflare DNS Records for {domain}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-100 dark:border-slate-800">
                <tr>
                  <th className="p-3.5">Type</th>
                  <th className="p-3.5">Name / Host</th>
                  <th className="p-3.5">Value / Content</th>
                  <th className="p-3.5">Proxy Status</th>
                  <th className="p-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {dnsRows.map((r, i) => (
                  <tr
                    key={i}
                    className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="p-3.5 font-bold font-mono text-indigo-600 dark:text-indigo-400">
                      {r.type}
                    </td>
                    <td className="p-3.5 font-mono text-slate-800 dark:text-slate-200">{r.name}</td>
                    <td className="p-3.5 max-w-xs font-mono text-slate-600 dark:text-slate-300 break-all select-all">
                      {r.value}
                    </td>
                    <td className="p-3.5">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                          r.proxy.includes('Orange')
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {r.proxy}
                      </span>
                    </td>
                    <td className="p-3.5 text-right">
                      <button
                        onClick={() => copyToClipboard(r.value, `row-${i}`)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-xs font-medium transition-colors"
                        title="Copy value"
                      >
                        {copiedKey === `row-${i}` ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                            <span className="text-emerald-600 dark:text-emerald-400 text-[11px]">
                              Copied!
                            </span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span className="text-[11px]">Copy</span>
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
