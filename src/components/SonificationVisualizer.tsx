import { useRef, useEffect, useCallback, useMemo, useImperativeHandle, forwardRef } from "react";
import type { PatternData } from "../utils/PatternAnalyzer";
import type { SonificationConfig } from "../utils/Sonifier";
import { yToNote } from "../utils/Sonifier";
import styles from "./SonificationVisualizer.module.css";

export type VisualStyle = "dots" | "living" | "pulse";

interface Props {
  patterns: PatternData;
  imageSrc: string;
  config: SonificationConfig;
  activeElementIndex?: number | null;
  visualStyle?: VisualStyle;
}

// Cleaner version — high notes = warm amber, low notes = deep blue
function noteHue(y: number): number {
  // y=0 top high → 40 (gold), y=1 bottom low → 250 (indigo)
  return 40 + y * 210;  // 40 (high) … 250 (low)
}

export interface VisualizerHandle {
  getCanvasStream: () => MediaStream | null;
  getCanvas: () => HTMLCanvasElement | null;
}

export const SonificationVisualizer = forwardRef<VisualizerHandle, Props>(({
  patterns,
  imageSrc,
  config: _config,
  activeElementIndex,
  visualStyle = "dots",
}, ref) => {
  useImperativeHandle(ref, () => ({
    getCanvas: () => canvasRef.current,
    getCanvasStream: () => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      return (canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(30);
    },
  }));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const pulseRingRef = useRef<{ x: number; y: number; hue: number; born: number } | null>(null);
  const drawRef = useRef<((now: number) => void) | null>(null);

  const sortedElements = useMemo(
    () => [...patterns.elements].sort((a, b) => a.x - b.x || a.y - b.y),
    [patterns.elements]
  );

  const activeElem =
    activeElementIndex != null ? sortedElements[activeElementIndex] ?? null : null;

  const activeNote = activeElem ? yToNote(activeElem.y) : null;

  const draw = useCallback((now: number = Date.now()) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    ctx.fillStyle = "#08080e";
    ctx.fillRect(0, 0, W, H);

    // Background image opacity varies by style
    if (imgRef.current) {
      const opacity = visualStyle === "living" ? 0.55 : visualStyle === "pulse" ? 0.35 : 0.12;
      ctx.globalAlpha = opacity;
      ctx.drawImage(imgRef.current, 0, 0, W, H);
      ctx.globalAlpha = 1;
    }

    if (visualStyle === "pulse") {
      // Ghost dots very faint
      sortedElements.forEach((elem) => {
        const hue = noteHue(elem.y);
        ctx.beginPath();
        ctx.arc(elem.x * W, elem.y * H, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${hue}, 70%, 60%, 0.12)`;
        ctx.fill();
      });

      // Expanding ring animation
      const pulse = pulseRingRef.current;
      if (pulse) {
        const age = now - pulse.born;
        const maxAge = 900;
        if (age < maxAge) {
          const px = pulse.x * W;
          const py = pulse.y * H;
          const progress = age / maxAge;
          const r1 = progress * Math.min(W, H) * 0.45;
          const r2 = progress * Math.min(W, H) * 0.18;
          const alpha = 1 - progress;

          ctx.beginPath();
          ctx.arc(px, py, r1, 0, Math.PI * 2);
          ctx.strokeStyle = `hsla(${pulse.hue}, 90%, 70%, ${alpha * 0.65})`;
          ctx.lineWidth = 2;
          ctx.stroke();

          const grd = ctx.createRadialGradient(px, py, 0, px, py, r2);
          grd.addColorStop(0, `hsla(${pulse.hue}, 100%, 85%, ${alpha})`);
          grd.addColorStop(1, `hsla(${pulse.hue}, 90%, 65%, 0)`);
          ctx.beginPath();
          ctx.arc(px, py, r2, 0, Math.PI * 2);
          ctx.fillStyle = grd;
          ctx.fill();
        }
      }
    } else {
      // dots or living — draw all elements
      sortedElements.forEach((elem, i) => {
        const hue = noteHue(elem.y);
        const velocity = Math.max(0.1, Math.min(1, elem.size * 0.5 + 0.3));
        const baseRadius = visualStyle === "living" ? 1.5 + velocity * 5 : 1 + velocity * 4;
        const alpha = visualStyle === "living" ? 0.45 + elem.density * 0.5 : 0.2 + elem.density * 0.6;
        const isActive = i === activeElementIndex;
        const cx = elem.x * W;
        const cy = elem.y * H;

        if (isActive) {
          const glowR = visualStyle === "living" ? baseRadius * 10 : baseRadius * 7;
          const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
          grd.addColorStop(0, `hsla(${hue}, 100%, ${visualStyle === "living" ? 90 : 75}%, 0.95)`);
          grd.addColorStop(1, `hsla(${hue}, 100%, 60%, 0)`);
          ctx.beginPath();
          ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
          ctx.fillStyle = grd;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(cx, cy, isActive ? baseRadius * 2.5 : baseRadius, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${hue}, ${isActive ? 95 : 75}%, ${isActive ? 80 : 55}%, ${isActive ? 1 : alpha})`;
        ctx.fill();

        if (!isActive && elem.density > 0.4) {
          ctx.beginPath();
          ctx.arc(cx, cy, baseRadius + 3, 0, Math.PI * 2);
          ctx.strokeStyle = `hsla(${hue}, 70%, 65%, ${elem.density * 0.2})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      });
    }

    // Vertical scan line (not in pulse mode)
    if (activeElem && visualStyle !== "pulse") {
      const scanX = activeElem.x * W;
      const hue = noteHue(activeElem.y);

      const fadeGrad = ctx.createLinearGradient(scanX - 40, 0, scanX + 40, 0);
      fadeGrad.addColorStop(0, "rgba(0,0,0,0)");
      fadeGrad.addColorStop(0.5, `hsla(${hue}, 80%, 50%, 0.12)`);
      fadeGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = fadeGrad;
      ctx.fillRect(scanX - 40, 0, 80, H);

      ctx.beginPath();
      ctx.moveTo(scanX, 0);
      ctx.lineTo(scanX, H);
      ctx.strokeStyle = `hsla(${hue}, 90%, 70%, 0.8)`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Pitch ruler on left edge
    const totalNotes = 20;
    for (let i = 0; i < totalNotes; i++) {
      const y = (1 - i / (totalNotes - 1)) * H;
      const hue = noteHue(i / (totalNotes - 1));
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(8, y);
      ctx.strokeStyle = `hsla(${hue}, 70%, 55%, 0.5)`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

  }, [patterns, activeElementIndex, sortedElements, activeElem, visualStyle]);

  // Keep drawRef current for the rAF loop
  useEffect(() => { drawRef.current = draw; }, [draw]);

  // Update pulse ring when active element changes in pulse mode
  useEffect(() => {
    if (visualStyle === "pulse" && activeElementIndex != null) {
      const elem = sortedElements[activeElementIndex];
      if (elem) {
        pulseRingRef.current = { x: elem.x, y: elem.y, hue: noteHue(elem.y), born: Date.now() };
      }
    }
  }, [activeElementIndex, visualStyle, sortedElements]);

  // rAF loop for smooth pulse animation
  useEffect(() => {
    if (visualStyle !== "pulse") return;
    let rafId: number;
    let active = true;
    const loop = () => {
      if (!active) return;
      drawRef.current?.(Date.now());
      rafId = requestAnimationFrame(loop);
    };
    loop();
    return () => { active = false; cancelAnimationFrame(rafId); };
  }, [visualStyle]);

  useEffect(() => {
    if (!imageSrc) return;
    imgRef.current = null;
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const canvas = canvasRef.current;
      if (canvas) {
        const maxW = 900;
        const scale = Math.min(1, maxW / img.width);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
      }
      draw();
    };
    img.src = imageSrc;
  }, [imageSrc]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.canvasWrap}>
        <canvas ref={canvasRef} className={styles.canvas} />
        {activeNote && (
          <div className={styles.noteDisplay}>
            <span className={styles.noteIcon}>♩</span>
            <span className={styles.noteName}>{activeNote}</span>
          </div>
        )}
      </div>

      <div className={styles.legend}>
        <div className={styles.pitchBar}>
          <span className={styles.pitchLabel}>high</span>
          <div className={styles.pitchGradient} />
          <span className={styles.pitchLabel}>low</span>
        </div>
        <div className={styles.legendItems}>
          <span>● small = soft</span>
          <span>● large = loud</span>
          <span>◎ ring = harmony</span>
          {visualStyle !== "pulse" && <span>← scan left → right</span>}
          {visualStyle === "pulse" && <span>● pulse on beat</span>}
          {visualStyle === "living" && <span>image shows through</span>}
        </div>
      </div>
    </div>
  );
});
