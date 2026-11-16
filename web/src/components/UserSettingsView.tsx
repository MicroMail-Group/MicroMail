import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Edit3,
  Eye,
  EyeOff,
  Globe,
  HelpCircle,
  Laptop,
  LayoutTemplate,
  Lock,
  Mail,
  Monitor,
  PenTool,
  Plus,
  RefreshCw,
  Save,
  Search,
  Server,
  ShieldCheck,
  Sliders,
  Smartphone,
  Trash2,
  User,
  X,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../store';
import { setUserSettingsTab, showToast, type UserSettingsTab } from '../store/slices/uiSlice';
import { copyTextToClipboard } from '../utils/clipboard';

export interface UserEmailTemplate {
  id: string;
  user_id: string;
  name: string;
  subject: string;
  body: string;
  created_at: number;
  updated_at: number;
}

export interface UserSession {
  id: string;
  device: string;
  user_agent: string;
  ip: string;
  current: boolean;
  created_at: number;
  last_active: number;
  expires_at: number;
}

const DEFAULT_SYSTEM_TEMPLATES = [
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

export interface ClientGuide {
  id: string;
  name: string;
  category: 'apple' | 'android' | 'desktop';
  platformBadge: string;
  iconType: 'apple' | 'android' | 'windows' | 'mail' | 'thunderbird';
  description: string;
  steps: string[];
  tips?: string[];
}

export const CLIENT_GUIDES: ClientGuide[] = [
  {
    id: 'apple-ios',
    name: 'Apple Mail (iPhone & iPad)',
    category: 'apple',
    platformBadge: 'iOS / iPadOS',
    iconType: 'apple',
    description: 'Native Apple Mail app pre-installed on iPhone, iPad, and iPod touch.',
    steps: [
      'Open the Settings app on your iOS device, then scroll down and tap "Mail" (on iOS 18+, find it under "Apps" → "Mail").',
      'Tap "Mail Accounts" (or "Accounts") and select "Add Account".',
      'Select "Other" at the bottom of the list, then tap "Add Mail Account".',
      'Enter your Name, full Email Address, Password, and a Description (e.g. MicroMail). Tap "Next".',
      'Make sure the "IMAP" tab is selected at the top.',
      'Under "Incoming Mail Server", enter your Server Hostname, your full Email address as User Name, and your password.',
      'Under "Outgoing Mail Server", enter the same Server Hostname, your full Email address as User Name, and your password.',
      'Tap "Next". iOS will verify the connection. Ensure "Mail" is toggled ON, then tap "Save".',
    ],
    tips: [
      'iOS automatically negotiates Port 993 (SSL) for incoming and Port 587 (STARTTLS) for outgoing.',
      'Make sure to enter your full email address in the Outgoing Mail Server User Name field, even if iOS marks it as optional.',
    ],
  },
  {
    id: 'apple-macos',
    name: 'Apple Mail (macOS)',
    category: 'apple',
    platformBadge: 'macOS',
    iconType: 'apple',
    description: 'Native macOS Mail application for MacBook, iMac, and Mac Mini.',
    steps: [
      'Launch the Mail application on your Mac.',
      'From the menu bar at the top, click "Mail" → "Add Account...".',
      'Select "Other Mail Account..." at the bottom of the provider list and click "Continue".',
      'Enter your Name, full Email Address, and Account Password. Click "Sign In".',
      'When prompted with manual settings, select Account Type: "IMAP".',
      'Enter your Server Hostname for both Incoming Mail Server and Outgoing Mail Server.',
      'Set User Name to your full email address, re-enter your password if requested, and click "Sign In".',
      'Select "Mail" and click "Done" to finish.',
    ],
    tips: [
      'If macOS asks to verify the certificate for custom domains, click "Show Certificate" and choose to trust your mail server.',
    ],
  },
  {
    id: 'outlook-desktop',
    name: 'Microsoft Outlook (Desktop)',
    category: 'desktop',
    platformBadge: 'Windows & Mac',
    iconType: 'windows',
    description: 'Microsoft Outlook 2016, 2019, 2021, and Microsoft 365 desktop software.',
    steps: [
      'Open Outlook and click "File" in the top-left menu (or "Outlook" → "Settings" → "Accounts" on macOS).',
      'Click "Add Account" (or the "+" icon).',
      'Enter your full email address, expand "Advanced options", check "Let me set up my account manually", and click "Connect".',
      'Choose "IMAP" from the account types grid.',
      'Configure Incoming Mail: Server = your mail hostname, Port = 993, Encryption = SSL/TLS.',
      'Configure Outgoing Mail: Server = your mail hostname, Port = 587, Encryption = STARTTLS (or 465 SSL/TLS).',
      'Ensure "Require logon using Secure Password Authentication (SPA)" remains UNCHECKED.',
      'Enter your account password and click "Connect" to finish.',
    ],
    tips: [
      'In More Settings > Outgoing Server, ensure "My outgoing server (SMTP) requires authentication" is checked.',
    ],
  },
  {
    id: 'outlook-mobile',
    name: 'Microsoft Outlook (Mobile)',
    category: 'apple',
    platformBadge: 'iOS & Android',
    iconType: 'mail',
    description: 'Official Microsoft Outlook mobile app for iPhone, iPad, and Android phones.',
    steps: [
      'Open the Outlook mobile app on your device.',
      'Tap your profile avatar or the menu icon, then tap the Settings gear or "+" Add Mail Account.',
      'Type your full email address and tap "Continue".',
      'If Outlook attempts to connect via Office 365, tap "Not Office 365" or "Change Account Provider" in the top-right.',
      'Select "IMAP" as your account provider.',
      'Toggle ON "Use Advanced Settings".',
      'Enter IMAP Incoming Server (hostname:993), IMAP Username (full email), and Password.',
      'Enter SMTP Outgoing Server (hostname:587), SMTP Username (full email), and Password.',
      'Tap the Checkmark or "Sign In" to complete setup.',
    ],
  },
  {
    id: 'thunderbird',
    name: 'Mozilla Thunderbird',
    category: 'desktop',
    platformBadge: 'Win / Mac / Linux',
    iconType: 'thunderbird',
    description: 'Free, open-source email client for Windows, macOS, and Linux with full IMAP IDLE support.',
    steps: [
      'Launch Thunderbird. Open the menu (≡) in the top-right corner → "Account Settings".',
      'At the bottom-left of the settings tab, click "Account Actions" → "Add Mail Account...".',
      'Enter your Name, Email Address, and Password. Click "Configure manually" at the bottom.',
      'Set Incoming: Protocol = IMAP, Hostname = your mail hostname, Port = 993, Connection security = SSL/TLS, Authentication = Normal password, Username = full email.',
      'Set Outgoing: Hostname = your mail hostname, Port = 587, Connection security = STARTTLS, Authentication = Normal password, Username = full email.',
      'Click "Re-test" to verify the connection.',
      'When the green confirmation banner appears, click "Done".',
    ],
    tips: [
      'Thunderbird fully supports IMAP IDLE for instant, real-time push notifications of incoming mail.',
    ],
  },
  {
    id: 'gmail-android',
    name: 'Gmail App (Android IMAP)',
    category: 'android',
    platformBadge: 'Android',
    iconType: 'android',
    description: 'Pre-installed Google Gmail app on Android smartphones and tablets.',
    steps: [
      'Open the Gmail app on your Android device.',
      'Tap your profile icon in the upper-right corner and select "Add another account".',
      'On the "Set up email" screen, select "Other".',
      'Enter your full email address and tap "Next" (choose "Personal (IMAP)" if prompted).',
      'Enter your account password and tap "Next".',
      'Incoming server settings: Server = your mail hostname, Port = 993, Security type = SSL/TLS. Tap "Next".',
      'Outgoing server settings: Toggle ON "Require sign-in", Server = your mail hostname, Port = 587, Security type = STARTTLS. Tap "Next".',
      'Choose your preferred sync frequency and notification options, then tap "Next" to complete.',
    ],
  },
  {
    id: 'samsung-email',
    name: 'Samsung Email',
    category: 'android',
    platformBadge: 'Samsung Galaxy',
    iconType: 'android',
    description: 'Default Samsung Email application on Galaxy phones and tablets.',
    steps: [
      'Open the Samsung Email app on your Galaxy device.',
      'Tap the menu icon (≡) → Settings gear icon → "Add account".',
      'Select "Other" from the list of providers.',
      'Enter your email address and password, then tap "Manual setup" at the bottom.',
      'Choose "IMAP account".',
      'Under Incoming server: Server = your mail hostname, Security type = SSL, Port = 993, User name = full email.',
      'Under Outgoing server: Server = your mail hostname, Security type = STARTTLS, Port = 587, Authentication switch = ON, User name = full email.',
      'Tap "Sign in" to connect.',
    ],
  },
  {
    id: 'spark-mail',
    name: 'Spark Mail',
    category: 'desktop',
    platformBadge: 'iOS / Android / Mac / Win',
    iconType: 'mail',
    description: 'Smart cross-platform email client by Readdle with AI and productivity workflows.',
    steps: [
      'Open Spark and click/tap "Settings" (or gear icon) → "Accounts" → "Add Account".',
      'Select "Set Up Account Manually" (or enter your email and click "Advanced Settings").',
      'Click the "IMAP" option.',
      'Enter your Display Name, Email address, and Password.',
      'Incoming Server (IMAP): Hostname = your mail hostname, Port = 993, Protection = SSL.',
      'Outgoing Server (SMTP): Hostname = your mail hostname, Port = 587, Protection = STARTTLS.',
      'Click "Log in" to authenticate and sync your inbox.',
    ],
  },
  {
    id: 'k9-mail',
    name: 'K-9 Mail / Thunderbird for Android',
    category: 'android',
    platformBadge: 'Android (Open Source)',
    iconType: 'android',
    description: 'Community-driven open-source email client for Android with deep privacy features.',
    steps: [
      'Launch K-9 Mail and tap "Add Account" (or "+" in the sidebar).',
      'Enter your email address and password, then tap "Manual setup".',
      'Select "IMAP" as the account type.',
      'Incoming server: IMAP server = your mail hostname, Security = SSL/TLS, Port = 993, Authentication = Normal password, Username = full email. Tap "Next".',
      'Outgoing server: SMTP server = your mail hostname, Security = STARTTLS, Port = 587, Require sign-in = Checked, Username = full email. Tap "Next".',
      'Select your folder poll frequency and display name, then tap "Done".',
    ],
  },
  {
    id: 'em-client',
    name: 'eM Client',
    category: 'desktop',
    platformBadge: 'Windows & macOS',
    iconType: 'windows',
    description: 'Modern desktop email client with advanced mail, contacts, and calendar sync.',
    steps: [
      'Open eM Client and go to "Menu" → "Accounts" → "Add account".',
      'Expand the "Mail" section and select "Other" to use manual configuration, then click "Next".',
      'Enter your email address and click "Next".',
      'Incoming Server: Select "IMAP", Hostname = your mail hostname, Port = 993, Security = Use SSL/TLS on special port (legacy).',
      'Outgoing Server: Hostname = your mail hostname, Port = 587, Security = Force usage of SSL/TLS (or STARTTLS).',
      'Enter your account password and username (full email address), then test configuration and click "Finish".',
    ],
  },
];

interface UserSettingsViewProps {
  onBack?: () => void;
  onUserUpdated?: (user: {
    display_name: string;
    signature: string;
    totp_enabled?: boolean;
  }) => void;
}

export const UserSettingsView: React.FC<UserSettingsViewProps> = ({ onBack, onUserUpdated }) => {
  const dispatch = useAppDispatch();
  const { userSettingsTab } = useAppSelector((state) => state.ui);
  const activeTab: UserSettingsTab = userSettingsTab || 'profile';

  // Profile & Signature State
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [signature, setSignature] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // Password Change State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPass, setShowCurrentPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [isChangingPass, setIsChangingPass] = useState(false);
  const [passError, setPassError] = useState<string | null>(null);

  // 2FA State
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [isSettingUp2FA, setIsSettingUp2FA] = useState(false);
  const [setupData, setSetupData] = useState<{
    secret: string;
    otpauth_uri: string;
    recovery_codes: string[];
  } | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [isSubmitting2FA, setIsSubmitting2FA] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Disable 2FA Modal
  const [isDisabling2FA, setIsDisabling2FA] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableError, setDisableError] = useState<string | null>(null);

  // Email Templates State
  const [templates, setTemplates] = useState<UserEmailTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<{
    id?: string;
    name: string;
    subject: string;
    body: string;
  } | null>(null);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  // Active Sessions State
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);
  const [isRevokingOthers, setIsRevokingOthers] = useState(false);

  // Email Clients State
  const [mailDomain, setMailDomain] = useState('');
  const [mailHostname, setMailHostname] = useState('');
  const [expandedClients, setExpandedClients] = useState<Record<string, boolean>>({
    'apple-ios': true,
  });
  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const [clientCategoryFilter, setClientCategoryFilter] = useState<'all' | 'apple' | 'android' | 'desktop'>('all');

  const fetchUserSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/user/settings');
      if (res.ok) {
        const data = await res.json();
        setEmail(data.email || '');
        setDisplayName(data.display_name || '');
        setSignature(data.signature || '');
        setIsAdmin(Boolean(data.is_admin));
        setTotpEnabled(Boolean(data.totp_enabled));
        if (data.mail_domain) setMailDomain(data.mail_domain);
        if (data.mail_hostname) setMailHostname(data.mail_hostname);
      }
    } catch (err) {
      console.error('Failed to load user settings:', err);
    } finally {
      setIsLoadingSettings(false);
    }
  }, []);

  const effectiveDomain =
    mailDomain || (email.includes('@') ? email.split('@')[1] : window.location.hostname);
  const effectiveHostname =
    mailHostname || (effectiveDomain ? `mail.${effectiveDomain}` : window.location.hostname);

  const toggleClientExpanded = (id: string) => {
    setExpandedClients((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleExpandAllClients = () => {
    const allExpanded: Record<string, boolean> = {};
    CLIENT_GUIDES.forEach((guide) => {
      allExpanded[guide.id] = true;
    });
    setExpandedClients(allExpanded);
  };

  const handleCollapseAllClients = () => {
    setExpandedClients({});
  };

  const fetchTemplates = useCallback(async () => {
    setIsLoadingTemplates(true);
    try {
      const res = await fetch('/api/user/templates');
      if (res.ok) {
        const data = await res.json();
        setTemplates(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to load templates:', err);
    } finally {
      setIsLoadingTemplates(false);
    }
  }, []);

  const fetchSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    try {
      const res = await fetch('/api/user/sessions');
      if (res.ok) {
        const data = await res.json();
        setSessions(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    fetchUserSettings();
    fetchTemplates();
    fetchSessions();
  }, [fetchUserSettings, fetchTemplates, fetchSessions]);

  const copyToClipboard = async (text: string, keyName: string, label?: string) => {
    await copyTextToClipboard(text);
    setCopiedKey(keyName);
    setTimeout(() => setCopiedKey(null), 2500);
    if (label) {
      dispatch(showToast({ message: `${label} copied to clipboard`, type: 'info', duration: 2000 }));
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSettings(true);
    try {
      const res = await fetch('/api/user/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: displayName,
          signature: signature,
        }),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || 'Failed to update settings');
      }

      localStorage.setItem('micromail_user_signature', signature);
      onUserUpdated?.({ display_name: displayName, signature, totp_enabled: totpEnabled });
      dispatch(showToast({ message: 'Profile & signature saved', type: 'success' }));
    } catch (err: any) {
      dispatch(
        showToast({
          message: err.message || 'Error saving settings',
          type: 'error',
        })
      );
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassError(null);

    if (newPassword.length < 6) {
      setPassError('New password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPassError('New passwords do not match');
      return;
    }

    setIsChangingPass(true);
    try {
      const res = await fetch('/api/user/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || 'Failed to update password');
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      dispatch(showToast({ message: 'Password updated successfully', type: 'success' }));
    } catch (err: any) {
      setPassError(err.message || 'Error changing password');
    } finally {
      setIsChangingPass(false);
    }
  };

  const handleStart2FASetup = async () => {
    setSetupError(null);
    setVerifyCode('');
    setIsSettingUp2FA(true);
    try {
      const res = await fetch('/api/auth/2fa/setup', { method: 'POST' });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || 'Failed to generate 2FA credentials');
      }
      const data = await res.json();
      setSetupData(data);
    } catch (err: any) {
      setSetupError(err.message || 'Could not initiate 2FA setup');
    }
  };

  const handleConfirm2FASetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyCode.trim()) return;
    setIsSubmitting2FA(true);
    setSetupError(null);

    try {
      const res = await fetch('/api/auth/2fa/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: verifyCode.trim() }),
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || 'Invalid verification code');
      }

      setIsSettingUp2FA(false);
      setSetupData(null);
      setTotpEnabled(true);
      onUserUpdated?.({ display_name: displayName, signature, totp_enabled: true });
      dispatch(showToast({ message: 'Two-Factor Authentication enabled', type: 'success' }));
    } catch (err: any) {
      setSetupError(err.message || 'Failed to verify code');
    } finally {
      setIsSubmitting2FA(false);
    }
  };

  const handleConfirm2FADisable = async (e: React.FormEvent) => {
    e.preventDefault();
    setDisableError(null);
    setIsSubmitting2FA(true);

    try {
      const res = await fetch('/api/auth/2fa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: disablePassword }),
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || 'Incorrect password');
      }

      setIsDisabling2FA(false);
      setDisablePassword('');
      setTotpEnabled(false);
      onUserUpdated?.({ display_name: displayName, signature, totp_enabled: false });
      dispatch(showToast({ message: 'Two-Factor Authentication disabled', type: 'info' }));
    } catch (err: any) {
      setDisableError(err.message || 'Failed to disable 2FA');
    } finally {
      setIsSubmitting2FA(false);
    }
  };

  // Template Handlers
  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTemplate?.name.trim()) return;

    setIsSavingTemplate(true);
    try {
      const isEdit = Boolean(editingTemplate.id);
      const url = isEdit ? `/api/user/templates/${editingTemplate.id}` : '/api/user/templates';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editingTemplate.name.trim(),
          subject: editingTemplate.subject.trim(),
          body: editingTemplate.body,
        }),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || 'Failed to save template');
      }

      await fetchTemplates();
      setEditingTemplate(null);
      dispatch(
        showToast({
          message: isEdit ? 'Template updated' : 'Template created',
          type: 'success',
        })
      );
    } catch (err: any) {
      dispatch(showToast({ message: err.message || 'Error saving template', type: 'error' }));
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const handleDeleteTemplate = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete the template "${name}"?`)) return;

    try {
      const res = await fetch(`/api/user/templates/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || 'Failed to delete template');
      }
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      dispatch(showToast({ message: 'Template deleted', type: 'info' }));
    } catch (err: any) {
      dispatch(showToast({ message: err.message || 'Error deleting template', type: 'error' }));
    }
  };

  const handleCloneDefaultTemplate = (tpl: { name: string; subject: string; body: string }) => {
    setEditingTemplate({
      name: `${tpl.name} (Custom)`,
      subject: tpl.subject,
      body: tpl.body,
    });
  };

  // Session Handlers
  const handleRevokeSession = async (session: UserSession) => {
    if (session.current) {
      if (
        !window.confirm('This is your current session. Revoking it will log you out now. Continue?')
      ) {
        return;
      }
    }

    setRevokingSessionId(session.id);
    try {
      const res = await fetch('/api/user/sessions/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: session.id }),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || 'Failed to revoke session');
      }

      const data = await res.json();
      if (data.is_current) {
        window.location.reload();
        return;
      }

      setSessions((prev) => prev.filter((s) => s.id !== session.id));
      dispatch(showToast({ message: 'Session signed out', type: 'info' }));
    } catch (err: any) {
      dispatch(showToast({ message: err.message || 'Error revoking session', type: 'error' }));
    } finally {
      setRevokingSessionId(null);
    }
  };

  const handleRevokeAllOtherSessions = async () => {
    if (!window.confirm('Are you sure you want to sign out of all other active sessions?')) {
      return;
    }

    setIsRevokingOthers(true);
    try {
      const res = await fetch('/api/user/sessions/revoke-others', { method: 'POST' });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || 'Failed to sign out of other sessions');
      }
      const data = await res.json();
      await fetchSessions();
      dispatch(
        showToast({
          message: `Signed out of ${data.revoked_count || 0} other session(s)`,
          type: 'success',
        })
      );
    } catch (err: any) {
      dispatch(showToast({ message: err.message || 'Error revoking sessions', type: 'error' }));
    } finally {
      setIsRevokingOthers(false);
    }
  };

  const insertVariableIntoTemplate = (variable: string) => {
    if (!editingTemplate) return;
    setEditingTemplate({
      ...editingTemplate,
      body: editingTemplate.body ? `${editingTemplate.body} ${variable}` : variable,
    });
  };

  return (
    <div className="w-full h-full min-h-full flex-1 flex flex-col overflow-y-auto bg-slate-50 dark:bg-slate-950 p-4 md:p-8 space-y-6 animate-view-fade">
      <div className="max-w-5xl mx-auto w-full flex-1 flex flex-col space-y-6">
        {/* Header Title & Back Button */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
                title="Back to Mailbox"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                  User Account & Preferences
                </h1>
                {isAdmin && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold border border-amber-500/20">
                    Administrator
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Manage your profile, email signature, templates, security credentials, active
                sessions, and email client setup.
              </p>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => dispatch(setUserSettingsTab('profile'))}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs transition-all ${
              activeTab === 'profile'
                ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950 shadow-sm font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-medium'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>Profile & Signature</span>
          </button>

          <button
            type="button"
            onClick={() => dispatch(setUserSettingsTab('templates'))}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs transition-all ${
              activeTab === 'templates'
                ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950 shadow-sm font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-medium'
            }`}
          >
            <LayoutTemplate className="w-3.5 h-3.5" />
            <span>Email Templates</span>
            {templates.length > 0 && (
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                  activeTab === 'templates'
                    ? 'bg-white/20 text-white dark:bg-black/20 dark:text-slate-950'
                    : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                {templates.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => dispatch(setUserSettingsTab('security'))}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs transition-all ${
              activeTab === 'security'
                ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950 shadow-sm font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-medium'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Security & Password</span>
            {totpEnabled && (
              <span className="w-2 h-2 rounded-full bg-emerald-500" title="2FA Active" />
            )}
          </button>

          <button
            type="button"
            onClick={() => dispatch(setUserSettingsTab('sessions'))}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs transition-all ${
              activeTab === 'sessions'
                ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950 shadow-sm font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-medium'
            }`}
          >
            <Laptop className="w-3.5 h-3.5" />
            <span>Active Sessions</span>
            {sessions.length > 0 && (
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                  activeTab === 'sessions'
                    ? 'bg-white/20 text-white dark:bg-black/20 dark:text-slate-950'
                    : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                {sessions.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => dispatch(setUserSettingsTab('clients'))}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs transition-all ${
              activeTab === 'clients'
                ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950 shadow-sm font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-medium'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>Email Clients</span>
          </button>
        </div>

        {/* TAB 1: Profile & Signature */}
        {activeTab === 'profile' && (
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 md:p-6 shadow-sm space-y-4 animate-view-fade">
            <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100 dark:border-slate-800">
              <User className="w-4 h-4 text-blue-500" />
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Profile & Email Signature
              </h2>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Email Address
                  </label>
                  <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-600 dark:text-slate-400 font-mono select-all">
                    <Mail className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                    <span className="truncate">{email}</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Display Name
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your Full Name"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/25 dark:focus:ring-white/30 focus:border-slate-900 dark:focus:border-white"
                  />
                </div>
              </div>

              <div className="space-y-1.5 pt-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Default Email Signature
                  </label>
                  <button
                    type="button"
                    onClick={() => setSignature(`--\n${displayName || 'Your Name'}\n${email}`)}
                    className="text-[11px] text-blue-500 hover:underline"
                  >
                    Generate Default
                  </button>
                </div>
                <textarea
                  rows={4}
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  placeholder="Enter your email signature here (e.g. name, title, contact information)..."
                  className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900/25 dark:focus:ring-white/30 focus:border-slate-900 dark:focus:border-white"
                />
                <p className="text-[11px] text-slate-400">
                  This signature will be pre-filled automatically when composing new messages or
                  replies.
                </p>
              </div>

              {signature && (
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 rounded-xl space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                    Signature Preview
                  </span>
                  <div className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-sans">
                    {signature}
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={isSavingSettings || isLoadingSettings}
                  className="btn-primary px-5 py-2 rounded-xl text-xs font-bold shadow-md hover:shadow-lg transition-all active:scale-95 flex items-center gap-2"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSavingSettings ? 'Saving...' : 'Save Profile & Signature'}</span>
                </button>
              </div>
            </form>
          </section>
        )}

        {/* TAB 2: Email Templates */}
        {activeTab === 'templates' && (
          <div className="space-y-6 animate-view-fade">
            {/* Header Action Bar */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <LayoutTemplate className="w-4 h-4 text-indigo-500" />
                  <span>Custom Email Templates</span>
                </h2>
                <p className="text-xs text-slate-400">
                  Create and manage reusable message templates with subject lines and fill-in
                  placeholders.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setEditingTemplate({
                    name: '',
                    subject: '',
                    body: '',
                  })
                }
                className="btn-primary px-4 py-2 rounded-xl text-xs font-bold shadow-sm hover:shadow-md transition-all active:scale-95 flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Create Template</span>
              </button>
            </div>

            {/* Template Editor Form (if creating or editing) */}
            {editingTemplate && (
              <div className="bg-white dark:bg-slate-900 border-2 border-indigo-500/40 rounded-2xl p-5 shadow-lg space-y-4 animate-in fade-in zoom-in-95 duration-150">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <PenTool className="w-4 h-4 text-indigo-500" />
                    <span className="font-bold text-xs text-slate-900 dark:text-slate-100">
                      {editingTemplate.id ? 'Edit Template' : 'Create New Template'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingTemplate(null)}
                    className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <form onSubmit={handleSaveTemplate} className="space-y-3.5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                        Template Name *
                      </label>
                      <input
                        type="text"
                        required
                        value={editingTemplate.name}
                        onChange={(e) =>
                          setEditingTemplate({ ...editingTemplate, name: e.target.value })
                        }
                        placeholder="e.g. Sales Intro, Meeting Request"
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/25 dark:focus:ring-white/30 focus:border-slate-900 dark:focus:border-white"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                        Default Subject
                      </label>
                      <input
                        type="text"
                        value={editingTemplate.subject}
                        onChange={(e) =>
                          setEditingTemplate({ ...editingTemplate, subject: e.target.value })
                        }
                        placeholder="e.g. Meeting Request: [Topic]"
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/25 dark:focus:ring-white/30 focus:border-slate-900 dark:focus:border-white"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                        Template Body Content
                      </label>
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                        <span>Insert placeholder:</span>
                        {['[Name]', '[Topic]', '[Date]', '[Amount]'].map((v) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => insertVariableIntoTemplate(v)}
                            className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-indigo-100 hover:text-indigo-600 dark:hover:bg-indigo-950 font-mono text-[10px] text-slate-600 dark:text-slate-300 transition-colors"
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                    </div>
                    <textarea
                      rows={6}
                      value={editingTemplate.body}
                      onChange={(e) =>
                        setEditingTemplate({ ...editingTemplate, body: e.target.value })
                      }
                      placeholder="Write your template message body here..."
                      className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-sans text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900/25 dark:focus:ring-white/30 focus:border-slate-900 dark:focus:border-white"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setEditingTemplate(null)}
                      className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSavingTemplate}
                      className="btn-primary px-5 py-2 rounded-xl text-xs font-bold shadow-md hover:shadow-lg transition-all flex items-center gap-1.5"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>{isSavingTemplate ? 'Saving...' : 'Save Template'}</span>
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Custom User Templates List */}
            <div className="space-y-3">
              {templates.length === 0 && !isLoadingTemplates && (
                <div className="bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-700 rounded-2xl p-8 text-center space-y-2">
                  <LayoutTemplate className="w-8 h-8 text-slate-400 mx-auto opacity-70" />
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    No custom templates created yet
                  </p>
                  <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
                    Save time on repetitive messages by creating your own custom templates, or
                    customize one of the starter templates below.
                  </p>
                </div>
              )}

              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 rounded-2xl p-4 shadow-sm transition-all space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs text-slate-900 dark:text-slate-100">
                        {tpl.name}
                      </span>
                      <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-bold border border-indigo-500/20">
                        Custom
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setEditingTemplate({
                            id: tpl.id,
                            name: tpl.name,
                            subject: tpl.subject,
                            body: tpl.body,
                          })
                        }
                        className="p-1.5 text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                        title="Edit Template"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(tpl.body, `tpl_${tpl.id}`)}
                        className="p-1.5 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                        title="Copy Body"
                      >
                        {copiedKey === `tpl_${tpl.id}` ? (
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteTemplate(tpl.id, tpl.name)}
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors"
                        title="Delete Template"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {tpl.subject && (
                    <div className="text-[11px] text-slate-600 dark:text-slate-400 font-medium">
                      Subject:{' '}
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {tpl.subject}
                      </span>
                    </div>
                  )}

                  <div className="text-xs text-slate-500 dark:text-slate-400 whitespace-pre-wrap bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/80 font-mono line-clamp-3">
                    {tpl.body}
                  </div>
                </div>
              ))}
            </div>

            {/* Built-in Starter Templates Section */}
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Starter / System Templates
                </h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {DEFAULT_SYSTEM_TEMPLATES.map((tpl) => (
                  <div
                    key={tpl.name}
                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 shadow-sm space-y-2 flex flex-col justify-between"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-slate-800 dark:text-slate-200">
                          {tpl.name}
                        </span>
                        <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 font-semibold">
                          Default
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        Subject: {tpl.subject}
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800/80">
                      <button
                        type="button"
                        onClick={() => copyToClipboard(tpl.body, `def_${tpl.name}`)}
                        className="text-[11px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 flex items-center gap-1"
                      >
                        {copiedKey === `def_${tpl.name}` ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-500" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy Body</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCloneDefaultTemplate(tpl)}
                        className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Customize & Save</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: Security & Password */}
        {activeTab === 'security' && (
          <div className="space-y-6 animate-view-fade">
            {/* Password Section */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 md:p-6 shadow-sm space-y-4">
              <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100 dark:border-slate-800">
                <Lock className="w-4 h-4 text-amber-500" />
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Account Password
                </h2>
              </div>

              {passError && (
                <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{passError}</span>
                </div>
              )}

              <form onSubmit={handleChangePassword} className="space-y-3.5 max-w-lg">
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Current Password
                  </label>
                  <div className="relative">
                    <input
                      type={showCurrentPass ? 'text' : 'password'}
                      required
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 pr-9 focus:outline-none focus:ring-2 focus:ring-slate-900/25 dark:focus:ring-white/30 focus:border-slate-900 dark:focus:border-white"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPass(!showCurrentPass)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                    >
                      {showCurrentPass ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                      New Password
                    </label>
                    <div className="relative">
                      <input
                        type={showNewPass ? 'text' : 'password'}
                        required
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="At least 6 characters"
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 pr-9 focus:outline-none focus:ring-2 focus:ring-slate-900/25 dark:focus:ring-white/30 focus:border-slate-900 dark:focus:border-white"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPass(!showNewPass)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                      >
                        {showNewPass ? (
                          <EyeOff className="w-3.5 h-3.5" />
                        ) : (
                          <Eye className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                      Confirm New Password
                    </label>
                    <input
                      type="password"
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repeat new password"
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/25 dark:focus:ring-white/30 focus:border-slate-900 dark:focus:border-white"
                    />
                  </div>
                </div>

                <div className="pt-1">
                  <button
                    type="submit"
                    disabled={isChangingPass || !currentPassword || !newPassword}
                    className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-sm hover:shadow-md transition-all active:scale-95 disabled:opacity-50"
                  >
                    {isChangingPass ? 'Updating Password...' : 'Update Password'}
                  </button>
                </div>
              </form>
            </section>

            {/* Two-Factor Authentication Section */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 md:p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      totpEnabled
                        ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400'
                        : 'bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400'
                    }`}
                  >
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Two-Factor Authentication (2FA)
                    </h2>
                    <p className="text-[11px] text-slate-400">
                      Adds an extra layer of security using standard TOTP authenticator apps.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold ${
                      totpEnabled
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                    }`}
                  >
                    {totpEnabled ? 'Active & Enabled' : 'Not Configured'}
                  </span>
                </div>
              </div>

              {!totpEnabled && !isSettingUp2FA && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    Two-factor authentication protects your mailbox against unauthorized access.
                    Every time you sign in, you will be prompted for a 6-digit code from Google
                    Authenticator, Authy, 1Password, or any RFC 6238 compatible app.
                  </p>
                  <button
                    type="button"
                    onClick={handleStart2FASetup}
                    className="btn-primary px-5 py-2 rounded-xl text-xs font-bold shadow-md hover:shadow-lg transition-all active:scale-95 flex items-center gap-2"
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    <span>Set Up Two-Factor Authentication</span>
                  </button>
                </div>
              )}

              {isSettingUp2FA && (
                <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="font-bold text-xs text-slate-900 dark:text-slate-100">
                      Step-by-Step 2FA Setup
                    </h3>
                    <button
                      type="button"
                      onClick={() => setIsSettingUp2FA(false)}
                      className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {setupError && (
                    <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <span>{setupError}</span>
                    </div>
                  )}

                  {setupData && (
                    <div className="space-y-4 text-xs">
                      <div className="space-y-1.5">
                        <span className="font-bold text-slate-700 dark:text-slate-300">
                          1. Secret Key (Manual Entry):
                        </span>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-mono text-xs tracking-wider text-slate-800 dark:text-slate-200 select-all overflow-x-auto">
                            {setupData.secret}
                          </code>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(setupData.secret, 'totp_secret')}
                            className="px-3 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-xl font-semibold text-xs flex items-center gap-1 transition-colors"
                          >
                            {copiedKey === 'totp_secret' ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-500" />
                                <span>Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <span className="font-bold text-slate-700 dark:text-slate-300">
                          2. Backup Recovery Codes (Save these now!):
                        </span>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-2.5 rounded-xl">
                          {setupData.recovery_codes.map((c) => (
                            <code
                              key={c}
                              className="font-mono text-[11px] text-center text-slate-700 dark:text-slate-300"
                            >
                              {c}
                            </code>
                          ))}
                        </div>
                      </div>

                      <form
                        onSubmit={handleConfirm2FASetup}
                        className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-700"
                      >
                        <label className="block font-bold text-slate-700 dark:text-slate-300">
                          3. Enter 6-digit verification code to activate:
                        </label>
                        <div className="flex items-center gap-2 max-w-xs">
                          <input
                            type="text"
                            maxLength={6}
                            value={verifyCode}
                            onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ''))}
                            placeholder="000000"
                            className="w-32 px-3 py-2 text-center text-sm font-mono tracking-widest bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/25 dark:focus:ring-white/30 focus:border-slate-900 dark:focus:border-white"
                          />
                          <button
                            type="submit"
                            disabled={isSubmitting2FA || verifyCode.length !== 6}
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all active:scale-95 disabled:opacity-50"
                          >
                            {isSubmitting2FA ? 'Verifying...' : 'Activate 2FA'}
                          </button>
                        </div>
                      </form>
                    </div>
                  )}
                </div>
              )}

              {totpEnabled && (
                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs text-slate-500">
                    Your account is safeguarded with Two-Factor Authentication.
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsDisabling2FA(true)}
                    className="px-3.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl transition-colors"
                  >
                    Disable 2FA
                  </button>
                </div>
              )}
            </section>
          </div>
        )}

        {/* TAB 4: Active Sessions */}
        {activeTab === 'sessions' && (
          <div className="space-y-6 animate-view-fade">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Laptop className="w-4 h-4 text-blue-500" />
                  <span>Your Active Sessions</span>
                </h2>
                <p className="text-xs text-slate-400">
                  Manage the devices and browsers currently logged into your MicroMail account.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={fetchSessions}
                  disabled={isLoadingSessions}
                  className="p-2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
                  title="Refresh Sessions"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoadingSessions ? 'animate-spin' : ''}`} />
                </button>
                {sessions.length > 1 && (
                  <button
                    type="button"
                    onClick={handleRevokeAllOtherSessions}
                    disabled={isRevokingOthers}
                    className="px-3.5 py-2 text-xs font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-xl shadow-sm transition-all active:scale-95 flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{isRevokingOthers ? 'Signing Out...' : 'Sign Out Other Sessions'}</span>
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-3">
              {sessions.map((sess) => (
                <div
                  key={sess.id}
                  className={`bg-white dark:bg-slate-900 border rounded-2xl p-4 shadow-sm transition-all space-y-3 ${
                    sess.current
                      ? 'border-blue-500/50 ring-1 ring-blue-500/30'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-9 h-9 rounded-full flex items-center justify-center ${
                          sess.current
                            ? 'bg-blue-100 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                        }`}
                      >
                        {sess.device.toLowerCase().includes('phone') ? (
                          <Smartphone className="w-4 h-4" />
                        ) : (
                          <Laptop className="w-4 h-4" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs text-slate-900 dark:text-slate-100">
                            {sess.device}
                          </span>
                          {sess.current && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold border border-emerald-500/20 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              <span>Current Session</span>
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                          <span className="flex items-center gap-1">
                            <Globe className="w-3 h-3 text-slate-400" />
                            {sess.ip}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div>
                      <button
                        type="button"
                        onClick={() => handleRevokeSession(sess)}
                        disabled={revokingSessionId === sess.id}
                        className="px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-xl transition-colors flex items-center gap-1"
                        title={sess.current ? 'Log out of this browser' : 'Revoke this session'}
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>{sess.current ? 'Sign Out' : 'Revoke'}</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                    <span>Created: {new Date(sess.created_at * 1000).toLocaleString()}</span>
                    <span>Last active: {new Date(sess.last_active * 1000).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 5: Email Clients & Setup Guides */}
        {activeTab === 'clients' && (
          <div className="space-y-6 animate-view-fade">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-blue-500" />
                  <span>Connect Email to Supported Clients</span>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Step-by-step instructions and server connection details for your desktop and mobile email applications.
                </p>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-auto">
                <button
                  type="button"
                  onClick={handleExpandAllClients}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl transition-colors"
                >
                  Expand All
                </button>
                <button
                  type="button"
                  onClick={handleCollapseAllClients}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl transition-colors"
                >
                  Collapse All
                </button>
              </div>
            </div>

            {/* Quick Reference Server Settings Card */}
            <div className="bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 text-white rounded-2xl p-5 md:p-6 shadow-md border border-slate-800 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                <div className="flex items-center gap-2">
                  <Server className="w-4 h-4 text-blue-400" />
                  <span className="text-xs font-bold text-white tracking-wide uppercase">
                    Universal Server Configuration
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-medium flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    IMAP (993) & SMTP (587) Active
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Incoming Mail (IMAP) */}
                <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/60 space-y-2.5">
                  <div className="flex items-center justify-between pb-1 border-b border-slate-700/50">
                    <span className="text-xs font-bold text-blue-400 flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5" /> Incoming Mail (IMAP)
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono font-bold">
                      SSL/TLS
                    </span>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Server Hostname:</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-semibold text-slate-100">{effectiveHostname}</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(effectiveHostname, 'imap-host', 'IMAP Hostname')}
                          className="p-1 hover:bg-slate-700 rounded transition-colors text-slate-400 hover:text-white"
                          title="Copy IMAP Hostname"
                        >
                          {copiedKey === 'imap-host' ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Port:</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-semibold text-slate-100">993</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard('993', 'imap-port', 'IMAP Port')}
                          className="p-1 hover:bg-slate-700 rounded transition-colors text-slate-400 hover:text-white"
                          title="Copy Port"
                        >
                          {copiedKey === 'imap-port' ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Username:</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-semibold text-slate-100 truncate max-w-[180px]">
                          {email || 'your-email@domain.com'}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(email, 'imap-user', 'Username')}
                          className="p-1 hover:bg-slate-700 rounded transition-colors text-slate-400 hover:text-white"
                          title="Copy Username"
                        >
                          {copiedKey === 'imap-user' ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Password:</span>
                      <span className="text-slate-300">Your account password</span>
                    </div>
                  </div>
                </div>

                {/* Outgoing Mail (SMTP) */}
                <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/60 space-y-2.5">
                  <div className="flex items-center justify-between pb-1 border-b border-slate-700/50">
                    <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5" /> Outgoing Mail (SMTP)
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono font-bold">
                      STARTTLS
                    </span>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Server Hostname:</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-semibold text-slate-100">{effectiveHostname}</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(effectiveHostname, 'smtp-host', 'SMTP Hostname')}
                          className="p-1 hover:bg-slate-700 rounded transition-colors text-slate-400 hover:text-white"
                          title="Copy SMTP Hostname"
                        >
                          {copiedKey === 'smtp-host' ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Port:</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-semibold text-slate-100">
                          587 <span className="text-slate-400 font-normal">(or 465 SSL)</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard('587', 'smtp-port', 'SMTP Port')}
                          className="p-1 hover:bg-slate-700 rounded transition-colors text-slate-400 hover:text-white"
                          title="Copy Port"
                        >
                          {copiedKey === 'smtp-port' ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Username:</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-semibold text-slate-100 truncate max-w-[180px]">
                          {email || 'your-email@domain.com'}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(email, 'smtp-user', 'Username')}
                          className="p-1 hover:bg-slate-700 rounded transition-colors text-slate-400 hover:text-white"
                          title="Copy Username"
                        >
                          {copiedKey === 'smtp-user' ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Authentication:</span>
                      <span className="text-slate-300">Required (same as incoming)</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Client Search & Category Filter Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                {(['all', 'apple', 'android', 'desktop'] as const).map((cat) => {
                  const label =
                    cat === 'all'
                      ? 'All Clients'
                      : cat === 'apple'
                        ? 'Apple (iOS / Mac)'
                        : cat === 'android'
                          ? 'Android'
                          : 'Desktop';
                  const count =
                    cat === 'all'
                      ? CLIENT_GUIDES.length
                      : CLIENT_GUIDES.filter((g) =>
                          cat === 'apple'
                            ? g.category === 'apple' || g.platformBadge.toLowerCase().includes('ios')
                            : cat === 'android'
                              ? g.category === 'android'
                              : g.category === 'desktop' || g.platformBadge.toLowerCase().includes('mac')
                        ).length;

                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setClientCategoryFilter(cat)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                        clientCategoryFilter === cat
                          ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm'
                          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800'
                      }`}
                    >
                      {label} ({count})
                    </button>
                  );
                })}
              </div>

              <div className="relative min-w-[240px]">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={clientSearchQuery}
                  onChange={(e) => setClientSearchQuery(e.target.value)}
                  placeholder="Filter clients (e.g. Outlook, iOS)..."
                  className="w-full pl-8 pr-7 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/25 dark:focus:ring-white/30 focus:border-slate-900 dark:focus:border-white"
                />
                {clientSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setClientSearchQuery('')}
                    className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Collapsible Client Guides List */}
            <div className="space-y-3">
              {CLIENT_GUIDES.filter((guide) => {
                const matchesCategory =
                  clientCategoryFilter === 'all' ||
                  guide.category === clientCategoryFilter ||
                  (clientCategoryFilter === 'apple' &&
                    (guide.category === 'apple' || guide.platformBadge.toLowerCase().includes('ios'))) ||
                  (clientCategoryFilter === 'desktop' &&
                    (guide.category === 'desktop' || guide.platformBadge.toLowerCase().includes('mac')));

                const matchesSearch =
                  !clientSearchQuery.trim() ||
                  guide.name.toLowerCase().includes(clientSearchQuery.toLowerCase()) ||
                  guide.platformBadge.toLowerCase().includes(clientSearchQuery.toLowerCase()) ||
                  guide.description.toLowerCase().includes(clientSearchQuery.toLowerCase());

                return matchesCategory && matchesSearch;
              }).map((guide) => {
                const isExpanded = Boolean(expandedClients[guide.id]);

                return (
                  <div
                    key={guide.id}
                    className={`bg-white dark:bg-slate-900 border rounded-2xl shadow-sm transition-all overflow-hidden ${
                      isExpanded
                        ? 'border-slate-300 dark:border-slate-700 ring-1 ring-slate-200 dark:ring-slate-800'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    {/* Collapsible Header */}
                    <button
                      type="button"
                      onClick={() => toggleClientExpanded(guide.id)}
                      className="w-full p-4 flex items-center justify-between text-left cursor-pointer hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {guide.iconType === 'apple' ? (
                          <div className="w-8 h-8 rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-950 flex items-center justify-center font-bold text-xs shadow-sm flex-shrink-0">
                            
                          </div>
                        ) : guide.iconType === 'android' ? (
                          <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-sm flex-shrink-0">
                            <Smartphone className="w-4 h-4" />
                          </div>
                        ) : guide.iconType === 'windows' ? (
                          <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-sm flex-shrink-0">
                            <Monitor className="w-4 h-4" />
                          </div>
                        ) : (
                          <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-sm flex-shrink-0">
                            <Mail className="w-4 h-4" />
                          </div>
                        )}

                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-xs sm:text-sm text-slate-900 dark:text-slate-100">
                              {guide.name}
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold border border-slate-200 dark:border-slate-700">
                              {guide.platformBadge}
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 font-mono font-medium border border-blue-200/50 dark:border-blue-900/50">
                              IMAP & SMTP
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">
                            {guide.description}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                        <span className="hidden sm:inline-block text-[11px] text-slate-400">
                          {guide.steps.length} steps
                        </span>
                        <div
                          className={`w-6 h-6 rounded-lg flex items-center justify-center text-slate-400 transition-transform duration-200 ${
                            isExpanded ? 'rotate-180 text-slate-900 dark:text-slate-100' : ''
                          }`}
                        >
                          <ChevronDown className="w-4 h-4" />
                        </div>
                      </div>
                    </button>

                    {/* Collapsible Content */}
                    {isExpanded && (
                      <div className="px-4 pb-5 pt-2 border-t border-slate-100 dark:border-slate-800 space-y-4 animate-view-fade">
                        {/* Quick Parameters Strip */}
                        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-3 border border-slate-200/80 dark:border-slate-700/60 flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-500 dark:text-slate-400 font-medium">Server:</span>
                            <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                              {effectiveHostname}
                            </span>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(effectiveHostname, `chip-host-${guide.id}`, 'Hostname')}
                              className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                              title="Copy Hostname"
                            >
                              {copiedKey === `chip-host-${guide.id}` ? (
                                <Check className="w-3.5 h-3.5 text-emerald-500" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-slate-500 dark:text-slate-400 font-medium">Username:</span>
                            <span className="font-mono font-bold text-slate-800 dark:text-slate-200 truncate max-w-[160px]">
                              {email || 'your-email@domain.com'}
                            </span>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(email, `chip-user-${guide.id}`, 'Username')}
                              className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                              title="Copy Email"
                            >
                              {copiedKey === `chip-user-${guide.id}` ? (
                                <Check className="w-3.5 h-3.5 text-emerald-500" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>

                          <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                            <span>
                              IMAP: <strong className="text-slate-700 dark:text-slate-200">993 (SSL)</strong>
                            </span>
                            <span>
                              SMTP: <strong className="text-slate-700 dark:text-slate-200">587 (TLS)</strong>
                            </span>
                          </div>
                        </div>

                        {/* Step-by-Step Instructions */}
                        <div className="space-y-2.5 pt-1">
                          <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                            <span>Setup Instructions:</span>
                          </h4>
                          <div className="space-y-2">
                            {guide.steps.map((step, idx) => (
                              <div
                                key={idx}
                                className="flex items-start gap-3 text-xs text-slate-600 dark:text-slate-300"
                              >
                                <span className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5 border border-slate-200 dark:border-slate-700">
                                  {idx + 1}
                                </span>
                                <span className="leading-relaxed">{step}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Pro Tips / Troubleshooting */}
                        {guide.tips && guide.tips.length > 0 && (
                          <div className="bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/70 dark:border-blue-900/50 rounded-xl p-3.5 space-y-1.5">
                            <div className="flex items-center gap-1.5 text-xs font-bold text-blue-700 dark:text-blue-300">
                              <HelpCircle className="w-3.5 h-3.5 flex-shrink-0" />
                              <span>Helpful Tips & Troubleshooting</span>
                            </div>
                            <ul className="list-disc list-inside space-y-1 text-[11px] text-blue-600 dark:text-blue-400">
                              {guide.tips.map((tip, tIdx) => (
                                <li key={tIdx} className="leading-relaxed">
                                  {tip}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Modal: Disable 2FA Password Confirmation */}
        {isDisabling2FA && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
              <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <h3 className="font-bold text-sm">Disable Two-Factor Authentication?</h3>
              </div>
              <p className="text-xs text-slate-500">
                Enter your current account password to confirm turning off 2FA protection.
              </p>

              {disableError && (
                <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-600 dark:text-red-400">
                  {disableError}
                </div>
              )}

              <form onSubmit={handleConfirm2FADisable} className="space-y-4">
                <input
                  type="password"
                  required
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                  placeholder="Your Account Password"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/25 dark:focus:ring-white/30 focus:border-slate-900 dark:focus:border-white"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsDisabling2FA(false);
                      setDisablePassword('');
                      setDisableError(null);
                    }}
                    className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting2FA || !disablePassword}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all"
                  >
                    {isSubmitting2FA ? 'Disabling...' : 'Confirm Disable'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
