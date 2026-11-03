import { describe, expect, it } from 'vitest';
import { assessGray } from './photoQuality';

const W = 64;
const H = 64;
const image = (f: (x: number, y: number) => number) => {
  const g = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g[y * W + x] = f(x, y);
  return g;
};
// sharp black-and-grey checkerboard: strong edges, middle brightness
const sharp = image((x, y) => (((x >> 2) + (y >> 2)) % 2 ? 200 : 60));

describe('photo quality', () => {
  it('passes a sharp, well-lit photo', () => {
    expect(assessGray(sharp, W, H)).toBeNull();
  });

  it('flags a dark photo', () => {
    expect(
      assessGray(
        image(() => 20),
        W,
        H,
      ),
    ).toBe('dark');
  });

  it('flags glare and over-exposure', () => {
    expect(
      assessGray(
        image(() => 240),
        W,
        H,
      ),
    ).toBe('bright');
    // a third of the picture blown out to white
    expect(
      assessGray(
        image((x, y) => (x < 22 ? 255 : sharp[y * W + x]!)),
        W,
        H,
      ),
    ).toBe('bright');
  });

  it('flags a blurry photo', () => {
    // smooth gradient: no edges
    expect(
      assessGray(
        image((x) => 80 + x),
        W,
        H,
      ),
    ).toBe('blurry');
  });
});
