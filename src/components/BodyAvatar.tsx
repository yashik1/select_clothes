"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildBody } from "@/lib/avatar/body";
import { renderBody, type Camera } from "@/lib/avatar/render";
import { formatLength } from "@/lib/units";
import type { BodyMeasurements, Unit } from "@/lib/types";

const VIEWS: { label: string; yaw: number; pitch: number }[] = [
  { label: "Front", yaw: 0, pitch: 0 },
  { label: "Side", yaw: Math.PI / 2, pitch: 0 },
  { label: "Back", yaw: Math.PI, pitch: 0 },
  { label: "¾", yaw: -Math.PI / 5, pitch: 0.12 },
];

const MAX_PITCH = 1.05;

export function BodyAvatar({
  measurements,
  unit = "cm",
  height = 460,
}: {
  measurements: BodyMeasurements;
  unit?: Unit;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [camera, setCamera] = useState<Camera>({ yaw: -Math.PI / 9, pitch: 0.06, zoom: 1 });
  const [showRings, setShowRings] = useState(true);
  const [spinning, setSpinning] = useState(false);

  // Rebuilt only when a measurement actually changes, so dragging stays cheap.
  const mesh = useMemo(() => buildBody(measurements), [measurements]);

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
      unitLabel: (cm) => formatLength(cm, unit),
    });
  }, [mesh, camera, showRings, height, unit]);

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
            className="rounded-full border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-1 text-xs text-[var(--color-muted)] transition-colors hover:border-[var(--color-ink)] hover:text-[var(--color-text)]"
          >
            {v.label}
          </button>
        ))}

        <button
          onClick={() => setSpinning((s) => !s)}
          aria-pressed={spinning}
          className={`rounded-full border px-3 py-1 text-xs transition-colors ${
            spinning
              ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white"
              : "border-[var(--color-line)] bg-[var(--color-paper)] text-[var(--color-muted)] hover:border-[var(--color-ink)] hover:text-[var(--color-text)]"
          }`}
        >
          {spinning ? "Stop" : "Spin"}
        </button>

        <button
          onClick={() => setShowRings((s) => !s)}
          aria-pressed={showRings}
          className={`rounded-full border px-3 py-1 text-xs transition-colors ${
            showRings
              ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white"
              : "border-[var(--color-line)] bg-[var(--color-paper)] text-[var(--color-muted)] hover:border-[var(--color-ink)] hover:text-[var(--color-text)]"
          }`}
        >
          Measurements
        </button>

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setCamera((c) => ({ ...c, zoom: Math.max(0.6, c.zoom - 0.15) }))}
            aria-label="Zoom out"
            className="rounded-full border border-[var(--color-line)] bg-[var(--color-paper)] px-2.5 py-1 text-xs text-[var(--color-muted)] hover:border-[var(--color-ink)] hover:text-[var(--color-text)]"
          >
            −
          </button>
          <button
            onClick={() => setCamera((c) => ({ ...c, zoom: Math.min(2.2, c.zoom + 0.15) }))}
            aria-label="Zoom in"
            className="rounded-full border border-[var(--color-line)] bg-[var(--color-paper)] px-2.5 py-1 text-xs text-[var(--color-muted)] hover:border-[var(--color-ink)] hover:text-[var(--color-text)]"
          >
            +
          </button>
        </div>
      </div>

      <p className="mt-2.5 text-xs leading-relaxed text-[var(--color-faint)]">
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
      </p>
    </div>
  );
}
