import React, { useState, useRef } from "react";
import { analyzeImage } from "../utils/PatternAnalyzer";
import type { PatternData } from "../utils/PatternAnalyzer";
import styles from "./ImageUpload.module.css";

interface ImageUploadProps {
  onPatternAnalyzed: (patterns: PatternData, imageSrc: string, file: File) => void;
  isLoading?: boolean;
}

export const ImageUpload: React.FC<ImageUploadProps> = ({
  onPatternAnalyzed,
  isLoading = false,
}) => {
  const [preview, setPreview] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setAnalyzing(true);
    try {
      // Read the file to a data URL first, then use it for both preview and parent
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });

      setPreview(dataUrl);

      const patterns = await analyzeImage(file, 8);
      onPatternAnalyzed(patterns, dataUrl, file);
    } catch (error) {
      console.error("Failed to analyze image:", error);
      alert("Failed to analyze image. Please try another file.");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.classList.add(styles.dragOver);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.currentTarget.classList.remove(styles.dragOver);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.classList.remove(styles.dragOver);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.type.startsWith("image/")) {
        if (fileInputRef.current) {
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(file);
          fileInputRef.current.files = dataTransfer.files;
          handleFileSelect({
            target: fileInputRef.current,
          } as React.ChangeEvent<HTMLInputElement>);
        }
      }
    }
  };

  return (
    <div className={styles.container}>
      <div
        className={styles.uploadArea}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          disabled={isLoading || analyzing}
          style={{ display: "none" }}
        />

        {preview ? (
          <div className={styles.preview}>
            <img src={preview} alt="Preview" />
            {analyzing && <div className={styles.analyzing}>Analyzing...</div>}
          </div>
        ) : (
          <div className={styles.uploadPrompt}>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading || analyzing}
              className={styles.uploadButton}
            >
              {analyzing ? "Analyzing..." : "Upload an image"}
            </button>
            <p>or drag and drop your drawing here</p>
          </div>
        )}
      </div>
    </div>
  );
};
