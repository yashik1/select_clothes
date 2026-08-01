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
  // Read by the swing loop, which runs on its own frames and must not restart
  // every time the camera moves.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
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

  /* -------------------------------------------------------- measuring -- */
  /*
   * A canvas has two sizes: the bitmap it owns, and the box CSS gives it. When
   * they disagree the browser stretches the bitmap to fit, and the figure comes
   * out squashed and soft. The box changes on every window resize and every
   * layout reflow, and none of those re-ran the draw — so the bitmap stayed at
   * whatever width the page happened to have when the camera last moved.
   */
  const [box, setBox] = useState({ width: 0, dpr: 1 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const measure = () => {
      const width = canvas.clientWidth;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      // Same object back when nothing moved, or every scroll-driven reflow
      // would re-render and redraw for no reason.
      setBox((prev) => (prev.width === width && prev.dpr === dpr ? prev : { width, dpr }));
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(canvas);

    // A ResizeObserver says nothing when only the pixel ratio changes, which is
    // what dragging a window to a second monitor does — same CSS box, twice the
    // device pixels. The query matches the ratio in force, so it fires on the
    // way out of it.
    const media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    media.addEventListener("change", measure);

    return () => {
      observer.disconnect();
      media.removeEventListener("change", measure);
    };
  }, [box.dpr]);

  /* ------------------------------------------------------------ swing -- */
  /*
   * How far the cloth is trailing the body, right now.
   *
   * A spring rather than a formula: it builds while the figure turns, carries
   * on past the moment you let go, and settles back. Kept in a ref and stepped
   * on its own frame loop, so releasing a drag still has something to watch —
   * deriving it from the camera alone would freeze the cloth mid-swing the
   * instant the yaw stopped changing.
   */
  const swingRef = useRef(0);
  const swingVelocity = useRef(0);
  const [swing, setSwing] = useState(0);
  const lastYaw = useRef(camera.yaw);
  const lastTick = useRef(0);
  const swingFrame = useRef(0);

  useEffect(() => {
    if (!dressable) return;

    /*
     * A real spring, carrying its own velocity, rather than a value chasing a
     * target. Chasing settles in about a tenth of a second — technically a
     * lag, but gone before the eye finds it, and it can only ever return the
     * way it came. Cloth released from a turn swings past the body and comes
     * back, and that overshoot is the whole thing worth watching. Underdamped
     * on purpose: `damping` sits below the 2·√stiffness that would kill it.
     */
    const STIFFNESS = 120;
    const DAMPING = 13;

    const step = (now: number) => {
      // Clamped both ways: a tab returning from the background reports a gap
      // of seconds, and a restarted loop reports one of nothing.
      const dt = Math.max(0.004, Math.min(0.05, (now - lastTick.current) / 1000));
      lastTick.current = now;

      const yaw = cameraRef.current.yaw;
      const turned = yaw - lastYaw.current;
      lastYaw.current = yaw;

      // Where the cloth wants to be while the body is turning, and zero the
      // moment it stops — from there the spring's own momentum carries it.
      const target = Math.max(-0.34, Math.min(0.34, (-turned / dt) * 0.05));

      swingVelocity.current +=
        ((target - swingRef.current) * STIFFNESS - swingVelocity.current * DAMPING) * dt;
      const next = swingRef.current + swingVelocity.current * dt;

      const settled =
        Math.abs(next) < 1e-3 && Math.abs(swingVelocity.current) < 1e-2 && Math.abs(target) < 1e-3;
      swingRef.current = settled ? 0 : next;
      if (settled) swingVelocity.current = 0;
      setSwing((prev) => (Math.abs(prev - swingRef.current) < 3e-4 ? prev : swingRef.current));

      // Stop dead once the cloth has hung still, rather than burning a frame
      // callback for the rest of the session on a figure nobody is turning.
      swingFrame.current = settled ? 0 : requestAnimationFrame(step);
    };

    if (!swingFrame.current) {
      lastTick.current = performance.now();
      swingFrame.current = requestAnimationFrame(step);
    }
    return () => {
      cancelAnimationFrame(swingFrame.current);
      swingFrame.current = 0;
    };
    // Re-runs whenever the figure turns, which is exactly when the cloth needs
    // waking up again.
  }, [dressable, camera.yaw]);

  /* ------------------------------------------------------------- draw -- */
  useEffect(() => {
    const canvas = canvasRef.current;
    // Zero before the first layout, and a zero-width bitmap stretched across a
    // real box is the worst-looking version of this bug.
    if (!canvas || box.width <= 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const wanted = { w: Math.round(box.width * box.dpr), h: Math.round(height * box.dpr) };
    // Assigning either dimension reallocates the bitmap and resets every
    // context property with it, so it happens only on a real size change —
    // this effect runs sixty times a second while the figure is spinning.
    if (canvas.width !== wanted.w || canvas.height !== wanted.h) {
      canvas.width = wanted.w;
      canvas.height = wanted.h;
    }
    ctx.setTransform(box.dpr, 0, 0, box.dpr, 0, 0);

    renderBody(ctx, mesh, {
      camera,
      width: box.width,
      height,
      showRings,
      garments: clothes?.shells,
      dressed,
      swing,
      unitLabel: (cm) => formatLength(cm, unit),
    });
  }, [mesh, clothes, dressed, swing, camera, showRings, height, unit, box]);

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
