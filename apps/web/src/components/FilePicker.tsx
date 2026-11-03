import { useState, type InputHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { checkPhoto, type PhotoIssue } from '../lib/photoQuality';

/**
 * File field in the app's language. The browser's own "Choose file / No file chosen" text follows
 * the browser's language, not the one picked in the app, so the native control is hidden and this
 * button and file name are shown instead. Put it inside a <Field> (a <label>): a tap anywhere on
 * the field opens the picker, and the hidden input keeps keyboard focus with a visible ring.
 * A chosen photo is checked on the device; a dark, glaring or blurry one gets a retake prompt.
 */
export function FilePicker({
  fileName,
  ...input
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> & {
  fileName?: string | null;
}) {
  const { t } = useTranslation();
  const [issue, setIssue] = useState<PhotoIssue | null>(null);
  const { onChange, ...rest } = input;
  return (
    <span className="mt-1.5 block">
      <input
        {...rest}
        type="file"
        className="peer sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          setIssue(null);
          if (file) void checkPhoto(file).then(setIssue);
          onChange?.(e);
        }}
      />
      <span className="flex min-h-11 items-center gap-3 rounded-xl border border-line-strong bg-white px-2 py-1.5 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-plum">
        <span className="inline-flex min-h-9 shrink-0 items-center rounded-lg bg-brand-050 px-3 text-[13px] font-semibold text-plum">
          {t('common.chooseFile')}
        </span>
        <span className="min-w-0 truncate text-sm font-normal text-muted">
          {fileName || t('common.noFile')}
        </span>
      </span>
      <PhotoAdvice issue={issue} />
    </span>
  );
}

/** The retake prompt for a photo that failed the on-device check. */
export function PhotoAdvice({ issue }: { issue: PhotoIssue | null }) {
  const { t } = useTranslation();
  if (!issue) return null;
  return (
    <span role="status" className="mt-1.5 block text-xs font-normal text-saffron">
      {t(`photo.${issue}`)} {t('photo.retake')}
    </span>
  );
}
