import {
  AlertOctagon,
  FileText,
  Inbox,
  KeyRound,
  LogOut,
  Moon,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Send,
  ShieldCheck,
  Sun,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import { addonHost, type CustomSidebarItem } from '../sdk/AddonHost';
import { SlotRenderer } from '../sdk/SlotRenderer';
import { toggleTheme } from '../utils/theme';

interface SidebarProps {
  currentFolder: string;
  onSelectFolder: (folder: string) => void;
  folderCounts: Record<string, number>;
  activeView:
    | 'mail'
    | 'addons'
    | 'dns'
    | 'accounts'
    | 'security'
    | 'addon_settings'
    | 'user_settings';
  onSelectView: (
    view: 'mail' | 'addons' | 'dns' | 'accounts' | 'security' | 'addon_settings' | 'user_settings'
  ) => void;
  onOpenCompose: () => void;
  user: any;
  onLogout: () => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
  addonUpdatesCount?: number;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentFolder,
  onSelectFolder,
  folderCounts,
  activeView,
  onSelectView,
  onOpenCompose,
  user,
  onLogout,
  isMobileOpen,
  onCloseMobile,
  addonUpdatesCount,
  isCollapsed = false,
  onToggleCollapse,
}) => {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  });

  const [customItems, setCustomItems] = useState<CustomSidebarItem[]>([]);

  useEffect(() => {
    setCustomItems(addonHost.getSidebarItems());
  }, []);

  const handleToggleTheme = () => {
    const next = toggleTheme();
    setTheme(next);
  };

  const handleFolderClick = (id: string) => {
    onSelectFolder(id);
    if (onCloseMobile) onCloseMobile();
  };

  const handleViewClick = (
    view: 'mail' | 'addons' | 'dns' | 'accounts' | 'security' | 'addon_settings' | 'user_settings'
  ) => {
    onSelectView(view);
    if (onCloseMobile) onCloseMobile();
  };

  const handleComposeClick = () => {
    onOpenCompose();
    if (onCloseMobile) onCloseMobile();
  };

  const folders = [
    { id: 'INBOX', name: 'Inbox', icon: Inbox },
    { id: 'Sent', name: 'Sent', icon: Send },
    { id: 'Drafts', name: 'Drafts', icon: FileText },
    { id: 'Spam', name: 'Spam', icon: AlertOctagon },
    { id: 'Trash', name: 'Trash', icon: Trash2 },
  ];

  return (
    <>
      {/* Mobile Drawer Backdrop */}
      {isMobileOpen && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-sm md:hidden animate-in fade-in duration-200"
        />
      )}

      {/* Sidebar Content (Desktop: collapsible w-20 or w-64, Mobile: off-canvas drawer) */}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-50 ${
          isCollapsed ? 'w-72 md:w-20' : 'w-72 md:w-64'
        } bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col h-full select-none flex-shrink-0 transition-all duration-300 ease-in-out md:translate-x-0 ${
          isMobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Brand Header */}
        <div
          className={`h-16 flex items-center ${
            isCollapsed ? 'justify-center px-2' : 'justify-between px-5'
          } border-b border-slate-200 dark:border-slate-800`}
        >
          {isCollapsed ? (
            <button
              onClick={onToggleCollapse}
              className="p-1 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Expand sidebar"
            >
              <img
                src="/micromail-icon.png"
                alt="MicroMail"
                className="w-9 h-9 rounded-xl shadow-md object-cover"
              />
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <img
                src="/micromail-icon.png"
                alt="MicroMail Logo"
                className="w-9 h-9 rounded-xl shadow-md flex-shrink-0 object-cover"
              />
              <div>
                <h1 className="font-extrabold text-base tracking-tight text-slate-900 dark:text-white leading-none">
                  MicroMail
                </h1>
              </div>
            </div>
          )}

          {/* Desktop Collapse Toggle */}
          {!isCollapsed && onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              className="hidden md:flex w-8 h-8 items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-all active:scale-95"
              title="Collapse sidebar to icons"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}

          {/* Mobile Drawer Close */}
          {onCloseMobile && (
            <button
              onClick={onCloseMobile}
              className="md:hidden w-8 h-8 items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-all active:scale-95"
              title="Close drawer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Compose Button */}
        <div className={isCollapsed ? 'p-3 flex justify-center' : 'p-4'}>
          {isCollapsed ? (
            <button
              onClick={handleComposeClick}
              className="w-11 h-11 btn-primary flex items-center justify-center rounded-full shadow-lg cursor-pointer transition-transform hover:scale-105 active:scale-95"
              title="Compose New Email"
              aria-label="Compose New Email"
            >
              <Plus className="w-5 h-5 stroke-[2.5]" />
            </button>
          ) : (
            <button
              onClick={handleComposeClick}
              className="w-full btn-primary flex items-center justify-center gap-2 py-2.5 font-bold text-xs rounded-xl cursor-pointer shadow-md"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>Compose Email</span>
            </button>
          )}
        </div>

        {/* Navigation Links */}
        <div
          className={`flex-1 overflow-y-auto ${
            isCollapsed ? 'px-2 pt-2.5 pb-4 space-y-2' : 'px-3 py-2 space-y-1'
          }`}
        >
          {!isCollapsed && (
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-3 py-1">
              Mailboxes
            </div>
          )}

          {folders.map((f) => {
            const Icon = f.icon;
            const isSelected = activeView === 'mail' && currentFolder === f.id;
            const count = folderCounts[f.id] || 0;

            if (isCollapsed) {
              return (
                <div key={f.id} className="flex justify-center">
                  <button
                    onClick={() => handleFolderClick(f.id)}
                    className={`relative w-10 h-10 flex items-center justify-center rounded-full transition-all active:scale-95 ${
                      isSelected
                        ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-semibold shadow-sm ring-2 ring-slate-400/40 dark:ring-slate-600/50'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                    }`}
                    title={`${f.name} ${count > 0 ? `(${count})` : ''}`}
                  >
                    <Icon
                      key={isSelected ? 'selected' : 'idle'}
                      className={`w-5 h-5 transition-transform ${
                        isSelected ? 'text-slate-900 dark:text-white animate-icon-pop' : ''
                      }`}
                    />
                    {count > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[10px] font-bold rounded-full flex items-center justify-center shadow-sm">
                        {count > 99 ? '99+' : count}
                      </span>
                    )}
                  </button>
                </div>
              );
            }

            return (
              <button
                key={f.id}
                onClick={() => handleFolderClick(f.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors relative overflow-hidden ${
                  isSelected
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-semibold shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                }`}
              >
                {isSelected && (
                  <span className="absolute left-0 top-0 bottom-0 w-1 bg-slate-950 dark:bg-white" />
                )}
                <div className="flex items-center gap-3">
                  <Icon
                    key={isSelected ? 'selected' : 'idle'}
                    className={`w-4 h-4 transition-transform ${
                      isSelected ? 'text-slate-900 dark:text-white animate-icon-pop' : ''
                    }`}
                  />
                  <span>{f.name}</span>
                </div>
                {count > 0 && (
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                      isSelected
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}

          {Boolean(user?.is_admin) && (
            <>
              <div
                className={`pt-3 ${
                  isCollapsed
                    ? 'border-t border-slate-100 dark:border-slate-800 my-2'
                    : 'text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-3 py-1'
                }`}
              >
                {!isCollapsed && 'Ecosystem'}
              </div>

              {/* Addon Store */}
              {isCollapsed ? (
                <div className="flex justify-center">
                  <button
                    onClick={() => handleViewClick('addons')}
                    className={`relative w-10 h-10 flex items-center justify-center rounded-full transition-all active:scale-95 ${
                      activeView === 'addons' || activeView === 'addon_settings'
                        ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950 font-semibold shadow-sm ring-2 ring-slate-950/20 dark:ring-white/40'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                    }`}
                    title={`Addon Store ${
                      addonUpdatesCount && addonUpdatesCount > 0
                        ? `(${addonUpdatesCount} updates)`
                        : ''
                    }`}
                  >
                    <Package
                      key={activeView === 'addons' || activeView === 'addon_settings' ? 'selected' : 'idle'}
                      className={`w-5 h-5 transition-transform ${
                        activeView === 'addons' || activeView === 'addon_settings'
                          ? 'text-white dark:text-slate-950 animate-icon-pop'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    />
                    {addonUpdatesCount && addonUpdatesCount > 0 ? (
                      <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-amber-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-sm animate-pulse">
                        {addonUpdatesCount}
                      </span>
                    ) : null}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => handleViewClick('addons')}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeView === 'addons' || activeView === 'addon_settings'
                      ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950 font-semibold shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Package
                      key={activeView === 'addons' || activeView === 'addon_settings' ? 'selected' : 'idle'}
                      className={`w-4 h-4 transition-transform ${
                        activeView === 'addons' || activeView === 'addon_settings'
                          ? 'text-white dark:text-slate-950 animate-icon-pop'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    />
                    <span>Addon Store</span>
                  </div>
                  {addonUpdatesCount && addonUpdatesCount > 0 ? (
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-full shadow-sm animate-pulse flex items-center gap-1">
                      {addonUpdatesCount} {addonUpdatesCount === 1 ? 'update' : 'updates'}
                    </span>
                  ) : null}
                </button>
              )}

              {/* DNS Setup */}
              {isCollapsed ? (
                <div className="flex justify-center">
                  <button
                    onClick={() => handleViewClick('dns')}
                    className={`w-10 h-10 flex items-center justify-center rounded-full transition-all active:scale-95 ${
                      activeView === 'dns'
                        ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950 font-semibold shadow-sm ring-2 ring-slate-950/20 dark:ring-white/40'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                    }`}
                    title="DNS & Ports"
                  >
                    <ShieldCheck
                      key={activeView === 'dns' ? 'selected' : 'idle'}
                      className={`w-5 h-5 transition-transform ${
                        activeView === 'dns'
                          ? 'text-white dark:text-slate-950 animate-icon-pop'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => handleViewClick('dns')}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeView === 'dns'
                      ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950 font-semibold shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <ShieldCheck
                      key={activeView === 'dns' ? 'selected' : 'idle'}
                      className={`w-4 h-4 transition-transform ${
                        activeView === 'dns'
                          ? 'text-white dark:text-slate-950 animate-icon-pop'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    />
                    <span>DNS & Ports</span>
                  </div>
                </button>
              )}

              {/* Mailboxes / Accounts */}
              {isCollapsed ? (
                <div className="flex justify-center">
                  <button
                    onClick={() => handleViewClick('accounts')}
                    className={`w-10 h-10 flex items-center justify-center rounded-full transition-all active:scale-95 ${
                      activeView === 'accounts'
                        ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950 font-semibold shadow-sm ring-2 ring-slate-950/20 dark:ring-white/40'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                    }`}
                    title="Mailbox Accounts"
                  >
                    <Users
                      key={activeView === 'accounts' ? 'selected' : 'idle'}
                      className={`w-5 h-5 transition-transform ${
                        activeView === 'accounts'
                          ? 'text-white dark:text-slate-950 animate-icon-pop'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => handleViewClick('accounts')}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeView === 'accounts'
                      ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950 font-semibold shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Users
                      key={activeView === 'accounts' ? 'selected' : 'idle'}
                      className={`w-4 h-4 transition-transform ${
                        activeView === 'accounts'
                          ? 'text-white dark:text-slate-950 animate-icon-pop'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    />
                    <span>Mailboxes</span>
                  </div>
                </button>
              )}

              {/* Security & 2FA / Token Settings (Admin) */}
              {isCollapsed ? (
                <div className="flex justify-center">
                  <button
                    onClick={() => handleViewClick('security')}
                    className={`w-10 h-10 flex items-center justify-center rounded-full transition-all active:scale-95 ${
                      activeView === 'security'
                        ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950 font-semibold shadow-sm ring-2 ring-slate-950/20 dark:ring-white/40'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                    }`}
                    title="Security & Session Policy"
                  >
                    <KeyRound
                      key={activeView === 'security' ? 'selected' : 'idle'}
                      className={`w-5 h-5 transition-transform ${
                        activeView === 'security'
                          ? 'text-white dark:text-slate-950 animate-icon-pop'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => handleViewClick('security')}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeView === 'security'
                      ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950 font-semibold shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <KeyRound
                      key={activeView === 'security' ? 'selected' : 'idle'}
                      className={`w-4 h-4 transition-transform ${
                        activeView === 'security'
                          ? 'text-white dark:text-slate-950 animate-icon-pop'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    />
                    <span>Security Policy</span>
                  </div>
                </button>
              )}
            </>
          )}

          {/* Custom Addon Registered Sidebar Items */}
          {customItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                item.onClick();
                if (onCloseMobile) onCloseMobile();
              }}
              className={
                isCollapsed
                  ? 'w-10 h-10 mx-auto flex items-center justify-center rounded-full text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-all active:scale-95'
                  : 'w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors'
              }
              title={item.label}
            >
              <div className="flex items-center gap-3">
                <Package className="w-4 h-4 text-purple-500 flex-shrink-0" />
                {!isCollapsed && <span>{item.label}</span>}
              </div>
              {!isCollapsed && item.badge && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-bold">
                  {item.badge}
                </span>
              )}
            </button>
          ))}

          {/* UI Slot in Sidebar */}
          {!isCollapsed && (
            <div className="pt-2 px-1">
              <SlotRenderer slot="sidebar_footer" />
            </div>
          )}
        </div>

        {/* User Info & Footer */}
        <div
          className={`p-3 border-t border-slate-200 dark:border-slate-800 ${
            isCollapsed
              ? 'flex flex-col items-center space-y-2'
              : 'flex items-center justify-between'
          }`}
        >
          {isCollapsed ? (
            <>
              <button
                type="button"
                onClick={() => handleViewClick('user_settings')}
                className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs shadow-sm transition-all active:scale-95 ${
                  user?.is_admin ? 'border-2 border-amber-500 dark:border-amber-400' : ''
                } ${
                  activeView === 'user_settings'
                    ? 'bg-blue-600 text-white ring-2 ring-blue-500/50 animate-icon-pop'
                    : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:ring-2 hover:ring-blue-400'
                }`}
                title={`User Settings${user?.is_admin ? ' (Admin)' : ''}: ${user?.display_name || user?.email}`}
              >
                {user?.email?.charAt(0).toUpperCase() || 'U'}
              </button>
              <button
                type="button"
                onClick={handleToggleTheme}
                title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-all active:scale-95"
              >
                {theme === 'dark' ? (
                  <Sun className="w-4 h-4 text-amber-400" />
                ) : (
                  <Moon className="w-4 h-4 text-slate-600" />
                )}
              </button>
              <button
                onClick={onLogout}
                title="Sign out"
                className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-all active:scale-95"
              >
                <LogOut className="w-4 h-4" />
              </button>
              {onToggleCollapse && (
                <button
                  onClick={onToggleCollapse}
                  title="Expand sidebar"
                  className="hidden md:flex w-8 h-8 items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-all active:scale-95"
                >
                  <PanelLeftOpen className="w-4 h-4" />
                </button>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => handleViewClick('user_settings')}
                className={`flex items-center gap-2.5 overflow-hidden flex-1 min-w-0 p-1.5 -m-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left group ${
                  activeView === 'user_settings'
                    ? 'bg-slate-100 dark:bg-slate-800 ring-1 ring-blue-500/40'
                    : ''
                }`}
                title="User Settings & Preferences"
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold text-xs flex-shrink-0 transition-transform group-hover:scale-105 ${
                    user?.is_admin ? 'border-2 border-amber-500 dark:border-amber-400' : ''
                  } ${
                    activeView === 'user_settings'
                      ? 'bg-blue-600 text-white animate-icon-pop'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {user?.email?.charAt(0).toUpperCase() || 'U'}
                </div>
                <div className="truncate text-left flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {user?.display_name || user?.email}
                    </span>
                    {user?.is_admin && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold border border-amber-500/20">
                        Admin
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">{user?.email}</div>
                </div>
              </button>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  type="button"
                  onClick={handleToggleTheme}
                  title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                  className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-all active:scale-95"
                >
                  {theme === 'dark' ? (
                    <Sun className="w-4 h-4 text-amber-400" />
                  ) : (
                    <Moon className="w-4 h-4 text-slate-600" />
                  )}
                </button>
                <button
                  onClick={onLogout}
                  title="Sign out"
                  className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-all active:scale-95"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
};
