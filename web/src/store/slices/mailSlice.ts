import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface ThreadItem {
  thread_id: string;
  subject: string;
  sender: string;
  snippet: string;
  message_count: number;
  has_unread: boolean;
  latest_at: number;
  tags?: string[];
}

export interface MailState {
  currentFolder: string;
  folderCounts: Record<string, number>;
  threads: ThreadItem[];
  selectedThreadId: string | null;
  threadMessages: any[];
  isLoadingThreads: boolean;
  isLoadingMessages: boolean;
}

const initialState: MailState = {
  currentFolder: 'INBOX',
  folderCounts: {},
  threads: [],
  selectedThreadId: null,
  threadMessages: [],
  isLoadingThreads: false,
  isLoadingMessages: false,
};

export const mailSlice = createSlice({
  name: 'mail',
  initialState,
  reducers: {
    setCurrentFolder: (state, action: PayloadAction<string>) => {
      state.currentFolder = action.payload;
      state.selectedThreadId = null;
    },
    setFolderCounts: (state, action: PayloadAction<Record<string, number>>) => {
      state.folderCounts = action.payload;
    },
    setThreads: (state, action: PayloadAction<ThreadItem[]>) => {
      state.threads = action.payload;
    },
    setSelectedThreadId: (state, action: PayloadAction<string | null>) => {
      state.selectedThreadId = action.payload;
    },
    setThreadMessages: (state, action: PayloadAction<any[]>) => {
      state.threadMessages = action.payload;
    },
    setIsLoadingThreads: (state, action: PayloadAction<boolean>) => {
      state.isLoadingThreads = action.payload;
    },
    setIsLoadingMessages: (state, action: PayloadAction<boolean>) => {
      state.isLoadingMessages = action.payload;
    },
    markThreadRead: (state, action: PayloadAction<{ threadId: string; isRead: boolean }>) => {
      state.threads = state.threads.map((t) =>
        t.thread_id === action.payload.threadId ? { ...t, has_unread: !action.payload.isRead } : t
      );
      state.threadMessages = state.threadMessages.map((m) =>
        m.thread_id === action.payload.threadId ? { ...m, is_read: action.payload.isRead } : m
      );
    },
    markMessageRead: (
      state,
      action: PayloadAction<{ messageId: string; threadId?: string; isRead: boolean }>
    ) => {
      state.threadMessages = state.threadMessages.map((m) =>
        m.id === action.payload.messageId ? { ...m, is_read: action.payload.isRead } : m
      );
      const targetThreadId = action.payload.threadId || state.selectedThreadId;
      if (targetThreadId) {
        const hasUnread = state.threadMessages.some((m) => !m.is_read);
        state.threads = state.threads.map((t) =>
          t.thread_id === targetThreadId ? { ...t, has_unread: hasUnread } : t
        );
      }
    },
    removeThreadById: (state, action: PayloadAction<string>) => {
      state.threads = state.threads.filter((t) => t.thread_id !== action.payload);
      if (state.selectedThreadId === action.payload) {
        state.selectedThreadId = null;
        state.threadMessages = [];
      }
    },
  },
});

export const {
  setCurrentFolder,
  setFolderCounts,
  setThreads,
  setSelectedThreadId,
  setThreadMessages,
  setIsLoadingThreads,
  setIsLoadingMessages,
  markThreadRead,
  markMessageRead,
  removeThreadById,
} = mailSlice.actions;

export default mailSlice.reducer;
