import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type ActiveView =
  | 'mail'
  | 'addons'
  | 'dns'
  | 'accounts'
  | 'security'
  | 'addon_settings'
  | 'user_settings';

export type UserSettingsTab = 'profile' | 'templates' | 'security' | 'sessions' | 'clients';

export interface ToastNotification {
  id: string;
  message: string;
  type?: 'success' | 'info' | 'warning' | 'error';
  duration?: number;
}

export interface UIState {
  activeView: ActiveView;
  userSettingsTab: UserSettingsTab;
  isSidebarCollapsed: boolean;
  isMobileSidebarOpen: boolean;
  isComposeOpen: boolean;
  replyTarget: any | null;
  activeAddonSettingsId: string | null;
  addonUpdatesCount: number;
  toast: ToastNotification | null;
}

const getInitialSidebarCollapsed = (): boolean => {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('micromail_sidebar_collapsed') === 'true';
};

const initialState: UIState = {
  activeView: 'mail',
  userSettingsTab: 'profile',
  isSidebarCollapsed: getInitialSidebarCollapsed(),
  isMobileSidebarOpen: false,
  isComposeOpen: false,
  replyTarget: null,
  activeAddonSettingsId: null,
  addonUpdatesCount: 0,
  toast: null,
};

export const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setActiveView: (state, action: PayloadAction<ActiveView>) => {
      state.activeView = action.payload;
      if (action.payload !== 'addon_settings') {
        state.activeAddonSettingsId = null;
      }
    },
    toggleSidebarCollapsed: (state) => {
      state.isSidebarCollapsed = !state.isSidebarCollapsed;
      if (typeof window !== 'undefined') {
        localStorage.setItem(
          'micromail_sidebar_collapsed',
          state.isSidebarCollapsed ? 'true' : 'false'
        );
      }
    },
    setSidebarCollapsed: (state, action: PayloadAction<boolean>) => {
      state.isSidebarCollapsed = action.payload;
      if (typeof window !== 'undefined') {
        localStorage.setItem('micromail_sidebar_collapsed', action.payload ? 'true' : 'false');
      }
    },
    setMobileSidebarOpen: (state, action: PayloadAction<boolean>) => {
      state.isMobileSidebarOpen = action.payload;
    },
    openCompose: (state, action: PayloadAction<any | null>) => {
      state.replyTarget = action.payload;
      state.isComposeOpen = true;
    },
    closeCompose: (state) => {
      state.isComposeOpen = false;
      state.replyTarget = null;
    },
    openAddonSettings: (state, action: PayloadAction<string>) => {
      state.activeAddonSettingsId = action.payload;
      state.activeView = 'addon_settings';
    },
    setAddonUpdatesCount: (state, action: PayloadAction<number>) => {
      state.addonUpdatesCount = action.payload;
    },
    showToast: (
      state,
      action: PayloadAction<{
        message: string;
        type?: 'success' | 'info' | 'warning' | 'error';
        duration?: number;
      }>
    ) => {
      state.toast = {
        id: Date.now().toString(),
        message: action.payload.message,
        type: action.payload.type || 'success',
        duration: action.payload.duration || 3000,
      };
    },
    setUserSettingsTab: (state, action: PayloadAction<UserSettingsTab>) => {
      state.userSettingsTab = action.payload;
    },
    openUserSettings: (state, action: PayloadAction<UserSettingsTab | undefined>) => {
      state.activeView = 'user_settings';
      if (action.payload) {
        state.userSettingsTab = action.payload;
      }
    },
    hideToast: (state) => {
      state.toast = null;
    },
  },
});

export const {
  setActiveView,
  setUserSettingsTab,
  openUserSettings,
  toggleSidebarCollapsed,
  setSidebarCollapsed,
  setMobileSidebarOpen,
  openCompose,
  closeCompose,
  openAddonSettings,
  setAddonUpdatesCount,
  showToast,
  hideToast,
} = uiSlice.actions;

export default uiSlice.reducer;
