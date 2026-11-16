import {
  ArrowUpCircle,
  CheckCircle,
  Cpu,
  Download,
  Monitor,
  Package,
  RefreshCw,
  Save,
  Settings,
  Shield,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { addonHost } from '../sdk/AddonHost';
import { useAppDispatch } from '../store';
import { showToast } from '../store/slices/uiSlice';

interface ConfigSchemaItem {
  key: string;
  type: string;
  options?: string[];
  default?: any;
  label: string;
}

interface AddonManifest {
  id: string;
  name: string;
  version: string;
  runtime: 'frontend' | 'backend' | 'hybrid';
  description: string;
  permissions?: string[];
  config_schema?: ConfigSchemaItem[];
}

interface RegistryItem {
  id: string;
  name: string;
  version: string;
  runtime: string;
  description: string;
  download_url: string;
  sha256?: string;
  manifest?: AddonManifest;
}

interface InstalledAddon {
  id: string;
  name: string;
  version: string;
  runtime: string;
  manifest_json: string;
  config_json: string;
  enabled: boolean;
  installed_at: number;
}

interface AddonStoreViewProps {
  onOpenSettings?: (addonId: string) => void;
}

export const AddonStoreView: React.FC<AddonStoreViewProps> = ({ onOpenSettings }) => {
  const dispatch = useAppDispatch();
  const [tab, setTab] = useState<'catalog' | 'installed'>('catalog');
  const [catalog, setCatalog] = useState<RegistryItem[]>([]);
  const [installed, setInstalled] = useState<InstalledAddon[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Config modal state
  const [configuringAddon, setConfiguringAddon] = useState<InstalledAddon | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, any>>({});

  const handleRefreshCatalog = async () => {
    if (isSpinning || isLoading) return;
    setIsSpinning(true);
    const startTime = Date.now();
    let success = true;
    try {
      await fetchStoreData();
    } catch (err) {
      console.error(err);
      success = false;
    } finally {
      const elapsed = Date.now() - startTime;
      if (elapsed < 650) {
        await new Promise((r) => setTimeout(r, 650 - elapsed));
      }
      setIsSpinning(false);
      if (success) {
        dispatch(showToast({ message: 'Addon catalog refreshed', type: 'success' }));
      } else {
        dispatch(showToast({ message: 'Failed to refresh addon catalog', type: 'error' }));
      }
    }
  };

  const fetchStoreData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [catRes, instRes] = await Promise.all([
        fetch('/api/addons/catalog'),
        fetch('/api/addons/installed'),
      ]);

      if (catRes.ok) {
        const catData = await catRes.json();
        setCatalog(catData.addons || []);
      }
      if (instRes.ok) {
        const instData = await instRes.json();
        setInstalled(instData || []);
      }
    } catch (err) {
      console.error('Failed to load store data:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStoreData();
  }, [fetchStoreData]);

  const handleInstall = async (item: RegistryItem) => {
    setStatusMsg(`Installing ${item.name}...`);
    try {
      const res = await fetch('/api/addons/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: item.id,
          download_url: item.download_url,
          sha256: item.sha256 || '',
        }),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt);
      }

      setStatusMsg(`Successfully installed ${item.name}!`);
      await fetchStoreData();
      await addonHost.loadEnabledAddons();
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (err: any) {
      setStatusMsg(`Error installing: ${err.message}`);
    }
  };

  const handleToggle = async (addon: InstalledAddon) => {
    try {
      const res = await fetch(`/api/addons/${addon.id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !addon.enabled }),
      });
      if (res.ok) {
        await fetchStoreData();
        await addonHost.loadEnabledAddons();
      }
    } catch (err) {
      console.error('Failed to toggle addon:', err);
    }
  };

  const handleUninstall = async (addon: InstalledAddon) => {
    if (!confirm(`Uninstall addon "${addon.name}"?`)) return;
    try {
      const res = await fetch(`/api/addons/${addon.id}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchStoreData();
        await addonHost.loadEnabledAddons();
      }
    } catch (err) {
      console.error('Failed to uninstall addon:', err);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    setStatusMsg(`Uploading & extracting ${file.name}...`);
    try {
      const res = await fetch('/api/addons/install', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt);
      }
      setStatusMsg(`Installed ${file.name}!`);
      await fetchStoreData();
      await addonHost.loadEnabledAddons();
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (err: any) {
      setStatusMsg(`Upload failed: ${err.message}`);
    }
  };

  const openConfigModal = (addon: InstalledAddon) => {
    setConfiguringAddon(addon);
    try {
      const parsed = JSON.parse(addon.config_json || '{}');
      setConfigValues(parsed);
    } catch {
      setConfigValues({});
    }
  };

  const saveConfig = async () => {
    if (!configuringAddon) return;
    try {
      const res = await fetch(`/api/addons/${configuringAddon.id}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configValues),
      });
      if (res.ok) {
        setConfiguringAddon(null);
        await fetchStoreData();
        await addonHost.loadEnabledAddons();
      }
    } catch (err) {
      console.error('Failed to save config:', err);
    }
  };

  const _isInstalled = (id: string) => installed.some((i) => i.id === id);

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 dark:bg-slate-950 overflow-y-auto p-6 md:p-8">
      {/* Title & Banner */}
      <div className="max-w-5xl mx-auto w-full space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-200 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center shadow-md shadow-emerald-500/20 flex-shrink-0">
                <Package className="w-6 h-6 flex-shrink-0" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                  Addon Store
                </h1>
                <p className="text-xs text-slate-400">
                  Browse, install, and manage community extensions.
                </p>
              </div>
            </div>
          </div>

          {/* Action buttons: Refresh and Upload zip */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefreshCatalog}
              disabled={isSpinning || isLoading}
              className="w-9 h-9 rounded-full flex items-center justify-center bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 shadow-sm transition-all active:scale-95 hover:scale-105 flex-shrink-0"
              title="Refresh Addon Catalog"
              aria-label="Refresh Addon Catalog"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 transition-transform duration-300 ${isSpinning || isLoading ? 'animate-spin text-emerald-500' : ''
                  }`}
              />
            </button>
            <label className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl shadow-sm cursor-pointer transition-colors">
              <Upload className="w-3.5 h-3.5" />
              <span>Install from .zip</span>
              <input type="file" accept=".zip" className="hidden" onChange={handleFileUpload} />
            </label>
          </div>
        </div>

        {/* Status notification toast */}
        {statusMsg && (
          <div className="p-3 bg-slate-100 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs flex items-center justify-between shadow-sm">
            <span>{statusMsg}</span>
            <button
              type="button"
              onClick={() => setStatusMsg(null)}
              className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-all"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
          <button
            onClick={() => setTab('catalog')}
            className={`px-4 py-2 text-xs rounded-xl transition-all ${tab === 'catalog'
              ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950 shadow-sm font-bold'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 font-medium'
              }`}
          >
            Catalog ({catalog.length})
          </button>
          <button
            onClick={() => setTab('installed')}
            className={`px-4 py-2 text-xs rounded-xl transition-all ${tab === 'installed'
              ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950 shadow-sm font-bold'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 font-medium'
              }`}
          >
            Installed ({installed.length})
          </button>
        </div>

        {/* Catalog Tab Content */}
        {tab === 'catalog' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {catalog.map((item) => {
              const installedRecord = installed.find((i) => i.id === item.id);
              const isInst = !!installedRecord;

              return (
                <div
                  key={item.id}
                  className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm flex flex-col justify-between hover:border-slate-300 dark:hover:border-slate-700 transition-all space-y-4"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                          {item.name}
                        </h3>
                        <div className="text-[11px] font-mono text-slate-400">
                          {item.id} • v{item.version}
                        </div>
                      </div>

                      {/* Runtime Badge */}
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded ${item.runtime === 'frontend'
                          ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300'
                          : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          }`}
                      >
                        {item.runtime === 'frontend' ? (
                          <Monitor className="w-3 h-3" />
                        ) : (
                          <Cpu className="w-3 h-3" />
                        )}
                        <span>{item.runtime}</span>
                      </span>
                    </div>

                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      {item.description}
                    </p>

                    {item.manifest?.permissions && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {item.manifest.permissions.map((p) => (
                          <span
                            key={p}
                            className="inline-flex items-center gap-0.5 text-[10px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-1.5 py-0.5 rounded"
                          >
                            <Shield className="w-2.5 h-2.5" />
                            {p}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <span className="text-[11px] text-slate-400">
                      {isInst ? 'Installed in /data/addons/' : 'Available from Registry'}
                    </span>

                    {isInst ? (
                      <div className="flex items-center gap-2">
                        {item.version !== installedRecord.version ? (
                          <button
                            type="button"
                            onClick={() => handleInstall(item)}
                            className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg shadow-sm transition-all"
                            title={`Update available: v${installedRecord.version} -> v${item.version}`}
                          >
                            <ArrowUpCircle className="w-3.5 h-3.5" />
                            <span>Update (v{item.version})</span>
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                            <CheckCircle className="w-4 h-4" />
                            <span>Installed</span>
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            onOpenSettings
                              ? onOpenSettings(installedRecord.id)
                              : openConfigModal(installedRecord)
                          }
                          className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-all active:scale-95"
                          title="Configure addon"
                        >
                          <Settings className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleInstall(item)}
                        className="flex items-center gap-1.5 px-3 py-1.5 btn-primary text-xs font-semibold rounded-xl shadow-sm"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Install Addon</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Installed Tab Content */}
        {tab === 'installed' && (
          <div className="space-y-3">
            {installed.length === 0 ? (
              <div className="p-12 text-center text-slate-400 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2">
                <Package className="w-8 h-8 mx-auto opacity-40" />
                <p className="text-sm">No addons installed yet.</p>
                <p className="text-xs">
                  Switch to the Catalog tab to install official WASM addons.
                </p>
              </div>
            ) : (
              installed.map((item) => {
                let mf: AddonManifest = {
                  id: item.id,
                  name: item.name,
                  version: item.version,
                  runtime: item.runtime as any,
                  description: '',
                };
                try {
                  mf = JSON.parse(item.manifest_json);
                } catch { }

                return (
                  <div
                    key={item.id}
                    className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                          {item.name}
                        </h3>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded">
                          v{item.version}
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                          {item.runtime}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">
                        {mf.description || 'Installed addon'}
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      {/* Enable/Disable Toggle */}
                      <button
                        onClick={() => handleToggle(item)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${item.enabled
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                          : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
                          }`}
                      >
                        {item.enabled ? (
                          <>
                            <ToggleRight className="w-4 h-4 text-emerald-600" />
                            <span>Enabled</span>
                          </>
                        ) : (
                          <>
                            <ToggleLeft className="w-4 h-4 text-slate-400" />
                            <span>Disabled</span>
                          </>
                        )}
                      </button>

                      {/* Settings Button */}
                      <button
                        type="button"
                        onClick={() =>
                          onOpenSettings ? onOpenSettings(item.id) : openConfigModal(item)
                        }
                        className="w-8 h-8 flex items-center justify-center text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-all active:scale-95"
                        title="Configure Addon"
                      >
                        <Settings className="w-4 h-4" />
                      </button>

                      {/* Uninstall Button */}
                      <button
                        type="button"
                        onClick={() => handleUninstall(item)}
                        className="w-8 h-8 flex items-center justify-center text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-full transition-all active:scale-95"
                        title="Uninstall Addon"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Dynamic Addon Configuration Modal */}
      {configuringAddon && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-md flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  Settings: {configuringAddon.name}
                </h3>
                <span className="text-[11px] text-slate-400">Configure parameters</span>
              </div>
              <button
                type="button"
                onClick={() => setConfiguringAddon(null)}
                className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-all active:scale-95"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4 max-h-96 overflow-y-auto">
              {(() => {
                let schema: ConfigSchemaItem[] = [];
                try {
                  const mf = JSON.parse(configuringAddon.manifest_json);
                  schema = mf.config_schema || [];
                } catch { }

                if (schema.length === 0) {
                  return (
                    <p className="text-xs text-slate-400">
                      This addon does not define any configurable schema settings.
                    </p>
                  );
                }

                return schema.map((field) => {
                  const val = configValues[field.key] ?? field.default ?? '';

                  return (
                    <div key={field.key} className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        {field.label || field.key}
                      </label>

                      {field.type === 'boolean' && (
                        <div>
                          <input
                            type="checkbox"
                            checked={!!val}
                            onChange={(e) =>
                              setConfigValues({ ...configValues, [field.key]: e.target.checked })
                            }
                            className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                          />
                        </div>
                      )}

                      {field.type === 'select' && (
                        <select
                          value={val}
                          onChange={(e) =>
                            setConfigValues({ ...configValues, [field.key]: e.target.value })
                          }
                          className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none"
                        >
                          {(field.options || []).map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      )}

                      {field.type === 'number' && (
                        <input
                          type="number"
                          step="any"
                          value={val}
                          onChange={(e) =>
                            setConfigValues({
                              ...configValues,
                              [field.key]: parseFloat(e.target.value) || 0,
                            })
                          }
                          className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none"
                        />
                      )}

                      {field.type === 'string' && (
                        <input
                          type="text"
                          value={val}
                          onChange={(e) =>
                            setConfigValues({ ...configValues, [field.key]: e.target.value })
                          }
                          className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none"
                        />
                      )}
                    </div>
                  );
                });
              })()}
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
              <button
                onClick={() => setConfiguringAddon(null)}
                className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveConfig}
                className="flex items-center gap-1.5 px-4 py-1.5 btn-primary text-xs font-semibold rounded-lg shadow-sm"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save Settings</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
