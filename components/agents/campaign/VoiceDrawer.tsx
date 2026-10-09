import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RiCloseLine, RiInformationLine, RiMicLine, RiRefreshLine, RiStopCircleLine } from "react-icons/ri";
import { primaryBtn } from "@/components/agents/ui";
import { RadioCard, SideDrawer, voiceUrl, WaitSelect, type CampaignStep } from "@/components/agents/campaign/kit";
import type { StepSave } from "@/components/agents/campaign/StepDrawer";
import VoicePlayer from "@/components/agents/campaign/VoicePlayer";

const MAX_MS = 60_000;
const LEVEL_BARS = 12;

function pickMime(): string {
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  if (typeof MediaRecorder === "undefined") return "";
  return options.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

const clock = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

type Phase = "idle" | "recording" | "recorded";

/** Edit a Voice Message step: record one message in the browser (max 60 s) that every contact receives. */
export default function VoiceDrawer({ step, workflowId, delayBefore, busy, onClose, onSave }: {
  step: CampaignStep; workflowId: string; delayBefore: number | null; busy: boolean; onClose: () => void; onSave: (s: StepSave) => void;
}) {
  const hasServerAudio = !!step.voice_duration_ms;
  const [phase, setPhase] = useState<Phase>(hasServerAudio ? "recorded" : "idle");
  const [blob, setBlob] = useState<{ data: Blob; url: string; ms: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(LEVEL_BARS).fill(0));
  const [delay, setDelay] = useState(delayBefore ?? 0);
  const [saving, setSaving] = useState(false);
  const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream; ctx: AudioContext; raf: number; timer: number; started: number; chunks: Blob[]; keep: boolean } | null>(null);

  const teardown = useCallback(() => {
    const r = rec.current;
    if (!r) return;
    cancelAnimationFrame(r.raf);
    clearInterval(r.timer);
    r.stream.getTracks().forEach((t) => t.stop());
    void r.ctx.close().catch(() => {});
    rec.current = null;
  }, []);

  useEffect(() => () => {
    if (rec.current) { rec.current.keep = false; if (rec.current.recorder.state !== "inactive") rec.current.recorder.stop(); }
    teardown();
  }, [teardown]);
  useEffect(() => () => { if (blob) URL.revokeObjectURL(blob.url); }, [blob]);

  function stop(keep: boolean) {
    const r = rec.current;
    if (!r) return;
    r.keep = keep;
    if (r.recorder.state !== "inactive") r.recorder.stop();
  }

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("This browser can't record audio. Try a recent Chrome, Edge or Firefox.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const denied = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
      toast.error(denied ? "Microphone access was blocked. Allow the microphone for this site in your browser, then try again." : "No microphone was found.");
      return;
    }
    const mime = pickMime();
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const started = Date.now();
    const state = { recorder, stream, ctx, raf: 0, timer: 0, started, chunks: [] as Blob[], keep: true };
    rec.current = state;

    const draw = () => {
      analyser.getByteFrequencyData(data);
      const step = Math.max(1, Math.floor(data.length / LEVEL_BARS));
      setLevels(Array.from({ length: LEVEL_BARS }, (_, i) => data[i * step] / 255));
      state.raf = requestAnimationFrame(draw);
    };
    state.raf = requestAnimationFrame(draw);
    state.timer = window.setInterval(() => {
      const ms = Date.now() - started;
      setElapsed(ms);
      if (ms >= MAX_MS) stop(true);
    }, 200);

    recorder.ondataavailable = (e) => { if (e.data.size > 0) state.chunks.push(e.data); };
    recorder.onstop = () => {
      const ms = Math.min(MAX_MS, Date.now() - started);
      const keep = state.keep;
      teardown();
      if (!keep || state.chunks.length === 0) { setPhase(hasServerAudio ? "recorded" : "idle"); return; }
      const data = new Blob(state.chunks, { type: recorder.mimeType || mime || "audio/webm" });
      setBlob({ data, url: URL.createObjectURL(data), ms });
      setPhase("recorded");
    };
    recorder.start(250);
    setBlob(null);
    setElapsed(0);
    setPhase("recording");
  }

  async function save() {
    setSaving(true);
    try {
      if (blob) {
        const r = await fetch(voiceUrl(workflowId, step.id), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audio_base64: await toBase64(blob.data), mime: blob.data.type || "audio/webm", duration_ms: blob.ms }),
        });
        if (!r.ok) { toast.error((await r.json().catch(() => ({}))).error ?? "Could not save the recording"); return; }
      }
      const out: StepSave = { fields: {} };
      if (delayBefore !== null && delay !== delayBefore) out.delaySeconds = delay;
      onSave(out);
    } catch {
      toast.error("Could not save the recording");
    } finally {
      setSaving(false);
    }
  }

  const noAudio = phase !== "recorded" || (!blob && !hasServerAudio);
  return (
    <SideDrawer title="Edit Send Voice Message step" onClose={onClose} footer={<>
      <button type="button" className="px-3 text-[15px] font-medium text-base-content/70 hover:text-base-content" onClick={onClose}>Cancel</button>
      <button type="button" className={primaryBtn} disabled={busy || saving || phase === "recording" || noAudio} onClick={save}>{saving ? "Saving…" : "Save Step"}</button>
    </>}>
      <div className="space-y-4">
        <RadioCard on onSelect={() => {}} title="Record a voice message" subtitle="Record it once yourself. Every contact hears the same message.">
          {phase === "idle" && (
            <div className="flex flex-col items-center gap-4 py-8">
              <span className="flex h-24 w-24 items-center justify-center rounded-full bg-success/15 text-[#3a8c4f]"><RiMicLine size={40} /></span>
              <div className="font-medium text-[22px] text-base-content">Ready to Record</div>
              <button type="button" onClick={start} className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-neutral px-5 text-[15px] font-medium text-neutral-content hover:opacity-90"><RiMicLine size={16} /> Start Recording</button>
              <p className="text-[13.5px] text-base-content/45">Up to 1 minute.</p>
            </div>
          )}
          {phase === "recording" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <span className="flex h-24 w-24 items-center justify-center rounded-full bg-error/12 text-error"><RiMicLine size={40} /></span>
              <div className="font-mono text-[32px] font-semibold tabular-nums text-base-content">{clock(elapsed)}</div>
              <div className="text-[15px] text-base-content/55">Recording in progress…</div>
              <div className="flex h-12 items-end gap-1.5" aria-hidden="true">
                {levels.map((l, i) => <span key={i} style={{ height: 4 + l * 40 }} className={`w-1.5 rounded-full ${l > 0.08 ? "bg-success" : "bg-success/25"}`} />)}
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => stop(false)} className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-base-200 px-4 text-[15px] font-medium text-base-content hover:bg-base-300"><RiCloseLine size={16} /> Cancel</button>
                <button type="button" onClick={() => stop(true)} className={primaryBtn}><RiStopCircleLine size={16} /> Stop &amp; Save</button>
              </div>
            </div>
          )}
          {phase === "recorded" && (
            <div className="space-y-3 pt-1">
              <VoicePlayer key={blob?.url ?? "server"} src={blob?.url ?? voiceUrl(workflowId, step.id)} durationMs={blob?.ms ?? step.voice_duration_ms ?? null} />
              <div className="text-center">
                <button type="button" onClick={start} className="inline-flex items-center gap-1.5 text-[15px] font-medium text-base-content/65 hover:text-base-content"><RiRefreshLine size={15} /> Re-record</button>
              </div>
            </div>
          )}
        </RadioCard>

        <div className="relative rounded-[12px] border border-[var(--border-subtle)] bg-base-100 opacity-70" aria-disabled="true">
          <span className="absolute -top-2.5 left-4 rounded-full bg-base-content/40 px-2.5 py-0.5 text-[12.5px] font-semibold uppercase tracking-[1px] text-base-100">Soon</span>
          <div className="flex items-start gap-3 px-5 py-4">
            <span className="mt-0.5 h-[18px] w-[18px] shrink-0 rounded-full border-2 border-base-content/25" />
            <span><span className="block font-medium text-base-content/70">AI voice message <span className="text-[#d4a017]">☆</span></span>
              <span className="mt-0.5 block text-[15px] text-base-content/50">A different message for each contact, written by AI and spoken in your own voice.</span></span>
          </div>
        </div>

        {delayBefore !== null && <div className="pt-2"><WaitSelect value={delay} onChange={setDelay} /></div>}
        <p className="flex items-center gap-1.5 text-[13.5px] text-base-content/50"><RiInformationLine size={14} /> This voice message will be sent to each contact when they reach this step</p>
      </div>
    </SideDrawer>
  );
}
