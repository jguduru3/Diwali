// The last pickup QR per order, kept on the phone so it still opens with no
// signal at the shop ground. The QR is an opaque token (no items or prices).
const key = (orderId: string) => `pp.pickup.${orderId}`;

export function savePickupQr(orderId: string, qr: string) {
  try {
    localStorage.setItem(key(orderId), qr);
  } catch {
    // storage unavailable
  }
}

export function loadPickupQr(orderId: string): string | null {
  try {
    return localStorage.getItem(key(orderId));
  } catch {
    return null;
  }
}
