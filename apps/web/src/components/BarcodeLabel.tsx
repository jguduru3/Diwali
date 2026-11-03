import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ean13Modules, formatPaise, isValidEan13 } from '@pataka/shared';
import { Button } from './ui';

/** EAN-13 bars as SVG, with the digits underneath. Other codes are shown as text only. */
export function Barcode({ code, className }: { code: string; className?: string }) {
  if (!isValidEan13(code)) {
    return <span className="font-mono text-sm tracking-wider">{code}</span>;
  }
  const modules = ean13Modules(code);
  // Guard bars run longer, as on printed EAN-13 labels.
  const guard = (i: number) => i < 3 || (i >= 45 && i < 50) || i >= 92;
  return (
    <svg
      viewBox="0 0 113 66"
      role="img"
      aria-label={code}
      className={className}
      shapeRendering="crispEdges"
    >
      <rect width="113" height="66" fill="#fff" />
      {[...modules].map((m, i) =>
        m === '1' ? (
          <rect key={i} x={9 + i} y={2} width={1} height={guard(i) ? 54 : 48} fill="#000" />
        ) : null,
      )}
      <text x="4" y="63" fontSize="9" fontFamily="monospace">
        {code[0]}
      </text>
      <text x="14" y="63" fontSize="9" fontFamily="monospace" textLength="40">
        {code.slice(1, 7)}
      </text>
      <text x="60" y="63" fontSize="9" fontFamily="monospace" textLength="40">
        {code.slice(7)}
      </text>
    </svg>
  );
}

/**
 * A printable shelf / box label: name, price and barcode, sized for the shop's 58 mm thermal
 * printer (the same printer as bills). Opened as a modal dialog; only the label prints.
 */
export function BarcodeLabelDialog({
  name,
  code,
  pricePaise,
  detail,
  onClose,
}: {
  name: string;
  code: string;
  pricePaise: number;
  detail?: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal?.();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={t('prices.labelTitle')}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current.close()}
      className="m-auto w-[min(92vw,24rem)] rounded-3xl border border-line bg-white p-0 text-ink shadow-[var(--shadow-lift)] backdrop:bg-night/60"
    >
      <div className="space-y-4 p-6">
        <h2 className="no-print text-xl font-bold">{t('prices.labelTitle')}</h2>
        <div className="print-area rounded-xl border border-line p-3 text-center">
          <p className="text-sm leading-tight font-bold">{name}</p>
          {detail && <p className="text-xs text-muted">{detail}</p>}
          <Barcode code={code} className="mx-auto mt-2 w-full max-w-[16rem]" />
          <p className="mt-1 text-base font-extrabold tabular-nums">{formatPaise(pricePaise)}</p>
        </div>
        <p className="no-print text-sm text-muted">{t('prices.labelHint')}</p>
        <div className="no-print flex gap-2">
          <Button onClick={() => window.print()}>{t('prices.printLabel')}</Button>
          <Button variant="secondary" onClick={() => ref.current?.close()}>
            {t('common.close')}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
