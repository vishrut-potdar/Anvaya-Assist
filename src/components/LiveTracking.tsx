import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, Navigation, CheckCircle2, Search, Play, Circle } from 'lucide-react';

interface Point {
  city: string;
  lat: number;
  lng: number;
}

interface Trip {
  title: string;
  lot: string;
  route: Point[]; // ordered stops, last one is the destination
  departedAt: number; // ms, start of the moving leg(s)
  etaAt: number; // ms, arrival at the last stop
  fromIndex: number; // route index the moving part starts at (earlier stops are history)
  history: { label: string; at: string }[];
  simulated?: { tripHours: number };
  state: string;
}

const REFRESH_MS = 20000; // re-fetch real shipments so new hand-offs show up
const ROAD_FACTOR = 1.3; // road distance vs straight line
const DEMO_MS = 120000; // fake trip plays out in 2 minutes
const DEMO_ROUTE: Point[] = [
  { city: 'Mumbai', lat: 19.076, lng: 72.8777 },
  { city: 'Pune', lat: 18.5204, lng: 73.8567 },
  { city: 'Hyderabad', lat: 17.385, lng: 78.4867 },
  { city: 'Bengaluru', lat: 12.9716, lng: 77.5946 },
  { city: 'Chennai', lat: 13.0827, lng: 80.2707 },
];

function km(a: Point, b: Point) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h)) * ROAD_FACTOR;
}

/** Position along route[from..] at fraction t of its total length, plus how many stops have been passed. */
function along(route: Point[], from: number, t: number) {
  const legs = route.slice(from);
  const lens = legs.slice(1).map((p, i) => km(legs[i], p));
  const total = lens.reduce((a, b) => a + b, 0);
  let left = t * total;
  for (let i = 0; i < lens.length; i++) {
    if (left <= lens[i] || i === lens.length - 1) {
      const f = lens[i] ? Math.min(1, left / lens[i]) : 1;
      const a = legs[i];
      const b = legs[i + 1];
      return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f, passed: from + i + (f >= 1 ? 1 : 0), totalKm: total };
    }
    left -= lens[i];
  }
  const last = route[route.length - 1];
  return { lat: last.lat, lng: last.lng, passed: route.length - 1, totalKm: total };
}

function demoTrip(): Trip {
  const now = Date.now();
  const totalKm = DEMO_ROUTE.slice(1).reduce((s, p, i) => s + km(DEMO_ROUTE[i], p), 0);
  return {
    title: 'Insulin Glargine Pens (cold chain)',
    lot: 'DEMO-TRIP',
    route: DEMO_ROUTE,
    departedAt: now,
    etaAt: now + DEMO_MS,
    fromIndex: 0,
    history: [
      { label: 'Manufactured · Mumbai', at: 'Simulated' },
      { label: 'Packaged · Mumbai', at: 'Simulated' },
    ],
    simulated: { tripHours: totalKm / 55 },
    state: 'IN_TRANSIT',
  };
}

function tripFromApi(data: any): Trip {
  const history = data.stops.map((s: any) => ({
    label: `${s.step.charAt(0) + s.step.slice(1).toLowerCase()} · ${s.city}`,
    at: new Date(s.at).toLocaleString('en-IN'),
  }));
  // One route point per city visit
  const route: Point[] = [];
  for (const s of data.stops) {
    if (route[route.length - 1]?.city !== s.city) route.push({ city: s.city, lat: s.lat, lng: s.lng });
  }
  const live = data.live;
  if (live) route.push(live.to);
  return {
    title: data.product.name,
    lot: data.product.lot,
    route,
    departedAt: live ? new Date(live.departedAt).getTime() : 0,
    etaAt: live ? new Date(live.etaAt).getTime() : 0,
    fromIndex: live ? route.length - 2 : route.length - 1,
    history,
    state: data.state,
  };
}

