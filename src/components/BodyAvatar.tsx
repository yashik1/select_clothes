"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildBody } from "@/lib/avatar/body";
import { buildGarments } from "@/lib/avatar/garment";
import { renderBody, type Camera } from "@/lib/avatar/render";
import { measurementProblems } from "@/lib/measurements";
import { formatLength } from "@/lib/units";
import type { BodyMeasurements, Garment, Unit } from "@/lib/types";

const VIEWS: { label: string; yaw: number; pitch: number }[] = [
  { label: "Front", yaw: 0, pitch: 0 },
  { label: "Side", yaw: Math.PI / 2, pitch: 0 },
  { label: "Back", yaw: Math.PI, pitch: 0 },
  { label: "¾", yaw: -Math.PI / 5, pitch: 0.12 },
];

const MAX_PITCH = 1.05;

/*
 * Every control here is pressed repeatedly while comparing views, so they get
 * press feedback but no entrance animation — the scale is instant confirmation
 * the click landed, and anything longer would be in the way by the third tap.
 */
const PILL =
  "rounded-full border px-3 py-1 text-xs transition-[transform,background-color,border-color,color] " +
  "duration-150 ease-[var(--ease-out)] active:scale-[0.97]";
const PILL_OFF =
  "border-[var(--color-line)] bg-[var(--color-paper)] text-[var(--color-muted)] hover:border-[var(--color-ink)] hover:text-[var(--color-text)]";
const PILL_ON = "border-[var(--color-ink)] bg-[var(--color-ink)] text-white";

