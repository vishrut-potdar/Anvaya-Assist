export interface GeoPoint {
  lat: number;
  lng: number;
}

export const CITIES: Record<string, { name: string; country: string; lat: number; lng: number }> = {
  NAGPUR: { name: 'Nagpur', country: 'IN', lat: 21.1458, lng: 79.0882 },
  MUMBAI: { name: 'Mumbai', country: 'IN', lat: 19.0760, lng: 72.8777 },
  PUNE: { name: 'Pune', country: 'IN', lat: 18.5204, lng: 73.8567 },
  DELHI: { name: 'Delhi', country: 'IN', lat: 28.6139, lng: 77.2090 },
  CHENNAI: { name: 'Chennai', country: 'IN', lat: 13.0827, lng: 80.2707 },
  KOLKATA: { name: 'Kolkata', country: 'IN', lat: 22.5726, lng: 88.3639 },
  BENGALURU: { name: 'Bengaluru', country: 'IN', lat: 12.9716, lng: 77.5946 },
  HYDERABAD: { name: 'Hyderabad', country: 'IN', lat: 17.3850, lng: 78.4867 },
  AHMEDABAD: { name: 'Ahmedabad', country: 'IN', lat: 23.0225, lng: 72.5714 },
  JAIPUR: { name: 'Jaipur', country: 'IN', lat: 26.9124, lng: 75.7873 },
  GUWAHATI: { name: 'Guwahati', country: 'IN', lat: 26.1445, lng: 91.7362 },
};

export function nearestCity(p: GeoPoint): string {
  let best = 'Unknown';
  let bestKm = Infinity;
  for (const c of Object.values(CITIES)) {
    const km = haversineKm(p, c);
    if (km < bestKm) {
      bestKm = km;
      best = c.name;
    }
  }
  return best;
}

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371; // Earth radius in km
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const sinDlat = Math.sin(dLat / 2);
  const sinDlng = Math.sin(dLng / 2);
  const h = sinDlat * sinDlat + Math.cos(lat1) * Math.cos(lat2) * sinDlng * sinDlng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function calculateVelocityKmh(
  p1: GeoPoint,
  t1Ms: number,
  p2: GeoPoint,
  t2Ms: number,
  skewSeconds = 120
): { km: number; hours: number; kmh: number } {
  const km = haversineKm(p1, p2);
  const diffHours = Math.abs(t2Ms - t1Ms) / 36e5;
  const adjustedHours = Math.max(diffHours, skewSeconds / 3600);
  const kmh = km / adjustedHours;
  return { km: Math.round(km * 10) / 10, hours: Math.round(diffHours * 100) / 100, kmh: Math.round(kmh) };
}
