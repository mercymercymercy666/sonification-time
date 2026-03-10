# Drawing Sonification

Transform your repeating patterns into sound. Upload hand-drawn images with systematic designs and sonify them using granular synthesis inspired by Ligeti's Artikulation.

## Features

- **Image Upload**: Upload PNG, JPG, or other image files containing your pattern designs
- **Pattern Analysis**: Automatically detects and analyzes repeating patterns and their characteristics
- **Real-time & Batch Sonification**:
  - **Batch Mode**: Processes the entire pattern as a coherent composition
  - **Real-time Mode**: Plays clustered patterns as articulated granular textures
- **Sound Design Controls**:
  - Frequency range (Hz)
  - Grain duration for granular texture
  - Reverb/Space
  - Tempo control

## How It Works

The sonification engine maps drawing characteristics to sound parameters:

- **Position (X)** → **Pitch/Frequency** - Horizontal position determines note pitch
- **Position (Y)** → **Filter Frequency** - Vertical position modulates the filter
- **Density** → **Granular Texture** - Dense regions create more grains and complex textures
- **Size/Shape** → **Amplitude & Articulation** - Element size controls volume and attack time
- **Color/Hue** → **Frequency Variation** - Color information adds micro-variations to pitch

## Getting Started

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

### Build for Production

```bash
npm run build
```

The build output will be in the `dist` folder.

## Project Structure

```
src/
├── components/
│   ├── ImageUpload.tsx          # Image upload and preview
│   └── SonificationController.tsx # Playback and parameter controls
├── utils/
│   ├── PatternAnalyzer.ts       # Image analysis and pattern extraction
│   └── Sonifier.ts              # Sound synthesis with Tone.js
├── App.tsx                       # Main application component
├── App.css                       # App styling
└── index.css                     # Global styles
```

## Technical Details

### Pattern Analyzer

- Samples pixels from the uploaded image at regular intervals
- Extracts HSL color values, position, and local density
- Calculates pattern statistics (density variation, etc.)

### Sonifier

- Uses **Tone.js** for Web Audio synthesis
- Implements granular synthesis for complex textures
- Provides both batch and real-time processing modes
- Includes reverb effects for spatial characteristics

### Sound Architecture

- **Main Synth**: Triangle wave synthesizer for primary melodic content
- **Grain Synth**: Polyphonic sine wave synthesizer for granular textures
- **Effects Chain**: Low-pass filter + reverb for tone shaping
- **Clustering**: Intelligently groups nearby elements for coherent articulation

## Inspiration

This tool is inspired by Ligeti's "Artikulation" and other works that emphasize dense, evolving textures created through systematic organization of elements.

## Requirements

- Modern browser with Web Audio API support
- Node.js 16+ for development

## License

MIT
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
