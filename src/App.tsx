import { useState, useRef } from 'react'
import type { PatternData } from './utils/PatternAnalyzer'
import { ImageUpload } from './components/ImageUpload'
import { SonificationController } from './components/SonificationController'
import { analyzeImage } from './utils/PatternAnalyzer'
import './App.css'

function App() {
  const [patterns, setPatterns] = useState<PatternData | null>(null)
  const [imageSrc, setImageSrc] = useState<string>('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [reloading, setReloading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handlePatternAnalyzed = (patterns: PatternData, imageSrc: string, file: File) => {
    setPatterns(patterns)
    setImageSrc(imageSrc)
    setImageFile(file)
  }

  const handleChangeImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setReloading(true)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = (ev) => resolve(ev.target?.result as string)
        reader.onerror = () => reject(new Error('Failed to read file'))
        reader.readAsDataURL(file)
      })
      const p = await analyzeImage(file, 8)
      setPatterns(p)
      setImageSrc(dataUrl)
      setImageFile(file)
    } finally {
      setReloading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const hasImage = !!patterns && !!imageSrc

  return (
    <div className="app">
      {!hasImage ? (
        <>
          <header className="header">
            <h1>Drawing Sonification</h1>
            <p>Transform your drawing into sound</p>
          </header>
          <main className="main">
            <ImageUpload onPatternAnalyzed={handlePatternAnalyzed} />
          </main>
        </>
      ) : (
        <main className="main mainLoaded">
          <div className="topBar">
            <span className="appTitle">Drawing Sonification</span>
            <label className="changeBtn">
              {reloading ? 'loading…' : '↺ change image'}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleChangeImage}
                style={{ display: 'none' }}
              />
            </label>
          </div>
          <SonificationController
            patterns={patterns}
            imageSrc={imageSrc}
            imageFile={imageFile}
          />
        </main>
      )}
    </div>
  )
}

export default App
