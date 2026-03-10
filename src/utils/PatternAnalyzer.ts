/**
 * Pattern Analyzer
 * Extracts repeating patterns and their characteristics from images
 */

export interface PatternElement {
  x: number;
  y: number;
  size: number;
  intensity: number; // 0-1, brightness
  hue: number; // 0-360
  saturation: number; // 0-1
  density: number; // local density of elements
}

export interface PatternData {
  elements: PatternElement[];
  width: number;
  height: number;
  avgDensity: number;
  densityVariation: number;
}

export interface AnalyzeOptions {
  sampleRate?: number;
  /** 0–1: pixels darker than this threshold are detected (drawing mode) */
  darkThreshold?: number;
  /** "drawing" detects dark marks; "photo" detects edges/contrast; "tattoo" detects dark desaturated ink */
  mode?: "drawing" | "photo" | "tattoo";
}

export async function analyzeImage(
  imageFile: File,
  sampleRate: number = 20,
  options?: AnalyzeOptions
): Promise<PatternData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e: ProgressEvent<FileReader>) => {
      try {
        const img = new Image();
        img.onload = () => {
          const data = extractPatterns(img, sampleRate, options);
          resolve(data);
        };
        img.onerror = () => reject(new Error("Failed to load image"));
        img.src = e.target?.result as string;
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(imageFile);
  });
}

function extractPatterns(
  img: HTMLImageElement,
  sampleRate: number,
  options?: AnalyzeOptions
): PatternData {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) throw new Error("Cannot get 2D context from canvas");

  canvas.width = img.width;
  canvas.height = img.height;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  const elements: PatternElement[] = [];
  const elementGrid = new Map<string, number>();

  const detectionMode = options?.mode ?? "drawing";
  // darkThreshold: 0 = only pick very dark pixels, 1 = pick everything
  const darkThreshold = options?.darkThreshold ?? 0.5;

  // Sample pixels at regular intervals
  for (let y = 0; y < canvas.height; y += sampleRate) {
    for (let x = 0; x < canvas.width; x += sampleRate) {
      const pixelIndex = (y * canvas.width + x) * 4;
      const r = data[pixelIndex];
      const g = data[pixelIndex + 1];
      const b = data[pixelIndex + 2];
      const a = data[pixelIndex + 3];

      if (a < 128) continue; // Skip transparent pixels

      // Convert RGB to HSL
      const [hue, saturation, intensity] = rgbToHsl(r, g, b);

      let include = false;

      if (detectionMode === "drawing") {
        // Drawing mode: detect dark marks below threshold
        include = intensity < darkThreshold;
      } else if (detectionMode === "tattoo") {
        // Tattoo ink: dark AND desaturated (ink is near-black/grey vs warm skin)
        include = intensity < darkThreshold && saturation < 0.35;
      } else {
        // Photo mode: detect high-contrast edges (local variation), ignoring flat areas
        const localContrast = calculateLocalContrast(data, canvas.width, canvas.height, x, y);
        include = localContrast > (1 - darkThreshold) * 80;
      }

      if (include) {
        elements.push({
          x: x / canvas.width, // Normalize to 0-1
          y: y / canvas.height,
          size: calculateLocalSize(data, canvas.width, canvas.height, x, y),
          intensity,
          hue,
          saturation,
          density: 0, // Will calculate after
        });

        // Track grid density
        const gridKey = `${Math.floor(x / 50)},${Math.floor(y / 50)}`;
        elementGrid.set(gridKey, (elementGrid.get(gridKey) || 0) + 1);
      }
    }
  }

  // Calculate local density for each element
  elements.forEach((elem) => {
    const gridKey = `${Math.floor(elem.x * canvas.width / 50)},${Math.floor(
      elem.y * canvas.height / 50
    )}`;
    elem.density = (elementGrid.get(gridKey) || 0) / 10; // Normalize
  });

  // Calculate average density and variation
  const densities = elements.map((e) => e.density);
  const avgDensity =
    densities.reduce((a, b) => a + b, 0) / densities.length || 0;
  const variance =
    densities.reduce((sum, d) => sum + Math.pow(d - avgDensity, 2), 0) /
    densities.length;
  const densityVariation = Math.sqrt(variance);

  return {
    elements,
    width: canvas.width,
    height: canvas.height,
    avgDensity,
    densityVariation,
  };
}

function rgbToHsl(
  r: number,
  g: number,
  b: number
): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return [h * 360, s, l];
}

function calculateLocalContrast(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number
): number {
  let maxDiff = 0;
  const centerIdx = (y * width + x) * 4;
  const centerL = (data[centerIdx] + data[centerIdx + 1] + data[centerIdx + 2]) / 3;

  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nIdx = (ny * width + nx) * 4;
        const nL = (data[nIdx] + data[nIdx + 1] + data[nIdx + 2]) / 3;
        maxDiff = Math.max(maxDiff, Math.abs(centerL - nL));
      }
    }
  }
  return maxDiff; // 0–255
}

function calculateLocalSize(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number
): number {
  // Calculate size based on local color variation
  let maxDist = 0;
  const threshold = 20;

  for (let dy = -10; dy <= 10; dy++) {
    for (let dx = -10; dx <= 10; dx++) {
      const nx = x + dx;
      const ny = y + dy;

      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const centerIdx = (y * width + x) * 4;
        const neighborIdx = (ny * width + nx) * 4;

        const dr = data[centerIdx] - data[neighborIdx];
        const dg = data[centerIdx + 1] - data[neighborIdx + 1];
        const db = data[centerIdx + 2] - data[neighborIdx + 2];

        const dist = Math.sqrt(dr * dr + dg * dg + db * db);
        if (dist > threshold) {
          maxDist = Math.max(maxDist, Math.sqrt(dx * dx + dy * dy));
        }
      }
    }
  }

  return Math.min(maxDist / 15, 1); // Normalize to 0-1
}
