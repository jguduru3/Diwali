import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QrCode } from '../../components/QrCode';
import { Button, Card, Notice, Segmented } from '../../components/ui';
import { useShopContext } from '../../lib/queries';

/**
 * The shop's own QR (never changes) as a print-ready counter poster (A4) or entrance standee.
 * Print from the browser and choose "Save as PDF" for a file to take to a printer.
 */
export function Poster() {
  const { t } = useTranslation();
  const ctx = useShopContext();
  const [size, setSize] = useState<'a4' | 'standee'>('a4');
  if (!ctx.data) return null;
  const url = `${window.location.origin}/s/${ctx.data.shopCode}`;
  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-3">
        <Segmented<'a4' | 'standee'>
          label={t('poster.size')}
          value={size}
          onChange={setSize}
          options={[
            { value: 'a4', label: t('poster.a4') },
            { value: 'standee', label: t('poster.standee') },
          ]}
        />
        <Button onClick={() => window.print()}>{t('poster.print')}</Button>
      </div>
      <Notice className="no-print">{t('poster.help')}</Notice>
      <Card
        className={
          size === 'a4'
            ? 'print-area poster-a4 mx-auto flex aspect-[210/297] max-w-md flex-col items-center justify-between p-8 text-center'
            : 'print-area poster-standee mx-auto flex aspect-[2/5] max-w-xs flex-col items-center justify-between p-8 text-center'
        }
      >
        <p className="text-3xl leading-tight font-extrabold">{ctx.data.name}</p>
        <QrCode text={url} label={ctx.data.shopCode} className="w-full max-w-64" />
        <div className="space-y-1">
          <p className="text-2xl font-extrabold text-plum">{t('poster.headline')}</p>
          <p className="text-base">{t('poster.subline')}</p>
          <p className="text-sm text-muted">{url.replace(/^https?:\/\//, '')}</p>
        </div>
      </Card>
    </div>
  );
}
