"use client";

import { useEffect, useRef, useState } from "react";

type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function InstallButton() {
  const [platform, setPlatform] = useState<"ios" | "android" | null>(null);
  const [installed, setInstalled] = useState(false);
  const [busy, setBusy] = useState(false);
  const promptRef = useRef<InstallPrompt | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const mobilePlatform = ios ? "ios" : /Android/i.test(navigator.userAgent) ? "android" : null;
    const standalone = window.matchMedia("(display-mode: standalone)");
    const fullscreen = window.matchMedia("(display-mode: fullscreen)");
    const isInstalled = () => standalone.matches || fullscreen.matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const frame = requestAnimationFrame(() => {
      setPlatform(window.isSecureContext ? mobilePlatform : null);
      setInstalled(isInstalled());
    });
    const beforeInstall = (event: Event) => {
      if (!mobilePlatform || isInstalled()) return;
      event.preventDefault();
      promptRef.current = event as InstallPrompt;
    };
    const onInstalled = () => {
      promptRef.current = null;
      setInstalled(true);
      dialogRef.current?.close();
    };
    const onDisplayChange = () => setInstalled(isInstalled());
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    standalone.addEventListener("change", onDisplayChange);
    fullscreen.addEventListener("change", onDisplayChange);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      standalone.removeEventListener("change", onDisplayChange);
      fullscreen.removeEventListener("change", onDisplayChange);
    };
  }, []);

  if (!platform || installed) return null;

  const install = async () => {
    if (busy) return;
    const prompt = promptRef.current;
    if (platform !== "android" || !prompt) {
      dialogRef.current?.showModal();
      return;
    }
    // Browser install prompts can only be used once, following a user gesture.
    promptRef.current = null;
    setBusy(true);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
    } catch {
      dialogRef.current?.showModal();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-1">
      <span className="text-xs text-muted-foreground">Keep HerGuardian on your Home Screen</span>
      <button type="button" onClick={install} disabled={busy}
        className="shrink-0 rounded-lg bg-[#1b7a86] px-3 py-2 text-xs font-semibold text-white disabled:opacity-60">
        {busy ? "Installing…" : "Install"}
      </button>
      <dialog ref={dialogRef} aria-labelledby="install-title"
        className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-sm overflow-y-auto rounded-xl border border-white/20 bg-background p-5 text-foreground backdrop:bg-black/70">
        <h2 id="install-title" className="text-lg font-semibold">Install HerGuardian</h2>
        {platform === "ios" ? (
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
            <li>Open this website in Safari.</li>
            <li>Open the Share menu and choose <strong>Add to Home Screen</strong>.</li>
            <li>Enable <strong>Open as Web App</strong> if shown, then tap <strong>Add</strong>.</li>
          </ol>
        ) : (
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
            <li>Open this website in Chrome.</li>
            <li>Open the browser menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>, if available.</li>
            <li>Confirm, then open HerGuardian from its new icon.</li>
          </ol>
        )}
        <p className="mt-3 text-xs text-muted-foreground">You can keep using the website without installing it.</p>
        <form method="dialog" className="mt-4">
          <button className="w-full rounded-lg bg-[#1b7a86] px-3 py-3 text-sm font-semibold text-white">Got it</button>
        </form>
      </dialog>
    </div>
  );
}