export default function LiveTracking() {
  const [code, setCode] = useState('');
  const [activeCode, setActiveCode] = useState('');
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const routeLayer = useRef<L.LayerGroup | null>(null);
  const truck = useRef<L.Marker | null>(null);

  async function load(c: string) {
    try {
      const res = await fetch(`/api/track/${encodeURIComponent(c)}`).then((r) => r.json());
      if (!res.ok) throw new Error(res.message || 'Shipment not found');
      setTrip(tripFromApi(res));
      setError(null);
    } catch (err: any) {
      setTrip(null);
      setError(err.message);
    }
  }

  useEffect(() => {
    if (!activeCode) return;
    load(activeCode);
    const id = setInterval(() => load(activeCode), REFRESH_MS);
    return () => clearInterval(id);
  }, [activeCode]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  // Create the map once
  useEffect(() => {
    if (!mapEl.current || map.current) return;
    map.current = L.map(mapEl.current, { scrollWheelZoom: false }).setView([22.5, 79], 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map.current);
    routeLayer.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Redraw route when the trip changes
  useEffect(() => {
    const m = map.current;
    if (!m || !routeLayer.current) return;
    routeLayer.current.clearLayers();
    truck.current = null;
    if (!trip) return;
    const latlngs = trip.route.map((p) => [p.lat, p.lng] as [number, number]);
    L.polyline(latlngs, { color: '#059669', weight: 4, opacity: 0.8 }).addTo(routeLayer.current);
    trip.route.forEach((p) =>
      L.circleMarker([p.lat, p.lng], { radius: 6, color: '#047857', fillColor: '#fff', fillOpacity: 1, weight: 2 })
        .bindTooltip(p.city)
        .addTo(routeLayer.current!)
    );
    truck.current = L.marker(latlngs[trip.fromIndex], {
      icon: L.divIcon({ className: '', html: '<div style="font-size:26px;line-height:26px">🚚</div>', iconSize: [26, 26], iconAnchor: [13, 13] }),
      zIndexOffset: 1000,
    }).addTo(routeLayer.current);
    m.fitBounds(L.latLngBounds(latlngs).pad(0.25));
  }, [trip]);

  const moving = !!trip && trip.etaAt > trip.departedAt;
  const progress = moving ? Math.min(1, Math.max(0, (now - trip!.departedAt) / (trip!.etaAt - trip!.departedAt))) : 1;
  const pos = trip ? (moving ? along(trip.route, trip.fromIndex, progress) : { ...trip.route[trip.fromIndex], passed: trip.fromIndex, totalKm: 0 }) : null;

  useEffect(() => {
    if (pos) truck.current?.setLatLng([pos.lat, pos.lng]);
  }, [pos?.lat, pos?.lng]);

  const arrived = moving && progress >= 1;
  const remainingKm = moving ? Math.round(pos!.totalKm * (1 - progress)) : 0;
  const etaMs = trip?.simulated ? trip.simulated.tripHours * 36e5 * (1 - progress) : moving ? trip!.etaAt - now : 0;
  const etaText = arrived ? 'Arrived' : `${Math.floor(etaMs / 36e5)}h ${Math.floor((etaMs % 36e5) / 6e4)}m`;

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4">
        <div>
          <h2 className="font-bold text-base text-slate-900 flex items-center gap-2">
            <Navigation className="w-4 h-4 text-emerald-600" /> Live Shipment Tracking
          </h2>
          <p className="text-xs text-slate-500">
            Enter the code from your pack's QR or the lot number to follow your order across India, or watch a simulated demo trip.
          </p>
        </div>

        <form
          className="flex flex-col sm:flex-row gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) setActiveCode(code.trim());
          }}
        >
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Unit token or lot number"
            aria-label="Unit token or lot number"
            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-emerald-500"
          />
          <button className="flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg px-4 py-2 transition cursor-pointer">
            <Search className="w-3.5 h-3.5" /> Track
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveCode('');
              setError(null);
              setTrip(demoTrip());
            }}
            className="flex items-center justify-center gap-1.5 text-xs font-semibold border border-slate-200 hover:bg-slate-50 rounded-lg px-4 py-2 transition cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" /> {trip?.simulated ? 'Restart demo trip' : 'Watch demo trip'}
          </button>
        </form>
        {error && (
          <p role="alert" className="text-xs text-rose-600">
            {error}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
          <div ref={mapEl} className="w-full h-96 z-0" />
          {moving && (
            <div className="p-4 space-y-2">
              <div className="flex justify-between text-xs font-semibold text-slate-700">
                <span>{trip!.route[trip!.fromIndex].city}</span>
                <span>{trip!.route[trip!.route.length - 1].city}</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${progress * 100}%` }} />
              </div>
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
          {!trip ? (
            <p className="text-xs text-slate-500">No shipment selected. Track a code, or press “Watch demo trip”.</p>
          ) : (
            <>
              <div>
                <p className="text-[11px] uppercase font-bold tracking-wider text-slate-400">
                  {trip.simulated ? 'Simulated demo trip' : 'Your order'}
                </p>
                <p className="text-sm font-bold text-slate-900">{trip.title}</p>
                <p className="text-xs font-mono text-slate-500">{trip.lot}</p>
              </div>

              {moving ? (
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                    <p className="text-emerald-700 font-semibold flex items-center gap-1">
                      {!arrived && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />}
                      {arrived ? 'Delivered' : 'On the road'}
                    </p>
                    <p className="text-slate-900 font-bold mt-1">{remainingKm} km left</p>
                  </div>
                  <div className="bg-slate-50 border border-slate-100 rounded-xl p-3">
                    <p className="text-slate-500 font-semibold">ETA</p>
                    <p className="text-slate-900 font-bold mt-1">{etaText}</p>
                  </div>
                </div>
              ) : (
                <p className="text-xs bg-slate-50 border border-slate-100 rounded-xl p-3 text-slate-600">
                  Status: <strong>{trip.state.replace('_', ' ')}</strong> — not moving right now.
                </p>
              )}
              {trip.simulated && (
                <p className="text-[11px] text-slate-400">
                  Simulation: a ~{Math.round(trip.simulated.tripHours)}h road trip compressed into 2 minutes.
                </p>
              )}

              <ol className="space-y-3">
                {trip.history.map((h, i) => (
                  <li key={`h${i}`} className="flex gap-2 text-xs">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <div>
                      <p className="font-semibold text-slate-800">{h.label}</p>
                      <p className="text-slate-400">{h.at}</p>
                    </div>
                  </li>
                ))}
                {moving &&
                  trip.route.slice(trip.fromIndex + 1).map((p, i) => {
                    const passed = pos!.passed >= trip.fromIndex + 1 + i;
                    const isLast = trip.fromIndex + 1 + i === trip.route.length - 1;
                    const Icon = passed ? CheckCircle2 : isLast ? MapPin : Circle;
                    return (
                      <li key={p.city} className="flex gap-2 text-xs">
                        <Icon className={`w-4 h-4 shrink-0 ${passed ? 'text-emerald-600' : 'text-slate-300'}`} />
                        <p className={`font-semibold ${passed ? 'text-slate-800' : 'text-slate-400'}`}>
                          {isLast ? (passed ? 'Delivered' : 'Arriving') : passed ? 'Passed' : 'Next checkpoint'} · {p.city}
                        </p>
                      </li>
                    );
                  })}
              </ol>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
