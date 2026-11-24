import { Mail, Menu, RefreshCw, Search, Tag, Trash2, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { addonHost } from '../sdk/AddonHost';
import { SlotRenderer } from '../sdk/SlotRenderer';
import { useAppDispatch } from '../store';
import { showToast } from '../store/slices/uiSlice';
import { ThreadListSkeleton } from './SkeletonLoader';

interface ThreadSummary {
  thread_id: string;
  subject: string;
  sender: string;
  snippet: string;
  message_count: number;
  has_unread: boolean;
  latest_at: number;
  tags?: string[];
}

interface ThreadListProps {
  threads: ThreadSummary[];
  selectedThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  folderName: string;
  onRefresh: () => Promise<void> | void;
  isLoading: boolean;
  onSearch: (q: string) => void;
  onDeleteThread?: (threadId: string) => void;
  onToggleSidebar?: () => void;
}

export const ThreadList: React.FC<ThreadListProps> = ({
  threads,
  selectedThreadId,
  onSelectThread,
  folderName,
  onRefresh,
  isLoading,
  onSearch,
  onDeleteThread,
  onToggleSidebar,
}) => {
  const dispatch = useAppDispatch();
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleRefreshClick = async () => {
    if (isSpinning || isLoading) return;
    setIsSpinning(true);
    const startTime = Date.now();
    let success = true;
    try {
      await onRefresh();
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
        dispatch(showToast({ message: `${folderName} refreshed`, type: 'success' }));
      } else {
        dispatch(showToast({ message: `Failed to refresh ${folderName}`, type: 'error' }));
      }
    }
  };

  // Listen to search query mutations from addons (e.g. Voice Search WASM)
  useEffect(() => {
    const unsub = addonHost.onSearchQuery((q) => {
      setSearchQuery(q);
      setIsSearchOpen(true);
      onSearch(q);
    });
    return unsub;
  }, [onSearch]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(searchQuery);
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <div className="w-full md:w-80 lg:w-96 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col h-full flex-shrink-0 animate-view-fade">
      {/* Header & Expandable Search */}
      <div className="h-[68px] min-h-[68px] max-h-[68px] px-4 border-b border-slate-200 dark:border-slate-800 flex items-center flex-shrink-0">
        <div className="relative flex items-center justify-between w-full h-9 overflow-hidden">
          {/* Header Title & Mobile Menu Button */}
          <div
            className={`flex-1 min-w-0 flex items-center gap-2 truncate transition-all duration-300 ease-in-out ${
              isSearchOpen
                ? 'opacity-0 -translate-x-4 pointer-events-none'
                : 'opacity-100 translate-x-0'
            }`}
          >
            {onToggleSidebar && (
              <button
                type="button"
                onClick={onToggleSidebar}
                className="md:hidden w-8 h-8 flex items-center justify-center text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-all active:scale-95 flex-shrink-0"
                title="Toggle Folder Navigation"
              >
                <Menu className="w-5 h-5" />
              </button>
            )}
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 truncate leading-6">
              {folderName}
            </h2>
          </div>

          {/* Action Buttons (when search is closed) */}
          <div
            className={`flex items-center gap-1 flex-shrink-0 ml-auto transition-all duration-300 ease-in-out ${
              isSearchOpen
                ? 'opacity-0 scale-75 pointer-events-none'
                : 'opacity-100 scale-100'
            }`}
          >
            {/* Circle Expandable Search Button */}
            <div className="relative group">
              <button
                type="button"
                onClick={() => {
                  setIsSearchOpen(true);
                  setTimeout(() => searchInputRef.current?.focus(), 50);
                }}
                aria-label={`Search ${folderName}`}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all hover:scale-110 active:scale-95"
              >
                <Search className="w-4 h-4" />
              </button>
              <span className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] font-medium px-2 py-0.5 rounded shadow-md whitespace-nowrap z-30">
                Search mail
              </span>
            </div>

            {/* Circle Refresh Button */}
            <div className="relative group">
              <button
                type="button"
                onClick={handleRefreshClick}
                disabled={isSpinning || isLoading}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all active:scale-95 hover:scale-105 flex-shrink-0 disabled:opacity-50"
                title={`Refresh ${folderName}`}
                aria-label={`Refresh ${folderName}`}
              >
                <RefreshCw
                  className={`w-4 h-4 transition-transform duration-300 ${
                    isSpinning || isLoading ? 'animate-spin text-cyan-500' : ''
                  }`}
                />
              </button>
              <span className="pointer-events-none absolute -bottom-7 right-0 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] font-medium px-2 py-0.5 rounded shadow-md whitespace-nowrap z-30">
                Refresh {folderName}
              </span>
            </div>
          </div>

          {/* Expanding / Shrinking Search Bar Form */}
          <form
            onSubmit={handleSearchSubmit}
            style={{ transformOrigin: 'right center' }}
            className={`absolute inset-0 flex items-center gap-1.5 bg-white dark:bg-slate-900 z-10 transition-all duration-300 ease-in-out ${
              isSearchOpen
                ? 'opacity-100 scale-x-100 pointer-events-auto'
                : 'opacity-0 scale-x-95 pointer-events-none'
            }`}
          >
            <div className="relative flex-1 flex items-center bg-slate-100 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 rounded-full px-3 py-1 shadow-inner focus-within:ring-2 focus-within:ring-slate-900/25 dark:focus-within:ring-white/30 focus-within:border-slate-900 dark:focus-within:border-white transition-all">
              <Search className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (e.target.value === '') {
                    onSearch('');
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    if (searchQuery) {
                      setSearchQuery('');
                      onSearch('');
                    } else {
                      setIsSearchOpen(false);
                    }
                  }
                }}
                placeholder="Search mail or voice..."
                className="w-full bg-transparent text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 px-2 py-0.5 focus:outline-none"
              />
              <div className="flex items-center gap-1 flex-shrink-0">
                <SlotRenderer slot="search_bar_action" />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      onSearch('');
                      searchInputRef.current?.focus();
                    }}
                    className="w-4 h-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex items-center justify-center transition-colors"
                    title="Clear search"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Close Button */}
            <div className="relative group flex-shrink-0">
              <button
                type="button"
                onClick={() => {
                  setIsSearchOpen(false);
                  if (searchQuery) {
                    setSearchQuery('');
                    onSearch('');
                  }
                }}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all hover:scale-110 active:scale-95"
                title="Close search"
                aria-label="Close search"
              >
                <X className="w-4 h-4" />
              </button>
              <span className="pointer-events-none absolute -bottom-7 right-0 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] font-medium px-2 py-0.5 rounded shadow-md whitespace-nowrap z-30">
                Close search
              </span>
            </div>
          </form>
        </div>
      </div>

      {/* Threads List */}
      <div
        key={folderName}
        className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/50 animate-view-fade"
      >
        {isLoading && threads.length === 0 ? (
          <ThreadListSkeleton />
        ) : threads.length === 0 ? (
          <div className="p-8 text-center text-slate-400 space-y-2">
            <Mail className="w-8 h-8 mx-auto opacity-40" />
            <p className="text-sm">No messages in {folderName}</p>
          </div>
        ) : (
          threads.map((t) => {
            const isSelected = selectedThreadId === t.thread_id;
            return (
              <div
                key={t.thread_id}
                onClick={() => onSelectThread(t.thread_id)}
                className={`p-3.5 cursor-pointer transition-colors text-left relative group select-none ${
                  isSelected
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                {isSelected && (
                  <span className="absolute left-0 top-0 bottom-0 w-1 bg-slate-950 dark:bg-white" />
                )}
                {/* Row 1: Sender & Date */}
                <div className="flex items-center justify-between text-xs mb-1 h-5">
                  <div className="flex items-center gap-1.5 truncate max-w-[70%]">
                    <span className="w-2 h-2 flex-shrink-0 flex items-center justify-center">
                      {t.has_unread && (
                        <span
                          className="w-2 h-2 rounded-full bg-blue-500 shadow-sm"
                          title="Unread"
                        />
                      )}
                    </span>
                    <span
                      className={`truncate ${
                        t.has_unread
                          ? 'font-semibold text-slate-900 dark:text-slate-100'
                          : 'font-medium text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {t.sender}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <span className="text-[11px] text-slate-400 font-normal">
                      {formatDate(t.latest_at)}
                    </span>
                    {onDeleteThread && (
                      <button
                        type="button"
                        title={folderName === 'Trash' ? 'Delete permanently' : 'Move to Trash'}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (folderName === 'Trash') {
                            if (confirm('Permanently delete this thread?')) {
                              onDeleteThread(t.thread_id);
                            }
                          } else {
                            onDeleteThread(t.thread_id);
                          }
                        }}
                        className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-all active:scale-90"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Row 2: Subject & Message Count */}
                <div className="flex items-center gap-1.5 h-5">
                  <div
                    className={`text-xs truncate flex-1 ${
                      t.has_unread
                        ? 'font-semibold text-slate-900 dark:text-slate-100'
                        : 'font-medium text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {t.subject || '(No subject)'}
                  </div>
                  {t.message_count > 1 && (
                    <span className="px-1.5 py-0.5 text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded font-bold leading-none flex-shrink-0">
                      {t.message_count}
                    </span>
                  )}
                </div>

                {/* Row 3: Snippet & Compact Tags (Guarantees constant height) */}
                <div className="flex items-center justify-between gap-1.5 mt-1 h-4 overflow-hidden">
                  <p className="text-xs text-slate-400 dark:text-slate-500 truncate flex-1 font-normal leading-4">
                    {t.snippet || '...'}
                  </p>
                  {t.tags && t.tags.length > 0 && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {t.tags.slice(0, 2).map((tag, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded max-w-[85px] truncate"
                        >
                          <Tag className="w-2.5 h-2.5 flex-shrink-0" />
                          <span className="truncate">{tag}</span>
                        </span>
                      ))}
                      {t.tags.length > 2 && (
                        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">
                          +{t.tags.length - 2}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
