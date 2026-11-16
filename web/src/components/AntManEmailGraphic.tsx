import type React from 'react';

export const AntManEmailGraphic: React.FC<{ className?: string }> = ({ className = '' }) => {
  return (
    <div
      className={`relative w-72 h-72 sm:w-80 sm:h-80 flex items-center justify-center select-none ${className}`}
      aria-label="MicroMail Quantum Graphic"
    >
      {/* 1. Deep Ambient White Glow */}
      <div className="absolute w-56 h-56 rounded-full bg-white/[0.06] blur-3xl pointer-events-none" />

      {/* 2. Shedding Ring: Primary White (Shrink phase) */}
      <div className="absolute w-36 h-28 sm:w-44 sm:h-32 rounded-3xl border-2 border-white animate-shed-white-shrink pointer-events-none" />

      {/* 3. Shedding Ring: Secondary Staggered White (Shrink phase) */}
      <div className="absolute w-36 h-28 sm:w-44 sm:h-32 rounded-3xl border border-white/70 animate-shed-white-shrink-2 pointer-events-none" />

      {/* 4. Shedding Ring: Primary White (Grow phase) */}
      <div className="absolute w-36 h-28 sm:w-44 sm:h-32 rounded-3xl border-2 border-white animate-shed-white-grow pointer-events-none" />

      {/* 5. Shedding Ring: Secondary Staggered White (Grow phase) */}
      <div className="absolute w-36 h-28 sm:w-44 sm:h-32 rounded-3xl border border-white/70 animate-shed-white-grow-2 pointer-events-none" />

      {/* 6. Floating White Quantum Spark Particles */}
      <div className="absolute -top-2 left-12 w-2 h-2 rounded-full bg-white blur-[0.5px] shadow-[0_0_8px_#ffffff] animate-pulse" />
      <div className="absolute -bottom-3 right-12 w-1.5 h-1.5 rounded-full bg-white blur-[0.5px] shadow-[0_0_8px_#ffffff] animate-pulse" />
      <div className="absolute top-1/2 -left-3 w-1.5 h-1.5 rounded-full bg-white blur-[0.5px] shadow-[0_0_6px_#ffffff] animate-pulse" />
      <div className="absolute top-8 -right-2 w-2 h-2 rounded-full bg-white blur-[0.5px] shadow-[0_0_8px_#ffffff] animate-pulse" />

      {/* 7. Central Core Email Graphic (Ant-Man Shrink & Grow) */}
      <div className="animate-ant-man-core relative z-10 flex items-center justify-center cursor-default">
        {/* Crisp White Envelope Container */}
        <div className="relative w-36 h-28 sm:w-44 sm:h-32 rounded-3xl p-[2px] bg-white/90 shadow-[0_0_30px_rgba(255,255,255,0.4)]">
          {/* Inner High-Tech Email Envelope */}
          <div className="w-full h-full rounded-[22px] bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 flex flex-col items-center justify-center relative overflow-hidden border border-white/20 shadow-inner">
            {/* Specular Light Reflection Sweep on Top Rim */}
            <div className="absolute top-0 inset-x-0 h-[1.5px] bg-gradient-to-r from-transparent via-white/80 to-transparent" />

            {/* Glowing Envelope SVG Geometry */}
            <svg
              viewBox="0 0 160 120"
              className="w-full h-full p-2.5 drop-shadow-[0_4px_12px_rgba(0,0,0,0.8)]"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                {/* White Neon Glow Filter */}
                <filter id="whiteNeon" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="2.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Envelope Body Outline */}
              <rect
                x="12"
                y="18"
                width="136"
                height="84"
                rx="14"
                stroke="rgba(255, 255, 255, 0.45)"
                strokeWidth="2"
                fill="rgba(15, 23, 42, 0.9)"
              />

              {/* Bottom Triangular Fold Lines */}
              <path
                d="M14 98L62 58M146 98L98 58"
                stroke="rgba(255, 255, 255, 0.3)"
                strokeWidth="1.5"
                strokeLinecap="round"
              />

              {/* Top Flap Path (V-shape) in Crisp White */}
              <path
                d="M14 24L80 72L146 24"
                stroke="#ffffff"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                filter="url(#whiteNeon)"
              />

              {/* Central Glowing Seal in Crisp White */}
              <circle
                cx="80"
                cy="70"
                r="11"
                fill="#09090b"
                stroke="#ffffff"
                strokeWidth="2"
                filter="url(#whiteNeon)"
              />

              {/* Micro Glowing Dot in Center */}
              <circle cx="80" cy="70" r="3.5" fill="#ffffff" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
};
