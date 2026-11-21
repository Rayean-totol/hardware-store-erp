'use client';

import { Alert, Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@erp/ui';
import { Camera } from 'lucide-react';
import * as React from 'react';
import { useI18n } from '@/providers/i18n-provider';

/** What this browser can do. Pure, so the rules are unit-tested without a camera. */
export type ScanSupport = 'ready' | 'no_detector' | 'no_camera' | 'insecure';

export function scanSupport(env: { hasDetector: boolean; hasCamera: boolean; isSecureContext: boolean }): ScanSupport {
  if (!env.isSecureContext) return 'insecure';
  if (!env.hasCamera) return 'no_camera';
  if (!env.hasDetector) return 'no_detector';
  return 'ready';
}

/** Minimal typing for the Barcode Detection API (not in every TypeScript lib). */
interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike;

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];

export function currentScanSupport(): ScanSupport {
  if (typeof window === 'undefined') return 'no_camera';
  return scanSupport({
    hasDetector: 'BarcodeDetector' in window,
    hasCamera: typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function',
    isSecureContext: window.isSecureContext,
  });
}

/**
 * Camera barcode scanning. The camera starts only after the user taps the button, and stops as soon
 * as a code is read, the dialog is closed, or the page is left. Where the camera or the detector is
 * not available, the button is not shown; typed input and keyboard scanners still work.
 */
export function BarcodeScanner({ onScan, disabled }: { onScan: (code: string) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const [support, setSupport] = React.useState<ScanSupport | null>(null);
  const [open, setOpen] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const timerRef = React.useRef<number | null>(null);
  // The latest callback, so re-renders of the parent do not restart the camera.
  const onScanRef = React.useRef(onScan);
  React.useEffect(() => {
    onScanRef.current = onScan;
  });

  React.useEffect(() => setSupport(currentScanSupport()), []);

  const stop = React.useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  React.useEffect(() => stop, [stop]);

  React.useEffect(() => {
    if (!open) {
      stop();
      return;
    }
    let cancelled = false;
    setMessage(null);
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!Detector) {
      setMessage(t('scan.unsupported'));
      return;
    }
    const detector = new Detector({ formats: FORMATS });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        void video.play().catch(() => undefined);
        timerRef.current = window.setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          try {
            const found = await detector.detect(videoRef.current);
            const code = found[0]?.rawValue?.trim();
            if (code) {
              onScanRef.current(code);
              setOpen(false);
            }
          } catch {
            // A frame that cannot be read is skipped; the scan keeps trying.
          }
        }, 300);
      })
      .catch(() => setMessage(t('scan.no_permission')));
    return () => {
      cancelled = true;
      stop();
    };
  }, [open, stop, t]);

  if (support !== 'ready') return null;

  return (
    <>
      <Button type="button" variant="outline" size="icon" className="size-11 shrink-0" disabled={disabled}
        aria-label={t('scan.open')} title={t('scan.open')} onClick={() => setOpen(true)}>
        <Camera aria-hidden="true" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={t('common.close')}>
          <DialogTitle>{t('scan.title')}</DialogTitle>
          <DialogDescription>{t('scan.hint')}</DialogDescription>
          {message ? <Alert variant="warning">{message}</Alert> : null}
          <video ref={videoRef} playsInline muted className="aspect-video w-full rounded-md bg-black object-cover" aria-label={t('scan.title')} />
        </DialogContent>
      </Dialog>
    </>
  );
}
