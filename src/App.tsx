/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  LayoutDashboard,
  Truck,
  RotateCcw,
  Package,
  Layers,
  Settings,
  HelpCircle,
  MessageSquare,
  Search,
  Bell,
  Mail,
  MoreVertical,
  TrendingUp,
  TrendingDown,
  Ship,
  Plane,
  ChevronDown,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  QrCode,
  Printer,
  Download,
  Copy,
  Check,
  CheckCircle2,
  XCircle,
  Play,
  Lock,
  RefreshCw,
  Compass,
  MapPin,
  Tag,
  Factory,
  Store,
  FileText,
  Zap,
  ExternalLink,
  ShieldOff,
  User,
  Boxes,
} from 'lucide-react';
import ScanGeoHistoryChart, { ScanHistoryEntry } from './components/ScanGeoHistoryChart.tsx';

interface Partner {
  id: string;
  name: string;
  role: 'manufacturer' | 'logistics' | 'distributor' | 'retailer' | 'regulator';
  country: string;
  public_key: string;
  apiKey?: string;
  privateKey?: string;
  fingerprint?: string;
}

interface Batch {
  id: string;
  batch_code: string;
  product_name: string;
  quantity: number;
  state: string;
  is_recalled: boolean;
  recalled_at?: string;
  recall_reason?: string;
  expiry_date?: string;
  current_holder_name?: string;
  current_holder_role?: string;
  event_count?: number;
  alert_count?: number;
}

interface EventItem {
  id: number;
  batch_id: string;
  type: string;
  actor_id: string;
  actor_name: string;
  actor_role: string;
  to_partner_name?: string;
  quantity: number;
  lat?: number;
  lng?: number;
  occurred_at: string;
  prev_hash: string;
  hash: string;
  signature: string;
  body: any;
}

interface AlertItem {
  id: number;
  rule_code: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  score: number;
  batch_code?: string;
  product_name?: string;
  explanation: string;
  details: any;
  status: 'open' | 'benign' | 'confirmed';
  created_at: string;
}

