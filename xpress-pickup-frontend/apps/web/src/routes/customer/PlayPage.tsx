import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { settings } from '../../lib/settings';
import { FINAL_ORDER_STATUSES, type OrderStatus } from '@pataka/shared';
import { useMe } from '../../auth/useAuth';
import { OrderStatusChip } from '../../components/OrderStatusChip';
import { Button, Card } from '../../components/ui';
import { useMyOrders } from '../../lib/queries';

const W = 360;
const H = 480;
const ROUND_SECONDS = 45;
const BEST_KEY = 'pp.game.best';

type Kind = 'sparkle' | 'diya' | 'cloud';
type Drop = { x: number; y: number; vy: number; kind: Kind; r: number };

const readBest = () => {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
};

function drawSparkle(c: CanvasRenderingContext2D, x: number, y: number, r: number) {
  c.fillStyle = '#f5b301';
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.4;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
  c.fill();
}

function drawDiya(c: CanvasRenderingContext2D, x: number, y: number, r: number) {
  c.fillStyle = '#e8590c';
  c.beginPath();
  c.ellipse(x, y + r * 0.2, r, r * 0.55, 0, 0, Math.PI);
  c.fill();
  c.fillStyle = '#ffd43b';
  c.beginPath();
  c.ellipse(x, y - r * 0.25, r * 0.28, r * 0.5, 0, 0, Math.PI * 2);
  c.fill();
}

function drawCloud(c: CanvasRenderingContext2D, x: number, y: number, r: number) {
  c.fillStyle = '#868e96';
  for (const [dx, dy, k] of [
    [-0.5, 0.1, 0.55],
    [0.5, 0.1, 0.55],
    [0, -0.2, 0.7],
  ] as const) {
    c.beginPath();
    c.arc(x + dx * r, y + dy * r, r * k, 0, Math.PI * 2);
    c.fill();
  }
  c.strokeStyle = '#4dabf7';
  c.lineWidth = 2;
  for (const dx of [-0.4, 0, 0.4]) {
    c.beginPath();
    c.moveTo(x + dx * r, y + r * 0.6);
    c.lineTo(x + dx * r - 3, y + r * 0.95);
    c.stroke();
  }
}

/**
 * /play — "Catch the sparkles": move BEA to catch sparkles (1) and diyas (3), dodge rain
 * clouds (3 lives), 45 seconds a round. Just for fun while an order is packed: no prizes,
 * points or credit of any kind (G12).
 */
