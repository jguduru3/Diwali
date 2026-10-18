import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, cx } from './ui';

type Detector = {
  detect: (src: CanvasImageSource | ImageBitmap) => Promise<{ rawValue: string }[]>;
};
type DetectorCtor = new (o: { formats: string[] }) => Detector;

/** Product barcodes the packer scans (EAN/UPC on boxes, Code 128/39 on shop labels). */
const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];

function nativeDetector(mode: 'qr' | 'barcode'): Detector | null {
  const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  return Ctor ? new Ctor({ formats: mode === 'qr' ? ['qr_code'] : BARCODE_FORMATS }) : null;
}

/**
 * Reads a QR (or, in barcode mode, a product barcode) with the camera
 * (BarcodeDetector, falling back to ZXing), from a photo, or from typed/pasted
 * text — a handheld scanner types into the box too — so the counter, packing
 * and gate keep working without a camera. Decoding happens on the device.
 * `continuous` keeps the camera on between reads (packing many items).
 */
export function QrScanner({
  onResult,
  manualLabel,
  manualPlaceholder,
  dark = false,
  busy = false,
  mode = 'qr',
  continuous = false,
  autoFocus = false,
}: {
  onResult: (text: string) => void;
  manualLabel: string;
  manualPlaceholder: string;
  dark?: boolean;
  busy?: boolean;
  mode?: 'qr' | 'barcode';
  continuous?: boolean;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const [scanning, setScanning] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const handled = useRef(false);
  const last = useRef<{ text: string; at: number } | null>(null);

  const stop = () => {
    stopRef.current?.();
    stopRef.current = null;
    setScanning(false);
  };
  useEffect(() => stop, []);

  const deliver = (text: string, fromCamera = false) => {
    if (continuous && fromCamera) {
      // Same code seen again within 1.5 s is the same unit still in view.
      const now = Date.now();
      if (last.current && last.current.text === text && now - last.current.at < 1500) return;
      last.current = { text, at: now };
      onResult(text.trim());
      return;
    }
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
      const native = nativeDetector(mode);
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
            if (hit?.rawValue) {
              deliver(hit.rawValue, true);
              if (!continuous) return;
            }
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
      const zxing = await import('@zxing/browser');
      const reader =
        mode === 'qr' ? new zxing.BrowserQRCodeReader() : new zxing.BrowserMultiFormatReader();
      setScanning(true);
      const controls = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current!,
        (result) => {
          if (result) deliver(result.getText(), true);
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
      const native = nativeDetector(mode);
      if (native) {
        const [hit] = await native.detect(await createImageBitmap(file));
        if (hit?.rawValue) return deliver(hit.rawValue);
      }
      const zxing = await import('@zxing/browser');
      const url = URL.createObjectURL(file);
      try {
        const reader =
          mode === 'qr' ? new zxing.BrowserQRCodeReader() : new zxing.BrowserMultiFormatReader();
        const result = await reader.decodeFromImageUrl(url);
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
          autoFocus={autoFocus}
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