export function BodyAvatar({
  measurements,
  unit = "cm",
  height = 460,
  garments,
  showMeasurementsByDefault,
}: {
  measurements: BodyMeasurements;
  unit?: Unit;
  height?: number;
  /** Clothes to put on the figure. Omit for the bare measurement view. */
  garments?: Garment[];
  showMeasurementsByDefault?: boolean;
}) {
  const dressable = Boolean(garments?.length);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Springs keep velocity when interrupted; this is the same idea in miniature.
  // Toggling mid-fade resumes from the current value instead of snapping.
  const dressedRef = useRef(dressable ? 1 : 0);
  const [camera, setCamera] = useState<Camera>({ yaw: -Math.PI / 9, pitch: 0.06, zoom: 1 });
  const [showRings, setShowRings] = useState(showMeasurementsByDefault ?? !dressable);
  const [spinning, setSpinning] = useState(false);
  const [wearing, setWearing] = useState(true);

  // Rebuilt only when a measurement actually changes, so dragging stays cheap.
  const mesh = useMemo(() => buildBody(measurements), [measurements]);
  const clothes = useMemo(
    () => (garments?.length ? buildGarments(mesh.frame, garments) : null),
    [mesh.frame, garments],
  );

  /*
   * Dressing cross-fades rather than popping. It is a state change the user
   * asked for, so it earns motion — but at 220ms, because they will toggle it
   * repeatedly to compare, and anything slower starts to feel like waiting.
   */
  const [dressed, setDressed] = useState(dressable ? 1 : 0);
  useEffect(() => {
    if (!dressable) return;
    const target = wearing ? 1 : 0;
    let frame = 0;
    const start = performance.now();
    const from = dressedRef.current;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 220);
      // Strong ease-out: the movement is over before the eye starts waiting.
      const eased = 1 - Math.pow(1 - t, 3);
      const value = from + (target - from) * eased;
      dressedRef.current = value;
      setDressed(value);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [wearing, dressable]);

  /* ------------------------------------------------------------- draw -- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssWidth = canvas.clientWidth;
    canvas.width = cssWidth * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    renderBody(ctx, mesh, {
      camera,
      width: cssWidth,
      height,
      showRings,
      garments: clothes?.shells,
      dressed,
      unitLabel: (cm) => formatLength(cm, unit),
    });
  }, [mesh, clothes, dressed, camera, showRings, height, unit]);

  /* ---------------------------------------------------------- spinning -- */
  useEffect(() => {
    if (!spinning) return;
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setCamera((c) => ({ ...c, yaw: c.yaw + dt * 0.7 }));
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [spinning]);

  /* ---------------------------------------------------------- dragging -- */
  const drag = useRef<{ x: number; y: number } | null>(null);

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY };
    setSpinning(false);
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };

    setCamera((c) => ({
      ...c,
      yaw: c.yaw + dx * 0.011,
      // Clamped: past vertical the figure turns inside out, and there is
      // nothing to see from directly overhead anyway.
      pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, c.pitch + dy * 0.009)),
    }));
  }

  function endDrag(e: React.PointerEvent<HTMLCanvasElement>) {
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  /* ---------------------------------------------------------- keyboard -- */
  function onKeyDown(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 0.4 : 0.15;
    const move: Record<string, () => void> = {
      ArrowLeft: () => setCamera((c) => ({ ...c, yaw: c.yaw - step })),
      ArrowRight: () => setCamera((c) => ({ ...c, yaw: c.yaw + step })),
      ArrowUp: () => setCamera((c) => ({ ...c, pitch: Math.max(-MAX_PITCH, c.pitch - step) })),
      ArrowDown: () => setCamera((c) => ({ ...c, pitch: Math.min(MAX_PITCH, c.pitch + step) })),
    };
    if (move[e.key]) {
      e.preventDefault();
      setSpinning(false);
      move[e.key]();
    }
  }

  const missing = mesh.estimated.length;

  /*
   * A figure drawn from an impossible profile still draws — it just isn't of
   * anybody. Saying so here matters more than on the form, because this is
   * where the mistake becomes visible: the reason to look at the picture at
   * all is that a wrong number is obvious as a shape long before it is
   * obvious as a digit.
   */
  const impossible = useMemo(() => measurementProblems(measurements, unit), [measurements, unit]);

  return (
    <div className="rounded-3xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={
          `A rotatable figure built from your measurements. ` +
          `${mesh.rings.map((r) => `${r.label} ${Math.round(r.circumference)} centimetres`).join(", ")}.`
        }
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        style={{ width: "100%", height, touchAction: "none" }}
        className="cursor-grab rounded-lg active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      />

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {VIEWS.map((v) => (
          <button
            key={v.label}
            onClick={() => {
              setSpinning(false);
              setCamera((c) => ({ ...c, yaw: v.yaw, pitch: v.pitch }));
            }}
            className={`${PILL} ${PILL_OFF}`}
          >
            {v.label}
          </button>
        ))}

        <button
          onClick={() => setSpinning((s) => !s)}
          aria-pressed={spinning}
          className={`${PILL} ${spinning ? PILL_ON : PILL_OFF}`}
        >
          {spinning ? "Stop" : "Spin"}
        </button>

        {dressable && (
          <button
            onClick={() => setWearing((w) => !w)}
            aria-pressed={wearing}
            className={`${PILL} ${wearing ? PILL_ON : PILL_OFF}`}
          >
            Wearing
          </button>
        )}

        <button
          onClick={() => setShowRings((s) => !s)}
          aria-pressed={showRings}
          className={`${PILL} ${showRings ? PILL_ON : PILL_OFF}`}
        >
          Measurements
        </button>

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setCamera((c) => ({ ...c, zoom: Math.max(0.6, c.zoom - 0.15) }))}
            aria-label="Zoom out"
            className={`${PILL} ${PILL_OFF} px-2.5`}
          >
            −
          </button>
          <button
            onClick={() => setCamera((c) => ({ ...c, zoom: Math.min(2.2, c.zoom + 0.15) }))}
            aria-label="Zoom in"
            className={`${PILL} ${PILL_OFF} px-2.5`}
          >
            +
          </button>
        </div>
      </div>

      {impossible.length > 0 && (
        <p className="mt-2.5 rounded-xl border border-[var(--color-bad)] bg-[var(--color-paper)] px-3 py-2 text-xs leading-relaxed text-[var(--color-bad)]">
          This isn&apos;t a shape a body comes in, so the figure and every score
          built on it are wrong. {impossible[0].message}
        </p>
      )}

      <p className="mt-2.5 text-xs leading-relaxed text-[var(--color-faint)]">
        {dressable ? (
          <>
            Drag to turn it. The clothes are drawn from their own measurements on
            your body, so the gap between cloth and skin <em>is</em> the ease —
            where a garment is narrower than you it moulds on rather than passing
            through.{" "}
            {clothes?.estimated.length ? (
              <span className="text-[var(--color-warn)]">
                {clothes.estimated.length === 1
                  ? `${clothes.estimated[0]} hasn't been measured, so it's drawn at this type's usual ease.`
                  : `${clothes.estimated.length} of these haven't been measured, so they're drawn at their type's usual ease.`}{" "}
              </span>
            ) : null}
            {clothes?.skipped.length ? (
              <>Not shown: {clothes.skipped.map((s) => s.name).join(", ")}.</>
            ) : null}
          </>
        ) : (
          <>
        Drag to turn it, or use the arrow keys. Every band is a measurement you
        entered, drawn at the height that landmark sits at.{" "}
        {missing > 0 ? (
          <>
            <span className="text-[var(--color-warn)]">
              {missing} {missing === 1 ? "measurement is" : "measurements are"} still estimated from
              your height
            </span>{" "}
            — those bands are dashed, and filling them in is what makes this yours rather than
            average.
          </>
        ) : (
          <>Every band is measured — this is your shape, not an average one.</>
        )}{" "}
        A girth says how far around you are, not what shape you are, so treat it as a tailor&apos;s
        dummy rather than a portrait.
          </>
        )}
      </p>
    </div>
  );
}
