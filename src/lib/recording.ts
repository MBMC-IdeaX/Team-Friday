export type CaptureState = {
  phase: "requesting" | "recording" | "stopped" | "failed";
  seconds: number;
  savedSegments: number;
  message?: string;
};
export type Capture = { stop(): Promise<void> };
const SEGMENT_MS = 30_000;
const MAX_MS = 15 * 60_000;
let active: Capture | null = null;
let microphoneReady = Promise.resolve();

export function supportedAudioMime() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  return ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"]
    .find(type => MediaRecorder.isTypeSupported(type));
}

// Each segment is one completed recorder, including its container headers/final data.
// Arbitrary timeslice fragments are not independently playable recordings.
export function startEvidenceRecording(persist: (blob: Blob, durationMs: number) => Promise<unknown>,
  notify: (state: CaptureState) => void): Capture {
  const previous = Promise.all([active?.stop() ?? Promise.resolve(), microphoneReady]);
  let stopped = false, failed = false, savedSegments = 0, completedMs = 0, startedAt = 0;
  let stream: MediaStream | undefined, recorder: MediaRecorder | null = null;
  let segmentTimer: ReturnType<typeof setTimeout> | undefined;
  let tick: ReturnType<typeof setInterval> | undefined;
  let finished = Promise.resolve();
  let finishSegment = () => {};
  const seconds = () => Math.floor((completedMs + (recorder ? Date.now() - startedAt : 0)) / 1000);
  const report = (phase: CaptureState["phase"], message?: string) => notify({ phase, seconds: seconds(), savedSegments, message });
  const release = () => {
    clearTimeout(segmentTimer); clearInterval(tick);
    stream?.getTracks().forEach(track => track.stop());
    stream = undefined;
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    if (active === handle) active = null;
  };
  const fail = (message: string) => {
    failed = true; stopped = true;
    report("failed", message);
  };
  const stopSegment = () => {
    clearTimeout(segmentTimer);
    try { if (recorder && recorder.state !== "inactive") recorder.stop(); }
    catch {
      recorder = null; finishSegment();
      fail("Audio could not be finalized. SOS is still active. Retry microphone recording."); release();
    }
  };
  const onVisibility = () => {
    // Finalize early before suspension; resume only after this file has committed.
    if (document.visibilityState === "hidden") stopSegment();
    else if (!stopped && !recorder) void finished.then(() => { if (!stopped && !recorder) begin(); });
  };
  const begin = () => {
    if (!stream || stopped || recorder) return;
    if (completedMs >= MAX_MS) { stopped = true; report("stopped", "Recording limit reached."); release(); return; }
    const parts: Blob[] = [];
    let resolveFinished: () => void;
    finished = new Promise<void>(resolve => { resolveFinished = resolve; });
    finishSegment = () => resolveFinished!();
    try {
      const mime = supportedAudioMime();
      const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 64_000 });
      recorder = rec; startedAt = Date.now();
      rec.ondataavailable = event => { if (event.data.size) parts.push(event.data); };
      rec.onerror = () => fail("Recording failed. SOS is still active. Retry microphone recording.");
      rec.onstop = () => {
        clearTimeout(segmentTimer);
        const durationMs = Math.max(0, Date.now() - startedAt);
        completedMs += durationMs;
        recorder = null;
        const type = parts.find(part => part.type)?.type || rec.mimeType || mime || "";
        const blob = new Blob(parts, { type });
        void (async () => {
          try {
            if (failed) return;
            if (!blob.size) { fail("No audio was captured. SOS is still active. Retry microphone recording."); return; }
            await persist(blob, durationMs);
            savedSegments++;
            if (stopped) report("stopped");
          } catch {
            fail("Audio could not be saved on this device. SOS is still active. Retry recording when storage is available.");
          } finally {
            resolveFinished!();
            if (stopped) release();
            else if (typeof document === "undefined" || document.visibilityState !== "hidden") begin();
          }
        })();
      };
      rec.start();
      report("recording");
      segmentTimer = setTimeout(stopSegment, Math.min(SEGMENT_MS, MAX_MS - completedMs));
    } catch {
      recorder = null; resolveFinished!();
      fail("This browser could not start audio recording. SOS is still active."); release();
    }
  };
  const ready = (async () => {
    await previous;
    if (stopped) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      fail("Recording is unavailable in this browser. SOS is still active."); return;
    }
    report("requesting");
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (stopped) { release(); return; }
      if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
      begin();
      if (stopped) return;
      tick = setInterval(() => {
        if (recorder?.state === "recording" && !failed) report("recording");
      }, 1000);
    } catch {
      if (stopped) { release(); return; }
      fail("Microphone access was denied or unavailable. SOS is still active. Enable microphone access and retry."); release();
    }
  })();
  const handle: Capture = {
    async stop() {
      stopped = true;
      // An unanswered permission prompt must not hold up ending SOS.
      stopSegment();
      await finished;
      release();
      if (!failed) report("stopped");
    },
  };
  microphoneReady = ready;
  active = handle;
  return handle;
}
