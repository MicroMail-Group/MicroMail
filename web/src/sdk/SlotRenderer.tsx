import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { addonHost, type SlotRegistration } from './AddonHost';

interface SlotRendererProps {
  slot: string;
  className?: string;
}

export const SlotRenderer: React.FC<SlotRendererProps> = ({ slot, className = '' }) => {
  const [registrations, setRegistrations] = useState<SlotRegistration[]>([]);

  useEffect(() => {
    // Initial fetch
    setRegistrations(addonHost.getSlots(slot));

    // Listen for slot registrations / unregistrations
    const unsubscribe = addonHost.onSlotChange(() => {
      setRegistrations(addonHost.getSlots(slot));
    });

    return unsubscribe;
  }, [slot]);

  if (registrations.length === 0) {
    return null;
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {registrations.map((reg) => (
        <SlotItem key={reg.addonId} registration={reg} />
      ))}
    </div>
  );
};

const SlotItem: React.FC<{ registration: SlotRegistration }> = ({ registration }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current && typeof registration.definition.render === 'function') {
      try {
        registration.definition.render(containerRef.current);
      } catch (err) {
        console.error(`[SlotItem] Error rendering slot from addon ${registration.addonId}:`, err);
      }
    }
  }, [registration]);

  if (typeof registration.definition.render === 'function') {
    return <div ref={containerRef} className="inline-flex items-center" />;
  }

  if (registration.definition.onClick && registration.definition.label) {
    return (
      <button
        type="button"
        onClick={registration.definition.onClick}
        className="px-2.5 py-1 text-xs font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded transition-colors"
      >
        {registration.definition.label}
      </button>
    );
  }

  return null;
};
