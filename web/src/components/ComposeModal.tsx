import {
  ExternalLink,
  File,
  FileText,
  Image,
  LayoutTemplate,
  Paperclip,
  PenTool,
  Plus,
  Search,
  Send,
  Smile,
  X,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { addonHost } from '../sdk/AddonHost';
import { SlotRenderer } from '../sdk/SlotRenderer';
import { useAppDispatch, useAppSelector } from '../store';
import { openUserSettings, showToast } from '../store/slices/uiSlice';

export interface ComposeAttachment {
  filename: string;
  size: number;
  content_type: string;
  data_base64: string;
}

interface ComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSend: (data: {
    to: string[];
    cc: string[];
    subject: string;
    body_text: string;
    body_html: string;
    attachments: ComposeAttachment[];
    in_reply_to?: string;
    thread_id?: string;
  }) => Promise<void>;
  replyTo?: {
    id?: string;
    sender: string;
    recipients?: string[];
    subject: string;
    message_id_header?: string;
    thread_id?: string;
    body_text?: string;
    created_at?: number;
    mode?: 'reply' | 'forward';
  } | null;
}

const EMAIL_TEMPLATES = [
  {
    name: 'Meeting Request',
    subject: 'Meeting Request: [Topic]',
    body: `Hi [Name],\n\nI hope you're having a productive week.\n\nI'd like to schedule a brief meeting to discuss [Topic]. Would you be available for 20-30 minutes at any of the following times?\n\n• Option 1: [Day, Date at Time]\n• Option 2: [Day, Date at Time]\n\nLooking forward to speaking with you.\n\nBest,`,
  },
  {
    name: 'Project Status Update',
    subject: 'Project Update: [Project Name] - [Date]',
    body: `Team,\n\nHere is the latest progress update for [Project Name]:\n\n✅ Key Milestones Completed:\n• [Milestone 1]\n• [Milestone 2]\n\n🔄 In Progress:\n• [Task 1]\n• [Task 2]\n\n⚠️ Potential Blockers / Notes:\n• None at this time\n\nPlease let me know if you have any questions or feedback.\n\nBest regards,`,
  },
  {
    name: 'Invoice & Payment Follow-Up',
    subject: 'Invoice & Payment Confirmation: #[Invoice Number]',
    body: `Dear [Client Name],\n\nPlease find attached the invoice #[Invoice Number] for recent services rendered.\n\n• Amount: $[Amount]\n• Due Date: [Date]\n\nPlease let me know if you need any clarification or updated purchase order information.\n\nThank you,`,
  },
  {
    name: 'Professional Follow-Up',
    subject: 'Following up on our conversation regarding [Topic]',
    body: `Hi [Name],\n\nThank you for your time earlier. I am following up on our discussion regarding [Topic].\n\nAs agreed, here are the next steps:\n1. [Next Step 1]\n2. [Next Step 2]\n\nPlease let me know if you need any additional information from my side.\n\nBest,`,
  },
];

const EMOJI_CATEGORIES = [
  {
    name: 'Smileys',
    emojis: [
      '😊',
      '😂',
      '🤣',
      '😍',
      '🥰',
      '😎',
      '🤓',
      '🥳',
      '😇',
      '🤔',
      '🙃',
      '😅',
      '🥺',
      '😭',
      '🤩',
      '😴',
    ],
  },
  {
    name: 'Gestures',
    emojis: [
      '👍',
      '👎',
      '👏',
      '🙌',
      '🤝',
      '✌️',
      '🤞',
      '👊',
      '✊',
      '🙏',
      '💪',
      '👋',
      '🫡',
      '❤️',
      '🔥',
      '✨',
    ],
  },
  {
    name: 'Office & Mail',
    emojis: [
      '📧',
      '📨',
      '📩',
      '📦',
      '📎',
      '📌',
      '💻',
      '📱',
      '⚙️',
      '💡',
      '🚀',
      '🎯',
      '📊',
      '📈',
      '📝',
      '📅',
    ],
  },
  {
    name: 'Celebration',
    emojis: [
      '🎉',
      '🎊',
      '🏆',
      '💯',
      '⚡',
      '🌟',
      '💥',
      '🌈',
      '☀️',
      '☕',
      '🍕',
      '🎂',
      '🍾',
      '🍻',
      '🎈',
      '🎁',
    ],
  },
];

