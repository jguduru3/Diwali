import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, cx } from './ui';

type Detector = {
  detect: (src: CanvasImageSource | ImageBitmap) => Promise<{ rawValue: string }[]>;
};
type DetectorCtor = new (o: { formats: string[] }) => Detector;

function nativeDetector(): Detector | null {
  const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  return Ctor ? new Ctor({ formats: ['qr_code'] }) : null;
}

/**
 * Reads a QR with the camera (BarcodeDetector, falling back to ZXing), from a
 * photo, or from typed/pasted text — so the counter and gate keep working
 * when the camera is unavailable. Decoding happens entirely on the device.
 */
export function QrScanner({
  onResult,
  manualLabel,
  manualPlaceholder,
  dark = false,
  busy = false,
}: {
  onResult: (text: string) => void;
  manualLabel: string;
  manualPlaceholder: string;
  dark?: boolean;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const [scanning, setScanning] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const handled = useRef(false);

  const stop = () => {
    stopRef.current?.();
    stopRef.current = null;
    setScanning(false);
  };
  useEffect(() => stop, []);

  const deliver = (text: string) => {
    if (handled.current) return;
    handled.current = true;
    stop();
    onResult(text.trim());
    setTimeout(() => (handled.current = false), 800);
  };

  const start = async () => {
    setCamError(null);
    handled.current = false;
    try {
      const native = nativeDetector();
      if (native && navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
        });
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        let alive = true;
        const tick = async () => {
          if (!alive) return;
          try {
            const [hit] = await native.detect(video);
            if (hit?.rawValue) return deliver(hit.rawValue);
          } catch {
            // frame not ready
          }
          setTimeout(tick, 200);
        };
        stopRef.current = () => {
          alive = false;
          stream.getTracks().forEach((tr) => tr.stop());
        };
        setScanning(true);
        void tick();
        return;
      }
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      const reader = new BrowserQRCodeReader();
      setScanning(true);
      const controls = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current!,
        (result) => {
          if (result) deliver(result.getText());
        },
      );
      stopRef.current = () => controls.stop();
    } catch {
      setScanning(false);
      setCamError(t('scan.cameraError'));
    }
  };

  const fromPhoto = async (file: File | undefined) => {
    if (!file) return;
    setCamError(null);
    handled.current = false;
    try {
      const native = nativeDetector();
      if (native) {
        const [hit] = await native.detect(await createImageBitmap(file));
        if (hit?.rawValue) return deliver(hit.rawValue);
      }
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      const url = URL.createObjectURL(file);
      try {
        const result = await new BrowserQRCodeReader().decodeFromImageUrl(url);
        deliver(result.getText());
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch {
      setCamError(t('scan.noCode'));
    }
  };

  const submitManual = (e: FormEvent) => {
    e.preventDefault();
    if (manual.trim()) {
      handled.current = false;
      deliver(manual);
      setManual('');
    }
  };

  return (
    <div className="space-y-4">
      <div
        className={cx(
          'relative aspect-[4/3] w-full overflow-hidden rounded-3xl',
          dark ? 'bg-black/60 ring-1 ring-white/10' : 'bg-night',
          !scanning && 'hidden',
        )}
      >
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        <div className="pointer-events-none absolute inset-8 rounded-3xl border-4 border-gold/80 shadow-[0_0_0_9999px_rgb(20_12_36/0.45)]" />
        <Button variant="secondary" size="sm" className="absolute right-3 bottom-3" onClick={stop}>
          {t('scan.stop')}
        </Button>
      </div>

      {!scanning && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Button size="lg" onClick={start} disabled={busy} className="min-h-20 text-lg">
            <span aria-hidden className="text-2xl">
              ⌖
            </span>{' '}
            {t('scan.start')}
          </Button>
          <label
            className={cx(
              'flex min-h-20 cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-5 text-base font-semibold transition',
              dark
                ? 'border-white/25 text-white hover:bg-white/5'
                : 'border-plum/25 text-plum hover:bg-plum/5',
            )}
          >
            <span aria-hidden className="text-xl">
              🖼
            </span>{' '}
            {t('scan.photo')}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => {
                void fromPhoto(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      )}

      {camError && (
        <p
          role="alert"
          className={cx(
            'rounded-2xl px-4 py-3 text-sm',
            dark ? 'bg-danger/25 text-white' : 'bg-danger-soft text-danger',
          )}
        >
          {camError}
        </p>
      )}

      <form onSubmit={submitManual} className="flex gap-2">
        <label className="sr-only" htmlFor="manual-code">
          {manualLabel}
        </label>
        <Input
          id="manual-code"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder={manualPlaceholder}
          autoCapitalize="characters"
          autoComplete="off"
          className={cx(
            'mt-0 font-mono tracking-wider',
            dark && 'border-white/20 bg-white/10 text-white placeholder:text-white/40',
          )}
        />
        <Button type="submit" variant={dark ? 'primary' : 'dark'} disabled={busy || !manual.trim()}>
          {t('scan.go')}
        </Button>
      </form>
    </div>
  );
}
