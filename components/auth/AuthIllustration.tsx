import { motion, useReducedMotion } from "motion/react";
import { RiCalendarCheckLine, RiChat3Line, RiFlashlightLine, RiLinkedinFill, RiSparkling2Line } from "react-icons/ri";

// Decorative product scene for the auth screens: a buying signal becomes a
// message, then a booked meeting. Purely illustrative, hidden from screen readers.

type FloatProps = { children: React.ReactNode; className: string; delay: number; drift?: number };

function Float({ children, className, delay, drift = 8 }: FloatProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={`absolute ${className}`}
      initial={reduce ? false : { opacity: 0, y: 18 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: [0, -drift, 0] }}
      transition={reduce ? undefined : {
        opacity: { duration: 0.5, delay },
        y: { duration: 6, delay, repeat: Infinity, ease: "easeInOut" },
      }}
    >
      {children}
    </motion.div>
  );
}

const card = "rounded-2xl border border-white/70 bg-white/90 shadow-[0_18px_50px_-20px_rgba(120,60,30,.35)] backdrop-blur";

export default function AuthIllustration() {
  return (
    <div aria-hidden className="relative mx-auto h-[490px] w-full max-w-[460px] select-none">
      {/* Path tying the three moments together */}
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 460 490" fill="none">
        <path d="M40 236 C 40 300, 80 330, 128 330 M200 398 C 200 432, 226 448, 258 448" stroke="#cc785c" strokeOpacity=".45" strokeWidth="1.6" strokeDasharray="5 7" strokeLinecap="round" />
        <circle cx="40" cy="236" r="4" fill="#cc785c" />
        <circle cx="128" cy="330" r="4" fill="#cc785c" fillOpacity=".7" />
        <circle cx="258" cy="448" r="4" fill="#5db872" />
      </svg>

      {/* 1. Signal */}
      <Float className="left-4 top-14 w-[300px]" delay={0.05}>
        <div className={`${card} p-4`}>
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#f3c7a8] to-[#cc785c] text-[14px] font-semibold text-white">PS</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-[#141413]">Priya Shah</p>
              <p className="truncate text-[12px] text-[#6c6a64]">VP Sales · Northwind</p>
            </div>
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#0a66c2] text-white"><RiLinkedinFill size={15} /></span>
          </div>
          <div className="mt-3.5 flex items-center gap-2 rounded-xl bg-[#fbefe7] px-3 py-2 text-[12px] font-medium text-[#a9583e]">
            <RiFlashlightLine size={14} /> Posted about scaling outbound
          </div>
          <div className="mt-3.5">
            <div className="mb-1.5 flex items-center justify-between text-[11px] text-[#6c6a64]">
              <span>ICP fit</span><span className="font-semibold text-[#141413]">92</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#efe9de]">
              <div className="h-full w-[92%] rounded-full bg-gradient-to-r from-[#e8a55a] to-[#cc785c]" />
            </div>
          </div>
        </div>
      </Float>

      {/* 2. Message */}
      <Float className="left-[130px] top-[250px] w-[300px]" delay={0.25} drift={6}>
        <div className={`${card} p-4`}>
          <div className="mb-2.5 flex items-center gap-2 text-[11px] font-medium text-[#6c6a64]">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#141413] text-white"><RiSparkling2Line size={11} /></span>
            Drafted for you
          </div>
          <p className="rounded-xl rounded-tl-sm bg-[#f5f0e8] px-3 py-2.5 text-[12.5px] leading-5 text-[#3d3d3a]">
            Hi Priya — loved your take on outbound. We help teams like Northwind book more first calls…
          </p>
          <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-[#5db872]">
            <RiChat3Line size={13} /> Replied · 2h ago
          </div>
        </div>
      </Float>

      {/* 3. Outcome */}
      <Float className="right-2 top-[418px]" delay={0.45} drift={5}>
        <div className={`${card} flex items-center gap-3 py-3 pl-3 pr-5`}>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#e7f5ea] text-[#3f9a55]"><RiCalendarCheckLine size={18} /></span>
          <div>
            <p className="text-[13px] font-semibold text-[#141413]">Meeting booked</p>
            <p className="text-[11px] text-[#6c6a64]">Thu · 10:30 AM</p>
          </div>
        </div>
      </Float>

      {/* Ambient accent */}
      <Float className="right-4 top-0" delay={0.6} drift={10}>
        <div className={`${card} flex items-center gap-2 px-3 py-2 text-[11px] font-medium text-[#3d3d3a]`}>
          <span className="h-2 w-2 rounded-full bg-[#5db872]" /> 12 new signals today
        </div>
      </Float>
    </div>
  );
}
