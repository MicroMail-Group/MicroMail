import {
  AlertCircle,
  CheckCircle2,
  Info,
  KeyRound,
  Menu,
  Package,
  Plus,
  ShieldCheck,
  Sliders,
  UserCog,
  Users,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { AddonSettingsView } from './components/AddonSettingsView';
import { AddonStoreView } from './components/AddonStoreView';
import { AdminAccountsView } from './components/AdminAccountsView';
import { ComposeModal } from './components/ComposeModal';
import { DNSSetupView } from './components/DNSSetupView';
import { FirstTimeSetupWizard } from './components/FirstTimeSetupWizard';
import { LoginModal } from './components/LoginModal';
import { MessageReader } from './components/MessageReader';
import { Security2FAView } from './components/Security2FAView';
import { Sidebar } from './components/Sidebar';
import { ThreadList } from './components/ThreadList';
import { UserSettingsView } from './components/UserSettingsView';
import { addonHost } from './sdk/AddonHost';
import { useAppDispatch, useAppSelector } from './store';
import { setAuthLoading, setSetupRequired, setUser } from './store/slices/authSlice';
import {
  markMessageRead,
  markThreadRead,
  removeThreadById,
  setCurrentFolder,
  setFolderCounts,
  setIsLoadingMessages,
  setIsLoadingThreads,
  setSelectedThreadId,
  setThreadMessages,
  setThreads,
} from './store/slices/mailSlice';
import {
  closeCompose,
  hideToast,
  openAddonSettings,
  openCompose,
  setActiveView,
  setAddonUpdatesCount,
  setMobileSidebarOpen,
  toggleSidebarCollapsed,
} from './store/slices/uiSlice';
import { initTheme } from './utils/theme';

export const App: React.FC = () => {
  const dispatch = useAppDispatch();

  // Redux Selectors
  const { user, isAuthLoading, isSetupRequired, setupInfo } = useAppSelector((state) => state.auth);
  const {
    activeView,
    isSidebarCollapsed,
    isMobileSidebarOpen,
    isComposeOpen,
    replyTarget,
    activeAddonSettingsId,
    addonUpdatesCount,
    toast,
  } = useAppSelector((state) => state.ui);

  // Auto-dismiss floating toast notifications
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      dispatch(hideToast());
    }, toast.duration || 3000);
    return () => clearTimeout(timer);
  }, [toast, dispatch]);
  const {
    currentFolder,
    folderCounts,
    threads,
    selectedThreadId,
    threadMessages,
    isLoadingThreads,
    isLoadingMessages,
  } = useAppSelector((state) => state.mail);

  useEffect(() => {
    initTheme();
  }, []);

  // Check for addon updates
  const refreshAddonUpdates = useCallback(async () => {
    if (!user) return;
    try {
      const [catRes, instRes] = await Promise.all([
        fetch('/api/addons/catalog'),
        fetch('/api/addons/installed'),
      ]);
      if (catRes.ok && instRes.ok) {
        const catData = await catRes.json();
        const catalog: any[] = Array.isArray(catData) ? catData : catData.addons || [];
        const installed: any[] = await instRes.json();
        const updates = installed.filter((inst) => {
          const match = catalog.find((c) => c.id === inst.id);
          return match && match.version !== inst.version;
        });
        dispatch(setAddonUpdatesCount(updates.length));
      }
    } catch (err) {
      console.error('Failed to check addon updates:', err);
    }
  }, [user, dispatch]);

  useEffect(() => {
    if (user) {
      refreshAddonUpdates();
    }
  }, [user, refreshAddonUpdates]);

  // 1. Check Setup Status & Authentication on Mount
  useEffect(() => {
    fetch('/api/setup/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((status) => {
        if (status?.is_setup_required) {
          dispatch(
            setSetupRequired({
              required: true,
              tokenRequired: status.setup_token_required,
              info: { domain: status.domain, hostname: status.hostname },
            })
          );
          return;
        }

        // Otherwise check current session
        return fetch('/api/auth/me')
          .then((res) => {
            if (res.ok) return res.json();
            throw new Error('Not logged in');
          })
          .then((userData) => {
            dispatch(setUser(userData));
          })
          .catch(() => {
            dispatch(setUser(null));
          })
          .finally(() => {
            dispatch(setAuthLoading(false));
          });
      })
      .catch(() => {
        dispatch(setAuthLoading(false));
      });
  }, [dispatch]);

  // 2. Load Enabled WASM Addons into dynamic slots
  useEffect(() => {
    if (user) {
      addonHost.loadEnabledAddons();
    }
  }, [user]);

  // 3. Fetch Folder Counts
  const refreshFolders = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/folders');
      if (res.ok) {
        const counts = await res.json();
        dispatch(setFolderCounts(counts));
      }
    } catch (err) {
      console.error('Failed to load folders:', err);
    }
  }, [user, dispatch]);

  // 4. Fetch Threads for Current Folder
  const refreshThreads = useCallback(async () => {
    if (!user) return;
    dispatch(setIsLoadingThreads(true));
    try {
      const res = await fetch(`/api/threads?folder=${currentFolder}`);
      if (res.ok) {
        const data = await res.json();
        const threadList = data || [];
        dispatch(setThreads(threadList));
        // Auto-select first thread ONLY on desktop screens (>= 768px)
        if (typeof window !== 'undefined' && window.innerWidth >= 768 && threadList.length > 0) {
          dispatch(setSelectedThreadId(threadList[0].thread_id));
        }
      }
    } catch (err) {
      console.error('Failed to load threads:', err);
    } finally {
      dispatch(setIsLoadingThreads(false));
    }
  }, [user, currentFolder, dispatch]);

  useEffect(() => {
    if (user) {
      refreshFolders();
      refreshThreads();
    }
  }, [user, refreshFolders, refreshThreads]);

  // Keep latest refresh functions in ref for stable SSE & visibility callbacks
  const refreshRef = useRef({ refreshFolders, refreshThreads });
  useEffect(() => {
    refreshRef.current = { refreshFolders, refreshThreads };
  }, [refreshFolders, refreshThreads]);

  // 5. Fetch Messages for Selected Thread
  useEffect(() => {
    if (!selectedThreadId || !user) {
      dispatch(setThreadMessages([]));
      return;
    }

    dispatch(setIsLoadingMessages(true));
    fetch(`/api/threads/${selectedThreadId}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((msgs) => {
        dispatch(setThreadMessages(msgs || []));
        dispatch(markThreadRead({ threadId: selectedThreadId, isRead: true }));
        refreshFolders();
      })
      .catch((err) => console.error('Failed to load thread messages:', err))
      .finally(() => dispatch(setIsLoadingMessages(false)));
  }, [selectedThreadId, user, dispatch, refreshFolders]);

  // 6. Connect to SSE Stream for Reactive Real-Time Inbound Updates & Tab Resume Handling
  useEffect(() => {
    if (!user) return;

    let eventSource: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let isDisposed = false;

    const connectSSE = () => {
      if (isDisposed) return;
      if (eventSource) {
        eventSource.close();
      }

      eventSource = new EventSource('/api/events');

      eventSource.addEventListener('NEW_MAIL', (event: any) => {
        try {
          const payload = JSON.parse(event.data);
          console.log('[SSE] Real-time inbound mail received:', payload);
          refreshRef.current.refreshFolders();
          refreshRef.current.refreshThreads();
        } catch (e) {
          console.error('Error handling SSE event:', e);
        }
      });

      eventSource.onerror = () => {
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(() => {
          if (!isDisposed && document.visibilityState !== 'hidden') {
            connectSSE();
          }
        }, 3000);
      };
    };

    connectSSE();

    // Auto-resync when returning to a dormant or background tab
    const handleTabResume = () => {
      if (document.visibilityState === 'visible') {
        refreshRef.current.refreshFolders();
        refreshRef.current.refreshThreads();
        if (!eventSource || eventSource.readyState === EventSource.CLOSED) {
          connectSSE();
        }
      }
    };

    document.addEventListener('visibilitychange', handleTabResume);
    window.addEventListener('focus', handleTabResume);

    return () => {
      isDisposed = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      document.removeEventListener('visibilitychange', handleTabResume);
      window.removeEventListener('focus', handleTabResume);
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [user]);

  // Search Handler
  const handleSearch = async (query: string) => {
    if (!query.trim()) {
      refreshThreads();
      return;
    }

    dispatch(setIsLoadingThreads(true));
    try {
      const res = await fetch(`/api/messages/search?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const messages = await res.json();
        const synthThreads = (messages || []).map((m: any) => ({
          thread_id: m.thread_id,
          subject: m.subject,
          sender: m.sender,
          snippet: m.snippet,
          message_count: 1,
          has_unread: !m.is_read,
          latest_at: m.created_at,
          tags: m.tags,
        }));
        dispatch(setThreads(synthThreads));
        if (synthThreads.length > 0) {
          dispatch(setSelectedThreadId(synthThreads[0].thread_id));
        }
      }
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      dispatch(setIsLoadingThreads(false));
    }
  };

  // Mail Actions
  const handleSelectThread = (threadId: string) => {
    dispatch(setSelectedThreadId(threadId));
    dispatch(markThreadRead({ threadId, isRead: true }));
  };

  const handleMarkRead = async (messageId: string, isRead: boolean) => {
    await fetch(`/api/messages/${messageId}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_read: isRead }),
    });
    dispatch(markMessageRead({ messageId, threadId: selectedThreadId || undefined, isRead }));
    if (!isRead && selectedThreadId) {
      dispatch(markThreadRead({ threadId: selectedThreadId, isRead: false }));
    }
    refreshFolders();
  };

  const handleMoveFolder = async (targetFolder: string) => {
    if (!selectedThreadId) return;
    const threadIdToMove = selectedThreadId;
    try {
      const res = await fetch(`/api/threads/${threadIdToMove}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: targetFolder }),
      });
      if (!res.ok) {
        const errorText = await res.text();
        console.error('Failed to move thread:', errorText);
        return;
      }
      // Instantly remove thread from current folder view and clear reader
      dispatch(removeThreadById(threadIdToMove));
      dispatch(setSelectedThreadId(null));
      await Promise.all([refreshFolders(), refreshThreads()]);
    } catch (err) {
      console.error('Error moving thread:', err);
    }
  };

  const handleDeletePermanently = async () => {
    if (!selectedThreadId) return;
    const threadIdToDelete = selectedThreadId;
    try {
      const res = await fetch(`/api/threads/${threadIdToDelete}`, { method: 'DELETE' });
      if (!res.ok) {
        console.error('Failed to delete thread permanently:', await res.text());
        return;
      }
      dispatch(removeThreadById(threadIdToDelete));
      dispatch(setSelectedThreadId(null));
      await Promise.all([refreshFolders(), refreshThreads()]);
    } catch (err) {
      console.error('Error deleting thread permanently:', err);
    }
  };

  const handleDeleteThread = async (threadId: string) => {
    try {
      if (currentFolder === 'Trash') {
        const res = await fetch(`/api/threads/${threadId}`, { method: 'DELETE' });
        if (!res.ok) {
          console.error('Failed to delete thread:', await res.text());
          return;
        }
      } else {
        const res = await fetch(`/api/threads/${threadId}/move`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folder: 'Trash' }),
        });
        if (!res.ok) {
          console.error('Failed to move thread to trash:', await res.text());
          return;
        }
      }
      dispatch(removeThreadById(threadId));
      await Promise.all([refreshFolders(), refreshThreads()]);
    } catch (err) {
      console.error('Error in handleDeleteThread:', err);
    }
  };

  const handleSend = async (data: any) => {
    const res = await fetch('/api/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.text();
      alert(`Failed to send email: ${err}`);
      return;
    }
    refreshFolders();
    if (currentFolder === 'Sent') {
      refreshThreads();
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    dispatch(setUser(null));
  };

  if (isAuthLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-900 text-white font-medium text-sm">
        Initializing MicroMail...
      </div>
    );
  }

  if (isSetupRequired) {
    return (
      <FirstTimeSetupWizard
        defaultDomain={setupInfo.domain}
        defaultHostname={setupInfo.hostname}
        onComplete={(u) => {
          dispatch(setUser(u));
          dispatch(setSetupRequired({ required: false }));
          dispatch(setActiveView('mail'));
        }}
      />
    );
  }

  if (!user) {
    return <LoginModal onLoginSuccess={(u) => dispatch(setUser(u))} />;
  }

  return (
    <div className="flex h-full w-full bg-slate-100 dark:bg-slate-950 font-sans text-slate-900 dark:text-slate-100 antialiased overflow-hidden select-none relative">
      {/* 1. Left Navigation Sidebar (Collapsible with Icon Badges & Icon Compose) */}
      <Sidebar
        currentFolder={currentFolder}
        onSelectFolder={(f) => {
          dispatch(setActiveView('mail'));
          dispatch(setCurrentFolder(f));
        }}
        folderCounts={folderCounts}
        activeView={activeView}
        onSelectView={(v) => dispatch(setActiveView(v))}
        onOpenCompose={() => {
          dispatch(setActiveView('mail'));
          dispatch(openCompose(null));
        }}
        user={user}
        onLogout={handleLogout}
        isMobileOpen={isMobileSidebarOpen}
        onCloseMobile={() => dispatch(setMobileSidebarOpen(false))}
        addonUpdatesCount={addonUpdatesCount}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => dispatch(toggleSidebarCollapsed())}
      />

      {/* 2. Main Content Area */}
      {activeView === 'mail' && (
        <div key="mail-view" className="flex flex-1 h-full overflow-hidden relative animate-view-fade">
          {/* Middle Pane: Thread List */}
          <div
            className={`${
              selectedThreadId ? 'hidden md:flex' : 'flex'
            } w-full md:w-auto h-full flex-shrink-0`}
          >
            <ThreadList
              threads={threads}
              selectedThreadId={selectedThreadId}
              onSelectThread={handleSelectThread}
              folderName={currentFolder}
              onRefresh={async () => {
                await Promise.all([refreshFolders(), refreshThreads()]);
              }}
              isLoading={isLoadingThreads}
              onSearch={handleSearch}
              onDeleteThread={handleDeleteThread}
              onToggleSidebar={() => dispatch(setMobileSidebarOpen(true))}
            />
          </div>

          {/* Right Pane: Message Reader */}
          <div
            className={`${
              !selectedThreadId ? 'hidden md:flex' : 'flex'
            } flex-1 h-full overflow-hidden`}
          >
            <MessageReader
              messages={threadMessages}
              onReply={(msg) => dispatch(openCompose({ ...msg, mode: 'reply' }))}
              onForward={(msg) => dispatch(openCompose({ ...msg, mode: 'forward' }))}
              onMarkRead={handleMarkRead}
              onMoveFolder={handleMoveFolder}
              onDeletePermanently={handleDeletePermanently}
              onBack={() => dispatch(setSelectedThreadId(null))}
              isLoading={isLoadingMessages}
            />
          </div>
        </div>
      )}

      {/* Non-mail views wrapper with mobile top navigation bar */}
      {activeView !== 'mail' && (
        <div key="non-mail-view" className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50 dark:bg-slate-950 animate-view-fade">
          <div className="md:hidden flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
            <button
              onClick={() => dispatch(setMobileSidebarOpen(true))}
              className="w-8 h-8 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-all active:scale-95 flex-shrink-0"
              title="Open Navigation"
            >
              <Menu className="w-5 h-5 flex-shrink-0" />
            </button>
            <div className="flex items-center gap-2 flex-shrink-0">
              {activeView === 'addons' && (
                <Package className="w-5 h-5 text-slate-900 dark:text-white flex-shrink-0 animate-icon-pop" />
              )}
              {activeView === 'addon_settings' && (
                <Sliders className="w-5 h-5 text-slate-900 dark:text-white flex-shrink-0 animate-icon-pop" />
              )}
              {activeView === 'dns' && (
                <ShieldCheck className="w-5 h-5 text-slate-900 dark:text-white flex-shrink-0 animate-icon-pop" />
              )}
              {activeView === 'accounts' && (
                <Users className="w-5 h-5 text-slate-900 dark:text-white flex-shrink-0 animate-icon-pop" />
              )}
              {activeView === 'security' && (
                <KeyRound className="w-5 h-5 text-slate-900 dark:text-white flex-shrink-0 animate-icon-pop" />
              )}
              {activeView === 'user_settings' && (
                <UserCog className="w-5 h-5 text-slate-900 dark:text-white flex-shrink-0 animate-icon-pop" />
              )}
            </div>
            <span className="font-semibold text-sm capitalize truncate">
              {activeView === 'addons' && 'Addon Ecosystem'}
              {activeView === 'addon_settings' && 'Addon Settings'}
              {activeView === 'dns' && 'DNS & Deliverability'}
              {activeView === 'accounts' && 'Account Administration'}
              {activeView === 'security' && 'System Security Policy'}
              {activeView === 'user_settings' && 'User Settings & Preferences'}
            </span>
          </div>
          <div key={activeView} className="flex-1 overflow-auto bg-slate-50 dark:bg-slate-950 flex flex-col animate-view-fade">
            {activeView === 'addons' && (
              <AddonStoreView onOpenSettings={(id) => dispatch(openAddonSettings(id))} />
            )}
            {activeView === 'addon_settings' && activeAddonSettingsId && (
              <AddonSettingsView
                addonId={activeAddonSettingsId}
                onBack={() => dispatch(setActiveView('addons'))}
              />
            )}
            {activeView === 'dns' && <DNSSetupView />}
            {activeView === 'accounts' && <AdminAccountsView />}
            {activeView === 'security' && <Security2FAView />}
            {activeView === 'user_settings' && (
              <UserSettingsView
                onBack={() => dispatch(setActiveView('mail'))}
                onUserUpdated={(updated) => {
                  if (user) {
                    dispatch(
                      setUser({
                        ...user,
                        display_name: updated.display_name,
                        signature: updated.signature,
                        totp_enabled:
                          updated.totp_enabled !== undefined
                            ? updated.totp_enabled
                            : user.totp_enabled,
                      })
                    );
                  }
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* Mobile Floating Action Button (FAB) for Compose */}
      {activeView === 'mail' && !selectedThreadId && (
        <button
          onClick={() => dispatch(openCompose(null))}
          className="md:hidden fixed bottom-6 right-6 z-30 p-4 btn-primary rounded-full shadow-xl flex items-center justify-center transition-all duration-200 animate-scale-up"
          aria-label="Compose new mail"
        >
          <Plus className="w-6 h-6 stroke-[2.5]" />
        </button>
      )}

      {/* Compose Modal Dialog */}
      <ComposeModal
        isOpen={isComposeOpen}
        onClose={() => dispatch(closeCompose())}
        onSend={handleSend}
        replyTo={replyTarget}
      />

      {/* Global Action Toast Notification */}
      {toast && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-4 py-2 bg-slate-900/95 dark:bg-slate-800/95 text-white text-xs font-semibold rounded-full shadow-2xl border border-slate-700/60 backdrop-blur-md animate-in fade-in slide-in-from-top-3 duration-200 pointer-events-auto">
          {toast.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
          ) : toast.type === 'info' ? (
            <Info className="w-4 h-4 text-sky-400 flex-shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
};
