import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { ShopSummary } from '@pataka/shared';
import { cx } from './ui';

// Teardrop pin: a dark plum body (stands out against OSM's orange and yellow roads) with a
// gold badge holding a storefront glyph. Closed shops get a smaller grey pin so open ones
// lead. Hover lift and the ground shadow are styled in index.css (.shop-pin).
function shopPin(open: boolean) {
  const [top, bottom] = open ? ['#57307f', '#2a1745'] : ['#b7afc2', '#8d849b'];
  const [badgeA, badgeB] = open ? ['#f5dc9a', '#e2b24f'] : ['#ffffff', '#f1edf5'];
  const glyph = open ? '#2a1745' : '#8d849b';
  const id = open ? 'pin-open' : 'pin-closed';
  const scale = open ? 1 : 0.82;
  const [w, h] = [Math.round(40 * scale), Math.round(52 * scale)];
  return L.divIcon({
    className: cx('shop-pin', !open && 'shop-pin-closed'),
    html: `<svg width="${w}" height="${h}" viewBox="0 0 40 52" aria-hidden="true">
      <defs>
        <linearGradient id="${id}-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/>
        </linearGradient>
        <linearGradient id="${id}-badge" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${badgeA}"/><stop offset="1" stop-color="${badgeB}"/>
        </linearGradient>
      </defs>
      <ellipse class="shop-pin-shadow" cx="20" cy="49.5" rx="6" ry="2"/>
      <path d="M20 49C18.6 49 3 31.6 3 19.5a17 17 0 0 1 34 0C37 31.6 21.4 49 20 49Z"
        fill="url(#${id}-body)" stroke="#fff" stroke-width="2.5"/>
      <circle cx="20" cy="19.5" r="11.5" fill="url(#${id}-badge)"/>
      <g fill="none" stroke="${glyph}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">
        <path d="M13 17 14.5 12.5h11L27 17"/>
        <path d="M13 17a2.33 2.33 0 0 0 4.67 0 2.33 2.33 0 0 0 4.66 0 2.33 2.33 0 0 0 4.67 0"/>
        <path d="M14.5 19.5V26h11v-6.5"/><path d="M18.5 26v-3.2h3V26"/>
      </g>
    </svg>`,
    iconSize: [w, h],
    iconAnchor: [w / 2, Math.round(49 * scale)],
    popupAnchor: [0, -Math.round(44 * scale)],
  });
}
const PINS = { open: shopPin(true), closed: shopPin(false) };

// "You are here": the familiar blue location dot with a soft pulsing halo (.you-pin in index.css).
const youPin = L.divIcon({
  className: 'you-pin',
  html: '<span class="you-pin-halo"></span><span class="you-pin-dot"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const HYDERABAD: [number, number] = [17.44, 78.37];

/** Leaflet + OpenStreetMap (SPEC §3). Loaded lazily so the list renders first. */
export default function ShopMap({
  shops,
  center,
  you,
}: {
  shops: ShopSummary[];
  center?: [number, number];
  you?: [number, number];
}) {
  const { t } = useTranslation();
  const withPos = shops.filter((s) => s.lat != null && s.lng != null);
  const c = center ?? (withPos[0] ? [withPos[0].lat!, withPos[0].lng!] : HYDERABAD);
  return (
    <MapContainer center={c} zoom={13} scrollWheelZoom={false} className="h-full w-full">
      <TileLayer
        // i18n-ignore: the map licence requires this attribution as written
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' // i18n-ignore
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {you && <Marker position={you} icon={youPin} zIndexOffset={-100} />}
      {withPos.map((s) => (
        <Marker
          key={s.shortCode}
          position={[s.lat!, s.lng!]}
          icon={s.openNow ? PINS.open : PINS.closed}
          zIndexOffset={s.openNow ? 100 : 0}
          title={s.name}
        >
          <Popup>
            <Link to={`/s/${s.shortCode}`} style={{ fontWeight: 700, color: '#2a1745' }}>
              {s.name}
            </Link>
            <br />
            {s.area}
            {s.distanceKm != null && ` · ${t('home.km', { km: s.distanceKm })}`}
            <br />
            <span style={{ color: s.openNow ? '#1b8a5a' : '#6c6280', fontWeight: 600 }}>
              {s.openNow ? t('home.open') : t('home.closed')}
            </span>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
