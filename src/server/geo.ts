export interface GeoPoint {
  lat: number;
  lng: number;
}

export const CITIES: Record<string, { name: string; country: string; lat: number; lng: number }> = {
  NAGPUR: { name: 'Nagpur', country: 'IN', lat: 21.1458, lng: 79.0882 },
  MUMBAI: { name: 'Mumbai', country: 'IN', lat: 19.0760, lng: 72.8777 },
  PUNE: { name: 'Pune', country: 'IN', lat: 18.5204, lng: 73.8567 },
  DELHI: { name: 'Delhi', country: 'IN', lat: 28.6139, lng: 77.2090 },
  BERLIN: { name: 'Berlin', country: 'DE', lat: 52.5200, lng: 13.4050 },
  PARIS: { name: 'Paris', country: 'FR', lat: 48.8566, lng: 2.3522 },
  LONDON: { name: 'London', country: 'GB', lat: 51.5074, lng: -0.1278 },
  NEW_YORK: { name: 'New York', country: 'US', lat: 40.7128, lng: -74.0060 },
  DUBAI: { name: 'Dubai', country: 'AE', lat: 25.2048, lng: 55.2708 },
  SINGAPORE: { name: 'Singapore', country: 'SG', lat: 1.3521, lng: 103.8198 },
  TOKYO: { name: 'Tokyo', country: 'JP', lat: 35.6762, lng: 139.6503 },
  LAGOS: { name: 'Lagos', country: 'NG', lat: 6.5244, lng: 3.3792 },
};

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
