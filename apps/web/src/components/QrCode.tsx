import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** Crisp SVG QR. Payloads use QR alphanumeric characters only (SPEC §7), so they stay small. */
export function QrCode({
  text,
  label,
  className,
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let alive = true;
    QRCode.toString(text, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      color: { dark: '#140c24', light: '#ffffff' },
    })
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(''));
    return () => {
      alive = false;
    };
  }, [text]);
  return (
    <div
      role="img"
      aria-label={label}
      className={className}
      // qrcode returns a self-contained <svg>; the input is our own encoded payload.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
