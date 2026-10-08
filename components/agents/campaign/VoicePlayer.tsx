import { useRef, useState } from "react";
import { RiArrowGoBackLine, RiPauseFill, RiPlayFill } from "react-icons/ri";

const fmt = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** Fixed pseudo-waveform: the same bar heights every render, seeded by position. */
const BARS = Array.from({ length: 56 }, (_, i) => 3 + Math.round(Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6)) * 12));

/** Compact audio player (give it a `key` per source so it resets): play/pause, restart, a static waveform that fills as it plays, and the time. */
export default function VoicePlayer({ src, durationMs }: { src: string; durationMs: number | null }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [total, setTotal] = useState(durationMs ?? 0);

  function toggle() {
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    else { a.pause(); setPlaying(false); }
  }
  function restart() {
    const a = audio.current;
    if (!a) return;
    a.currentTime = 0;
    setPos(0);
  }

  const progress = total > 0 ? Math.min(1, pos / total) : 0;
  return (
    <div className="flex items-center gap-3 rounded-full border border-[var(--border-subtle)] bg-base-100 py-1.5 pl-1.5 pr-4">
      <audio ref={audio} src={src} preload="metadata"
        onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d) && d > 0) setTotal(d * 1000); }}
        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime * 1000)}
        onEnded={() => { setPlaying(false); setPos(total); }} />
      <button type="button" onClick={toggle} aria-label={playing ? "Pause" : "Play"} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-content hover:bg-[var(--primary-hover)]">
        {playing ? <RiPauseFill size={18} /> : <RiPlayFill size={18} />}
      </button>
      <button type="button" onClick={restart} aria-label="Restart" className="shrink-0 text-base-content/50 hover:text-base-content"><RiArrowGoBackLine size={16} /></button>
      <div className="flex h-6 min-w-0 flex-1 items-center gap-[3px] overflow-hidden" aria-hidden="true">
        {BARS.map((h, i) => (
          <span key={i} style={{ height: h }} className={`w-[2px] shrink-0 rounded-full ${i / BARS.length <= progress ? "bg-primary" : "bg-base-content/20"}`} />
        ))}
      </div>
      <span className="shrink-0 font-mono text-xs tabular-nums text-base-content/55">{fmt(pos)} / {fmt(total)}</span>
    </div>
  );
}
