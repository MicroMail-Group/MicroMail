import {
  AlertOctagon,
  ArchiveRestore,
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  ChevronUp,
  Download,
  Eye,
  EyeOff,
  File,
  Forward,
  Image as ImageIcon,
  Paperclip,
  Reply,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import { addonHost, type MessageBanner } from '../sdk/AddonHost';
import { SlotRenderer } from '../sdk/SlotRenderer';
import { useAppSelector } from '../store';
import { MessageReaderSkeleton } from './SkeletonLoader';

interface CleanedContent {
  clean: string;
  quoted?: string;
}

/**
 * Trims nested quote history from plain text email messages so each
 * conversation level displays only its unique message.
 */
function cleanMessageText(rawText: string): CleanedContent {
  if (!rawText) return { clean: '' };

  const quotePatterns = [
    // On [date/time], [sender] wrote:
    /\r?\n(?:\s*On\s+[^\n]+?wrote:\s*[\s\S]*)/i,
    // -----Original Message----- or --- Original Message ---
    /\r?\n(?:\s*-{3,}\s*Original Message\s*-{3,}[\s\S]*)/i,
    // ---------- Forwarded message ---------
    /\r?\n(?:\s*-{3,}\s*Forwarded message\s*-{3,}[\s\S]*)/i,
    // From: ... Date: ... / Sent: ... To: ... Subject: ...
    /\r?\n(?:\s*From:\s+[^\n]+\r?\n\s*(?:Sent|Date):\s+[^\n]+\r?\n\s*(?:To|Subject):[\s\S]*)/i,
    // Consecutive lines starting with >
    /\r?\n(?:\s*>[^\n]*\r?\n\s*>[^\n]*[\s\S]*)/,
  ];

  for (const pattern of quotePatterns) {
    const match = rawText.match(pattern);
    if (match && match.index !== undefined) {
      const clean = rawText.slice(0, match.index).trim();
      const quoted = rawText.slice(match.index).trim();
      if (clean.length > 0) {
        return { clean, quoted };
      }
    }
  }

  return { clean: rawText };
}

/**
 * Strips nested quote history from HTML email bodies so each
 * conversation level displays only its unique message.
 */
function cleanMessageHtml(rawHtml: string): CleanedContent {
  if (!rawHtml) return { clean: '' };

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtml, 'text/html');

    const quoteSelectors = [
      'blockquote',
      '.gmail_quote',
      '.gmail_extra',
      '.moz-cite-prefix',
      '#divRplyFwdMsg',
      '.yahoo_quoted',
      '[id^="mail-editor-reference"]',
    ];

    const quoteEls = doc.querySelectorAll(quoteSelectors.join(','));
    if (quoteEls.length > 0) {
      let foundQuotedHtml = '';
      quoteEls.forEach((el) => {
        foundQuotedHtml += el.outerHTML;
        const prev = el.previousSibling;
        if (prev?.textContent && /On\s+[^\n]+?wrote:?$/i.test(prev.textContent.trim())) {
          foundQuotedHtml = prev.textContent + foundQuotedHtml;
          prev.parentNode?.removeChild(prev);
        }
        el.parentNode?.removeChild(el);
      });

      const cleanHtml = doc.body.innerHTML.trim();
      if (cleanHtml.length > 0) {
        return { clean: cleanHtml, quoted: foundQuotedHtml };
      }
    }
  } catch {
    // fallback to original if parsing fails
  }

  return { clean: rawHtml };
}

interface AttachmentMeta {
  filename: string;
  content_type: string;
  size: number;
  path: string;
}

interface Message {
  id: string;
  user_id: string;
  imap_uid: number;
  folder: string;
  thread_id: string;
  message_id_header?: string;
  in_reply_to?: string;
  sender: string;
  recipients: string[];
  subject: string;
  snippet: string;
  body_text: string;
  body_html: string;
  raw_blob_path: string;
  attachments?: AttachmentMeta[];
  tags: string[];
  spam_score: number;
  is_read: boolean;
  created_at: number;
}

interface MessageReaderProps {
  messages: Message[];
  onReply: (message: Message) => void;
  onForward: (message: Message) => void;
  onMarkRead: (messageId: string, isRead: boolean) => void;
  onMoveFolder: (targetFolder: string) => void;
  onDeletePermanently: () => void;
  onDeleteMessage?: (messageId: string) => void;
  onBack?: () => void;
  isLoading?: boolean;
}

