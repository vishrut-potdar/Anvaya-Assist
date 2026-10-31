import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Legend,
} from 'recharts';
import {
  MapPin,
  TrendingUp,
  AlertTriangle,
  Zap,
  ShieldCheck,
  Compass,
  Navigation,
} from 'lucide-react';

export interface ScanHistoryEntry {
  id: string;
  scanNumber: number;
  timestamp: number;
  timeFormatted: string;
  city: string;
  lat: number;
  lng: number;
  deviceId: string;
  distanceFromPrevKm: number;
  velocityKmh: number;
  isImpossibleTravel: boolean;
  verdict: 'Verified' | 'Caution' | 'Not verified' | 'Recalled';
  riskScore: number;
}

interface ScanGeoHistoryChartProps {
  history: ScanHistoryEntry[];
  onSimulateScan?: (city: string) => void;
  isLoading?: boolean;
}

export default function ScanGeoHistoryChart({
  history,
  onSimulateScan,
  isLoading,
}: ScanGeoHistoryChartProps) {
  // Pattern detection at a glance
  const patternAnalysis = useMemo(() => {
    if (!history || history.length === 0) {
      return {
        type: 'NO_DATA',
        title: 'Awaiting Scans',
        desc: 'Scan this code to record initial geo-location telemetry.',
        color: 'text-slate-500',
        bgColor: 'bg-slate-50',
        borderColor: 'border-slate-200',
      };
    }

    const hasImpossible = history.some((h) => h.isImpossibleTravel || h.velocityKmh > 900);
    const uniqueCities = new Set(history.map((h) => h.city)).size;
    const maxVelocity = Math.max(...history.map((h) => h.velocityKmh || 0));

    if (hasImpossible) {
      return {
        type: 'CLONED_PHOTOCOPY',
        title: 'Cloned Photocopy Pattern Detected (Rule R4)',
        desc: `Impossible physical velocity detected (Peak: ${maxVelocity.toLocaleString()} km/h). Consecutive scans across multiple cities within minutes indicate cloned duplicates.`,
        color: 'text-rose-700',
        bgColor: 'bg-rose-50',
        borderColor: 'border-rose-200',
        badge: 'CRITICAL ANOMALY',
      };
    }

    if (uniqueCities >= 3) {
      return {
        type: 'HIGH_DIVERSITY',
        title: 'Abnormal Geographic Dispersion (Rule R5)',
        desc: `Scanned across ${uniqueCities} distinct cities. Genuine units are typically sold and retained in a single regional zone.`,
        color: 'text-amber-700',
        bgColor: 'bg-amber-50',
        borderColor: 'border-amber-200',
        badge: 'SUSPICIOUS DIVERSITY',
      };
    }

    return {
      type: 'NORMAL_CLUSTER',
      title: 'Plausible Localized Scan Activity',
      desc: `Scans are geographically coherent within normal travel constraints (Peak velocity: ${maxVelocity} km/h < 900 km/h threshold).`,
      color: 'text-emerald-700',
      bgColor: 'bg-emerald-50',
      borderColor: 'border-emerald-200',
      badge: 'CONSISTENT PATTERN',
    };
  }, [history]);

  // Transform data for Recharts chart
  const chartData = useMemo(() => {
    if (!history) return [];
    let cumulativeDist = 0;
    return history.map((item, idx) => {
      cumulativeDist += item.distanceFromPrevKm || 0;
      return {
        index: idx + 1,
        label: `#${item.scanNumber} ${item.city}`,
        city: item.city,
        time: item.timeFormatted || new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        velocity: item.velocityKmh || 0,
        distance: item.distanceFromPrevKm || 0,
        cumulativeDistance: Math.round(cumulativeDist),
        score: Math.round((item.riskScore || 0) * 100),
        verdict: item.verdict,
        isImpossible: item.isImpossibleTravel || item.velocityKmh > 900,
        lat: item.lat,
        lng: item.lng,
      };
    });
  }, [history]);

  // India coordinate bounds for D3/SVG Trajectory Map
  const mapPoints = useMemo(() => {
    if (!history) return [];
    return history.map((item, idx) => {
      // Longitude: 68 to 98 -> x: 20 to 580
      const x = ((Math.max(68, Math.min(98, item.lng)) - 68) / 30) * 560 + 20;
      // Latitude: 37 to 6 -> y: 20 to 240
      const y = ((37 - Math.max(6, Math.min(37, item.lat))) / 31) * 220 + 20;
      return {
        ...item,
        x,
        y,
        stepIndex: idx + 1,
      };
    });
  }, [history]);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6 shadow-sm">
      {/* Header and Pattern Diagnosis */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <div className="flex items-center space-x-2 text-slate-900">
            <Compass className="w-5 h-5 text-blue-600" />
            <h3 className="font-bold text-base">Geo-Location Scan History &amp; Travel Velocity</h3>
          </div>
          <p className="text-xs text-slate-500">
            Temporal telemetry analysis detecting photocopy cloning via physical travel impossibilities (Rule R4) and geographic scan diversity (Rule R5).
          </p>
        </div>

        {/* Diagnostic Banner */}
        <div className={`px-4 py-2.5 rounded-xl border ${patternAnalysis.bgColor} ${patternAnalysis.borderColor} flex items-center space-x-3`}>
          {patternAnalysis.type === 'CLONED_PHOTOCOPY' ? (
            <Zap className="w-5 h-5 text-rose-600 animate-bounce flex-shrink-0" />
          ) : patternAnalysis.type === 'HIGH_DIVERSITY' ? (
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
          ) : (
            <ShieldCheck className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          )}
          <div>
            <div className="flex items-center space-x-2">
              <span className={`text-xs font-bold ${patternAnalysis.color}`}>{patternAnalysis.title}</span>
              {patternAnalysis.badge && (
                <span className="text-[9px] uppercase tracking-wider font-extrabold px-1.5 py-0.5 rounded bg-white/80 text-slate-700 border border-slate-200">
                  {patternAnalysis.badge}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-600 max-w-sm line-clamp-1">{patternAnalysis.desc}</p>
          </div>
        </div>
      </div>

      {/* QUICK PATTERN SIMULATION ACTIONS */}
      {onSimulateScan && (
        <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-slate-600 font-medium flex items-center space-x-1.5">
            <Navigation className="w-3.5 h-3.5 text-blue-600" />
            <span>Simulate Consecutive Scan:</span>
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { city: 'Delhi', note: 'Original North' },
              { city: 'Chennai', note: 'Cloned South ⚡' },
              { city: 'Mumbai', note: 'West Coast' },
              { city: 'Pune', note: 'Nearby 150km' },
              { city: 'Guwahati', note: 'North-East ⚡' },
            ].map(({ city, note }) => (
              <button
                key={city}
                disabled={isLoading}
                onClick={() => onSimulateScan(city)}
                className="px-2.5 py-1 bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-700 border border-slate-200 hover:border-blue-300 rounded-lg text-[11px] transition flex items-center space-x-1 font-medium disabled:opacity-50 shadow-xs"
              >
                <MapPin className="w-3 h-3 text-blue-600" />
                <span>{city}</span>
                <span className="text-[9px] text-slate-400 font-mono">({note})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* RECHARTS COMPONENT: VELOCITY & DISTANCE OVER TIME */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-600">
          <span className="font-semibold text-slate-800 flex items-center space-x-1">
            <TrendingUp className="w-4 h-4 text-blue-600" />
            <span>Velocity (km/h) &amp; Distance Traveled Over Time</span>
          </span>
          <span className="font-mono text-[11px]">
            Threshold: <strong className="text-rose-600 font-bold">900 km/h</strong> (Air Speed Limit)
          </span>
        </div>

        <div className="h-64 w-full bg-slate-50/60 p-2 rounded-xl border border-slate-200">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 15, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="label"
                  stroke="#64748b"
                  fontSize={10}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  yAxisId="left"
                  stroke="#475569"
                  fontSize={10}
                  tickLine={false}
                  unit=" km/h"
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="#0284c7"
                  fontSize={10}
                  tickLine={false}
                  unit=" km"
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-white border border-slate-200 p-3 rounded-xl shadow-xl text-xs space-y-1.5 font-sans">
                          <div className="flex items-center justify-between border-b border-slate-100 pb-1">
                            <span className="font-bold text-slate-900 flex items-center space-x-1">
                              <MapPin className="w-3.5 h-3.5 text-blue-600" />
                              <span>{data.city} (Scan #{data.index})</span>
                            </span>
                            <span className="text-slate-400 text-[10px]">{data.time}</span>
                          </div>
                          <div className="space-y-0.5 text-[11px]">
                            <p className="text-slate-600">
                              Velocity: <strong className={data.isImpossible ? 'text-rose-600 font-bold' : 'text-blue-600'}>{data.velocity.toLocaleString()} km/h</strong>
                            </p>
                            <p className="text-slate-600">
                              Segment Distance: <strong className="text-cyan-700">{data.distance.toLocaleString()} km</strong>
                            </p>
                            <p className="text-slate-600">
                              Cumulative Distance: <strong className="text-slate-900">{data.cumulativeDistance.toLocaleString()} km</strong>
                            </p>
                            <p className="text-slate-600">
                              Verdict: <strong className={data.verdict === 'Verified' ? 'text-emerald-600' : 'text-amber-600'}>{data.verdict}</strong>
                            </p>
                          </div>
                          {data.isImpossible && (
                            <div className="text-[10px] text-rose-700 font-semibold bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200">
                              ⚡ Impossible Physical Velocity
                            </div>
                          )}
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }}
                />
                <ReferenceLine
                  yAxisId="left"
                  y={900}
                  label={{
                    value: 'Max 900 km/h (R4 Alert)',
                    fill: '#e11d48',
                    fontSize: 10,
                    position: 'insideTopLeft',
                  }}
                  stroke="#e11d48"
                  strokeDasharray="4 4"
                  strokeWidth={2}
                />
                <Bar
                  yAxisId="right"
                  dataKey="distance"
                  name="Segment Distance (km)"
                  fill="#38bdf8"
                  opacity={0.6}
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="velocity"
                  name="Velocity (km/h)"
                  stroke="#2563eb"
                  strokeWidth={2.5}
                  dot={(props: any) => {
                    const { cx, cy, payload } = props;
                    const isImp = payload.isImpossible;
                    return (
                      <circle
                        key={`dot-${payload.index}`}
                        cx={cx}
                        cy={cy}
                        r={isImp ? 6 : 4}
                        fill={isImp ? '#e11d48' : '#2563eb'}
                        stroke="#ffffff"
                        strokeWidth={2}
                        className={isImp ? 'animate-pulse' : ''}
                      />
                    );
                  }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-slate-400 text-xs">
              Perform scans from different cities above to plot velocity curves.
            </div>
          )}
        </div>
      </div>

      {/* D3 / SVG GEO-TRAJECTORY MAP */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-600">
          <span className="font-semibold text-slate-800 flex items-center space-x-1">
            <Compass className="w-4 h-4 text-blue-600" />
            <span>Interactive India Geo-Telemetry Trajectory Map</span>
          </span>
          <span className="text-[11px] text-slate-500">
            Coordinates: Equirectangular projection with flight/road arcs
          </span>
        </div>

        <div className="bg-slate-950 p-4 rounded-xl border border-slate-900 relative overflow-hidden">
          <svg viewBox="0 0 600 260" className="w-full h-56 select-none">
            {/* World Grid Lines */}
            <defs>
              <pattern id="world-grid" width="60" height="26" patternUnits="userSpaceOnUse">
                <path d="M 60 0 L 0 0 0 26" fill="none" stroke="#1e293b" strokeWidth="0.5" />
              </pattern>
              <linearGradient id="arc-normal" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.8" />
              </linearGradient>
              <linearGradient id="arc-impossible" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#f43f5e" stopOpacity="1" />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity="1" />
              </linearGradient>
            </defs>

            <rect width="600" height="260" fill="url(#world-grid)" rx="8" />

            <line x1="20" y1="130" x2="580" y2="130" stroke="#334155" strokeWidth="0.7" strokeDasharray="3 3" />
            <text x="25" y="125" fill="#64748b" fontSize="8" fontFamily="monospace">Equator (0°)</text>

            <line x1="300" y1="20" x2="300" y2="240" stroke="#334155" strokeWidth="0.7" strokeDasharray="3 3" />
            <text x="305" y="32" fill="#64748b" fontSize="8" fontFamily="monospace">Prime Meridian (0°)</text>

            <text x="340" y="85" fill="#475569" fontSize="10" fontWeight="bold">EUROPE</text>
            <text x="325" y="155" fill="#475569" fontSize="10" fontWeight="bold">AFRICA</text>
            <text x="430" y="130" fill="#475569" fontSize="10" fontWeight="bold">ASIA / INDIA</text>
            <text x="140" y="100" fill="#475569" fontSize="10" fontWeight="bold">NORTH AMERICA</text>

            {/* Arcs between consecutive scans */}
            {mapPoints.map((pt, idx) => {
              if (idx === 0) return null;
              const prev = mapPoints[idx - 1];
              const isImp = pt.isImpossibleTravel || pt.velocityKmh > 900;
              const midX = (prev.x + pt.x) / 2;
              const midY = Math.min(prev.y, pt.y) - Math.abs(prev.x - pt.x) * 0.15;
              const pathD = `M ${prev.x} ${prev.y} Q ${midX} ${midY} ${pt.x} ${pt.y}`;

              return (
                <g key={`arc-${idx}`}>
                  <path
                    d={pathD}
                    fill="none"
                    stroke={isImp ? 'url(#arc-impossible)' : 'url(#arc-normal)'}
                    strokeWidth={isImp ? 3 : 1.8}
                    strokeDasharray={isImp ? 'none' : '4 3'}
                    className={isImp ? 'animate-pulse' : ''}
                  />
                  {isImp && (
                    <text
                      x={midX}
                      y={midY - 4}
                      fill="#f43f5e"
                      fontSize="9"
                      fontWeight="bold"
                      textAnchor="middle"
                      className="font-mono"
                    >
                      ⚡ {pt.velocityKmh.toLocaleString()} km/h
                    </text>
                  )}
                </g>
              );
            })}

            {/* Location Nodes */}
            {mapPoints.map((pt) => {
              const isImp = pt.isImpossibleTravel || pt.velocityKmh > 900;
              return (
                <g key={pt.id} transform={`translate(${pt.x}, ${pt.y})`}>
                  {isImp && (
                    <circle r="12" fill="#f43f5e" opacity="0.25" className="animate-ping" />
                  )}
                  <circle
                    r="6"
                    fill={isImp ? '#f43f5e' : '#38bdf8'}
                    stroke="#ffffff"
                    strokeWidth="1.5"
                  />
                  <rect
                    x="-20"
                    y="-22"
                    width="40"
                    height="14"
                    rx="3"
                    fill="#0f172a"
                    stroke={isImp ? '#f43f5e' : '#334155'}
                    strokeWidth="0.8"
                  />
                  <text
                    x="0"
                    y="-12"
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="8"
                    fontWeight="bold"
                  >
                    #{pt.stepIndex} {pt.city.slice(0, 4)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* SCAN HISTORY TABLE */}
      {history && history.length > 0 && (
        <div className="space-y-2">
          <span className="text-xs font-semibold text-slate-700">Recorded Geo-Telemetry Log</span>
          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 text-[11px]">
                <tr>
                  <th className="p-2.5">#</th>
                  <th className="p-2.5">Location</th>
                  <th className="p-2.5">Time</th>
                  <th className="p-2.5">Segment Dist</th>
                  <th className="p-2.5">Calculated Speed</th>
                  <th className="p-2.5">Verdict</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                {history.map((h, i) => (
                  <tr key={h.id} className="hover:bg-slate-50">
                    <td className="p-2.5 text-slate-400 font-bold">#{h.scanNumber || i + 1}</td>
                    <td className="p-2.5 text-slate-900 font-sans font-medium flex items-center space-x-1">
                      <MapPin className="w-3 h-3 text-blue-600 flex-shrink-0" />
                      <span>{h.city}</span>
                    </td>
                    <td className="p-2.5 text-slate-500">{h.timeFormatted}</td>
                    <td className="p-2.5 text-cyan-700">{h.distanceFromPrevKm > 0 ? `${h.distanceFromPrevKm} km` : '—'}</td>
                    <td className="p-2.5">
                      {h.velocityKmh > 0 ? (
                        <span className={h.velocityKmh > 900 ? 'text-rose-600 font-bold' : 'text-blue-600'}>
                          {h.velocityKmh.toLocaleString()} km/h
                          {h.velocityKmh > 900 && ' ⚡'}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="p-2.5">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-sans font-bold uppercase ${
                          h.verdict === 'Verified'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : h.verdict === 'Caution'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}
                      >
                        {h.verdict}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