export function PlayPage() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const orders = useMyOrders(me?.role === 'customer');
  const active = (orders.data ?? []).find(
    (o) => !(FINAL_ORDER_STATUSES as readonly OrderStatus[]).includes(o.status),
  );

  const canvas = useRef<HTMLCanvasElement>(null);
  const sprite = useRef<HTMLImageElement | null>(null);
  const state = useRef({
    x: W / 2,
    drops: [] as Drop[],
    score: 0,
    lives: 3,
    t0: 0,
    last: 0,
    spawn: 0,
  });
  const raf = useRef(0);
  const [phase, setPhase] = useState<'ready' | 'playing' | 'over'>('ready');
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [left, setLeft] = useState(ROUND_SECONDS);
  const [best, setBest] = useState(readBest);

  // Paint the night sky and BEA before the first round, so the board isn't blank.
  const paintIdle = useCallback(() => {
    const c = canvas.current?.getContext('2d');
    if (!c) return;
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1a0b3d');
    g.addColorStop(1, '#3b1a7a');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    drawSparkle(c, 80, 110, 14);
    drawDiya(c, 250, 170, 14);
    drawSparkle(c, 300, 80, 10);
    const img = sprite.current;
    if (img?.complete) c.drawImage(img, W / 2 - 36, H - 88, 72, 72);
  }, []);

  useEffect(() => {
    const img = new Image();
    img.onload = paintIdle;
    img.src = '/bea-sprite.png';
    sprite.current = img;
    paintIdle();
  }, [paintIdle]);

  const end = useCallback(() => {
    cancelAnimationFrame(raf.current);
    setPhase('over');
    const s = state.current.score;
    setBest((b) => {
      const nb = Math.max(b, s);
      try {
        localStorage.setItem(BEST_KEY, String(nb));
      } catch {
        // storage unavailable
      }
      return nb;
    });
  }, []);

  const frame = useCallback(
    (now: number) => {
      const cv = canvas.current;
      const c = cv?.getContext('2d');
      if (!c) return;
      const s = state.current;
      const dt = Math.min(0.05, (now - (s.last || now)) / 1000);
      s.last = now;
      const elapsed = (now - s.t0) / 1000;
      const remaining = Math.max(0, ROUND_SECONDS - elapsed);
      // speeds up a little as the round goes on
      const pace = 1 + elapsed / ROUND_SECONDS;
      s.spawn -= dt;
      if (s.spawn <= 0) {
        const roll = Math.random();
        const kind: Kind = roll < 0.55 ? 'sparkle' : roll < 0.75 ? 'diya' : 'cloud';
        s.drops.push({
          x: 20 + Math.random() * (W - 40),
          y: -20,
          vy: (110 + Math.random() * 90) * pace,
          kind,
          r: kind === 'cloud' ? 22 : 14,
        });
        s.spawn = 0.55 / pace;
      }
      const by = H - 52;
      for (const d of s.drops) d.y += d.vy * dt;
      s.drops = s.drops.filter((d) => {
        const hit = Math.abs(d.x - s.x) < 34 + d.r * 0.5 && Math.abs(d.y - by) < 30 + d.r * 0.5;
        if (hit) {
          if (d.kind === 'cloud') s.lives -= 1;
          else s.score += d.kind === 'diya' ? 3 : 1;
          navigator.vibrate?.(d.kind === 'cloud' ? 60 : 10);
          return false;
        }
        return d.y < H + 30;
      });

      c.clearRect(0, 0, W, H);
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#1a0b3d');
      g.addColorStop(1, '#3b1a7a');
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
      for (const d of s.drops) {
        if (d.kind === 'sparkle') drawSparkle(c, d.x, d.y, d.r);
        else if (d.kind === 'diya') drawDiya(c, d.x, d.y, d.r);
        else drawCloud(c, d.x, d.y, d.r);
      }
      const img = sprite.current;
      if (img?.complete) c.drawImage(img, s.x - 36, by - 36, 72, 72);
      else {
        c.fillStyle = '#4dabf7';
        c.beginPath();
        c.arc(s.x, by, 30, 0, Math.PI * 2);
        c.fill();
      }

      setScore(s.score);
      setLives(s.lives);
      setLeft(Math.ceil(remaining));
      if (s.lives <= 0 || remaining <= 0) return end();
      raf.current = requestAnimationFrame(frame);
    },
    [end],
  );

  const start = () => {
    state.current = {
      x: W / 2,
      drops: [],
      score: 0,
      lives: 3,
      t0: performance.now(),
      last: 0,
      spawn: 0,
    };
    setPhase('playing');
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(frame);
  };

  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  // Leaving the app ends the round instead of letting it run in the background.
  useEffect(() => {
    const onHide = () => document.hidden && phase === 'playing' && end();
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [phase, end]);

  const move = (clientX: number) => {
    const cv = canvas.current;
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    state.current.x = Math.max(30, Math.min(W - 30, ((clientX - r.left) / r.width) * W));
  };
  const nudge = (dx: number) => {
    state.current.x = Math.max(30, Math.min(W - 30, state.current.x + dx));
  };

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="flex items-center gap-3">
        <img src="/bea-96.png" alt="" className="h-12 w-12 rounded-full" />
        <div>
          <h1 className="text-2xl font-extrabold">{t('game.title')}</h1>
          <p className="text-sm text-muted">{t('game.subtitle')}</p>
        </div>
      </div>

      {active && (
        <Link
          to={`/orders/${active.id}`}
          className="card flex items-center justify-between gap-3 p-3 text-sm"
        >
          <span className="min-w-0 truncate font-semibold">{active.shopName}</span>
          <OrderStatusChip status={active.status} />
        </Link>
      )}

      <div className="flex justify-between text-sm font-bold tabular-nums" aria-live="polite">
        <span>{t('game.score', { score })}</span>
        <span aria-label={t('game.livesLabel', { count: lives })}>
          {'♥'.repeat(Math.max(0, lives))}
        </span>
        <span>{t('game.timeLeft', { seconds: left })}</span>
      </div>

      <div className="relative overflow-hidden rounded-3xl shadow-[var(--shadow-lift)]">
        <canvas
          ref={canvas}
          width={W}
          height={H}
          className="block h-auto w-full touch-none select-none"
          aria-label={t('game.canvasLabel')}
          tabIndex={0}
          onPointerMove={(e) => move(e.clientX)}
          onPointerDown={(e) => move(e.clientX)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') nudge(-28);
            if (e.key === 'ArrowRight') nudge(28);
          }}
        />
        {phase !== 'playing' && (
          <div className="absolute inset-0 grid place-items-center bg-black/55 p-6 text-center text-white">
            <div className="space-y-3">
              {phase === 'over' && (
                <p className="font-display text-3xl font-extrabold">{t('game.final', { score })}</p>
              )}
              <p className="text-sm text-white/85">
                {phase === 'ready' ? t('game.how') : t('game.best', { best })}
              </p>
              <Button size="lg" onClick={start}>
                {phase === 'ready' ? t('game.play') : t('game.again')}
              </Button>
            </div>
          </div>
        )}
      </div>

      <Card className="p-4 text-center text-xs text-muted">
        <p>{t('game.noPrizes')}</p>
        <p className="mt-1">
          {t('game.madeBy')}{' '}
          {settings.companyUrl ? (
            <a
              href={settings.companyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-plum underline-offset-2 hover:underline"
            >
              {t('game.company')}
            </a>
          ) : (
            <span className="font-semibold">{t('game.company')}</span>
          )}
        </p>
      </Card>
    </div>
  );
}