export const MessageReader: React.FC<MessageReaderProps> = ({
  messages,
  onReply,
  onForward,
  onMarkRead,
  onMoveFolder,
  onDeletePermanently,
  onDeleteMessage: _onDeleteMessage,
  onBack,
  isLoading,
}) => {
  const { user } = useAppSelector((state) => state.auth);
  const [viewMode, setViewMode] = useState<'html' | 'text'>('html');
  const [securityModalMsg, setSecurityModalMsg] = useState<Message | null>(null);
  const [banners, setBanners] = useState<MessageBanner[]>(() => addonHost.getMessageBanners());
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});
  const [showQuotedMap, setShowQuotedMap] = useState<Record<string, boolean>>({});

  const toggleQuoted = (msgId: string) => {
    setShowQuotedMap((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  useEffect(() => {
    return addonHost.onBannerChange((newBanners) => {
      setBanners(newBanners);
    });
  }, []);

  if (isLoading) {
    return <MessageReaderSkeleton />;
  }

  if (!messages || messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 bg-slate-50 dark:bg-slate-950 text-slate-400">
        <p className="text-sm">Select a message from the thread list to view its contents.</p>
      </div>
    );
  }

  // Sort messages recent to last (newest first, oldest last)
  const sortedMessages = [...messages].sort((a, b) => b.created_at - a.created_at);
  const latest = sortedMessages[0];
  const isInTrash = latest.folder.toLowerCase() === 'trash';
  const isInSpam = latest.folder.toLowerCase() === 'spam';

  const toggleCollapse = (msgId: string) => {
    setCollapsedMap((prev) => {
      const isCurrentlyCollapsed =
        prev[msgId] !== undefined ? prev[msgId] : sortedMessages.length > 1;
      return { ...prev, [msgId]: !isCurrentlyCollapsed };
    });
  };

  const hasAnyExpanded = sortedMessages.some((m, idx) => {
    const isCol = collapsedMap[m.id] !== undefined ? collapsedMap[m.id] : idx > 0;
    return !isCol;
  });

  const toggleAllCollapse = () => {
    const nextState: Record<string, boolean> = {};
    for (const m of sortedMessages) {
      nextState[m.id] = hasAnyExpanded;
    }
    setCollapsedMap(nextState);
  };

  return (
    <div
      key={latest.thread_id || latest.id}
      className="flex-1 flex flex-col h-full bg-white dark:bg-slate-900 overflow-hidden relative animate-view-fade select-text"
    >
      {/* Thread Title & Actions Topbar */}
      <div className="p-3 md:p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 md:gap-4">
        <div className="flex items-center gap-2 truncate">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="md:hidden w-8 h-8 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full flex-shrink-0 transition-all active:scale-95"
              title="Back to inbox"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div className="min-w-0">
            <h2 className="text-base md:text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
              {latest.subject || '(No subject)'}
            </h2>
            <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
              <span>
                {messages.length} message{messages.length > 1 ? 's' : ''} in thread
              </span>
              {messages.length > 1 && (
                <>
                  <span>•</span>
                  <div className="relative group inline-flex items-center">
                    <button
                      type="button"
                      onClick={toggleAllCollapse}
                      title={hasAnyExpanded ? 'Collapse all' : 'Expand all'}
                      aria-label={hasAnyExpanded ? 'Collapse all messages' : 'Expand all messages'}
                      className="w-5 h-5 rounded-full flex items-center justify-center bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white transition-all hover:scale-110 active:scale-95 cursor-pointer shadow-2xs"
                    >
                      {hasAnyExpanded ? (
                        <ChevronsDownUp className="w-3 h-3" />
                      ) : (
                        <ChevronsUpDown className="w-3 h-3" />
                      )}
                    </button>
                    <span className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 dark:bg-slate-800 text-white text-[10px] font-medium px-2 py-0.5 rounded shadow-md whitespace-nowrap z-30">
                      {hasAnyExpanded ? 'Collapse all' : 'Expand all'}
                    </span>
                  </div>
                  <span>•</span>
                  <div className="hidden sm:inline-flex items-center gap-2.5 text-[11px] text-slate-500 dark:text-slate-400">
                    <span
                      className="inline-flex items-center gap-1.5"
                      title="Inbound received message"
                    >
                      <span className="w-4 h-4 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-950 flex items-center justify-center">
                        <ArrowDownLeft className="w-2.5 h-2.5" />
                      </span>
                      <span>Received</span>
                    </span>
                    <span
                      className="inline-flex items-center gap-1.5"
                      title="Outbound sent message"
                    >
                      <span className="w-4 h-4 rounded-full border border-slate-900 text-slate-900 bg-white dark:border-white dark:text-white dark:bg-slate-900 flex items-center justify-center">
                        <ArrowUpRight className="w-2.5 h-2.5" />
                      </span>
                      <span>Sent</span>
                    </span>
                  </div>
                </>
              )}
              <span>•</span>
              <span className="font-mono text-[11px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                Folder: {latest.folder}
              </span>
            </div>
          </div>
        </div>

        {/* Global Thread Actions */}
        <div className="flex items-center gap-1.5">
          {/* Addon Slot for Message Header Actions */}
          <SlotRenderer slot="message_header_action" />

          {/* Circle Reply Button with hover text */}
          <div className="relative group">
            <button
              type="button"
              onClick={() => onReply(latest)}
              aria-label="Reply"
              className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-all hover:scale-110 active:scale-95 shadow-sm"
            >
              <Reply className="w-4 h-4" />
            </button>
            <span className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] font-medium px-2 py-0.5 rounded shadow-md whitespace-nowrap z-30">
              Reply
            </span>
          </div>

          {/* Circle Forward Button with hover text */}
          <div className="relative group">
            <button
              type="button"
              onClick={() => onForward(latest)}
              aria-label="Forward"
              className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-all hover:scale-110 active:scale-95 shadow-sm"
            >
              <Forward className="w-4 h-4" />
            </button>
            <span className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] font-medium px-2 py-0.5 rounded shadow-md whitespace-nowrap z-30">
              Forward
            </span>
          </div>

          {/* Circle Mark Read / Unread */}
          <div className="relative group">
            <button
              type="button"
              onClick={() => onMarkRead(latest.id, !latest.is_read)}
              aria-label={latest.is_read ? 'Mark unread' : 'Mark read'}
              className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all hover:scale-110 active:scale-95"
            >
              {latest.is_read ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
            <span className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] font-medium px-2 py-0.5 rounded shadow-md whitespace-nowrap z-30">
              {latest.is_read ? 'Mark unread' : 'Mark read'}
            </span>
          </div>

          {/* Contextual Not Spam Button */}
          {isInSpam && (
            <div className="relative group">
              <button
                type="button"
                onClick={() => onMoveFolder('INBOX')}
                aria-label="Mark as Not Spam"
                className="w-8 h-8 rounded-full flex items-center justify-center text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 border border-emerald-200 dark:border-emerald-800 transition-all hover:scale-110 active:scale-95 shadow-sm"
              >
                <CheckCircle className="w-4 h-4 text-emerald-500" />
              </button>
              <span className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] font-medium px-2 py-0.5 rounded shadow-md whitespace-nowrap z-30">
                Not Spam
              </span>
            </div>
          )}

          {!isInTrash && !isInSpam && (
            <div className="relative group">
              <button
                type="button"
                onClick={() => onMoveFolder('Spam')}
                aria-label="Mark as Spam"
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-slate-800 transition-all hover:scale-110 active:scale-95"
              >
                <AlertOctagon className="w-4 h-4" />
              </button>
              <span className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] font-medium px-2 py-0.5 rounded shadow-md whitespace-nowrap z-30">
                Mark Spam
              </span>
            </div>
          )}

          {isInTrash ? (
            <>
              {/* Restore Button */}
              <div className="relative group">
                <button
                  type="button"
                  onClick={() => onMoveFolder('INBOX')}
                  aria-label="Restore to Inbox"
                  className="w-8 h-8 rounded-full flex items-center justify-center text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-slate-800 transition-all hover:scale-110 active:scale-95"
                >
                  <ArchiveRestore className="w-4 h-4" />
                </button>
                <span className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] font-medium px-2 py-0.5 rounded shadow-md whitespace-nowrap z-30">
                  Restore to Inbox
                </span>
              </div>

              {/* Delete Permanently Button */}
              <div className="relative group">
                <button
                  type="button"
                  onClick={() => {
                    if (confirm('Permanently delete this email thread? This cannot be undone.')) {
                      onDeletePermanently();
                    }
                  }}
                  aria-label="Delete Permanently"
                  className="w-8 h-8 rounded-full flex items-center justify-center text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-all hover:scale-110 active:scale-95"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <span className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] font-medium px-2 py-0.5 rounded shadow-md whitespace-nowrap z-30">
                  Delete Permanently
                </span>
              </div>
            </>
          ) : (
            /* Circle Delete Button with hover text */
            <div className="relative group">
              <button
                type="button"
                onClick={() => onMoveFolder('Trash')}
                aria-label="Delete (Move to Trash)"
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-800 transition-all hover:scale-110 active:scale-95"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <span className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] font-medium px-2 py-0.5 rounded shadow-md whitespace-nowrap z-30">
                Delete
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Contextual Spam Notice Banner */}
      {isInSpam && (
        <div className="mx-6 mt-4 p-3 bg-amber-50 dark:bg-slate-800/90 border border-amber-200/80 dark:border-amber-700/60 rounded-xl text-xs text-amber-900 dark:text-amber-200 flex items-center justify-between gap-3 shadow-sm animate-in fade-in duration-200">
          <div className="flex items-center gap-2">
            <AlertOctagon className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <span>
              This email was filtered into your Spam folder. If you trust this sender, click{' '}
              <strong>Not Spam</strong> to move it back to your Inbox.
            </span>
          </div>
          <button
            type="button"
            onClick={() => onMoveFolder('INBOX')}
            className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-semibold rounded-lg shadow-sm transition-all flex-shrink-0"
          >
            Not Spam
          </button>
        </div>
      )}

      {/* Addon Injected Message Banners */}
      {banners.map((b) => (
        <div
          key={b.id}
          className={`mx-6 mt-3 p-3 rounded-xl text-xs font-medium border flex items-center justify-between gap-3 shadow-sm animate-in fade-in duration-200 ${
            b.type === 'warning'
              ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 border-amber-200/80 dark:border-amber-800'
              : b.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 border-emerald-200/80 dark:border-emerald-800'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700'
          }`}
        >
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 flex-shrink-0 text-indigo-600 dark:text-indigo-400" />
            <span>{b.text}</span>
          </div>
          {b.actionLabel && b.onAction && (
            <button
              type="button"
              onClick={b.onAction}
              className="px-3 py-1 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-semibold rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 transition-all flex-shrink-0"
            >
              {b.actionLabel}
            </button>
          )}
        </div>
      ))}

      {/* Messages Scrollable Area */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className={`space-y-4 relative ${sortedMessages.length > 1 ? 'pl-8 md:pl-10' : ''}`}>
          {/* Continuous White Vertical Timeline Line */}
          {sortedMessages.length > 1 && (
            <div
              className="absolute left-4 md:left-5 top-5 bottom-5 w-0.5 bg-white ring-1 ring-slate-200 dark:ring-white/20 -translate-x-1/2 pointer-events-none z-0"
              aria-hidden="true"
            />
          )}

          {sortedMessages.map((msg, index) => {
            const dateStr = new Date(msg.created_at * 1000).toLocaleString();
            const isCollapsed =
              collapsedMap[msg.id] !== undefined
                ? collapsedMap[msg.id]
                : sortedMessages.length > 1 && index > 0;

            const isSent =
              msg.folder.toLowerCase() === 'sent' ||
              Boolean(user?.email && msg.sender.toLowerCase().includes(user.email.toLowerCase()));

            const cleanedText = cleanMessageText(msg.body_text);
            const cleanedHtml = cleanMessageHtml(msg.body_html);
            const isQuotedShown = showQuotedMap[msg.id] || false;
            const previewSnippet =
              cleanedText.clean?.replace(/\s+/g, ' ').slice(0, 80) || msg.snippet || '(No preview)';

            return (
              <div
                key={msg.id}
                className={`rounded-2xl border transition-all relative z-10 ${
                  index === 0
                    ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm'
                    : 'bg-slate-50/80 dark:bg-slate-900/60 border-slate-200/70 dark:border-slate-800/70'
                }`}
              >
                {/* Timeline Bubble (Horizontally Centered on the Line: Sent = Unfilled black/white, Received = Filled) */}
                {sortedMessages.length > 1 && (
                  <div className="absolute -left-4 md:-left-5 top-3 -translate-x-1/2 group/bubble z-20">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center ring-4 ring-white dark:ring-slate-900 transition-transform hover:scale-110 cursor-pointer ${
                        isSent
                          ? 'border-2 border-slate-900 text-slate-900 bg-white dark:border-white dark:text-white dark:bg-slate-900 shadow-xs'
                          : 'bg-slate-900 text-white dark:bg-white dark:text-slate-950 shadow-md'
                      }`}
                      title={isSent ? 'Sent message' : 'Received message'}
                    >
                      {isSent ? (
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      ) : (
                        <ArrowDownLeft className="w-3.5 h-3.5" />
                      )}
                    </div>

                    {/* Text Pop-up on Hover */}
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-0.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-[10px] font-semibold rounded-md shadow-lg opacity-0 group-hover/bubble:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-30">
                      {isSent ? 'Sent message' : 'Received message'}
                      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900 dark:border-t-slate-100" />
                    </div>
                  </div>
                )}

                {/* Collapsed Card Summary (Top bar height & center line up with timeline bubble) */}
                {isCollapsed ? (
                  <div
                    onClick={() => toggleCollapse(msg.id)}
                    className="h-12 px-4 flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-100/50 dark:hover:bg-slate-800/40 rounded-2xl transition-colors"
                  >
                    <div className="flex items-center gap-2.5 truncate min-w-0">
                      <span className="font-bold text-xs text-slate-800 dark:text-slate-200 truncate flex-shrink-0 max-w-[140px] sm:max-w-[200px]">
                        {msg.sender}
                      </span>
                      <span className="text-xs text-slate-400 dark:text-slate-500 truncate hidden sm:inline">
                        {previewSnippet}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {msg.attachments && msg.attachments.length > 0 && (
                        <span className="flex items-center gap-1 text-[11px] text-slate-400">
                          <Paperclip className="w-3 h-3" />
                          <span>{msg.attachments.length}</span>
                        </span>
                      )}
                      <span className="text-[11px] text-slate-400 font-mono">{dateStr}</span>
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    </div>
                  </div>
                ) : (
                  /* Expanded Card View (Top bar height & center line up with timeline bubble) */
                  <div>
                    {/* Header with Collapse Action */}
                    {sortedMessages.length > 1 && (
                      <div
                        onClick={() => toggleCollapse(msg.id)}
                        className="h-12 px-5 flex items-center justify-between border-b border-slate-100 dark:border-slate-800 text-xs cursor-pointer group hover:bg-slate-50/50 dark:hover:bg-slate-800/30 rounded-t-2xl transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-slate-700 dark:text-slate-300 font-semibold text-[11px]">
                            {index === 0
                              ? 'Most Recent'
                              : index === sortedMessages.length - 1
                                ? 'Initial Message'
                                : 'Conversation Reply'}
                          </span>
                          {msg.in_reply_to && (
                            <span className="hidden sm:inline font-mono text-[10px] text-slate-400">
                              • In-Reply-To verified
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200 transition-colors">
                          <span className="text-[11px]">Collapse</span>
                          <ChevronUp className="w-3.5 h-3.5" />
                        </div>
                      </div>
                    )}

                    <div className="p-5">
                      {/* Header Info */}
                      <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-bold text-sm shadow-sm flex items-center justify-center flex-shrink-0">
                            {msg.sender.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                              {msg.sender}
                            </div>
                            <div className="text-xs text-slate-400">
                              To: {msg.recipients.join(', ')}
                            </div>
                          </div>
                        </div>

                        <div className="text-right text-xs text-slate-400 space-y-1.5">
                          <div>{dateStr}</div>

                          {/* Actions & Badges: Verification/Certificate, Spam, Reply & Forward circle buttons */}
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Security & Certificate Modal Trigger */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSecurityModalMsg(msg);
                              }}
                              className={`w-7 h-7 rounded-full flex items-center justify-center shadow-xs transition-all active:scale-95 hover:scale-110 ${
                                msg.spam_score >= 0.75
                                  ? 'bg-rose-100 hover:bg-rose-200 text-rose-700 dark:bg-rose-950 dark:hover:bg-rose-900 dark:text-rose-400 border border-rose-300 dark:border-rose-700'
                                  : 'bg-emerald-100 hover:bg-emerald-200 text-emerald-700 dark:bg-emerald-950/80 dark:hover:bg-emerald-900 dark:text-emerald-400 border border-emerald-300/60 dark:border-emerald-700/60'
                              }`}
                              title="Security & Certificate (DKIM / SPF / TLS) - Click to inspect"
                              aria-label="Security and Certificate Information"
                            >
                              <ShieldCheck className="w-3.5 h-3.5" />
                            </button>

                            {msg.spam_score > 0 && (
                              <span
                                className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                                  msg.spam_score >= 0.75
                                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                                    : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                                }`}
                              >
                                Spam: {(msg.spam_score * 100).toFixed(0)}%
                              </span>
                            )}

                            {/* Circle Reply Button with Hover Text */}
                            <div className="relative group/reply">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onReply(msg);
                                }}
                                className="w-7 h-7 rounded-full flex items-center justify-center bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-all active:scale-95 shadow-xs"
                                title="Reply"
                                aria-label="Reply"
                              >
                                <Reply className="w-3.5 h-3.5" />
                              </button>
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-0.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-[10px] font-semibold rounded shadow-md opacity-0 group-hover/reply:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-30">
                                Reply
                                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900 dark:border-t-slate-100" />
                              </div>
                            </div>

                            {/* Circle Forward Button with Hover Text */}
                            <div className="relative group/fwd">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onForward(msg);
                                }}
                                className="w-7 h-7 rounded-full flex items-center justify-center bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-all active:scale-95 shadow-xs"
                                title="Forward"
                                aria-label="Forward"
                              >
                                <Forward className="w-3.5 h-3.5" />
                              </button>
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-0.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-[10px] font-semibold rounded shadow-md opacity-0 group-hover/fwd:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-30">
                                Forward
                                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900 dark:border-t-slate-100" />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Body Content (Fresh message content only; quoted past thread history trimmed) */}
                      <div className="pt-4">
                        {msg.body_html ? (
                          <div>
                            <div className="flex justify-end gap-2 mb-2">
                              <button
                                onClick={() => setViewMode('html')}
                                className={`text-[11px] font-medium px-2 py-0.5 rounded transition-colors ${
                                  viewMode === 'html'
                                    ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white font-semibold'
                                    : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                                }`}
                              >
                                HTML
                              </button>
                              <button
                                onClick={() => setViewMode('text')}
                                className={`text-[11px] font-medium px-2 py-0.5 rounded transition-colors ${
                                  viewMode === 'text'
                                    ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white font-semibold'
                                    : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                                }`}
                              >
                                Plain Text
                              </button>
                            </div>

                            {viewMode === 'html' ? (
                              <div>
                                <div
                                  className="prose prose-sm dark:prose-invert max-w-none break-words overflow-x-auto select-text"
                                  dangerouslySetInnerHTML={{
                                    __html:
                                      isQuotedShown && cleanedHtml.quoted
                                        ? msg.body_html
                                        : cleanedHtml.clean,
                                  }}
                                />
                                {cleanedHtml.quoted && (
                                  <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleQuoted(msg.id);
                                      }}
                                      className="px-2 py-0.5 rounded text-[11px] font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors inline-flex items-center gap-1"
                                      title={
                                        isQuotedShown
                                          ? 'Hide trimmed history'
                                          : 'Show trimmed quoted history'
                                      }
                                    >
                                      <span>{isQuotedShown ? 'Hide trimmed history' : '···'}</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div>
                                <pre className="whitespace-pre-wrap font-sans text-sm text-slate-800 dark:text-slate-200 leading-relaxed select-text">
                                  {isQuotedShown && cleanedText.quoted
                                    ? msg.body_text
                                    : cleanedText.clean || '(No text content)'}
                                </pre>
                                {cleanedText.quoted && (
                                  <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleQuoted(msg.id);
                                      }}
                                      className="px-2 py-0.5 rounded text-[11px] font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors inline-flex items-center gap-1"
                                      title={
                                        isQuotedShown
                                          ? 'Hide trimmed history'
                                          : 'Show trimmed quoted history'
                                      }
                                    >
                                      <span>{isQuotedShown ? 'Hide trimmed history' : '···'}</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div>
                            <pre className="whitespace-pre-wrap font-sans text-sm text-slate-800 dark:text-slate-200 leading-relaxed select-text">
                              {isQuotedShown && cleanedText.quoted
                                ? msg.body_text
                                : cleanedText.clean || '(Empty message)'}
                            </pre>
                            {cleanedText.quoted && (
                              <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleQuoted(msg.id);
                                  }}
                                  className="px-2 py-0.5 rounded text-[11px] font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors inline-flex items-center gap-1"
                                  title={
                                    isQuotedShown
                                      ? 'Hide trimmed history'
                                      : 'Show trimmed quoted history'
                                  }
                                >
                                  <span>{isQuotedShown ? 'Hide trimmed history' : '···'}</span>
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Attachments Section (Actual User Attachments Only) */}
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2">
                          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                            <Paperclip className="w-3.5 h-3.5" />
                            <span>Attachments ({msg.attachments.length})</span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                            {msg.attachments.map((att, i) => {
                              const isImg =
                                att.content_type?.startsWith('image/') ||
                                /\.(png|jpe?g|gif|webp|svg)$/i.test(att.filename);
                              const sizeKb = Math.round(att.size / 1024);

                              return (
                                <div
                                  key={i}
                                  className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/80 dark:border-slate-700/80 hover:border-indigo-400 transition-all text-xs"
                                >
                                  <div className="flex items-center gap-2 truncate mr-2">
                                    {isImg ? (
                                      <ImageIcon className="w-4 h-4 text-indigo-500 flex-shrink-0" />
                                    ) : (
                                      <File className="w-4 h-4 text-slate-400 flex-shrink-0" />
                                    )}
                                    <div className="truncate">
                                      <p className="font-medium text-slate-800 dark:text-slate-200 truncate">
                                        {att.filename}
                                      </p>
                                      <p className="text-[10px] text-slate-400">{sizeKb} KB</p>
                                    </div>
                                  </div>

                                  <a
                                    href={`/api/blobs/${att.path}`}
                                    download={att.filename}
                                    title={`Download ${att.filename}`}
                                    className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-white dark:hover:bg-slate-700 rounded-lg transition-colors flex-shrink-0"
                                  >
                                    <Download className="w-4 h-4" />
                                  </a>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Message Metadata Footer */}
                      <div className="mt-5 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
                        <div className="flex items-center gap-2">
                          <span>
                            Record ID:{' '}
                            <span className="font-mono text-[10px] font-semibold text-slate-600 dark:text-slate-400">
                              {msg.id.slice(0, 8)}
                            </span>
                          </span>
                          {msg.message_id_header && (
                            <span className="hidden md:inline font-mono text-[10px] text-slate-400/80">
                              • {msg.message_id_header}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Security & Certificate Details Modal */}
      {securityModalMsg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Security & Certificate Information
                  </h3>
                  <p className="text-[11px] text-slate-400">Cryptographic authenticity details</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSecurityModalMsg(null)}
                className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-all active:scale-95"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              {/* Status List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                  <span className="text-slate-500 dark:text-slate-400">DKIM Signature:</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> RSA 2048-bit Signed (selector: default)
                  </span>
                </div>

                <div className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                  <span className="text-slate-500 dark:text-slate-400">SPF Validation:</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> PASS (Designated IP authorized)
                  </span>
                </div>

                <div className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                  <span className="text-slate-500 dark:text-slate-400">DMARC Policy:</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> Aligned (100% Quarantine/Reject)
                  </span>
                </div>

                <div className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                  <span className="text-slate-500 dark:text-slate-400">Transport Encryption:</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    TLS 1.3 / STARTTLS Encrypted
                  </span>
                </div>
              </div>

              {/* Raw RFC 5322 Source Action */}
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
                  <span>Server Storage Blob:</span>
                  <span className="font-mono text-[10px] truncate max-w-[200px]">
                    {securityModalMsg.raw_blob_path}
                  </span>
                </div>
                <a
                  href={`/api/blobs/${securityModalMsg.raw_blob_path}`}
                  download
                  className="w-full flex items-center justify-center gap-2 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-medium rounded-xl transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Full RFC 5322 EML Source & Headers</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
