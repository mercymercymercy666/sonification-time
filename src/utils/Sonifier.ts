/**
 * Sonifier
 * Converts pattern data into sound using Tone.js
 * Maps: y-position → pitch (pentatonic scale), x-position → time,
 *       size → duration, density → harmony, intensity → velocity
 */

import * as Tone from "tone";
import type { PatternData, PatternElement } from "./PatternAnalyzer";

export interface SonificationConfig {
  minFrequency: number;
  maxFrequency: number;
  grainDuration: number;
  density: number;
  tempo: number;
  reverbWet: number;
}

export const DEFAULT_CONFIG: SonificationConfig = {
  minFrequency: 100,
  maxFrequency: 2000,
  grainDuration: 50,
  density: 0.5,
  tempo: 90,
  reverbWet: 0.35,
};

const PENTATONIC = ["C", "D", "E", "G", "A"];
const BASE_OCTAVE = 2;
const OCTAVE_RANGE = 4; // C2–A5

/** Map y position (0=top, 1=bottom) to a pentatonic note string */
export function yToNote(y: number): string {
  const totalNotes = PENTATONIC.length * OCTAVE_RANGE;
  const idx = Math.round((1 - y) * (totalNotes - 1));
  const clamped = Math.max(0, Math.min(totalNotes - 1, idx));
  const octave = BASE_OCTAVE + Math.floor(clamped / PENTATONIC.length);
  return `${PENTATONIC[clamped % PENTATONIC.length]}${octave}`;
}

function sizeToDuration(size: number): string {
  if (size > 0.7) return "4n";
  if (size > 0.4) return "8n";
  return "16n";
}

export class Sonifier {
  private synth: Tone.PolySynth<Tone.Synth> | null = null;
  private grainSynth: Tone.PolySynth<Tone.Synth> | null = null;
  private reverb: Tone.Reverb | null = null;
  private delay: Tone.PingPongDelay | null = null;
  private filter: Tone.Filter | null = null;
  private config: SonificationConfig;
  private isInitialized = false;
  private mediaStreamDest: MediaStreamAudioDestinationNode | null = null;

  constructor(config: SonificationConfig = DEFAULT_CONFIG) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      if (Tone.getContext().state !== "running") {
        await Tone.start();
      }

