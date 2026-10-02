"use client";

// Voice SOS (S.8). Last thing built, and last in the cut order, because of one
// fact: **Web Speech recognition in Chrome is cloud-based.** It needs a network
// round trip per utterance, so the one trigger that would matter most in a tunnel
// is the one that stops working there. The red button remains the floor.
//
// What it IS good for: you cannot reach the screen. Bag is open, hands full,
// walking fast. Saying two words beats finding the button.
//
// Recognition must be started from a real user gesture, so this is only ever
// called from a click handler, never on load.

// Minimal shape: lib.dom has no types for the prefixed SpeechRecognition.
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

export function voiceSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

// Deliberately narrow. "help" on its own fires constantly in ordinary speech; a
// false SOS alert trains guardians to ignore alerts, which is worse than no voice
// trigger at all. Two-word or unambiguous keywords only. Nepali "bachao" is
// included since the demo city is Kathmandu.
const PHRASES = [
  "help me",
  "help us",
  "bachao",
  "bacha",
  "sos",
  "emergency",
  "save me",
];

/** Pure, so it is testable without a microphone. */
export function matchesSos(transcript: string): boolean {
  const t = transcript.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  // Someone spelling it out is a realistic way to trigger this: "s o s" has to
  // match too. Boundaries keep the collapsed form honest — otherwise "i s o s"
  // collapses to "isos" and contains "sos".
  const spelled = t.replace(/\b(?:[a-z] ){2,}[a-z]\b/g, (m) => m.replace(/ /g, ""));
  return PHRASES.some((p) =>
    [t, spelled].some((hay) => new RegExp(`(?:^|\\s)${p}(?:\\s|$)`).test(hay)),
  );
}

/**
 * Start listening. Calls `onFire` once on a match, then disarms itself.
 * Returns a stop function.
 */
export function startVoiceSos(onFire: () => void, onError?: (message: string) => void): () => void {
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) {
    onError?.("This browser has no speech recognition.");
    return () => {};
  }

  const recognition = new Ctor();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = "en-US";
  let fired = false;
  let stopped = false;

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (!matchesSos(transcript)) continue;
      fired = true;
      recognition.abort();
      onFire();
      return;
    }
  };
  recognition.onerror = (e) => {
    const code = e.error ?? "unknown";
    if (code === "not-allowed" || code === "service-not-allowed") {
      onError?.("Microphone permission was declined.");
      return;
    }
    if (code === "network") {
      onError?.("Speech recognition needs a network connection — it does not work offline.");
    }
  };
  // Chrome ends a session after a pause in speech, so keep restarting until
  // something fires. This loop is why a hung recogniser never silently disarms.
  recognition.onend = () => {
    if (!stopped && !fired) {
      try {
        recognition.start();
      } catch {
        /* already starting */
      }
    }
  };

  try {
    recognition.start();
  } catch {
    onError?.("Could not start listening.");
  }
  return () => {
    stopped = true;
    recognition.onend = null;
    recognition.abort();
  };
}