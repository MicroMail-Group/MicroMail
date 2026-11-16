import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle,
  Package,
  RotateCcw,
  Save,
  Sliders,
  Sparkles,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { addonHost } from '../sdk/AddonHost';

interface ConfigSchemaItem {
  key: string;
  type: string;
  options?: string[];
  default?: any;
  label: string;
  description?: string;
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

interface AddonSettingsViewProps {
  addonId: string;
  onBack: () => void;
}

export const AddonSettingsView: React.FC<AddonSettingsViewProps> = ({ addonId, onBack }) => {
  const [addon, setAddon] = useState<InstalledAddon | null>(null);
  const [manifest, setManifest] = useState<any | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, any>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const customMountRef = useRef<HTMLDivElement>(null);

  const loadAddonData = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/addons/installed');
      if (res.ok) {
        const list: InstalledAddon[] = await res.json();
        const found = list.find((a) => a.id === addonId);
        if (found) {
          setAddon(found);
          let m: any = {};
          let cfg: any = {};
          try {
            m = JSON.parse(found.manifest_json || '{}');
            setManifest(m);
          } catch (e) {
            console.error('Failed to parse manifest JSON:', e);
          }
          try {
            cfg = JSON.parse(found.config_json || '{}');
            setConfigValues(cfg);
          } catch (e) {
            console.error('Failed to parse config JSON:', e);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load addon data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [addonId]);

  useEffect(() => {
    loadAddonData();
  }, [loadAddonData]);

  const handleSaveConfig = useCallback(
    async (valuesToSave = configValues) => {
      if (!addon) return;
      setIsSaving(true);
      setStatusMsg(null);

      try {
        const res = await fetch(`/api/addons/installed/${addon.id}/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(valuesToSave),
        });

        if (!res.ok) {
          const txt = await res.text();
          throw new Error(txt || 'Failed to update addon configuration');
        }

        setStatusMsg({
          type: 'success',
          text: 'Settings saved successfully. Changes applied to addon.',
        });
        setTimeout(() => setStatusMsg(null), 3500);
        await loadAddonData();
      } catch (err: any) {
        setStatusMsg({ type: 'error', text: err.message });
      } finally {
        setIsSaving(false);
      }
    },
    [addon, configValues, loadAddonData]
  );

  // Mount custom settings page if registered by addon
  useEffect(() => {
    if (!addon) return;
    const customPage = addonHost.getSettingsPage(addon.id);
    if (customPage?.render && customMountRef.current) {
      customMountRef.current.innerHTML = '';
      try {
        customPage.render(customMountRef.current, {
          config: configValues,
          saveConfig: async (newCfg: Record<string, any>) => {
            await handleSaveConfig(newCfg);
          },
        });
      } catch (err) {
        console.error('Error mounting custom addon settings UI:', err);
      }
    }
  }, [addon, configValues, handleSaveConfig]);

  const handleResetDefaults = () => {
    if (!manifest?.config_schema) return;
    const defaults: Record<string, any> = {};
    manifest.config_schema.forEach((item: ConfigSchemaItem) => {
      if (item.default !== undefined) {
        defaults[item.key] = item.default;
      }
    });
    setConfigValues(defaults);
    setStatusMsg({
      type: 'success',
      text: 'Reset fields to default schema values. Click Save to persist.',
    });
    setTimeout(() => setStatusMsg(null), 3000);
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-slate-500 text-sm">
        <Package className="w-6 h-6 animate-spin text-indigo-500 mr-2" />
        Loading addon settings...
      </div>
    );
  }

  if (!addon) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-slate-500 text-sm space-y-3">
        <AlertCircle className="w-8 h-8 text-amber-500" />
        <p>Addon "{addonId}" was not found or is not installed.</p>
        <button
          onClick={onBack}
          className="px-4 py-2 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl hover:bg-slate-300 transition-colors"
        >
          Return to Addon Store
        </button>
      </div>
    );
  }

  const customPage = addonHost.getSettingsPage(addon.id);
  const schema: ConfigSchemaItem[] = manifest?.config_schema || [];

  return (
    <div className="flex-1 h-full overflow-y-auto bg-slate-50 dark:bg-slate-950 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Top Header & Breadcrumb */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="w-9 h-9 flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-white dark:hover:bg-slate-800 rounded-full border border-slate-200 dark:border-slate-800 shadow-sm transition-all active:scale-95 flex-shrink-0"
              title="Back"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                  Addon Configuration
                </span>
                <span className="text-xs text-slate-400">•</span>
                <span className="text-xs text-slate-500">{addon.id}</span>
              </div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2 mt-0.5">
                {addon.name}
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-normal">
                  v{addon.version}
                </span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleResetDefaults}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl transition-colors shadow-sm"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Defaults
            </button>
            <button
              type="button"
              onClick={() => handleSaveConfig()}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold btn-primary disabled:opacity-50 rounded-xl shadow-md transition-colors"
            >
              {isSaving ? (
                <Save className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              Save Changes
            </button>
          </div>
        </div>

        {/* Status Notification Banner */}
        {statusMsg && (
          <div
            className={`flex items-center gap-2.5 p-3.5 rounded-xl text-xs font-medium border animate-in fade-in ${
              statusMsg.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800'
            }`}
          >
            {statusMsg.type === 'success' ? (
              <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
            )}
            <span>{statusMsg.text}</span>
          </div>
        )}

        {/* Addon Details Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                <Package className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">{addon.name}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {manifest?.description || 'No description provided.'}
                </p>
              </div>
            </div>

            <span
              className={`px-2.5 py-1 text-xs font-semibold rounded-full ${
                addon.enabled
                  ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
              }`}
            >
              {addon.enabled ? 'Active & Enabled' : 'Disabled'}
            </span>
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-slate-400 block">Runtime</span>
              <span className="font-semibold text-slate-700 dark:text-slate-200 capitalize">
                {addon.runtime}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block">Installed On</span>
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                {new Date(addon.installed_at * 1000).toLocaleDateString()}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block">Version</span>
              <span className="font-mono text-slate-700 dark:text-slate-200">v{addon.version}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Identifier</span>
              <span className="font-mono text-slate-700 dark:text-slate-200 truncate block">
                {addon.id}
              </span>
            </div>
          </div>
        </div>

        {/* Declarative Schema Settings Form */}
        {schema.length > 0 && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-5">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
              <Sliders className="w-4 h-4 text-indigo-500" />
              <h2 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                Configuration Parameters
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {schema.map((item) => (
                <div key={item.key} className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {item.label || item.key}
                  </label>
                  {item.description && (
                    <p className="text-[11px] text-slate-400">{item.description}</p>
                  )}

                  {item.type === 'boolean' ? (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() =>
                          setConfigValues((prev) => ({
                            ...prev,
                            [item.key]: !prev[item.key],
                          }))
                        }
                        className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors ${
                          configValues[item.key]
                            ? 'bg-indigo-600 justify-end'
                            : 'bg-slate-300 dark:bg-slate-700 justify-start'
                        }`}
                      >
                        <div className="bg-white w-4 h-4 rounded-full shadow-md transform transition" />
                      </button>
                    </div>
                  ) : item.type === 'select' ? (
                    <select
                      value={configValues[item.key] ?? item.default ?? ''}
                      onChange={(e) =>
                        setConfigValues((prev) => ({
                          ...prev,
                          [item.key]: e.target.value,
                        }))
                      }
                      className="w-full text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-900/25 dark:focus:ring-white/30 focus:border-slate-900 dark:focus:border-white"
                    >
                      {(item.options || []).map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : item.type === 'textarea' ? (
                    <textarea
                      rows={3}
                      value={configValues[item.key] ?? item.default ?? ''}
                      onChange={(e) =>
                        setConfigValues((prev) => ({
                          ...prev,
                          [item.key]: e.target.value,
                        }))
                      }
                      className="w-full text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-900/25 dark:focus:ring-white/30 focus:border-slate-900 dark:focus:border-white"
                    />
                  ) : item.type === 'number' ? (
                    <input
                      type="number"
                      value={configValues[item.key] ?? item.default ?? 0}
                      onChange={(e) =>
                        setConfigValues((prev) => ({
                          ...prev,
                          [item.key]: Number(e.target.value),
                        }))
                      }
                      className="w-full text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-900/25 dark:focus:ring-white/30 focus:border-slate-900 dark:focus:border-white"
                    />
                  ) : (
                    <input
                      type="text"
                      value={configValues[item.key] ?? item.default ?? ''}
                      onChange={(e) =>
                        setConfigValues((prev) => ({
                          ...prev,
                          [item.key]: e.target.value,
                        }))
                      }
                      className="w-full text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-900/25 dark:focus:ring-white/30 focus:border-slate-900 dark:focus:border-white"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Custom Registered Addon Settings Container */}
        {customPage && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
              <Sparkles className="w-4 h-4 text-purple-500" />
              <h2 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                {customPage.title || 'Addon Visual Controls'}
              </h2>
            </div>

            <div ref={customMountRef} className="addon-custom-settings-root" />
          </div>
        )}

        {schema.length === 0 && !customPage && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center text-slate-400 text-xs">
            This addon does not expose any configurable options.
          </div>
        )}
      </div>
    </div>
  );
};
