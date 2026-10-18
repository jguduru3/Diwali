import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import { Link } from 'react-router-dom';
import type { ShopSummary } from '@pataka/shared';

const pin = L.divIcon({
  className: '',
  html: `<div style="width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:linear-gradient(135deg,#f5dc9a,#e2b24f 50%,#ef7d3c);box-shadow:0 6px 14px -4px rgba(20,12,36,.55);border:2px solid #fff"></div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 30],
  popupAnchor: [0, -28],
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
  const withPos = shops.filter((s) => s.lat != null && s.lng != null);
  const c = center ?? (withPos[0] ? [withPos[0].lat!, withPos[0].lng!] : HYDERABAD);
  return (
    <MapContainer center={c} zoom={13} scrollWheelZoom={false} className="h-full w-full">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {you && (
        <Marker
          position={you}
          icon={L.divIcon({
            className: '',
            html: '<div style="width:16px;height:16px;border-radius:50%;background:#2a1745;border:3px solid #fff;box-shadow:0 0 0 6px rgba(42,23,69,.2)"></div>',
            iconSize: [16, 16],
          })}
        />
      )}
      {withPos.map((s) => (
        <Marker key={s.shortCode} position={[s.lat!, s.lng!]} icon={pin}>
          <Popup>
            <Link to={`/s/${s.shortCode}`} style={{ fontWeight: 700, color: '#2a1745' }}>
              {s.name}
            </Link>
            <br />
            {s.area}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
