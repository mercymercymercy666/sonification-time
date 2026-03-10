import { useRef, useEffect } from "react";
import styles from "./CameraCapture.module.css";

interface Props {
  onCapture: (dataUrl: string, file: File) => void;
  onClose: () => void;
}

export function CameraCapture({ onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } } })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => {
        alert("Camera access denied or unavailable.");
        onClose();
      });
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCapture = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const blob = await new Promise<Blob>((res) =>
      canvas.toBlob((b) => res(b!), "image/jpeg", 0.92)
    );
    const file = new File([blob], "camera.jpg", { type: "image/jpeg" });
    streamRef.current?.getTracks().forEach((t) => t.stop());
    onCapture(dataUrl, file);
  };

  return (
    <div className={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <span className={styles.title}>📷 Scan Tattoo</span>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={styles.video}
        />
        <div className={styles.hint}>Point camera at the tattoo, then capture</div>
        <div className={styles.controls}>
          <button className={styles.captureBtn} onClick={handleCapture}>
            ◉ Capture
          </button>
          <button className={styles.cancelBtn} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
