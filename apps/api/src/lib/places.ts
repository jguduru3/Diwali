import type { ClusterInfo } from '@pataka/shared';
import type { clusters } from '../db/schema';

export function clusterView(c: typeof clusters.$inferSelect | null): ClusterInfo | null {
  if (!c) return null;
  return {
    id: c.id,
    name: c.name,
    area: c.area,
    address: c.address,
    lat: c.lat,
    lng: c.lng,
    gateNotes: c.gateNotes,
  };
}