export default function App() {
  // Navigation tabs matching the screenshot menu
  const [activeTab, setActiveTab] = useState<
    'dashboard' | 'shipping' | 'reports' | 'order' | 'delivery' | 'inventory' | 'settings' | 'guide'
  >('dashboard');

  const [analyticsCategory, setAnalyticsCategory] = useState<'ship' | 'truck' | 'plane' | 'delivery'>('ship');
  const [shipmentFilter, setShipmentFilter] = useState<'notable' | 'delivered' | 'shipping'>('notable');
  const [searchQuery, setSearchQuery] = useState('');

  // Backend state
  const [sseConnected, setSseConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [partners, setPartners] = useState<Partner[]>([]);
  const [activePartner, setActivePartner] = useState<Partner | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [selectedBatchDetails, setSelectedBatchDetails] = useState<{ batch: Batch; events: EventItem[]; alerts: any[] } | null>(null);
  const [units, setUnits] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [chainStatus, setChainStatus] = useState<any>(null);

  // Buyer verification state
  const [verifyTokenInput, setVerifyTokenInput] = useState('');
  const [verifyCity, setVerifyCity] = useState('Berlin');
  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);

  // Demo & Recall states
  const [demoOutput, setDemoOutput] = useState<any>(null);
  const [recallTrace, setRecallTrace] = useState<any>(null);

  // Label Printing states
  const [printModalUnit, setPrintModalUnit] = useState<any | null>(null);
  const [isSheetPrintModalOpen, setIsSheetPrintModalOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // SSE Stream
  useEffect(() => {
    fetchInitialData();

    const eventSource = new EventSource('/api/alerts/stream');
    eventSource.onopen = () => setSseConnected(true);
    eventSource.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.type === 'NEW_ALERT') {
          setAlerts((prev) => [payload.data, ...prev]);
        }
      } catch (err) {
        console.error('SSE parse error:', err);
      }
    };
    eventSource.onerror = () => setSseConnected(false);

    return () => eventSource.close();
  }, []);

  async function fetchInitialData() {
    try {
      const [partnersRes, batchesRes, alertsRes, chainRes] = await Promise.all([
        fetch('/api/partners').then((r) => r.json()),
        fetch('/api/batches').then((r) => r.json()),
        fetch('/api/alerts').then((r) => r.json()),
        fetch('/api/chain/verify').then((r) => r.json()),
      ]);

      if (partnersRes.ok) {
        setPartners(partnersRes.partners || []);
        if (partnersRes.partners?.length > 0 && !activePartner) {
          setActivePartner(partnersRes.partners[0]);
        }
      }
      if (batchesRes.ok) {
        setBatches(batchesRes.batches || []);
        if (batchesRes.batches?.length > 0 && !selectedBatchId) {
          setSelectedBatchId(batchesRes.batches[0].id);
        }
      }
      if (alertsRes.ok) setAlerts(alertsRes.alerts || []);
      if (chainRes) setChainStatus(chainRes);
    } catch (err) {
      console.error('Failed to load initial data:', err);
    }
  }

  // Fetch batch details and units
  useEffect(() => {
    if (selectedBatchId) {
      fetch(`/api/batches/${selectedBatchId}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.ok) setSelectedBatchDetails(data);
        })
        .catch(console.error);

      fetch(`/api/batches/${selectedBatchId}/units?limit=50`)
        .then((r) => r.json())
        .then((data) => {
          if (data.ok) {
            setUnits(data.units || []);
            if (data.units?.length > 0 && !verifyTokenInput) {
              setVerifyTokenInput(data.units[0].token);
            }
          }
        })
        .catch(console.error);
    }
  }, [selectedBatchId]);

  // Run 1-Click Golden Path Demo
  async function runGoldenPath() {
    setLoading(true);
    setStatusMessage('Executing Golden Path: Registering partners, creating LOT42, signing Ed25519 events...');
    try {
      const res = await fetch('/api/demo/golden-path', { method: 'POST' }).then((r) => r.json());
      setDemoOutput(res);
      setStatusMessage('Golden Path executed! Check live shipment history and anomaly feed.');
      await fetchInitialData();
      if (res.batch?.id) setSelectedBatchId(res.batch.id);
      if (res.sampleUnit?.token) setVerifyTokenInput(res.sampleUnit.token);
    } catch (err: any) {
      setStatusMessage('Golden Path error: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  // Run Counterfeit Injection Test
  async function runCounterfeitInjection() {
    setLoading(true);
    setStatusMessage('Simulating photocopy clone: Scanning in Berlin, then Lagos 20 min later (Impossible Travel R4)...');
    try {
      const res = await fetch('/api/demo/counterfeit-injection', { method: 'POST' }).then((r) => r.json());
      setDemoOutput(res);
      setStatusMessage('Counterfeit detected! R4_IMPOSSIBLE_TRAVEL triggered (4,700 km in 20 min).');
      await fetchInitialData();
    } catch (err: any) {
      setStatusMessage('Counterfeit test error: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  // Run Cryptographic Tamper Test
  async function runTamperTest() {
    setLoading(true);
    try {
      const res = await fetch('/api/chain/tamper', { method: 'POST' }).then((r) => r.json());
      setStatusMessage(res.message);
      const audit = await fetch('/api/chain/verify').then((r) => r.json());
      setChainStatus(audit);
    } catch (err: any) {
      setStatusMessage('Tamper error: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  // Restore Tampered Ledger
  async function runRestoreTest() {
    setLoading(true);
    try {
      const res = await fetch('/api/chain/restore', { method: 'POST' }).then((r) => r.json());
      setStatusMessage(res.message);
      const audit = await fetch('/api/chain/verify').then((r) => r.json());
      setChainStatus(audit);
    } catch (err: any) {
      setStatusMessage('Restore error: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  // Buyer Verification Check
  async function handleVerify(tokenOverride?: string, cityOverride?: string) {
    const token = tokenOverride || verifyTokenInput;
    if (!token) return;

    setVerifyLoading(true);
    const city = cityOverride || verifyCity;
    const coords: Record<string, { lat: number; lng: number }> = {
      Berlin: { lat: 52.52, lng: 13.405 },
      Lagos: { lat: 6.5244, lng: 3.3792 },
      Mumbai: { lat: 19.076, lng: 72.8777 },
      Pune: { lat: 18.5204, lng: 73.8567 },
      'New York': { lat: 40.7128, lng: -74.006 },
    };

    const loc = coords[city] || { lat: 52.52, lng: 13.405 };

    try {
      const res = await fetch(
        `/api/verify/${encodeURIComponent(token)}?lat=${loc.lat}&lng=${loc.lng}&city=${encodeURIComponent(city)}&device=browser-scanner`
      ).then((r) => r.json());

      setVerifyResult(res);
      await fetchInitialData();
    } catch (err) {
      console.error('Verify error:', err);
    } finally {
      setVerifyLoading(false);
    }
  }

  // Run Recursive CTE Recall
  async function handleRecallTrace(batchId: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/batches/${batchId}/recall`).then((r) => r.json());
      setRecallTrace(res);
    } catch (err) {
      console.error('Recall trace error:', err);
    } finally {
      setLoading(false);
    }
  }

  // Resolve Alert as Benign
  async function handleResolveBenign(alertId: number) {
    try {
      await fetch(`/api/alerts/${alertId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Reviewed by auditor: legitimate procedural re-scan.' }),
      });
      await fetchInitialData();
    } catch (err) {
      console.error('Resolve error:', err);
    }
  }

  // Dotted column chart data matching the screenshot
  const dottedChartColumns = [
    { month: 'Jan', dots: 4 },
    { month: 'Feb', dots: 6 },
    { month: 'Mar', dots: 7 },
    { month: 'Apr', dots: 8 },
    { month: 'May', dots: 12, highlight: true },
    { month: 'Jun', dots: 8 },
    { month: 'Jul', dots: 7 },
    { month: 'Aug', dots: 6 },
    { month: 'Sep', dots: 9 },
    { month: 'Oct', dots: 11 },
    { month: 'Nov', dots: 9 },
    { month: 'Dec', dots: 8 },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex font-sans antialiased">
      {/* ================= LEFT SIDEBAR (Matching Screenshot) ================= */}
      <aside className="no-print w-64 bg-white border-r border-slate-200 flex flex-col justify-between p-5 select-none shrink-0">
        <div className="space-y-6">
          {/* User Profile Header */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-500 text-white font-bold flex items-center justify-center text-sm shadow-sm ring-2 ring-blue-100">
              R
            </div>
            <div>
              <p className="text-[11px] text-slate-400 font-medium leading-none">Welcome back,</p>
              <h2 className="text-sm font-bold text-slate-900 leading-tight">Ronald!</h2>
              <p className="text-[10px] text-slate-400">ProvChain Logistics</p>
            </div>
          </div>

          {/* Company Selector Dropdown */}
          <div className="bg-slate-50 hover:bg-slate-100/80 border border-slate-200/80 rounded-xl p-2.5 flex items-center justify-between cursor-pointer transition">
            <div className="flex items-center space-x-2.5">
              <div className="w-7 h-7 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 flex items-center justify-center font-bold text-xs">
                <Truck className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-semibold block leading-none">Company</span>
                <span className="text-xs font-bold text-slate-900">Load Swift NYC</span>
              </div>
            </div>
            <ChevronDown className="w-4 h-4 text-slate-400" />
          </div>

          {/* Main Navigation Menu */}
          <div className="space-y-1">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 px-3 block mb-1">
              Menu
            </span>

            {[
              { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
              { id: 'shipping', label: 'Shipping History', icon: Truck },
              { id: 'reports', label: `Report & Analysis ${alerts.filter(a => a.status === 'open').length ? `(${alerts.filter(a => a.status === 'open').length})` : ''}`, icon: FileText },
              { id: 'order', label: 'Order / GS1 QR', icon: Tag },
              { id: 'delivery', label: 'Delivery / Verify', icon: QrCode },
              { id: 'inventory', label: 'Inventory / Recall', icon: Package },
              { id: 'settings', label: 'Settings / Ledger', icon: Settings },
            ].map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id as any)}
                  className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-500/25'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* Help & Support Menu */}
          <div className="space-y-1 pt-3 border-t border-slate-100">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 px-3 block mb-1">
              Help &amp; Support
            </span>

            <button
              onClick={() => setActiveTab('guide')}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-xs font-medium transition ${
                activeTab === 'guide'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/25'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <User className="w-4 h-4 text-slate-400" />
              <span>User Guide / Demo</span>
            </button>

            <button
              onClick={() => setActiveTab('reports')}
              className="w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition"
            >
              <HelpCircle className="w-4 h-4 text-slate-400" />
              <span>FAQ &amp; Rules</span>
            </button>

            <button
              onClick={() => fetchInitialData()}
              className="w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition"
            >
              <MessageSquare className="w-4 h-4 text-slate-400" />
              <span>Contact Support</span>
            </button>
          </div>
        </div>

        {/* System Pill Footer */}
        <div className="pt-4 border-t border-slate-100 text-[11px] text-slate-400 flex items-center justify-between">
          <div className="flex items-center space-x-1.5">
            <span className={`w-2 h-2 rounded-full ${sseConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'}`} />
            <span>{sseConnected ? 'Live Network' : 'Connecting'}</span>
          </div>
          <span className="font-mono text-[10px] text-slate-400">v1.2.0</span>
        </div>
      </aside>

      {/* ================= MAIN CONTAINER ================= */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Top Header Bar (Matching Screenshot) */}
        <header className="no-print bg-white border-b border-slate-200 px-8 py-3.5 flex items-center justify-between sticky top-0 z-30">
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Dashboard</h1>
            <p className="text-xs text-slate-400">Home Couriers System &bull; Sunday, October 2026</p>
          </div>

          <div className="flex items-center space-x-4">
            {/* Pill Search Input with blue circular button */}
            <div className="relative flex items-center">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="bg-white border border-slate-200 rounded-full pl-4 pr-10 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 w-64 shadow-xs"
              />
              <button className="absolute right-1 w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 transition">
                <Search className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Notification Bell with alert counter */}
            <button
              onClick={() => setActiveTab('reports')}
              className="relative p-2 rounded-full hover:bg-slate-100 text-slate-600 transition"
              title="Alerts"
            >
              <Bell className="w-4 h-4" />
              {alerts.filter((a) => a.status === 'open').length > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 bg-rose-500 rounded-full ring-2 ring-white" />
              )}
            </button>

            {/* Message Mail Icon */}
            <button
              onClick={() => setActiveTab('shipping')}
              className="p-2 rounded-full hover:bg-slate-100 text-slate-600 transition"
              title="Shipments"
            >
              <Mail className="w-4 h-4" />
            </button>

            {/* Refresh */}
            <button
              onClick={() => fetchInitialData()}
              className="p-2 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition"
              title="Refresh Telemetry"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Global status banner */}
        {statusMessage && (
          <div className="bg-blue-50 border-b border-blue-200 px-8 py-2 text-xs text-blue-700 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Zap className="w-4 h-4 text-blue-600 flex-shrink-0" />
              <span>{statusMessage}</span>
            </div>
            <button onClick={() => setStatusMessage(null)} className="text-slate-400 hover:text-slate-700 text-sm font-bold">
              &times;
            </button>
          </div>
        )}

        {/* Main Content Area */}
        <main className="flex-1 p-8 space-y-6">
          {/* TAB: DASHBOARD (Exact Match to Screenshot) */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              {/* TOP 4 KPI CARDS (Matching image layout & colors) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                {/* CARD 1: Solid Hero Blue Card */}
                <div className="bg-blue-600 text-white rounded-2xl p-5 shadow-lg shadow-blue-500/25 flex flex-col justify-between h-36">
                  <div className="flex items-center justify-between">
                    <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center text-white">
                      <Package className="w-4 h-4" />
                    </div>
                    <button className="text-white/70 hover:text-white">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>
                  <div>
                    <span className="text-[11px] text-white/80 font-medium block">Total Order</span>
                    <div className="flex items-baseline justify-between mt-0.5">
                      <span className="text-2xl font-bold tracking-tight text-white">$238.00</span>
                      <span className="text-[11px] font-semibold text-white/90 bg-white/20 px-2 py-0.5 rounded-full">
                        +1.29%
                      </span>
                    </div>
                  </div>
                </div>

                {/* CARD 2: White Total Delivery */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col justify-between h-36">
                  <div className="flex items-center justify-between">
                    <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                      <Truck className="w-4 h-4" />
                    </div>
                    <button className="text-slate-400 hover:text-slate-600">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 font-medium block">Total Delivery</span>
                    <div className="flex items-baseline justify-between mt-0.5">
                      <span className="text-2xl font-bold tracking-tight text-slate-900">$35,874</span>
                      <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                        +1.29%
                      </span>
                    </div>
                  </div>
                </div>

                {/* CARD 3: White Return Pending */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col justify-between h-36">
                  <div className="flex items-center justify-between">
                    <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                      <RotateCcw className="w-4 h-4" />
                    </div>
                    <button className="text-slate-400 hover:text-slate-600">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 font-medium block">Return Pending</span>
                    <div className="flex items-baseline justify-between mt-0.5">
                      <span className="text-2xl font-bold tracking-tight text-slate-900">64%</span>
                      <span className="text-[11px] font-semibold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full">
                        -1.29%
                      </span>
                    </div>
                  </div>
                </div>

                {/* CARD 4: White Total Order */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col justify-between h-36">
                  <div className="flex items-center justify-between">
                    <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                      <ShieldCheck className="w-4 h-4" />
                    </div>
                    <button className="text-slate-400 hover:text-slate-600">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 font-medium block">Ledger Integrity</span>
                    <div className="flex items-baseline justify-between mt-0.5">
                      <span className="text-2xl font-bold tracking-tight text-slate-900">$238.00</span>
                      <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                        +1.29%
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* MIDDLE SECTION: Analytics Chart & Shipment History */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* LEFT / CENTER: Analytics & Dotted Column Chart (approx 68% width) */}
                <div className="lg:col-span-8 space-y-6">
                  {/* Analytics Card */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-5">
                    {/* Top Row: Title, Category Pills, and Year filter */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center space-x-4">
                        <h3 className="font-bold text-base text-slate-900">Analytics</h3>

                        {/* Category switch tabs [ Ship | Truck | Plane | Delivery ] */}
                        <div className="flex items-center space-x-1 border-b border-slate-100 pb-0.5">
                          {[
                            { id: 'ship', label: 'Ship', icon: Ship },
                            { id: 'truck', label: 'Truck', icon: Truck },
                            { id: 'plane', label: 'Plane', icon: Plane },
                            { id: 'delivery', label: 'Delivery', icon: Package },
                          ].map((cat) => {
                            const Icon = cat.icon;
                            const isSelected = analyticsCategory === cat.id;
                            return (
                              <button
                                key={cat.id}
                                onClick={() => setAnalyticsCategory(cat.id as any)}
                                className={`flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                                  isSelected
                                    ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                                    : 'text-slate-400 hover:text-slate-600'
                                }`}
                              >
                                <Icon className="w-3.5 h-3.5" />
                                <span>{cat.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Dropdown filter */}
                      <button className="flex items-center space-x-1.5 text-xs font-semibold text-slate-500 bg-slate-50 hover:bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 transition">
                        <span>This year</span>
                        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                      </button>
                    </div>

                    {/* Dotted Bubble Column Chart (Matching Screenshot!) */}
                    <div className="relative pt-2 pb-4">
                      {/* Left Y-axis labels */}
                      <div className="flex">
                        <div className="w-10 flex flex-col justify-between text-[10px] text-slate-400 font-mono py-1 pr-2 text-right select-none">
                          <span>70K</span>
                          <span>60K</span>
                          <span>50K</span>
                          <span>40K</span>
                          <span>30K</span>
                          <span>20K</span>
                          <span>10K</span>
                          <span>0K</span>
                        </div>

                        {/* 12 Columns with stacked circular dots */}
                        <div className="flex-1 grid grid-cols-12 gap-2 h-56 items-end border-b border-slate-100 pb-2 px-1">
                          {dottedChartColumns.map((col, idx) => (
                            <div key={idx} className="flex flex-col items-center justify-end h-full group cursor-pointer">
                              {/* Stacked circular dots */}
                              <div className="flex flex-col-reverse items-center space-y-reverse space-y-1">
                                {Array.from({ length: col.dots }).map((_, dIdx) => {
                                  const isTop = dIdx === col.dots - 1;
                                  return (
                                    <span
                                      key={dIdx}
                                      className={`rounded-full transition-transform group-hover:scale-110 ${
                                        col.highlight && isTop
                                          ? 'w-3.5 h-3.5 bg-blue-700 ring-4 ring-blue-100 shadow-md'
                                          : 'w-2.5 h-2.5 bg-blue-600'
                                      }`}
                                    />
                                  );
                                })}
                              </div>

                              {/* Month label */}
                              <span className="text-[10px] font-medium text-slate-400 mt-2 group-hover:text-blue-600">
                                {col.month}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Bottom Sub-Widgets: Fleet Tonnage & Visits by Country */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                      {/* Sub-Card 1: Our Fleet Tonnage */}
                      <div className="bg-slate-50/70 border border-slate-200/80 rounded-xl p-4 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-slate-800">Our Fleet Tonnage</span>
                          <span className="text-[11px] text-slate-400">Total: 1,247 vehicles</span>
                        </div>
                        <div className="flex items-center justify-between text-xs pt-1">
                          <span className="text-slate-500 font-medium">Ship Freight</span>
                          <span className="font-bold text-slate-900 font-mono">2,345,500</span>
                        </div>
                        <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-600 rounded-full" style={{ width: '74%' }} />
                        </div>
                      </div>

                      {/* Sub-Card 2: Visits by Country */}
                      <div className="bg-slate-50/70 border border-slate-200/80 rounded-xl p-4 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-slate-800">Visits by Country</span>
                          <span className="text-[11px] text-slate-400">20 countries share 97% visits</span>
                        </div>
                        <div className="flex items-center justify-between text-xs pt-1">
                          <div className="flex items-center space-x-2">
                            <span className="text-base leading-none">🇺🇸</span>
                            <span className="text-slate-700 font-medium">United States</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <span className="font-bold text-slate-900 font-mono">9,763</span>
                            <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                              +7.4%
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* RIGHT COLUMN: Shipment History (Matching Screenshot!) */}
                <div className="lg:col-span-4 space-y-6">
                  <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4">
                    {/* Header */}
                    <div>
                      <h3 className="font-bold text-base text-slate-900">Shipment History</h3>
                      <p className="text-xs text-slate-400">59 Active Shipments &bull; Provenance Ledger</p>
                    </div>

                    {/* Filter Tabs: [ Notable | Delivered | Shipping ] */}
                    <div className="flex items-center space-x-4 border-b border-slate-100 text-xs font-semibold pb-1">
                      {[
                        { id: 'notable', label: 'Notable' },
                        { id: 'delivered', label: 'Delivered' },
                        { id: 'shipping', label: 'Shipping' },
                      ].map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => setShipmentFilter(tab.id as any)}
                          className={`pb-2 transition ${
                            shipmentFilter === tab.id
                              ? 'text-blue-600 border-b-2 border-blue-600 font-bold'
                              : 'text-slate-400 hover:text-slate-600'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    {/* Shipment History Cards List */}
                    <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
                      {/* Item 1: Delivered */}
                      <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2 hover:border-slate-300 transition shadow-xs">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2.5">
                            <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                              <Ship className="w-4 h-4" />
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-400 block font-medium">Ship Freight</span>
                              <span className="text-xs font-bold text-slate-900 font-mono">#5635-342808</span>
                            </div>
                          </div>
                          <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                            Delivered
                          </span>
                        </div>

                        {/* Route Timeline with red/blue dots */}
                        <div className="pl-3.5 space-y-1.5 text-[11px] text-slate-500 border-l border-slate-200 ml-4 py-1">
                          <div className="flex items-center space-x-2">
                            <span className="w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white -ml-[17px]" />
                            <span>Messina Harbor, Sicily, Italy</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <span className="w-2 h-2 rounded-full bg-blue-600 ring-2 ring-white -ml-[17px]" />
                            <span>Malakor Container Hotel, Tallinn, EST</span>
                          </div>
                        </div>
                      </div>

                      {/* Item 2: Shipping */}
                      <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2 hover:border-slate-300 transition shadow-xs">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2.5">
                            <div className="w-8 h-8 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
                              <Truck className="w-4 h-4" />
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-400 block font-medium">Ship Freight</span>
                              <span className="text-xs font-bold text-slate-900 font-mono">#5635-342809</span>
                            </div>
                          </div>
                          <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200">
                            Shipping
                          </span>
                        </div>

                        {/* Route Timeline */}
                        <div className="pl-3.5 space-y-1.5 text-[11px] text-slate-500 border-l border-slate-200 ml-4 py-1">
                          <div className="flex items-center space-x-2">
                            <span className="w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white -ml-[17px]" />
                            <span>Nagpur Pharma Facility, IN</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <span className="w-2 h-2 rounded-full bg-blue-600 ring-2 ring-white -ml-[17px]" />
                            <span>MediDist Mumbai Logistics Port, IN</span>
                          </div>
                        </div>
                      </div>

                      {/* Item 3: Delivered */}
                      <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2 hover:border-slate-300 transition shadow-xs">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2.5">
                            <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                              <Package className="w-4 h-4" />
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-400 block font-medium">Ship Freight</span>
                              <span className="text-xs font-bold text-slate-900 font-mono">#5635-342810</span>
                            </div>
                          </div>
                          <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                            Delivered
                          </span>
                        </div>

                        {/* Route Timeline */}
                        <div className="pl-3.5 space-y-1.5 text-[11px] text-slate-500 border-l border-slate-200 ml-4 py-1">
                          <div className="flex items-center space-x-2">
                            <span className="w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white -ml-[17px]" />
                            <span>Messina Harbor, Sicily, Italy</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <span className="w-2 h-2 rounded-full bg-blue-600 ring-2 ring-white -ml-[17px]" />
                            <span>Tallinn Central Distribution, EST</span>
                          </div>
                        </div>
                      </div>

                      {/* Item 4: Anomaly alert item if alerts exist */}
                      {alerts.length > 0 && (
                        <div className="bg-rose-50/50 border border-rose-200 rounded-xl p-3.5 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2.5">
                              <div className="w-8 h-8 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center font-bold">
                                <AlertTriangle className="w-4 h-4" />
                              </div>
                              <div>
                                <span className="text-[10px] text-rose-500 block font-medium">Provenance Alert</span>
                                <span className="text-xs font-bold text-rose-900 font-mono">{alerts[0].rule_code}</span>
                              </div>
                            </div>
                            <span className="text-[10px] font-bold text-rose-700 bg-rose-100 px-2.5 py-0.5 rounded-full">
                              Anomaly
                            </span>
                          </div>
                          <p className="text-[11px] text-rose-800 line-clamp-2">
                            {alerts[0].explanation}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB: SHIPPING HISTORY & LEDGER */}
          {activeTab === 'shipping' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <h3 className="font-bold text-base text-slate-900">Batches &amp; Custody Ledger</h3>
                  <p className="text-xs text-slate-500">
                    Append-only event chain with Ed25519 signatures, state transitions, and custody handoffs.
                  </p>
                </div>
                {batches.length === 0 && (
                  <button
                    onClick={runGoldenPath}
                    className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl transition shadow-sm"
                  >
                    Run Golden Path (Seed Data)
                  </button>
                )}
              </div>

              {/* Batches Table */}
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="p-3">Batch Code</th>
                      <th className="p-3">Product Name</th>
                      <th className="p-3">Quantity</th>
                      <th className="p-3">Current Holder</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {batches.map((b) => (
                      <tr
                        key={b.id}
                        onClick={() => setSelectedBatchId(b.id)}
                        className={`hover:bg-slate-50/80 cursor-pointer transition ${
                          selectedBatchId === b.id ? 'bg-blue-50/60 font-medium' : ''
                        }`}
                      >
                        <td className="p-3 font-mono font-bold text-blue-700">{b.batch_code}</td>
                        <td className="p-3 text-slate-800">{b.product_name}</td>
                        <td className="p-3 text-slate-600 font-mono">{b.quantity} cases</td>
                        <td className="p-3 text-slate-700">
                          <strong>{b.current_holder_name}</strong> ({b.current_holder_role})
                        </td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                              b.is_recalled
                                ? 'bg-red-50 text-red-600 border border-red-200'
                                : b.state === 'SOLD'
                                ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                                : 'bg-blue-50 text-blue-600 border border-blue-200'
                            }`}
                          >
                            {b.is_recalled ? 'RECALLED' : b.state}
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedBatchId(b.id);
                              setActiveTab('order');
                            }}
                            className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-[11px] font-medium"
                          >
                            View QR Labels
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Event Chain Trail for selected batch */}
              {selectedBatchDetails?.events && selectedBatchDetails.events.length > 0 && (
                <div className="space-y-3 pt-4 border-t border-slate-100">
                  <h4 className="font-bold text-sm text-slate-900">
                    Cryptographic Event Trail for {selectedBatchDetails.batch.batch_code} ({selectedBatchDetails.events.length} signed events)
                  </h4>
                  <div className="space-y-2">
                    {selectedBatchDetails.events.map((ev, i) => (
                      <div
                        key={ev.id}
                        className="bg-slate-50/80 border border-slate-200 rounded-xl p-3.5 flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center space-x-3">
                          <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center text-[10px]">
                            {i + 1}
                          </span>
                          <div>
                            <div className="flex items-center space-x-2">
                              <span className="font-bold text-slate-900">{ev.type}</span>
                              <span className="text-slate-500">by {ev.actor_name} ({ev.actor_role})</span>
                            </div>
                            <p className="text-[10px] font-mono text-slate-400">
                              hash: {ev.hash?.slice(0, 24)}... &bull; prev: {ev.prev_hash?.slice(0, 16)}...
                            </p>
                          </div>
                        </div>
                        <span className="text-[11px] font-mono text-slate-400">
                          {new Date(ev.occurred_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB: ORDER / GS1 QR & PRINTABLE LABELS */}
          {activeTab === 'order' && (
            <div className="space-y-6">
              {/* GS1 Station Header */}
              <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-5">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-5">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <Tag className="w-5 h-5 text-blue-600" />
                      <h3 className="font-bold text-base text-slate-900">GS1 Digital Link 2D Barcode &amp; Label Station</h3>
                    </div>
                    <p className="text-xs text-slate-500">
                      Standard: <strong className="text-slate-800">GS1 Digital Link (ISO/IEC 18975:2024 / Sunrise 2027)</strong> with anti-tamper HMAC tokenization.
                    </p>
                    {selectedBatchDetails?.batch && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <span className="text-[11px] font-mono bg-slate-50 px-2 py-0.5 rounded border border-slate-200 text-slate-700">
                          AI(01) GTIN: <strong className="text-slate-900">09506000134352</strong>
                        </span>
                        <span className="text-[11px] font-mono bg-slate-50 px-2 py-0.5 rounded border border-slate-200 text-slate-700">
                          AI(10) LOT: <strong className="text-slate-900">{selectedBatchDetails.batch.batch_code}</strong>
                        </span>
                        <span className="text-[11px] font-mono bg-slate-50 px-2 py-0.5 rounded border border-slate-200 text-slate-700">
                          Units: <strong className="text-slate-900">{units.length} units</strong>
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => setIsSheetPrintModalOpen(true)}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition flex items-center space-x-1.5 shadow-md shadow-blue-500/20"
                    >
                      <Printer className="w-4 h-4" />
                      <span>Print Batch Label Sheet ({units.length})</span>
                    </button>
                  </div>
                </div>

                {/* Units QR Grid */}
                {units.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {units.map((u) => {
                      const gtin = '09506000134352';
                      const lot = selectedBatchDetails?.batch?.batch_code || 'LOT42';
                      const serial = String(u.serial);
                      const t = u.gs1Token || '';
                      const qrPngUrl = `/api/qr/gs1?gtin=${gtin}&lot=${encodeURIComponent(lot)}&serial=${encodeURIComponent(serial)}&t=${encodeURIComponent(t)}`;
                      const qrDownloadUrl = `${qrPngUrl}&download=true`;
                      const gs1Uri = typeof window !== 'undefined'
                        ? `${window.location.origin}/01/${gtin}/10/${lot}/21/${serial}?t=${t}`
                        : `/01/${gtin}/10/${lot}/21/${serial}?t=${t}`;

                      return (
                        <div
                          key={u.id}
                          className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between space-y-3 hover:border-blue-400 hover:shadow-sm transition"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-bold text-xs text-blue-700 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-100">
                              Unit #{u.serial}
                            </span>
                            <span className="text-[10px] uppercase font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                              {u.state || 'COMMISSIONED'}
                            </span>
                          </div>

                          <div className="flex items-center space-x-3 bg-slate-50 p-3 rounded-xl border border-slate-200/80">
                            <img
                              src={qrPngUrl}
                              alt={`GS1 QR code for unit ${u.serial}`}
                              className="w-24 h-24 bg-white p-1 rounded-lg border border-slate-300 shadow-xs flex-shrink-0"
                            />
                            <div className="space-y-1 font-mono text-[10px] text-slate-600 overflow-hidden">
                              <span className="text-slate-400 font-sans uppercase font-bold text-[9px] block">
                                Human-Readable (HRI)
                              </span>
                              <p className="truncate text-slate-800">
                                <strong className="text-blue-600">(01)</strong> {gtin}
                              </p>
                              <p className="truncate text-slate-800">
                                <strong className="text-blue-600">(10)</strong> {lot}
                              </p>
                              <p className="truncate text-slate-800">
                                <strong className="text-blue-600">(21)</strong> {serial.padStart(4, '0')}
                              </p>
                              <p className="truncate text-slate-400 text-[9px]">
                                <strong className="text-cyan-600">SEC:</strong> {t}
                              </p>
                            </div>
                          </div>

                          {/* Action Buttons */}
                          <div className="grid grid-cols-3 gap-1.5 pt-1">
                            <a
                              href={qrDownloadUrl}
                              download={`GS1_${gtin}_${lot}_unit_${serial}.png`}
                              className="py-1.5 px-2 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-[11px] font-medium transition flex items-center justify-center space-x-1"
                              title="Download high-resolution PNG"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>PNG</span>
                            </a>

                            <button
                              onClick={() => setPrintModalUnit({ ...u, gtin, lot, qrPngUrl, gs1Uri })}
                              className="py-1.5 px-2 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-[11px] font-medium transition flex items-center justify-center space-x-1"
                              title="Print Carton Label"
                            >
                              <Printer className="w-3.5 h-3.5" />
                              <span>Print</span>
                            </button>

                            <button
                              onClick={() => {
                                setVerifyTokenInput(u.token);
                                setActiveTab('delivery');
                                handleVerify(u.token);
                              }}
                              className="py-1.5 px-2 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-[11px] font-medium transition flex items-center justify-center space-x-1"
                              title="Verify this code"
                            >
                              <Search className="w-3.5 h-3.5" />
                              <span>Verify</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-8 text-center text-slate-400 bg-slate-50 rounded-xl border border-slate-200">
                    <p className="text-xs">No batch selected. Please run the Golden Path or select a batch from Shipping History.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB: DELIVERY / BUYER VERIFICATION */}
          {activeTab === 'delivery' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left: Scanner Simulator */}
                <div className="lg:col-span-5 space-y-4">
                  <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4">
                    <div className="flex items-center space-x-2 text-slate-900">
                      <QrCode className="w-5 h-5 text-blue-600" />
                      <h2 className="font-bold text-base">Consumer QR Scan Simulator</h2>
                    </div>
                    <p className="text-xs text-slate-500">
                      Simulate a smartphone scanning a GS1 Digital Link QR code. Select different locations to test geo-velocity impossible travel.
                    </p>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-700">Unit Token or Code</label>
                      <input
                        type="text"
                        value={verifyTokenInput}
                        onChange={(e) => setVerifyTokenInput(e.target.value)}
                        placeholder="Enter unitToken (e.g. uuid.hmac)"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-slate-800 focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-700">Simulated Location</label>
                      <div className="grid grid-cols-3 gap-2">
                        {['Berlin', 'Lagos', 'Mumbai', 'Pune', 'New York'].map((city) => (
                          <button
                            key={city}
                            onClick={() => setVerifyCity(city)}
                            className={`px-3 py-2 text-xs rounded-xl border transition flex items-center justify-center space-x-1.5 ${
                              verifyCity === city
                                ? 'bg-blue-50 border-blue-400 text-blue-700 font-bold'
                                : 'bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            <MapPin className="w-3 h-3 text-blue-600" />
                            <span>{city}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      disabled={verifyLoading || !verifyTokenInput}
                      onClick={() => handleVerify()}
                      className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition flex items-center justify-center space-x-2 shadow-md shadow-blue-500/20"
                    >
                      {verifyLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                      <span>Execute Verification Check</span>
                    </button>
                  </div>
                </div>

                {/* Right: Buyer Result Interface */}
                <div className="lg:col-span-7 space-y-4">
                  {verifyResult ? (
                    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-5">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                        <div className="flex items-center space-x-3">
                          {verifyResult.verdict === 'Verified' && (
                            <div className="bg-emerald-50 p-2.5 rounded-xl text-emerald-600 border border-emerald-200">
                              <ShieldCheck className="w-8 h-8" />
                            </div>
                          )}
                          {verifyResult.verdict === 'Caution' && (
                            <div className="bg-amber-50 p-2.5 rounded-xl text-amber-600 border border-amber-200">
                              <AlertTriangle className="w-8 h-8" />
                            </div>
                          )}
                          {verifyResult.verdict === 'Not verified' && (
                            <div className="bg-rose-50 p-2.5 rounded-xl text-rose-600 border border-rose-200">
                              <ShieldOff className="w-8 h-8" />
                            </div>
                          )}
                          {verifyResult.verdict === 'Recalled' && (
                            <div className="bg-red-50 p-2.5 rounded-xl text-red-600 border border-red-200">
                              <ShieldAlert className="w-8 h-8" />
                            </div>
                          )}

                          <div>
                            <div className="flex items-center space-x-2">
                              <span className="text-xl font-bold text-slate-900">{verifyResult.verdict}</span>
                              <span className="text-xs text-slate-500 font-mono">
                                (Risk Score: {verifyResult.score})
                              </span>
                            </div>
                            <p className="text-xs text-slate-500">
                              {verifyResult.verdict === 'Verified' && 'Genuine product record found in cryptographic ledger.'}
                              {verifyResult.verdict === 'Caution' && 'Suspicious travel or repeat scan patterns detected.'}
                              {verifyResult.verdict === 'Not verified' && 'Code was not recognized or failed HMAC check.'}
                              {verifyResult.verdict === 'Recalled' && 'Product has been recalled by manufacturer.'}
                            </p>
                          </div>
                        </div>

                        <div className="text-right">
                          <span className="text-[10px] uppercase font-semibold text-slate-400">Scan Count</span>
                          <p className="text-xs font-mono font-bold text-slate-800">
                            {verifyResult.scanCountBucket} ({verifyResult.rawScanCount || 1} total)
                          </p>
                        </div>
                      </div>

                      {/* Reasons */}
                      {verifyResult.reasons && verifyResult.reasons.length > 0 && (
                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1">
                          <span className="text-xs font-bold text-amber-800 flex items-center space-x-1">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span>Risk Signals:</span>
                          </span>
                          {verifyResult.reasons.map((r: string, idx: number) => (
                            <p key={idx} className="text-xs text-amber-900 pl-5">
                              &bull; {r}
                            </p>
                          ))}
                        </div>
                      )}

                      {/* Safe Product Projection */}
                      {verifyResult.product && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Product</span>
                            <span className="text-slate-900 font-medium">{verifyResult.product.name}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Brand</span>
                            <span className="text-slate-900 font-medium">{verifyResult.product.brand}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Lot</span>
                            <span className="text-slate-900 font-mono">{verifyResult.product.lot}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Expiry</span>
                            <span className="text-slate-900 font-mono">{verifyResult.product.expiry}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-slate-400 space-y-2">
                      <QrCode className="w-10 h-10 mx-auto text-slate-300" />
                      <p className="text-sm">Enter a code on the left and click &ldquo;Execute Verification Check&rdquo;.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Geo-Location History Chart */}
              <ScanGeoHistoryChart
                history={verifyResult?.scanHistory || []}
                onSimulateScan={(city) => handleVerify(undefined, city)}
                isLoading={verifyLoading}
              />
            </div>
          )}

          {/* TAB: REPORT & ANALYSIS (Live Anomalies Feed) */}
          {activeTab === 'reports' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <h3 className="font-bold text-base text-slate-900">Deterministic Anomaly Engine (R1 - R9)</h3>
                  <p className="text-xs text-slate-500">Live SSE stream of detected inconsistencies and outbox alerts.</p>
                </div>
                <span className="text-xs bg-slate-100 text-slate-700 px-3 py-1 rounded-lg font-bold">
                  {alerts.length} Total Alerts
                </span>
              </div>

              {alerts.length === 0 ? (
                <div className="p-12 text-center text-slate-400 space-y-2">
                  <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-500" />
                  <p className="text-sm">No supply-chain inconsistencies detected.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {alerts.map((alert) => (
                    <div
                      key={alert.id}
                      className={`p-4 rounded-xl border transition ${
                        alert.status === 'benign'
                          ? 'bg-slate-50/50 border-slate-200 opacity-60'
                          : alert.severity === 'critical'
                          ? 'bg-red-50 border-red-200'
                          : alert.severity === 'high'
                          ? 'bg-rose-50 border-rose-200'
                          : 'bg-amber-50 border-amber-200'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start space-x-3">
                          <AlertTriangle
                            className={`w-5 h-5 flex-shrink-0 mt-0.5 ${
                              alert.severity === 'critical'
                                ? 'text-red-600'
                                : alert.severity === 'high'
                                ? 'text-rose-600'
                                : 'text-amber-600'
                            }`}
                          />
                          <div>
                            <div className="flex items-center space-x-2">
                              <span className="font-mono text-xs font-bold text-slate-900">{alert.rule_code}</span>
                              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-white/80 border border-slate-200">
                                {alert.severity}
                              </span>
                              {alert.status === 'benign' && (
                                <span className="text-[10px] font-bold text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full">
                                  Resolved as Benign
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-700 mt-1">{alert.explanation}</p>
                            {alert.batch_code && (
                              <span className="text-[10px] text-slate-400 font-mono mt-1 block">
                                Batch: {alert.batch_code} &bull; {new Date(alert.created_at).toLocaleTimeString()}
                              </span>
                            )}
                          </div>
                        </div>

                        {alert.status === 'open' && (
                          <button
                            onClick={() => handleResolveBenign(alert.id)}
                            className="px-3 py-1 bg-white hover:bg-slate-100 text-slate-700 text-xs font-medium rounded-lg border border-slate-200 transition"
                          >
                            Resolve as Benign
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB: INVENTORY / RECALL */}
          {activeTab === 'inventory' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <h3 className="font-bold text-base text-slate-900">Recursive CTE Recall Tracing</h3>
                  <p className="text-xs text-slate-500">
                    Instant lineage traversal over split/child batches, current custodians, and units in stock vs sold.
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <select
                    value={selectedBatchId || ''}
                    onChange={(e) => {
                      setSelectedBatchId(e.target.value);
                      handleRecallTrace(e.target.value);
                    }}
                    className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800"
                  >
                    {batches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.batch_code} &bull; {b.product_name}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={loading || !selectedBatchId}
                    onClick={() => selectedBatchId && handleRecallTrace(selectedBatchId)}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl transition shadow-xs"
                  >
                    Trace Recall
                  </button>
                </div>
              </div>

              {recallTrace && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl text-center">
                      <span className="text-[10px] uppercase font-semibold text-slate-400">Trace Speed</span>
                      <p className="text-xl font-bold text-emerald-600">{recallTrace.executionDurationMs} ms</p>
                      <span className="text-[10px] text-slate-400">&lt; 1 sec target</span>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl text-center">
                      <span className="text-[10px] uppercase font-semibold text-slate-400">Affected Batches</span>
                      <p className="text-xl font-bold text-slate-900">{recallTrace.affectedBatches?.length || 1}</p>
                      <span className="text-[10px] text-slate-400">Includes child splits</span>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl text-center">
                      <span className="text-[10px] uppercase font-semibold text-slate-400">Units in Stock</span>
                      <p className="text-xl font-bold text-blue-600">{recallTrace.totalUnitsInStock}</p>
                      <span className="text-[10px] text-slate-400">Quarantine immediate</span>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl text-center">
                      <span className="text-[10px] uppercase font-semibold text-slate-400">Units Sold</span>
                      <p className="text-xl font-bold text-rose-600">{recallTrace.totalUnitsSold}</p>
                      <span className="text-[10px] text-slate-400">Public recall notice</span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                        <tr>
                          <th className="p-3">Batch Code</th>
                          <th className="p-3">Product</th>
                          <th className="p-3">Quantity</th>
                          <th className="p-3">Current Holder</th>
                          <th className="p-3">State</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {recallTrace.affectedBatches?.map((b: any) => (
                          <tr key={b.id} className="hover:bg-slate-50">
                            <td className="p-3 font-mono font-bold text-blue-700">{b.batch_code}</td>
                            <td className="p-3 text-slate-800">{b.product_name}</td>
                            <td className="p-3 text-slate-600 font-mono">{b.quantity}</td>
                            <td className="p-3 text-slate-700">{b.holder} ({b.holder_role})</td>
                            <td className="p-3 font-mono text-slate-600">{b.state}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB: SETTINGS & LEDGER AUDIT */}
          {activeTab === 'settings' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <h3 className="font-bold text-base text-slate-900">Cryptographic Hash Chain Audit</h3>
                  <p className="text-xs text-slate-500">
                    Audit append-only continuity: <code>hash_n = SHA256(prev_hash || canonical_JSON || signature || actor_id)</code>
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center space-x-1.5 ${
                      chainStatus?.ok
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-rose-50 text-rose-700 border border-rose-200'
                    }`}
                  >
                    {chainStatus?.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                    <span>{chainStatus?.ok ? 'Ledger Chain Verified' : 'Chain Broken!'}</span>
                  </span>
                  <button
                    onClick={chainStatus?.ok === false ? runRestoreTest : runTamperTest}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition ${
                      chainStatus?.ok === false
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                        : 'bg-rose-600 hover:bg-rose-700 text-white'
                    }`}
                  >
                    {chainStatus?.ok === false ? 'Restore Pristine State' : 'Simulate Database Tamper'}
                  </button>
                </div>
              </div>

              {chainStatus?.ok === false && (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl space-y-2 text-xs">
                  <div className="flex items-center space-x-2 text-rose-700 font-bold">
                    <AlertTriangle className="w-4 h-4" />
                    <span>Cryptographic Tamper Pinpointed at Event #{chainStatus.brokenAt}!</span>
                  </div>
                  <p className="text-rose-900">{chainStatus.reason}</p>
                </div>
              )}
            </div>
          )}

          {/* TAB: USER GUIDE & 1-CLICK DEMO */}
          {activeTab === 'guide' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-6">
              <div className="border-b border-slate-100 pb-4">
                <h3 className="font-bold text-base text-slate-900">1-Click Storyline Demo &amp; Benchmark</h3>
                <p className="text-xs text-slate-500">
                  Execute the complete HackNova PS-05 presentation storyline in one click.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <button
                  disabled={loading}
                  onClick={runGoldenPath}
                  className="p-4 rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50/40 text-left transition space-y-2"
                >
                  <span className="text-[10px] font-bold uppercase text-blue-600">Step 1</span>
                  <h4 className="font-bold text-sm text-slate-900">Run Golden Path</h4>
                  <p className="text-xs text-slate-500">
                    Commissions batch LOT42, signs 8 Ed25519 events, and triggers R7 quantity mismatch.
                  </p>
                </button>

                <button
                  disabled={loading}
                  onClick={runCounterfeitInjection}
                  className="p-4 rounded-xl border border-slate-200 hover:border-rose-300 hover:bg-rose-50/40 text-left transition space-y-2"
                >
                  <span className="text-[10px] font-bold uppercase text-rose-600">Step 2</span>
                  <h4 className="font-bold text-sm text-slate-900">Inject Counterfeit Clone</h4>
                  <p className="text-xs text-slate-500">
                    Scans genuine code in Berlin, then scans photocopy 20 min later in Lagos (triggers R4 Impossible Travel).
                  </p>
                </button>

                <button
                  disabled={loading}
                  onClick={chainStatus?.ok === false ? runRestoreTest : runTamperTest}
                  className="p-4 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 text-left transition space-y-2"
                >
                  <span className="text-[10px] font-bold uppercase text-indigo-600">Step 3</span>
                  <h4 className="font-bold text-sm text-slate-900">
                    {chainStatus?.ok === false ? 'Restore Chain' : 'Test DB Tamper'}
                  </h4>
                  <p className="text-xs text-slate-500">
                    Mutates an event body directly in PostgreSQL; audits detect the exact broken event ID.
                  </p>
                </button>
              </div>

              {demoOutput && (
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
                  <span className="text-xs font-bold text-slate-700">Latest Execution Response:</span>
                  <pre className="text-[11px] font-mono text-slate-600 overflow-x-auto">
                    {JSON.stringify(demoOutput, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* SINGLE UNIT PRINT MODAL */}
      {printModalUnit && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2 text-slate-900">
                <Printer className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-sm">Print GS1 Unit Barcode Label</h3>
              </div>
              <button
                onClick={() => setPrintModalUnit(null)}
                className="text-slate-400 hover:text-slate-700 text-lg font-bold"
              >
                &times;
              </button>
            </div>

            <div className="bg-white text-slate-950 p-5 rounded-xl border-2 border-dashed border-slate-400 space-y-3">
              <div className="border-b border-slate-300 pb-2">
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block">
                  Pharmaceutical Packaging Barcode Label
                </span>
                <h4 className="font-bold text-sm text-slate-900">
                  {selectedBatchDetails?.batch?.product_name || 'Cefixime 200mg Oral Suspension'}
                </h4>
                <p className="text-[10px] text-slate-600">
                  Mfg: {selectedBatchDetails?.batch?.current_holder_name || 'ApexBio Pharma'} &bull; Origin: IN
                </p>
              </div>

              <div className="flex items-center space-x-4">
                <img
                  src={printModalUnit.qrPngUrl}
                  alt="GS1 QR"
                  className="w-28 h-28 border border-slate-300 p-1 bg-white"
                />
                <div className="space-y-1 font-mono text-[11px] text-slate-900">
                  <p><strong>(01) GTIN:</strong> {printModalUnit.gtin}</p>
                  <p><strong>(10) LOT:</strong> {printModalUnit.lot}</p>
                  <p><strong>(21) SERIAL:</strong> {String(printModalUnit.serial).padStart(4, '0')}</p>
                  <p><strong>(17) EXP:</strong> 2028-10-30</p>
                  <p className="text-[9px] text-slate-500 break-all">
                    TOKEN: {printModalUnit.gs1Token || printModalUnit.token?.slice(0, 16)}
                  </p>
                </div>
              </div>

              <div className="text-[9px] text-slate-500 text-center border-t border-slate-200 pt-1">
                GS1 Digital Link ISO/IEC 18975:2024 &bull; Scan with any camera or POS 2D scanner
              </div>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <a
                href={`${printModalUnit.qrPngUrl}&download=true`}
                download={`GS1_${printModalUnit.gtin}_${printModalUnit.lot}_unit_${printModalUnit.serial}.png`}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl text-xs transition flex items-center space-x-1.5"
              >
                <Download className="w-4 h-4" />
                <span>Download PNG</span>
              </a>
              <button
                onClick={() => window.print()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition flex items-center space-x-1.5 shadow-md shadow-blue-500/20"
              >
                <Printer className="w-4 h-4" />
                <span>Print Label Now</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FULL BATCH SHEET PRINT MODAL */}
      {isSheetPrintModalOpen && selectedBatchDetails?.batch && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2 text-slate-900">
                <Printer className="w-5 h-5 text-blue-600" />
                <div>
                  <h3 className="font-bold text-sm">Batch Adhesive Label Sheet ({units.length} Unit Labels)</h3>
                  <p className="text-xs text-slate-500">
                    Formatted for standard 2D barcode adhesive sticker sheets (Avery 3x7 or pharma roll stock).
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsSheetPrintModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-lg font-bold"
              >
                &times;
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-slate-50 p-6 rounded-xl border border-slate-200 text-slate-950 space-y-4">
              <div className="text-center border-b border-slate-200 pb-2">
                <h4 className="font-bold text-base text-slate-900">
                  {selectedBatchDetails.batch.product_name} &bull; Batch {selectedBatchDetails.batch.batch_code}
                </h4>
                <p className="text-xs text-slate-500 font-mono">
                  GTIN: 09506000134352 &bull; Total Units: {units.length} &bull; Sunrise 2027 Compliant
                </p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {units.map((u) => {
                  const gtin = '09506000134352';
                  const lot = selectedBatchDetails.batch.batch_code;
                  const serial = String(u.serial);
                  const t = u.gs1Token || '';
                  const qrPngUrl = `/api/qr/gs1?gtin=${gtin}&lot=${encodeURIComponent(lot)}&serial=${encodeURIComponent(serial)}&t=${encodeURIComponent(t)}`;

                  return (
                    <div
                      key={u.id}
                      className="border border-dashed border-slate-300 p-2.5 rounded-lg flex items-center space-x-2.5 bg-white text-slate-900"
                    >
                      <img
                        src={qrPngUrl}
                        alt={`QR ${u.serial}`}
                        className="w-16 h-16 border border-slate-200 p-0.5 flex-shrink-0"
                      />
                      <div className="font-mono text-[9px] space-y-0.5 overflow-hidden">
                        <p className="font-bold text-[10px] text-slate-950 truncate">
                          {selectedBatchDetails.batch.product_name.slice(0, 18)}
                        </p>
                        <p className="truncate">(01) {gtin}</p>
                        <p className="truncate">(10) {lot}</p>
                        <p className="truncate font-bold text-blue-700">
                          (21) {serial.padStart(4, '0')}
                        </p>
                        <p className="text-slate-400 text-[8px] truncate">EXP: 2028-10-30</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <span className="text-xs text-slate-400">
                Tip: Choose &ldquo;Save as PDF&rdquo; in the print dialog to export a printable PDF sheet.
              </span>
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => setIsSheetPrintModalOpen(false)}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl text-xs transition"
                >
                  Close
                </button>
                <button
                  onClick={() => window.print()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition flex items-center space-x-1.5 shadow-md shadow-blue-500/20"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print Entire Sheet Now</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PRINT-ONLY DOM CONTAINER */}
      <div className="print-only p-4 font-sans text-black bg-white">
        {printModalUnit ? (
          <div className="max-w-md mx-auto border-2 border-dashed border-gray-400 p-6 rounded-lg text-black space-y-3">
            <div className="border-b border-gray-300 pb-2">
              <span className="text-[10px] font-bold text-gray-500 block uppercase">
                Pharmaceutical Packaging Barcode Label
              </span>
              <h3 className="font-bold text-base text-gray-950">
                {selectedBatchDetails?.batch?.product_name || 'Cefixime 200mg Oral Suspension'}
              </h3>
              <p className="text-xs text-gray-700">
                Manufacturer: {selectedBatchDetails?.batch?.current_holder_name || 'ApexBio Pharma'} &bull; Origin: IN
              </p>
            </div>

            <div className="flex items-center space-x-6 py-2">
              <img
                src={printModalUnit.qrPngUrl}
                alt="Barcode"
                className="w-32 h-32 border border-gray-300 p-1 bg-white"
              />
              <div className="space-y-1 font-mono text-xs text-gray-900">
                <p><strong>(01) GTIN:</strong> {printModalUnit.gtin}</p>
                <p><strong>(10) LOT:</strong> {printModalUnit.lot}</p>
                <p><strong>(21) SERIAL:</strong> {String(printModalUnit.serial).padStart(4, '0')}</p>
                <p><strong>(17) EXP:</strong> 2028-10-30</p>
                <p className="text-[10px] text-gray-600"><strong>SEC:</strong> {printModalUnit.gs1Token || 'Verified'}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-center border-b border-gray-300 pb-3">
              <h2 className="text-xl font-bold text-gray-950">
                {selectedBatchDetails?.batch?.product_name} &bull; Batch {selectedBatchDetails?.batch?.batch_code}
              </h2>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {units.map((u) => {
                const gtin = '09506000134352';
                const lot = selectedBatchDetails?.batch?.batch_code || 'LOT42';
                const serial = String(u.serial);
                const t = u.gs1Token || '';
                const qrPngUrl = `/api/qr/gs1?gtin=${gtin}&lot=${encodeURIComponent(lot)}&serial=${encodeURIComponent(serial)}&t=${encodeURIComponent(t)}`;

                return (
                  <div
                    key={u.id}
                    className="border border-dashed border-gray-400 p-3 rounded-lg flex items-center space-x-3 bg-white text-gray-950"
                  >
                    <img
                      src={qrPngUrl}
                      alt={`Unit ${u.serial}`}
                      className="w-20 h-20 border border-gray-300 p-0.5 flex-shrink-0"
                    />
                    <div className="font-mono text-[10px] space-y-0.5 overflow-hidden">
                      <p className="font-bold text-xs truncate">
                        {selectedBatchDetails?.batch?.product_name?.slice(0, 16)}
                      </p>
                      <p>(01) {gtin}</p>
                      <p>(10) {lot}</p>
                      <p className="font-bold text-blue-900">(21) {serial.padStart(4, '0')}</p>
                      <p className="text-[9px] text-gray-600">EXP: 2028-10-30</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
