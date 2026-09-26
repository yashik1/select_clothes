"use client";

import { useEffect, useState } from "react";

/**
 * Registers the service worker, and offers to install the app.
 *
 * Two jobs in one component because they are the same feature: the worker is
 * what makes the browser consider the app installable in the first place, and
 * the banner is the only moment anyone finds out that it is.
 *
 * The banner is deliberately quiet. `beforeinstallprompt` fires on a page the
 * person came to for something else, so it appears once, sits at the bottom out
 * of the way of the content, and a dismissal is remembered — an install prompt
 * that keeps coming back is the reason people distrust install prompts.
 */

/** Not in lib.dom yet; Chromium-only, and it is the whole mechanism. */
interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED = "fitcheck.install.dismissed";

export function InstallPrompt({ offer = false }: { offer?: boolean }) {
  const [event, setEvent] = useState<InstallEvent | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    /*
     * After load, not during render. Registration competes for the same
     * connections as the page's own resources, and the worker is worth nothing
     * on this visit — only on the next one.
     */
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // An unregistered worker costs a slower cold start and nothing else.
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  useEffect(() => {
    if (!offer) return;
    try {
      if (localStorage.getItem(DISMISSED)) return;
    } catch {
      // Private mode, or storage blocked. Offering anyway is the lesser evil:
      // it can only mean the banner reappears.
    }

    const onPrompt = (e: Event) => {
      // Stops Chrome's own mini-infobar, so there is one offer rather than two.
      e.preventDefault();
      setEvent(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // Once installed the offer is meaningless, and this fires even when the
    // install happened through the browser's own menu.
    const onInstalled = () => setEvent(null);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [offer]);

  function dismiss() {
    setEvent(null);
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {
      /* Nothing to remember it with; it will offer again next time. */
    }
  }

  async function install() {
    if (!event) return;
    const pending = event;
    // Cleared first: the event can only be prompted once, so leaving the button
    // on screen would leave a button that does nothing.
    setEvent(null);
    try {
      await pending.prompt();
      const { outcome } = await pending.userChoice;
      // A refusal is an answer. Asking again on the next page load would be
      // ignoring it.
      if (outcome === "dismissed") localStorage.setItem(DISMISSED, "1");
    } catch {
      /* The browser withdrew the prompt; nothing to do. */
    }
  }

  if (!event) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 p-4 sm:left-auto sm:right-4 sm:max-w-sm">
      <div className="flex items-center gap-3 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-3 shadow-[0_10px_40px_-12px_rgba(50,48,47,0.28)]">
        <span
          aria-hidden
          className="display flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-ink)] text-sm text-white"
        >
          F
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Add FitCheck to your home screen</p>
          <p className="text-xs text-[var(--color-muted)]">
            Opens straight to the camera when you’re adding clothes.
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            onClick={install}
            className="flex min-h-11 items-center rounded-full bg-[var(--color-ink)] px-4 text-sm font-medium text-white transition-transform active:scale-[0.97]"
          >
            Install
          </button>
          <button
            onClick={dismiss}
            aria-label="Not now"
            className="flex min-h-11 w-11 items-center justify-center rounded-full text-[var(--color-muted)] transition-colors hover:bg-[var(--color-raised)]"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
