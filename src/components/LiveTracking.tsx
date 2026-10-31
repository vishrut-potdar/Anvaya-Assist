import React, { useEffect, useState } from 'react';
import { MapPin, Truck, Navigation, CheckCircle2, Search } from 'lucide-react';

interface Stop {
  step: string;
  city: string;
  lat: number;
  lng: number;
  at: string;
}

interface TrackData {
  ok: boolean;
  message?: string;
  product: { name: string; lot: string };
  state: string;
  stops: Stop[];
  live: null | {
    from: { city: string; lat: number; lng: number };
    to: { city: string; lat: number; lng: number };
    roadKm: number;
    departedAt: string;
    etaAt: string;
  };
}

const REFRESH_MS = 20000; // re-fetch the ledger so new hand-offs show up
const MAP_REFRESH_MS = 30000; // the OSM embed reloads on change, so move its marker less often

export default function LiveTracking({ initialCode = '' }: { initialCode?: string }) {
  const [code, setCode] = useState(initialCode);
  const [activeCode, setActiveCode] = useState('');
  const [data, setData] = useState<TrackData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  async function load(c: string) {
    try {
      const res = await fetch(`/api/track/${encodeURIComponent(c)}`).then((r) => r.json());
      if (!res.ok) throw new Error(res.message || 'Shipment not found');
      setData(res);
      setError(null);
    } catch (err: any) {
      setData(null);
      setError(err.message);
    }
  }

  async function loadDemo() {
    const res = await fetch('/api/track/demo').then((r) => r.json());
    if (!res.ok) return setError(res.message);
    setCode(res.token);
    setActiveCode(res.token);
  }

  useEffect(() => {
    if (!activeCode) return;
    load(activeCode);
    const id = setInterval(() => load(activeCode), REFRESH_MS);
    return () => clearInterval(id);
  }, [activeCode]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const live = data?.live;
  let progress = 1;
  let position: { lat: number; lng: number } | null = null;
  if (live) {
    const start = new Date(live.departedAt).getTime();
    const end = new Date(live.etaAt).getTime();
    progress = Math.min(1, Math.max(0, (now - start) / (end - start)));
    position = {
      lat: live.from.lat + (live.to.lat - live.from.lat) * progress,
      lng: live.from.lng + (live.to.lng - live.from.lng) * progress,
    };
  } else if (data?.stops.length) {
    position = data.stops[data.stops.length - 1];
  }

  // Map snapshot: recomputed only every MAP_REFRESH_MS so the iframe doesn't reload every second
  const mapTick = Math.floor(now / MAP_REFRESH_MS);
  const [mapPos, setMapPos] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    setMapPos(position);
  }, [mapTick, data]);

  const points = [...(data?.stops || []), ...(live ? [live.to] : [])];
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const pad = 1.5;
  const bbox = points.length
    ? [Math.min(...lngs) - pad, Math.min(...lats) - pad, Math.max(...lngs) + pad, Math.max(...lats) + pad].join(',')
    : '';

  const remainingKm = live ? Math.round(live.roadKm * (1 - progress)) : 0;
  const etaMs = live ? new Date(live.etaAt).getTime() - now : 0;
  const etaText =
    etaMs > 0 ? `${Math.floor(etaMs / 36e5)}h ${Math.floor((etaMs % 36e5) / 6e4)}m` : 'Arriving';

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4">
        <div>
          <h2 className="font-bold text-base text-slate-900 flex items-center gap-2">
            <Navigation className="w-4 h-4 text-emerald-600" /> Live Shipment Tracking
          </h2>
          <p className="text-xs text-slate-500">
            Enter the code from your pack's QR (or the lot number) to follow your order across India in real time.
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
            placeholder="Unit token or lot number, e.g. LOT-LIVE-5520"
            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-emerald-500"
          />
          <button className="flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg px-4 py-2 transition cursor-pointer">
            <Search className="w-3.5 h-3.5" /> Track
          </button>
          <button
            type="button"
            onClick={loadDemo}
            className="text-xs font-semibold border border-slate-200 hover:bg-slate-50 rounded-lg px-4 py-2 transition cursor-pointer"
          >
            Track demo parcel
          </button>
        </form>
        {error && (
          <p role="alert" className="text-xs text-rose-600">
            {error}
          </p>
        )}
      </div>

      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            {mapPos && (
              <iframe
                title="Shipment location map"
                className="w-full h-80 border-0"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${mapPos.lat.toFixed(4)},${mapPos.lng.toFixed(4)}`}
              />
            )}
            {live && (
              <div className="p-4 space-y-2">
                <div className="flex justify-between text-xs font-semibold text-slate-700">
                  <span>{live.from.city}</span>
                  <span>{live.to.city}</span>
                </div>
                <div className="relative h-2 bg-slate-100 rounded-full">
                  <div
                    className="absolute inset-y-0 left-0 bg-emerald-500 rounded-full transition-all duration-1000"
                    style={{ width: `${progress * 100}%` }}
                  />
                  <Truck
                    className="absolute -top-2.5 w-6 h-6 text-emerald-700 transition-all duration-1000"
                    style={{ left: `calc(${progress * 100}% - 12px)` }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
            <div>
              <p className="text-[11px] uppercase font-bold tracking-wider text-slate-400">Your order</p>
              <p className="text-sm font-bold text-slate-900">{data.product.name}</p>
              <p className="text-xs font-mono text-slate-500">{data.product.lot}</p>
            </div>

            {live ? (
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                  <p className="text-emerald-700 font-semibold flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> On the road
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
                Status: <strong>{data.state.replace('_', ' ')}</strong> — not moving right now.
              </p>
            )}

            <ol className="space-y-3">
              {data.stops.map((s, i) => (
                <li key={i} className="flex gap-2 text-xs">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <div>
                    <p className="font-semibold text-slate-800">
                      {s.step.charAt(0) + s.step.slice(1).toLowerCase()} · {s.city}
                    </p>
                    <p className="text-slate-400">{new Date(s.at).toLocaleString('en-IN')}</p>
                  </div>
                </li>
              ))}
              {live && (
                <li className="flex gap-2 text-xs">
                  <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                  <div>
                    <p className="font-semibold text-slate-500">Arriving · {live.to.city}</p>
                    <p className="text-slate-400">{new Date(live.etaAt).toLocaleString('en-IN')}</p>
                  </div>
                </li>
              )}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
