# brazen — sonification

Transform drawings and tattoos into sound.

**Live:** [mercymercymercy666.github.io/sonification-time](https://mercymercymercy666.github.io/sonification-time/)

---

## What it does

Upload a drawing, photo, or tattoo image. The app scans it left to right, turning marks into music — position maps to pitch, darkness to volume, density to harmony.

## Features

- **Drawing / Photo / Tattoo modes** — detects dark ink marks, photo edges, or desaturated tattoo ink
- **Pentatonic scale + maj7/9 harmony** — always sounds musical
- **Three visual styles** — Dots, Living (image shows through), Pulse (expanding rings)
- **Batch & Realtime playback**
- **MP4 export** — record the visualizer as a video (H.264/AAC, works on iPhone)
- **Reel export** — 9:16 portrait video ready for Instagram Reels
- **Camera capture** — photograph a tattoo directly in the app

## How it maps sound

| Drawing property | Sound parameter |
|---|---|
| X position (left→right) | Time (plays first→last) |
| Y position (top→bottom) | Pitch (high→low) |
| Darkness | Velocity / loudness |
| Local density | Harmony (maj7, 9th) |
| Mark size | Note duration |

## Run locally

```bash
npm install
npm run dev
```

Open [localhost:5174](http://localhost:5174)

## Stack

- React 19 + TypeScript + Vite
- Tone.js (synthesis + effects)
- WebCodecs API + mp4-muxer (MP4 recording)
- Web Audio API

## Inspiration

Ligeti's *Artikulation* — a graphic score where visual marks become articulated sound.
