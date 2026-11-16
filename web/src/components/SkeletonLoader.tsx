import type React from 'react';

export const ThreadListSkeleton: React.FC = () => {
  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-800/60 animate-in fade-in duration-200">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full animate-shimmer" />
              <div className="w-24 h-3.5 rounded-md animate-shimmer" />
            </div>
            <div className="w-12 h-3 rounded-md animate-shimmer" />
          </div>

          <div className="w-44 h-4 rounded-md animate-shimmer" />
          <div className="w-full h-3 rounded-md animate-shimmer" />
        </div>
      ))}
    </div>
  );
};

export const MessageReaderSkeleton: React.FC = () => {
  return (
    <div className="flex-1 flex flex-col h-full bg-white dark:bg-slate-900 p-6 space-y-6 animate-in fade-in duration-200 overflow-hidden">
      {/* Header Bar */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
        <div className="space-y-2">
          <div className="w-64 h-6 rounded-lg animate-shimmer" />
          <div className="w-32 h-3.5 rounded-md animate-shimmer" />
        </div>
        <div className="flex items-center gap-2">
          <div className="w-16 h-7 rounded-lg animate-shimmer" />
          <div className="w-7 h-7 rounded-lg animate-shimmer" />
        </div>
      </div>

      {/* Message Card */}
      <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-4 shadow-sm">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full animate-shimmer flex-shrink-0" />
            <div className="space-y-1.5">
              <div className="w-32 h-4 rounded-md animate-shimmer" />
              <div className="w-48 h-3 rounded-md animate-shimmer" />
            </div>
          </div>
          <div className="w-28 h-4 rounded-md animate-shimmer" />
        </div>

        {/* Content Lines */}
        <div className="space-y-2.5 pt-2">
          <div className="w-full h-3.5 rounded-md animate-shimmer" />
          <div className="w-11/12 h-3.5 rounded-md animate-shimmer" />
          <div className="w-4/5 h-3.5 rounded-md animate-shimmer" />
          <div className="w-9/12 h-3.5 rounded-md animate-shimmer" />
          <div className="w-2/3 h-3.5 rounded-md animate-shimmer" />
        </div>
      </div>
    </div>
  );
};
