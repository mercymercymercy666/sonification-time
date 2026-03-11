import { useRef, useEffect, useState, useCallback } from "react";
import { Sonifier } from "../utils/Sonifier";
import type { SonificationConfig } from "../utils/Sonifier";
import type { PatternData } from "../utils/PatternAnalyzer";
import styles from "./ReelRecorder.module.css";
import type { VisualStyle } from "./SonificationVisualizer";

// 9:16 portrait — the actual Instagram Reels spec
const REEL_W = 540;
const REEL_H = 960;

interface Props {
  patterns: PatternData;
  imageSrc: string;
  config: SonificationConfig;
  playMode: "batch" | "realtime";
  visualStyle?: VisualStyle;
  onClose: () => void;
}

export function ReelRecorder({ patterns, imageSrc, config, playMode, visualStyle = "dots", onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const drawFrame = useCallback((activeIndex: number | null) => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;

    ctx.fillStyle = "#0a0a0f";
    ctx.fillRect(0, 0, W, H);

    // Background image — opacity by style
    if (img) {
      ctx.save();
      ctx.globalAlpha = visualStyle === "living" ? 0.55 : visualStyle === "pulse" ? 0.35 : 0.1;
      const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      ctx.restore();
    }

    // Portrait reel layout:
    //   X axis of drawing  → horizontal spread across canvas width
    //   Y axis of drawing  → VERTICAL position (top of drawing = top of reel)
    //   Playback order (X) → scan line moves top→bottom by mapping X→scanY
    //
    // So the scan line sweeps downward and each row of the reel corresponds
    // to a "column" in the original drawing — left columns play first (top),
    // right columns play last (bottom).

    patterns.elements.forEach((elem, i) => {
      // Portrait rotation: drawing X (time) → vertical, drawing Y (pitch) → horizontal
      const px = elem.y * W;
      const py = elem.x * H;
      const hue = 40 + elem.y * 210;
      const vel = Math.max(0.2, Math.min(1, 0.3 + (1 - elem.intensity) * 0.8));
      const r = 1 + vel * 3;
      const active = i === activeIndex;

      if (active) {
        const glowR = visualStyle === "living" ? r * 11 : r * 7;
        const grd = ctx.createRadialGradient(px, py, 0, px, py, glowR);
        grd.addColorStop(0, `hsla(${hue}, 95%, ${visualStyle === "living" ? 90 : 70}%, 0.9)`);
        grd.addColorStop(1, `hsla(${hue}, 90%, 60%, 0)`);
        ctx.beginPath();
        ctx.arc(px, py, glowR, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(px, py, active ? r * 1.7 : r, 0, Math.PI * 2);
      ctx.fillStyle = active
        ? `hsl(${hue}, 95%, 82%)`
        : `hsla(${hue}, 80%, 65%, ${visualStyle === "living" ? 0.85 : 0.75})`;
      ctx.fill();
    });

    // Horizontal scan line — sweeps top to bottom as playback progresses
    if (activeIndex !== null) {
      const elem = patterns.elements[activeIndex];
      if (elem) {
        const sy = elem.x * H;
        const g = ctx.createLinearGradient(0, sy - 3, 0, sy + 3);
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(0.5, "rgba(255,255,255,0.2)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, sy - 3, W, 6);
      }
    }

    // Pitch color bar on bottom edge (left=high/gold, right=low/indigo)
    for (let px = 0; px < W; px++) {
      const hue = 40 + (px / W) * 210;
      ctx.fillStyle = `hsla(${hue}, 70%, 55%, 0.25)`;
      ctx.fillRect(px, H - 6, 1, 6);
    }

    // Watermark
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.font = `${Math.round(W * 0.028)}px monospace`;
    ctx.textAlign = "right";
    ctx.fillText("brazen", W - 14, H - 14);
  }, [patterns, visualStyle]);

  // Load image then draw initial frame
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      drawFrame(null);
    };
    img.src = imageSrc;
  }, [imageSrc, drawFrame]);

  const handleRecord = async () => {
    if (isRecording) return;
    setDownloadUrl(null);

    const canvas = canvasRef.current;
    if (!canvas) return;

    if (typeof VideoEncoder === "undefined") {
      alert("WebCodecs not supported. Use Chrome or Safari 16.4+.");
      return;
    }

    const recSonifier = new Sonifier(config);
    await recSonifier.initialize();

    const W = canvas.width;
    const H = canvas.height;

    const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: { codec: "avc", width: W, height: H },
      audio: { codec: "aac", numberOfChannels: 2, sampleRate: 44100 },
      firstTimestampBehavior: "offset",
      fastStart: "in-memory",
    });

    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => console.error("VideoEncoder:", e),
    });
    videoEncoder.configure({
      codec: "avc1.42001f",
      width: W,
      height: H,
      bitrate: 3_000_000,
      framerate: 30,
    });

    const captureCtx = new AudioContext({ sampleRate: 44100 });
    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => console.error("AudioEncoder:", e),
    });
    audioEncoder.configure({
      codec: "mp4a.40.2",
      numberOfChannels: 2,
      sampleRate: captureCtx.sampleRate,
      bitrate: 128_000,
    });

    // Audio capture
    const audioStream = recSonifier.getAudioStream();
    let cleanupAudio = () => {};
    let audioTs = 0;
    if (audioStream) {
      const src = captureCtx.createMediaStreamSource(audioStream);
      const bufSize = 4096;
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const node = captureCtx.createScriptProcessor(bufSize, 2, 2);
      node.onaudioprocess = (e) => {
        if (audioEncoder.state === "closed") return;
        const L = e.inputBuffer.getChannelData(0);
        const R = e.inputBuffer.getChannelData(1);
        const planar = new Float32Array(bufSize * 2);
        planar.set(L, 0);
        planar.set(R, bufSize);
        try {
          const ad = new AudioData({
            format: "f32-planar",
            sampleRate: captureCtx.sampleRate,
            numberOfFrames: bufSize,
            numberOfChannels: 2,
            timestamp: audioTs,
            data: planar,
          });
          audioEncoder.encode(ad);
          ad.close();
        } catch { /* ignore */ }
        audioTs += Math.round(bufSize * (1_000_000 / captureCtx.sampleRate));
      };
      src.connect(node);
      node.connect(captureCtx.destination);
      cleanupAudio = () => {
        try { src.disconnect(); } catch { /* ignore */ }
        try { node.disconnect(); } catch { /* ignore */ }
      };
    }

    // Video frame capture
    let frameCount = 0;
    const recStart = performance.now();
    const captureInterval = setInterval(() => {
      if (videoEncoder.state === "closed" || videoEncoder.encodeQueueSize > 20) return;
      const ts = Math.round((performance.now() - recStart) * 1000);
      try {
        const frame = new VideoFrame(canvas, { timestamp: ts });
        videoEncoder.encode(frame, { keyFrame: frameCount % 150 === 0 });
        frame.close();
        frameCount++;
      } catch { /* ignore */ }
    }, 1000 / 30);

    setIsRecording(true);

    try {
      await recSonifier.sonify(patterns, playMode, (index) => {
        drawFrame(index);
      });
    } finally {
      clearInterval(captureInterval);
      cleanupAudio();

      try {
        await videoEncoder.flush();
        videoEncoder.close();
        await audioEncoder.flush();
        audioEncoder.close();
        muxer.finalize();
        await captureCtx.close();

        const blob = new Blob([target.buffer], { type: "video/mp4" });
        setDownloadUrl(URL.createObjectURL(blob));
      } catch (err) {
        console.error("Reel MP4 finalization failed:", err);
        alert("Reel encoding failed. Try again.");
      }

      recSonifier.stop();
      setIsRecording(false);
      drawFrame(null);
    }
  };

  return (
    <div className={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <span className={styles.title}>Reel Export <span className={styles.ratio}>9:16</span></span>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div className={styles.canvasWrap}>
          <canvas
            ref={canvasRef}
            width={REEL_W}
            height={REEL_H}
            className={styles.canvas}
          />
          {isRecording && (
            <div className={styles.recBadge}>● REC</div>
          )}
        </div>

        <div className={styles.controls}>
          <button
            className={isRecording ? styles.recActive : styles.recordBtn}
            onClick={handleRecord}
            disabled={isRecording}
          >
            {isRecording ? "● Recording…" : "⏺ Record Reel"}
          </button>
          {downloadUrl && !isRecording && (
            <a className={styles.downloadBtn} href={downloadUrl} download="reel.mp4">
              ↓ Download MP4
            </a>
          )}
        </div>
        <p className={styles.hint}>Records fresh playback at 9:16 for Instagram Reels</p>
      </div>
    </div>
  );
}
