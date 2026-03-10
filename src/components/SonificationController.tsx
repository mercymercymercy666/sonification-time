import React, { useState, useEffect, useRef } from "react";
import { ReelRecorder } from "./ReelRecorder";
import { CameraCapture } from "./CameraCapture";
import type { VisualStyle } from "./SonificationVisualizer";
import type { PatternData } from "../utils/PatternAnalyzer";
import { analyzeImage } from "../utils/PatternAnalyzer";
import { Sonifier, DEFAULT_CONFIG } from "../utils/Sonifier";
import type { SonificationConfig } from "../utils/Sonifier";
import { SonificationVisualizer } from "./SonificationVisualizer";
import type { VisualizerHandle } from "./SonificationVisualizer";
import styles from "./SonificationController.module.css";

interface SonificationControllerProps {
  patterns: PatternData | null;
  imageSrc: string;
  imageFile: File | null;
}

export const SonificationController: React.FC<SonificationControllerProps> = ({
  patterns: initialPatterns,
  imageSrc,
  imageFile,
}) => {
  const [patterns, setPatterns] = useState<PatternData | null>(initialPatterns);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playMode, setPlayMode] = useState<"realtime" | "batch">("batch");
  const [detectionMode, setDetectionMode] = useState<"drawing" | "photo" | "tattoo">("drawing");
  const [darkThreshold, setDarkThreshold] = useState(0.5);
  const [config, setConfig] = useState<SonificationConfig>(DEFAULT_CONFIG);
  const [sonifier, setSonifier] = useState<Sonifier | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeElementIndex, setActiveElementIndex] = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingReady, setRecordingReady] = useState<string | null>(null);
  const [recordingExt, setRecordingExt] = useState("mp4");
  const [showReel, setShowReel] = useState(false);
  const [visualStyle, setVisualStyle] = useState<VisualStyle>("dots");
  const [showCamera, setShowCamera] = useState(false);
  const [localImageSrc, setLocalImageSrc] = useState<string>("");

  const visualizerRef = useRef<VisualizerHandle>(null);

  // Sync patterns when parent passes new ones (image change)
  useEffect(() => {
    setPatterns(initialPatterns);
  }, [initialPatterns]);

  useEffect(() => {
    const sf = new Sonifier(config);
    setSonifier(sf);
    return () => { sf.stop(); };
  }, [config]);

  const handleReanalyze = async (
    nextMode: "drawing" | "photo" | "tattoo",
    nextThreshold: number
  ) => {
    if (!imageFile || isPlaying) return;
    setIsLoading(true);
    try {
      const sampleRate = nextMode === "photo" ? 20 : 8;
      const p = await analyzeImage(imageFile, sampleRate, {
        mode: nextMode,
        darkThreshold: nextThreshold,
      });
      setPatterns(p);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCameraCapture = async (dataUrl: string, file: File) => {
    setShowCamera(false);
    setLocalImageSrc(dataUrl);
    setIsLoading(true);
    try {
      const sampleRate = detectionMode === "photo" ? 20 : 8;
      const p = await analyzeImage(file, sampleRate, { mode: detectionMode, darkThreshold });
      setPatterns(p);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePlay = async () => {
    if (!patterns || !sonifier || isPlaying) return;
    setIsLoading(true);
    setIsPlaying(true);
    setActiveElementIndex(null);
    setRecordingReady(null);
    try {
      await sonifier.sonify(patterns, playMode, (index) => {
        setActiveElementIndex(index);
      });
    } catch (error) {
      console.error("Sonification failed:", error);
      alert(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsLoading(false);
      setIsPlaying(false);
      setActiveElementIndex(null);
    }
  };

  const handleStop = async () => {
    setIsPlaying(false);
    setActiveElementIndex(null);
    if (sonifier) {
      await sonifier.stop();
      setSonifier(new Sonifier(config));
    }
  };

  const handleRecord = async () => {
    if (!patterns || isPlaying || isRecording) return;
    setRecordingReady(null);

    const canvas = visualizerRef.current?.getCanvas();
    if (!canvas) { alert("Canvas not ready."); return; }

    const recSonifier = new Sonifier(config);
    await recSonifier.initialize();

    const hasWebCodecs =
      typeof VideoEncoder !== "undefined" &&
      typeof AudioEncoder !== "undefined" &&
      typeof VideoFrame !== "undefined" &&
      typeof AudioData !== "undefined";

    if (hasWebCodecs) {
      await recordMp4(canvas, recSonifier);
    } else {
      await recordWebm(recSonifier);
    }
  };

  const recordMp4 = async (canvas: HTMLCanvasElement, recSonifier: Sonifier) => {
    const W = canvas.width || 900;
    const H = canvas.height || 600;

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
      bitrate: 2_500_000,
      framerate: 30,
    });

    // Use a fresh AudioContext to capture from the Sonifier's media stream
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

    // Tap audio from Sonifier output
    const audioStream = recSonifier.getAudioStream();
    let cleanupAudio = () => {};
    let audioTimestamp = 0;

    if (audioStream) {
      const source = captureCtx.createMediaStreamSource(audioStream);
      const bufSize = 4096;
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const scriptNode = captureCtx.createScriptProcessor(bufSize, 2, 2);
      scriptNode.onaudioprocess = (e) => {
        if (audioEncoder.state === "closed") return;
        const left = e.inputBuffer.getChannelData(0);
        const right = e.inputBuffer.getChannelData(1);
        const planar = new Float32Array(bufSize * 2);
        planar.set(left, 0);
        planar.set(right, bufSize);
        try {
          const audioData = new AudioData({
            format: "f32-planar",
            sampleRate: captureCtx.sampleRate,
            numberOfFrames: bufSize,
            numberOfChannels: 2,
            timestamp: audioTimestamp,
            data: planar,
          });
          audioEncoder.encode(audioData);
          audioData.close();
        } catch (err) {
          console.warn("Audio encode error:", err);
        }
        audioTimestamp += Math.round(bufSize * (1_000_000 / captureCtx.sampleRate));
      };
      source.connect(scriptNode);
      scriptNode.connect(captureCtx.destination);
      cleanupAudio = () => {
        try { source.disconnect(); } catch { /* ignore */ }
        try { scriptNode.disconnect(); } catch { /* ignore */ }
      };
    }

    // Capture canvas frames at 30 fps
    let frameCount = 0;
    const recStart = performance.now();
    const captureInterval = setInterval(() => {
      if (videoEncoder.state === "closed" || videoEncoder.encodeQueueSize > 20) return;
      const timestamp = Math.round((performance.now() - recStart) * 1000);
      try {
        const frame = new VideoFrame(canvas, { timestamp });
        videoEncoder.encode(frame, { keyFrame: frameCount % 150 === 0 });
        frame.close();
        frameCount++;
      } catch (err) {
        console.warn("Video frame error:", err);
      }
    }, 1000 / 30);

    setIsRecording(true);
    setIsPlaying(true);
    setActiveElementIndex(null);

    try {
      await recSonifier.sonify(patterns!, playMode, (index) => {
        setActiveElementIndex(index);
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
        const url = URL.createObjectURL(blob);
        setRecordingReady(url);
        setRecordingExt("mp4");
      } catch (err) {
        console.error("MP4 finalization failed:", err);
        alert("MP4 encoding failed. Try recording again.");
      }

      recSonifier.stop();
      setIsRecording(false);
      setIsPlaying(false);
      setActiveElementIndex(null);
    }
  };

  const recordWebm = async (recSonifier: Sonifier) => {
    const audioStream = recSonifier.getAudioStream();
    const videoStream = visualizerRef.current?.getCanvasStream() ?? null;

    if (!audioStream || !videoStream) {
      alert("Could not get streams for recording.");
      recSonifier.stop();
      return;
    }

    const combined = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...audioStream.getAudioTracks(),
    ]);

    const mimeType = ["video/webm;codecs=vp8,opus", "video/webm"].find((t) =>
      MediaRecorder.isTypeSupported(t)
    ) ?? "video/webm";

    const chunks: Blob[] = [];
    const mr = new MediaRecorder(combined, { mimeType });
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    mr.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      setRecordingReady(url);
      setRecordingExt("webm");
      setIsRecording(false);
      recSonifier.stop();
    };

    mr.start(100);
    setIsRecording(true);
    setIsPlaying(true);
    setActiveElementIndex(null);

    try {
      await recSonifier.sonify(patterns!, playMode, (index) => {
        setActiveElementIndex(index);
      });
    } finally {
      if (mr.state !== "inactive") mr.stop();
      setIsPlaying(false);
      setActiveElementIndex(null);
    }
  };

  const displaySrc = localImageSrc || imageSrc;
  if (!patterns || !displaySrc) return null;

  return (
    <div className={styles.container}>
      {/* Big central visualizer */}
      <div className={styles.visualizerWrap}>
        <SonificationVisualizer
          ref={visualizerRef}
          patterns={patterns}
          imageSrc={displaySrc}
          config={config}
          activeElementIndex={activeElementIndex}
          visualStyle={visualStyle}
        />
      </div>

      {/* Stats row */}
      <div className={styles.statsRow}>
        <span className={styles.stat}>
          <span className={styles.statLabel}>elements</span>
          {patterns.elements.length}
        </span>
        <span className={styles.stat}>
          <span className={styles.statLabel}>density</span>
          {(patterns.avgDensity * 100).toFixed(1)}%
        </span>
        <span className={styles.stat}>
          <span className={styles.statLabel}>variation</span>
          {(patterns.densityVariation * 100).toFixed(1)}%
        </span>
      </div>

      {/* Controls strip */}
      <div className={styles.controlsStrip}>
        <div className={styles.modeToggle}>
          <button
            className={detectionMode === "drawing" ? styles.modeActive : styles.modeBtn}
            onClick={() => { setDetectionMode("drawing"); handleReanalyze("drawing", darkThreshold); }}
            disabled={isPlaying || isLoading}
          >Drawing</button>
          <button
            className={detectionMode === "photo" ? styles.modeActive : styles.modeBtn}
            onClick={() => { setDetectionMode("photo"); handleReanalyze("photo", darkThreshold); }}
            disabled={isPlaying || isLoading}
          >Photo</button>
          <button
            className={detectionMode === "tattoo" ? styles.modeActive : styles.modeBtn}
            onClick={() => { setDetectionMode("tattoo"); handleReanalyze("tattoo", darkThreshold); }}
            disabled={isPlaying || isLoading}
          >Tattoo</button>
        </div>

        <div className={styles.modeToggle}>
          <button className={visualStyle === "dots" ? styles.modeActive : styles.modeBtn}
            onClick={() => setVisualStyle("dots")} disabled={isPlaying}>Dots</button>
          <button className={visualStyle === "living" ? styles.modeActive : styles.modeBtn}
            onClick={() => setVisualStyle("living")} disabled={isPlaying}>Living</button>
          <button className={visualStyle === "pulse" ? styles.modeActive : styles.modeBtn}
            onClick={() => setVisualStyle("pulse")} disabled={isPlaying}>Pulse</button>
          <button className={styles.modeBtn} onClick={() => setShowCamera(true)}
            disabled={isPlaying || isLoading}>📷</button>
        </div>

        <div className={styles.param}>
          <label>Threshold</label>
          <input type="range" min="0.1" max="0.9" step="0.05" value={darkThreshold}
            onChange={(e) => setDarkThreshold(Number(e.target.value))}
            onMouseUp={() => handleReanalyze(detectionMode, darkThreshold)}
            onTouchEnd={() => handleReanalyze(detectionMode, darkThreshold)}
            disabled={isPlaying || isLoading} />
          <span>{(darkThreshold * 100).toFixed(0)}%</span>
        </div>

        <div className={styles.param}>
          <label>Reverb</label>
          <input type="range" min="0" max="1" step="0.05" value={config.reverbWet}
            onChange={(e) => setConfig({ ...config, reverbWet: Number(e.target.value) })}
            disabled={isPlaying} />
          <span>{(config.reverbWet * 100).toFixed(0)}%</span>
        </div>
        <div className={styles.param}>
          <label>Tempo</label>
          <input type="range" min="30" max="180" value={config.tempo}
            onChange={(e) => setConfig({ ...config, tempo: Number(e.target.value) })}
            disabled={isPlaying} />
          <span>{config.tempo} bpm</span>
        </div>
        <div className={styles.param}>
          <label>Grain</label>
          <input type="range" min="10" max="200" value={config.grainDuration}
            onChange={(e) => setConfig({ ...config, grainDuration: Number(e.target.value) })}
            disabled={isPlaying} />
          <span>{config.grainDuration}ms</span>
        </div>

        <div className={styles.modeToggle}>
          <button className={playMode === "batch" ? styles.modeActive : styles.modeBtn}
            onClick={() => setPlayMode("batch")} disabled={isPlaying}>Batch</button>
          <button className={playMode === "realtime" ? styles.modeActive : styles.modeBtn}
            onClick={() => setPlayMode("realtime")} disabled={isPlaying}>Live</button>
        </div>
      </div>

      {/* Play / Record row */}
      <div className={styles.playRow}>
        {isPlaying ? (
          <button className={styles.stopBtn} onClick={handleStop}>■ Stop</button>
        ) : (
          <>
            <button className={styles.playBtn} onClick={handlePlay} disabled={isLoading || isRecording}>
              {isLoading ? "…" : "▶ Play"}
            </button>
            <button
              className={styles.recordBtn}
              onClick={handleRecord}
              disabled={isLoading || isRecording}
            >
              ⏺ Record
            </button>
          </>
        )}
        {recordingReady && !isPlaying && !isRecording && (
          <a
            className={styles.downloadBtn}
            href={recordingReady}
            download={`sonification.${recordingExt}`}
          >
            ↓ Download {recordingExt.toUpperCase()}
          </a>
        )}
        <button
          className={styles.reelBtn}
          onClick={() => setShowReel(true)}
          disabled={isPlaying || isRecording}
        >
          ▨ Reel
        </button>
      </div>

      {showReel && patterns && (
        <ReelRecorder
          patterns={patterns}
          imageSrc={displaySrc}
          config={config}
          playMode={playMode}
          visualStyle={visualStyle}
          onClose={() => setShowReel(false)}
        />
      )}
      {showCamera && (
        <CameraCapture
          onCapture={handleCameraCapture}
          onClose={() => setShowCamera(false)}
        />
      )}
    </div>
  );
};
