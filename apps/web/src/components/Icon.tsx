import type { LucideIcon } from 'lucide-react';

/**
 * One line-icon style for the whole app (lucide, 1.75 stroke). Inline icons sit on the text
 * baseline at the text's size; they are decorative, so screen readers skip them.
 */
export function Icon({ icon: Glyph, className }: { icon: LucideIcon; className?: string }) {
  return (
    <Glyph
      aria-hidden
      strokeWidth={1.75}
      className={`inline-block h-[1.15em] w-[1.15em] shrink-0 align-[-0.2em] ${className ?? ''}`}
    />
  );
}
