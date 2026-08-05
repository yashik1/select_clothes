"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * The thing that says what just happened, out loud.
 *
 * Every asynchronous action in this app used to report itself by swapping a
 * word inside a button — "Save" becoming "Saved", a red line of text appearing
 * under a form. Sighted users read that from the corner of their eye. To a
 * screen reader it is nothing at all: the text changed somewhere off the
 * cursor's path, no event was raised, and the user is left holding a form with
 * no idea whether it went through.
 *
 * A live region fixes that by announcing its own content whenever it changes,
 * with no focus move and no interruption. Two politeness levels, and the
 * difference matters:
 *
 *   polite    waits for a pause. Right for "Saved", which nobody needs to hear
 *             mid-sentence.
 *   assertive cuts in immediately. Right for a failure, because carrying on
 *             reading a form that just refused the submission wastes the
 *             user's time.
 *
 * The element is always rendered, even when empty. A live region that is added
 * to the page already containing text is frequently not announced at all —
 * the region has to exist before the change for the change to be a change.
 */

export type Tone = "ok" | "bad" | "busy";

export interface StatusState {
  message: string;
  tone: Tone;
}

export function useStatus() {
  const [state, setState] = useState<StatusState>({ message: "", tone: "ok" });

  const say = useCallback((message: string) => setState({ message, tone: "ok" }), []);
  const fail = useCallback((message: string) => setState({ message, tone: "bad" }), []);
  const busy = useCallback((message: string) => setState({ message, tone: "busy" }), []);
  const clear = useCallback(() => setState({ message: "", tone: "ok" }), []);

  return useMemo(
    () => ({ say, fail, busy, clear, props: state }),
    [say, fail, busy, clear, state],
  );
}

const TONE_CLASS: Record<Tone, string> = {
  ok: "text-[var(--color-good)]",
  bad: "text-[var(--color-bad)]",
  busy: "text-[var(--color-muted)]",
};

export function Status({ message, tone, className = "" }: StatusState & { className?: string }) {
  return (
    <p
      // `alert` carries an implicit assertive live region and is what a screen
      // reader's own conventions expect for an error, so failures get the role
      // rather than only the politeness setting.
      role={tone === "bad" ? "alert" : "status"}
      aria-live={tone === "bad" ? "assertive" : "polite"}
      // Without this, a region whose text changes from "Saving…" to "Saved" may
      // be read as just the diff. Atomic makes it read the whole sentence.
      aria-atomic="true"
      className={`text-xs leading-relaxed ${TONE_CLASS[tone]} ${className}`}
    >
      {message}
    </p>
  );
}

/**
 * A heading that takes focus when it appears.
 *
 * For the moment one view replaces another without the page navigating — a
 * form becoming a confirmation, a wizard moving on. Visually this is obvious.
 * For anyone driving by keyboard it is the opposite of obvious: focus was on a
 * button that no longer exists, so the browser drops it to `<body>`, and the
 * next Tab starts again from the top of the page with no indication that
 * anything happened at all.
 *
 * Moving focus to the new heading fixes both halves — the new content is read
 * out, and Tab continues from where the content now is.
 *
 * `tabIndex={-1}` makes a heading focusable by script without adding it to the
 * tab order, and the outline is suppressed because this focus was not asked
 * for by the user and a ring around a heading reads as a bug.
 */
export function FocusHeading({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <h1 ref={ref} tabIndex={-1} className={`outline-none ${className}`}>
      {children}
    </h1>
  );
}

/**
 * A live region with nothing visible in it.
 *
 * For results that are already on screen and obvious to anyone who can see
 * them — a list that just filtered down to four items, a score that finished
 * calculating. Repeating that visibly would be noise; saying it once to a
 * screen reader is the whole point.
 */
export function ScreenReaderStatus({ message }: { message: string }) {
  return (
    <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </span>
  );
}
