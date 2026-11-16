export interface SlotRegistration {
  addonId: string;
  slotName: string;
  definition: {
    render?: (container: HTMLElement) => void;
    component?: any;
    label?: string;
    onClick?: () => void;
  };
}

export interface AddonSettingsPage {
  addonId: string;
  title?: string;
  icon?: string;
  render?: (
    container: HTMLElement,
    context: {
      config: Record<string, any>;
      saveConfig: (newCfg: Record<string, any>) => Promise<void>;
    }
  ) => void;
  component?: any;
}

export interface MessageBanner {
  id: string;
  addonId: string;
  type?: 'info' | 'warning' | 'success';
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}

export interface CustomSidebarItem {
  id: string;
  addonId: string;
  label: string;
  icon?: string;
  badge?: string | number;
  onClick: () => void;
}

export interface MicroMailSDK {
  addonId: string;
  config: Record<string, any>;
  assetUrl: (relPath: string) => string;
  registerSlot: (slotName: string, definition: any) => void;
  registerSettingsPage: (definition: Omit<AddonSettingsPage, 'addonId'>) => void;
  registerSidebarItem: (item: Omit<CustomSidebarItem, 'addonId'>) => () => void;
  injectStyles: (css: string) => () => void;
  addMessageBanner: (banner: Omit<MessageBanner, 'addonId'>) => () => void;
  setSearchQuery: (query: string) => void;
  insertComposeText: (text: string) => void;
}

export type SlotListener = (registrations: SlotRegistration[]) => void;
export type SearchQueryListener = (query: string) => void;
export type ComposeTextListener = (text: string) => void;
export type BannerListener = (banners: MessageBanner[]) => void;

class AddonHostManager {
  private slots: Map<string, SlotRegistration[]> = new Map();
  private settingsPages: Map<string, AddonSettingsPage> = new Map();
  private sidebarItems: Map<string, CustomSidebarItem> = new Map();
  private banners: Map<string, MessageBanner> = new Map();
  private injectedStyles: Map<string, HTMLStyleElement> = new Map();

  private slotListeners: Set<SlotListener> = new Set();
  private searchQueryListeners: Set<SearchQueryListener> = new Set();
  private composeTextListeners: Set<ComposeTextListener> = new Set();
  private bannerListeners: Set<BannerListener> = new Set();
  private loadedAddonIds: Set<string> = new Set();

  constructor() {
    if (typeof window !== 'undefined') {
      (window as any).MicroMail = this;
    }
  }

  public async loadEnabledAddons(): Promise<void> {
    try {
      const res = await fetch('/api/addons/enabled');
      if (!res.ok) return;
      const enabledList = await res.json();

      // Clear existing registrations on full reload
      this.slots.clear();
      this.settingsPages.clear();
      this.sidebarItems.clear();
      this.banners.clear();
      this.loadedAddonIds.clear();

      for (const item of enabledList) {
        if (item.manifest?.frontend?.entry) {
          await this.loadSingleAddon(item);
        }
      }
      this.notifySlotListeners();
      this.notifyBannerListeners();
    } catch (err) {
      console.warn('[AddonHost] Failed loading addons:', err);
    }
  }

  public async loadSingleAddon(addon: any): Promise<void> {
    const entryUrl = `/addons/${addon.id}/${addon.manifest.frontend.entry}`;
    try {
      const sdk: MicroMailSDK = {
        addonId: addon.id,
        config: addon.config || {},
        assetUrl: (relPath: string) => `/addons/${addon.id}/ui/${relPath.replace(/^\/+/, '')}`,
        registerSlot: (slotName: string, definition: any) => {
          this.registerSlot(addon.id, slotName, definition);
        },
        registerSettingsPage: (definition) => {
          this.settingsPages.set(addon.id, {
            addonId: addon.id,
            ...definition,
          });
        },
        registerSidebarItem: (item) => {
          const id = `${addon.id}:${item.id}`;
          this.sidebarItems.set(id, { ...item, addonId: addon.id, id });
          return () => {
            this.sidebarItems.delete(id);
          };
        },
        injectStyles: (css: string) => {
          const styleEl = document.createElement('style');
          styleEl.id = `addon-style-${addon.id}`;
          styleEl.textContent = css;
          document.head.appendChild(styleEl);
          this.injectedStyles.set(addon.id, styleEl);
          return () => {
            styleEl.remove();
            this.injectedStyles.delete(addon.id);
          };
        },
        addMessageBanner: (banner) => {
          const id = `${addon.id}:${banner.id}`;
          this.banners.set(id, { ...banner, addonId: addon.id, id });
          this.notifyBannerListeners();
          return () => {
            this.banners.delete(id);
            this.notifyBannerListeners();
          };
        },
        setSearchQuery: (query: string) => {
          this.triggerSearchQuery(query);
        },
        insertComposeText: (text: string) => {
          this.triggerComposeText(text);
        },
      };

      // Dynamic import of ES Module
      const mod = await import(/* @vite-ignore */ entryUrl);
      if (mod?.default && typeof mod.default.init === 'function') {
        mod.default.init(sdk);
        this.loadedAddonIds.add(addon.id);
        console.log(`[AddonHost] Initialized addon: ${addon.name} (${addon.id})`);
      }
    } catch (err) {
      console.error(`[AddonHost] Failed to import addon module ${entryUrl}:`, err);
    }
  }

  public registerSlot(addonId: string, slotName: string, definition: any): void {
    if (!this.slots.has(slotName)) {
      this.slots.set(slotName, []);
    }
    const current = this.slots.get(slotName)!;
    const filtered = current.filter((r) => r.addonId !== addonId);
    filtered.push({ addonId, slotName, definition });
    this.slots.set(slotName, filtered);
    this.notifySlotListeners();
  }

  public getSlots(slotName: string): SlotRegistration[] {
    return this.slots.get(slotName) || [];
  }

  public getSettingsPage(addonId: string): AddonSettingsPage | undefined {
    return this.settingsPages.get(addonId);
  }

  public getSidebarItems(): CustomSidebarItem[] {
    return Array.from(this.sidebarItems.values());
  }

  public getMessageBanners(): MessageBanner[] {
    return Array.from(this.banners.values());
  }

  public onSlotChange(listener: SlotListener): () => void {
    this.slotListeners.add(listener);
    return () => this.slotListeners.delete(listener);
  }

  public onBannerChange(listener: BannerListener): () => void {
    this.bannerListeners.add(listener);
    return () => this.bannerListeners.delete(listener);
  }

  public onSearchQuery(listener: SearchQueryListener): () => void {
    this.searchQueryListeners.add(listener);
    return () => this.searchQueryListeners.delete(listener);
  }

  public onComposeText(listener: ComposeTextListener): () => void {
    this.composeTextListeners.add(listener);
    return () => this.composeTextListeners.delete(listener);
  }

  private triggerSearchQuery(query: string): void {
    this.searchQueryListeners.forEach((l) => l(query));
  }

  private triggerComposeText(text: string): void {
    this.composeTextListeners.forEach((l) => l(text));
  }

  private notifySlotListeners(): void {
    const all = Array.from(this.slots.values()).flat();
    this.slotListeners.forEach((l) => l(all));
  }

  private notifyBannerListeners(): void {
    const all = Array.from(this.banners.values());
    this.bannerListeners.forEach((l) => l(all));
  }
}

export const addonHost = new AddonHostManager();