      // Main polyphonic synth — musical, sustained
      this.synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "triangle" },
        envelope: {
          attack: 0.06,   // slightly softer attack — chord tones blend in
          decay: 0.15,
          sustain: 0.55,
          release: 2.2,   // longer tail lets maj7 hang in the air
        },
        volume: -6,
      });

      // Grain synth for realtime/texture mode
      this.grainSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: {
          attack: 0.001,
          decay: this.config.grainDuration / 1000,
          sustain: 0,
          release: 0.01,
        },
      });

      this.delay = new Tone.PingPongDelay({
        delayTime: "8n",
        feedback: 0.25,
        wet: 0.15,
      });

      this.reverb = new Tone.Reverb({
        decay: 3,
        wet: this.config.reverbWet,
      });

      this.filter = new Tone.Filter({
        frequency: 2000,
        type: "lowpass",
      });

      // Audio graph: synth → delay → filter → reverb → out
      this.synth.connect(this.delay);
      this.grainSynth.connect(this.filter);
      this.delay.connect(this.filter);
      this.filter.connect(this.reverb);
      this.reverb.toDestination();

      // Also route audio to a MediaStream for recording
      const rawCtx = Tone.getContext().rawContext as AudioContext;
      this.mediaStreamDest = rawCtx.createMediaStreamDestination();
      Tone.getDestination().connect(this.mediaStreamDest);

      this.isInitialized = true;
    } catch (error) {
      console.error("Failed to initialize Sonifier:", error);
      throw error;
    }
  }

  getAudioStream(): MediaStream | null {
    return this.mediaStreamDest?.stream ?? null;
  }

  async sonify(
    patterns: PatternData,
    mode: "realtime" | "batch" = "batch",
    onElementPlay?: (sortedIndex: number) => void
  ): Promise<void> {
    await this.initialize();

    if (mode === "realtime") {
      await this.sonifyRealtime(patterns, onElementPlay);
    } else {
      await this.sonifyBatch(patterns, onElementPlay);
    }
  }

  private async sonifyBatch(
    patterns: PatternData,
    onElementPlay?: (sortedIndex: number) => void
  ): Promise<void> {
    if (!this.synth || !this.filter) return;

    // Sort left → right (x = time position)
    const sortedElements = [...patterns.elements].sort(
      (a, b) => a.x - b.x || a.y - b.y
    );

    const totalDuration = Math.max(
      sortedElements.length * 0.1,
      (sortedElements.length / (patterns.avgDensity || 1)) * 0.05
    );

    Tone.getTransport().bpm.value = this.config.tempo;
    Tone.getTransport().start();

    let maxTime = 0;

    sortedElements.forEach((elem, index) => {
      const delayFraction = index / Math.max(sortedElements.length, 1);
      const delayTime = delayFraction * totalDuration;
      maxTime = Math.max(maxTime, delayTime);

      Tone.getTransport().schedule((time) => {
        const note = yToNote(elem.y);
        const duration = sizeToDuration(elem.size);
        // Darker marks = louder
        const velocity = Math.max(0.2, Math.min(1, 0.3 + (1 - elem.intensity) * 0.8));

        onElementPlay?.(index);

        this.synth?.triggerAttackRelease(note, duration, time, velocity);

        // Maj7 voicing: layer chord tones at low velocity based on density
        if (elem.density > 0.4) {
          const freq = Tone.Frequency(note);
          // Major 3rd (+4) — warm, fills in the triad
          const third = freq.transpose(4).toNote();
          // Perfect 5th (+7) — stable foundation
          const fifth = freq.transpose(7).toNote();
          // Major 7th (+11) — the floating, cinematic quality
          const maj7 = freq.transpose(11).toNote();

          this.synth?.triggerAttackRelease(third, duration, time, velocity * 0.22);
          this.synth?.triggerAttackRelease(fifth, duration, time, velocity * 0.28);
          this.synth?.triggerAttackRelease(maj7, duration, time, velocity * 0.18);

          // 9th (+14) only for the densest/most prominent elements
          if (elem.density > 0.65) {
            const ninth = freq.transpose(14).toNote();
            this.synth?.triggerAttackRelease(ninth, duration, time, velocity * 0.13);
          }
        }

        // Granular texture for very dense elements
        if (elem.density > 0.3) {
          this.addGranularTextureScheduled(elem, time);
        }
      }, delayTime);
    });

    await new Promise((resolve) => {
      setTimeout(() => {
        Tone.getTransport().stop();
        resolve(null);
      }, (maxTime + 3) * 1000);
    });
  }

  private addGranularTextureScheduled(elem: PatternElement, time: number) {
    if (!this.grainSynth) return;

    const grainCount = Math.ceil(elem.density * 6);
    const baseNote = yToNote(elem.y);
    const baseFreq = Tone.Frequency(baseNote).toFrequency();

    for (let i = 0; i < grainCount; i++) {
      const grainDelay = Math.random() * 0.1;
      const grainFreq = baseFreq * (0.95 + Math.random() * 0.1);
      const grainTime = time + grainDelay;
      const grainVelocity = Math.max(0.05, elem.size * 0.15);

      this.grainSynth.triggerAttackRelease(
        grainFreq,
        this.config.grainDuration / 1000,
        grainTime,
        grainVelocity
      );
    }
  }

  private async sonifyRealtime(
    patterns: PatternData,
    onElementPlay?: (sortedIndex: number) => void
  ): Promise<void> {
    if (!this.grainSynth) return;

    const clusters = this.clusterElements(patterns.elements);

    Tone.getTransport().start();

    let totalTime = 0;

    for (let clusterIdx = 0; clusterIdx < clusters.length; clusterIdx++) {
      const cluster = clusters[clusterIdx];
      const clusterDuration = this.calculateArticulation(cluster);
      const clusterStartTime = totalTime;
      totalTime += clusterDuration;

      cluster.forEach((elem, elemIdx) => {
        const offset =
          (elemIdx / Math.max(cluster.length, 1)) * clusterDuration * 0.5;

        Tone.getTransport().schedule((time) => {
          const note = yToNote(elem.y);
          const velocity = Math.max(0.1, elem.size * 0.3 + 0.2);

          onElementPlay?.(clusterIdx);

          if (this.grainSynth) {
            this.grainSynth.triggerAttackRelease(
              note,
              this.config.grainDuration / 1000,
              time,
              velocity
            );
          }
        }, clusterStartTime + offset);
      });
    }

    await new Promise((resolve) => {
      setTimeout(() => {
        Tone.getTransport().stop();
        resolve(null);
      }, (totalTime + 1) * 1000);
    });
  }

  private clusterElements(
    elements: PatternElement[],
    clusterDistance: number = 0.15
  ): PatternElement[][] {
    if (!elements.length) return [];

    const clusters: PatternElement[][] = [];
    const visited = new Set<number>();

    elements.forEach((elem, i) => {
      if (visited.has(i)) return;

      const cluster = [elem];
      visited.add(i);

      elements.forEach((other, j) => {
        if (!visited.has(j)) {
          const dist = Math.sqrt(
            Math.pow(elem.x - other.x, 2) + Math.pow(elem.y - other.y, 2)
          );
          if (dist < clusterDistance) {
            cluster.push(other);
            visited.add(j);
          }
        }
      });

      clusters.push(cluster);
    });

    return clusters;
  }

  private calculateArticulation(elements: PatternElement[]): number {
    const avgDensity =
      elements.reduce((sum, e) => sum + e.density, 0) / elements.length;
    return 0.5 + avgDensity * 1.5;
  }

  async stop(): Promise<void> {
    Tone.getTransport().stop();
    Tone.getTransport().cancel();

    if (this.synth) {
      this.synth.dispose();
      this.synth = null;
    }
    if (this.grainSynth) {
      this.grainSynth.dispose();
      this.grainSynth = null;
    }
    if (this.delay) {
      this.delay.dispose();
      this.delay = null;
    }
    if (this.reverb) {
      this.reverb.dispose();
      this.reverb = null;
    }
    if (this.filter) {
      this.filter.dispose();
      this.filter = null;
    }
    if (this.mediaStreamDest) {
      this.mediaStreamDest.disconnect();
      this.mediaStreamDest = null;
    }
    this.isInitialized = false;
  }
}