export const ComposeModal: React.FC<ComposeModalProps> = ({ isOpen, onClose, onSend, replyTo }) => {
  const dispatch = useAppDispatch();
  const { user } = useAppSelector((state) => state.auth);

  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [attachments, setAttachments] = useState<ComposeAttachment[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);

  const [customTemplates, setCustomTemplates] = useState<
    { id: string; name: string; subject: string; body: string }[]
  >([]);
  const [templateSearch, setTemplateSearch] = useState('');
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  const [includeSignature, setIncludeSignature] = useState(() => {
    return localStorage.getItem('micromail_include_signature') !== 'false';
  });
  const [signatureText, setSignatureText] = useState(() => {
    return (
      user?.signature ||
      localStorage.getItem('micromail_user_signature') ||
      '--\nBest regards,\nMicroMail User'
    );
  });

  useEffect(() => {
    if (user?.signature !== undefined) {
      setSignatureText(user.signature);
    } else {
      const stored = localStorage.getItem('micromail_user_signature');
      if (stored) setSignatureText(stored);
    }
  }, [user?.signature]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resetForm = useCallback(() => {
    setTo('');
    setCc('');
    setShowCc(false);
    setSubject('');
    setBodyText('');
    setAttachments([]);
    setShowEmojiPicker(false);
    setShowTemplatePicker(false);
  }, []);

  const handleClose = () => {
    resetForm();
    onClose();
  };

  useEffect(() => {
    if (isOpen) {
      if (replyTo) {
        if (replyTo.mode === 'forward') {
          setTo('');
          setCc('');
          setShowCc(false);
          const baseSubj = replyTo.subject || '(No subject)';
          setSubject(
            baseSubj.toLowerCase().startsWith('fwd:') || baseSubj.toLowerCase().startsWith('fw:')
              ? baseSubj
              : `Fwd: ${baseSubj}`
          );
          const dateStr = replyTo.created_at
            ? new Date(replyTo.created_at * 1000).toLocaleString()
            : new Date().toLocaleString();
          const fwdHeader = `\n\n---------- Forwarded message ---------\nFrom: ${replyTo.sender}\nDate: ${dateStr}\nSubject: ${baseSubj}\nTo: ${(replyTo.recipients || []).join(', ')}\n\n${replyTo.body_text || ''}`;
          setBodyText(fwdHeader);
        } else {
          // reply mode: each email in the conversation thread is its own discrete level,
          // so we start with a clean message body without repeating past thread history.
          setTo(replyTo.sender);
          setCc('');
          setShowCc(false);
          const baseSubj = replyTo.subject || '(No subject)';
          setSubject(baseSubj.toLowerCase().startsWith('re:') ? baseSubj : `Re: ${baseSubj}`);
          setBodyText('');
        }
      } else {
        resetForm();
      }
      setShowEmojiPicker(false);
      setShowTemplatePicker(false);
    }
  }, [isOpen, replyTo, resetForm]);

  // Addon SDK insertion hook
  useEffect(() => {
    const unsub = addonHost.onComposeText((inserted) => {
      setBodyText((prev) => (prev ? `${prev}\n${inserted}` : inserted));
    });
    return unsub;
  }, []);

  const fetchCustomTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/user/templates');
      if (res.ok) {
        const data = await res.json();
        setCustomTemplates(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to load custom templates in compose:', err);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchCustomTemplates();
    }
  }, [isOpen, fetchCustomTemplates]);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();

      reader.onload = () => {
        const resultStr = reader.result as string;
        // Strip data:*;base64, prefix
        const base64Data = resultStr.includes(',') ? resultStr.split(',')[1] : resultStr;

        setAttachments((prev) => [
          ...prev,
          {
            filename: file.name,
            size: file.size,
            content_type: file.type || 'application/octet-stream',
            data_base64: base64Data,
          },
        ]);
      };

      reader.readAsDataURL(file);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const insertEmoji = (emoji: string) => {
    if (textareaRef.current) {
      const start = textareaRef.current.selectionStart || 0;
      const end = textareaRef.current.selectionEnd || 0;
      const nextText = bodyText.substring(0, start) + emoji + bodyText.substring(end);
      setBodyText(nextText);

      // Reset cursor position
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = start + emoji.length;
          textareaRef.current.selectionEnd = start + emoji.length;
          textareaRef.current.focus();
        }
      }, 0);
    } else {
      setBodyText((prev) => prev + emoji);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleSaveCurrentAsTemplate = async () => {
    const tplName = window.prompt(
      'Enter a name for this new template:',
      subject || 'Custom Template'
    );
    if (!tplName?.trim()) return;

    setIsSavingTemplate(true);
    try {
      const res = await fetch('/api/user/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: tplName.trim(),
          subject: subject,
          body: bodyText,
        }),
      });
      if (!res.ok) {
        throw new Error('Failed to save template');
      }
      await fetchCustomTemplates();
      dispatch(showToast({ message: 'Template saved to your account', type: 'success' }));
    } catch (err: any) {
      dispatch(showToast({ message: err.message || 'Error saving template', type: 'error' }));
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const applyTemplate = (tpl: { name: string; subject: string; body: string }) => {
    setSubject(tpl.subject);
    setBodyText(tpl.body);
    setShowTemplatePicker(false);
  };

  const toggleIncludeSignature = () => {
    const next = !includeSignature;
    setIncludeSignature(next);
    localStorage.setItem('micromail_include_signature', String(next));
  };

  const handleSaveDraft = async () => {
    setIsSavingDraft(true);
    try {
      const toList = to
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const ccList = cc
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      let finalBody = bodyText;
      if (includeSignature && signatureText && !finalBody.includes(signatureText.trim())) {
        finalBody = `${finalBody}\n\n${signatureText}`;
      }

      const res = await fetch('/api/messages/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: toList.length > 0 ? toList : ['(Draft)'],
          cc: ccList,
          subject: subject || '(Untitled Draft)',
          body_text: finalBody,
          body_html: '',
          attachments: attachments.map((a) => ({
            filename: a.filename,
            content_type: a.content_type,
            data_base64: a.data_base64,
          })),
        }),
      });

      if (res.ok) {
        onClose();
      }
    } catch (err) {
      console.error('Failed to save draft:', err);
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!to.trim()) return;

    setIsSending(true);
    try {
      const toList = to
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const ccList = cc
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      let finalBody = bodyText;
      if (includeSignature && signatureText && !finalBody.includes(signatureText.trim())) {
        finalBody = `${finalBody}\n\n${signatureText}`;
      }

      await onSend({
        to: toList,
        cc: ccList,
        subject,
        body_text: finalBody,
        body_html: '',
        attachments,
        in_reply_to: replyTo?.message_id_header || replyTo?.id,
        thread_id: replyTo?.thread_id,
      });
      resetForm();
      onClose();
    } catch (err) {
      console.error('Failed to send:', err);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 relative">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm">
            {replyTo?.mode === 'forward'
              ? 'Forward Message'
              : replyTo
                ? 'Reply Message'
                : 'New Message'}
          </h3>
          <button
            onClick={handleClose}
            className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-all active:scale-95"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1">
          <div className="p-4 space-y-3 border-b border-slate-100 dark:border-slate-800">
            {/* To field */}
            <div className="flex items-center gap-3">
              <label className="w-12 text-xs font-semibold text-slate-400">To:</label>
              <input
                type="text"
                required
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="recipient@example.com (comma separated)"
                className="flex-1 text-sm bg-transparent border-0 focus:outline-none text-slate-800 dark:text-slate-200"
              />
              {!showCc && (
                <button
                  type="button"
                  onClick={() => setShowCc(true)}
                  className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 font-medium"
                >
                  Cc
                </button>
              )}
            </div>

            {/* Cc field */}
            {showCc && (
              <div className="flex items-center gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <label className="w-12 text-xs font-semibold text-slate-400">Cc:</label>
                <input
                  type="text"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  placeholder="cc@example.com"
                  className="flex-1 text-sm bg-transparent border-0 focus:outline-none text-slate-800 dark:text-slate-200"
                />
              </div>
            )}

            {/* Subject field */}
            <div className="flex items-center gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <label className="w-12 text-xs font-semibold text-slate-400">Subject:</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Message Subject"
                className="flex-1 text-sm bg-transparent border-0 focus:outline-none font-medium text-slate-800 dark:text-slate-200"
              />
            </div>
          </div>

          {/* Action Toolbar: Attachments, Emojis & Addon Slots */}
          <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between relative">
            <div className="flex items-center gap-2">
              {/* Attach File Button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
                title="Attach Files"
              >
                <Paperclip className="w-3.5 h-3.5" />
                <span>Attach</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />

              {/* Emoji Picker Button */}
              <button
                type="button"
                onClick={() => {
                  setShowEmojiPicker(!showEmojiPicker);
                  setShowTemplatePicker(false);
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors ${
                  showEmojiPicker
                    ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
                title="Insert Emoji"
              >
                <Smile className="w-3.5 h-3.5" />
                <span>Emoji</span>
              </button>

              {/* Slot next to Emoji for Addons (e.g. Voice to Compose) */}
              <SlotRenderer slot="compose_actions" />

              {/* Templates Dropdown Button */}
              <button
                type="button"
                onClick={() => {
                  setShowTemplatePicker(!showTemplatePicker);
                  setShowEmojiPicker(false);
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors ${
                  showTemplatePicker
                    ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
                title="Use Email Template"
              >
                <LayoutTemplate className="w-3.5 h-3.5 text-indigo-500" />
                <span>Templates</span>
              </button>

              {/* Signature Toggle Button */}
              <button
                type="button"
                onClick={toggleIncludeSignature}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg transition-all border ${
                  includeSignature
                    ? 'border-slate-900 dark:border-white text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-800 font-semibold'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title={
                  includeSignature
                    ? 'Signature enabled (click to disable)'
                    : 'Signature disabled (click to enable)'
                }
              >
                <PenTool className="w-3.5 h-3.5 text-emerald-500" />
                <span>Signature</span>
              </button>
            </div>

            {/* Addon Slot for Compose Toolbar */}
            <SlotRenderer slot="compose_toolbar" />

            {/* Popup Template Picker Panel */}
            {showTemplatePicker && (
              <div className="absolute left-4 md:left-24 top-10 z-50 bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 p-3 w-80 space-y-2.5 animate-in fade-in zoom-in-95 duration-100 max-h-96 flex flex-col">
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-100 dark:border-slate-700">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    Insert Email Template
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setShowTemplatePicker(false);
                        onClose();
                        dispatch(openUserSettings('templates'));
                      }}
                      className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline px-1 py-0.5 rounded font-medium flex items-center gap-1"
                      title="Manage templates in User Settings"
                    >
                      <span>Manage</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowTemplatePicker(false)}
                      className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                      title="Close"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Quick Save Current Message as Template button */}
                {(subject.trim() || bodyText.trim()) && (
                  <button
                    type="button"
                    onClick={handleSaveCurrentAsTemplate}
                    disabled={isSavingTemplate}
                    className="w-full py-1.5 px-2 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-xl text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Save Current as New Template</span>
                  </button>
                )}

                {/* Search Input */}
                <div className="relative">
                  <Search className="w-3 h-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={templateSearch}
                    onChange={(e) => setTemplateSearch(e.target.value)}
                    placeholder="Search templates..."
                    className="w-full pl-7 pr-2 py-1 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none"
                  />
                </div>

                {/* Templates List */}
                <div className="space-y-1 overflow-y-auto max-h-56 pr-1">
                  {[
                    ...customTemplates.map((t) => ({ ...t, isCustom: true })),
                    ...EMAIL_TEMPLATES.map((t) => ({ ...t, id: t.name, isCustom: false })),
                  ]
                    .filter(
                      (t) =>
                        t.name.toLowerCase().includes(templateSearch.toLowerCase()) ||
                        t.subject.toLowerCase().includes(templateSearch.toLowerCase())
                    )
                    .map((tpl) => (
                      <button
                        key={`${tpl.isCustom ? 'cust' : 'sys'}_${tpl.id || tpl.name}`}
                        type="button"
                        onClick={() => applyTemplate(tpl)}
                        className="w-full text-left p-2 hover:bg-slate-100 dark:hover:bg-slate-700/80 rounded-xl transition-colors group"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-800 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                            {tpl.name}
                          </span>
                          <span
                            className={`text-[9px] px-1.5 py-0.2 rounded-full font-semibold ${
                              tpl.isCustom
                                ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20'
                                : 'bg-slate-100 dark:bg-slate-700 text-slate-500'
                            }`}
                          >
                            {tpl.isCustom ? 'Custom' : 'Default'}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 truncate mt-0.5">
                          {tpl.subject}
                        </div>
                      </button>
                    ))}
                </div>
              </div>
            )}

            {/* Popup Emoji Picker Panel */}
            {showEmojiPicker && (
              <div className="absolute left-4 top-10 z-50 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 p-3 w-80 max-h-72 overflow-y-auto space-y-3 animate-in fade-in zoom-in-95 duration-100">
                <div className="flex items-center justify-between pb-1 border-b border-slate-100 dark:border-slate-700">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    Select Emoji
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowEmojiPicker(false)}
                    className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                    title="Close"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {EMOJI_CATEGORIES.map((cat) => (
                  <div key={cat.name} className="space-y-1">
                    <div className="text-[10px] font-semibold text-slate-400 uppercase">
                      {cat.name}
                    </div>
                    <div className="grid grid-cols-8 gap-1">
                      {cat.emojis.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => insertEmoji(emoji)}
                          className="w-8 h-8 flex items-center justify-center text-lg hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-transform hover:scale-125"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Attachment Chips List */}
          {attachments.length > 0 && (
            <div className="p-3 bg-slate-50/50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-800 flex flex-wrap gap-2">
              {attachments.map((att, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 pl-2.5 pr-1.5 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs shadow-sm"
                >
                  {att.content_type.startsWith('image/') ? (
                    <Image className="w-3.5 h-3.5 text-indigo-500" />
                  ) : (
                    <File className="w-3.5 h-3.5 text-slate-400" />
                  )}
                  <span className="font-medium text-slate-800 dark:text-slate-200 max-w-[140px] truncate">
                    {att.filename}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    ({formatFileSize(att.size)})
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(i)}
                    className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-full transition-colors"
                    title="Remove attachment"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Body textarea */}
          <textarea
            ref={textareaRef}
            required
            rows={10}
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            placeholder="Write your email here... (supports emojis 😊 and file attachments 📎)"
            className="p-4 flex-1 text-sm bg-transparent border-0 focus:outline-none resize-none text-slate-800 dark:text-slate-200 leading-relaxed"
          />

          {/* Footer Actions */}
          <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={isSavingDraft || isSending}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl transition-all border border-slate-200 dark:border-slate-700 active:scale-95 shadow-sm"
              >
                <FileText className="w-3.5 h-3.5 text-slate-400" />
                <span>{isSavingDraft ? 'Saving Draft...' : 'Save Draft'}</span>
              </button>
              <button
                type="submit"
                disabled={isSending || isSavingDraft}
                className="btn-primary flex items-center gap-1.5 px-5 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer select-none shadow-md"
              >
                <Send className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>{isSending ? 'Sending...' : 'Send Message'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
