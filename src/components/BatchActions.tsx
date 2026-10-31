import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';

// Keys match the server's CITIES table (src/server/geo.ts)
export const INDIA_CITIES: Record<string, string> = {
  AHMEDABAD: 'Ahmedabad',
  BENGALURU: 'Bengaluru',
  CHENNAI: 'Chennai',
  DELHI: 'Delhi',
  GUWAHATI: 'Guwahati',
  HYDERABAD: 'Hyderabad',
  JAIPUR: 'Jaipur',
  KOLKATA: 'Kolkata',
  MUMBAI: 'Mumbai',
  NAGPUR: 'Nagpur',
  PUNE: 'Pune',
};

type StepType = 'INSPECTED' | 'PACKAGED' | 'DISPATCHED' | 'RECEIVED' | 'SOLD';

interface BatchLike {
  id: string;
  batch_code: string;
  product_name: string;
  quantity: number;
  state: string;
  is_recalled?: boolean;
  current_holder_role?: string;
  pending_recipient_role?: string | null;
  current_city?: string | null;
  destination_city?: string | null;
}

const STEP_LABEL: Record<StepType, string> = {
  INSPECTED: 'Inspect',
  PACKAGED: 'Package',
  DISPATCHED: 'Dispatch',
  RECEIVED: 'Receive',
  SOLD: 'Mark sold',
};

/** The next lifecycle step for a batch, and who it is recorded as (the server signs as that partner). */
export function nextStep(b: BatchLike): { type: StepType; as: string } | null {
  if (b.is_recalled) return null;
  const roleName = (role?: string | null) =>
    role === 'logistics' ? 'logistics fleet' : role === 'distributor' ? 'distributor' : role === 'retailer' ? 'retail store' : 'manufacturer';
  switch (b.state) {
    case 'MANUFACTURED':
      return { type: 'INSPECTED', as: 'manufacturer' };
    case 'INSPECTED':
      return { type: 'PACKAGED', as: 'manufacturer' };
    case 'PACKAGED':
      return { type: 'DISPATCHED', as: 'manufacturer' };
    case 'IN_TRANSIT':
      return { type: 'RECEIVED', as: roleName(b.pending_recipient_role) };
    case 'RECEIVED':
      return b.current_holder_role === 'retailer'
        ? { type: 'SOLD', as: 'retail store' }
        : { type: 'DISPATCHED', as: roleName(b.current_holder_role) };
    default:
      return null;
  }
}

async function post(url: string, body: any) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(data.message || data.error || 'Request failed');
  return data;
}

const fieldClass =
  'mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-normal bg-white focus:outline-none focus:border-blue-500';

function CitySelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="block text-xs font-semibold text-slate-700">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={fieldClass}>
        {Object.entries(INDIA_CITIES).map(([key, name]) => (
          <option key={key} value={key}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm text-slate-900">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FormFooter({ busy, error, submitLabel }: { busy: boolean; error: string | null; submitLabel: string }) {
  return (
    <>
      {error && (
        <p role="alert" className="text-xs text-rose-600">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg py-2 transition cursor-pointer"
      >
        {busy ? 'Saving…' : submitLabel}
      </button>
    </>
  );
}

export function NewBatchButton({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [productName, setProductName] = useState('');
  const [quantity, setQuantity] = useState(100);
  const [city, setCity] = useState('NAGPUR');
  const [expiryDate, setExpiryDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/api/workspace/batches', { productName, quantity, city, expiryDate: expiryDate || undefined });
      setOpen(false);
      setProductName('');
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl transition shadow-sm flex items-center gap-1.5 cursor-pointer"
      >
        <Plus className="w-3.5 h-3.5" /> New batch
      </button>
      {open && (
        <Modal title="Create a new batch" onClose={() => setOpen(false)}>
          <form onSubmit={submit} className="space-y-3">
            <label className="block text-xs font-semibold text-slate-700">
              Product name
              <input
                required
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="e.g. Paracetamol 500mg Tablets"
                className={fieldClass}
              />
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              Units
              <input
                type="number"
                required
                min={1}
                max={5000}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className={fieldClass}
              />
            </label>
            <CitySelect label="Manufactured in" value={city} onChange={setCity} />
            <label className="block text-xs font-semibold text-slate-700">
              Expiry date (optional)
              <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className={fieldClass} />
            </label>
            <FormFooter busy={busy} error={error} submitLabel="Create batch" />
          </form>
        </Modal>
      )}
    </>
  );
}

export function StepButton({ batch, onDone }: { batch: BatchLike; onDone: () => void }) {
  const step = nextStep(batch);
  const cityKeyOf = (name?: string | null) => Object.keys(INDIA_CITIES).find((k) => INDIA_CITIES[k] === name);
  const [open, setOpen] = useState(false);
  // Receiving happens at the destination; every other step where the batch currently is
  const [city, setCity] = useState(
    (step?.type === 'RECEIVED' ? cityKeyOf(batch.destination_city) : cityKeyOf(batch.current_city)) || 'NAGPUR'
  );
  const [quantity, setQuantity] = useState(batch.quantity);
  // Manufacturers usually hand to a fleet; fleets and distributors deliver to a store
  const [to, setTo] = useState<'logistics' | 'distributor' | 'retailer'>(batch.state === 'PACKAGED' ? 'logistics' : 'retailer');
  const [destination, setDestination] = useState('DELHI');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!step) return <span className="text-[11px] text-slate-400">—</span>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post(`/api/workspace/batches/${batch.id}/events`, {
        type: step!.type,
        city,
        quantity,
        ...(step!.type === 'DISPATCHED' ? { to, destination } : {}),
      });
      setOpen(false);
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title={`Recorded as the ${step.as}`}
        className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-[11px] rounded-lg transition cursor-pointer"
      >
        {STEP_LABEL[step.type]}
      </button>
      {open && (
        <Modal title={`${STEP_LABEL[step.type]} · ${batch.batch_code}`} onClose={() => setOpen(false)}>
          <form onSubmit={submit} className="space-y-3">
            <p className="text-xs text-slate-500">
              {batch.product_name} · recorded as the {step.as}
            </p>
            <CitySelect label={step.type === 'DISPATCHED' ? 'Dispatching from' : 'Location'} value={city} onChange={setCity} />
            {(step.type === 'RECEIVED' || step.type === 'DISPATCHED') && (
              <label className="block text-xs font-semibold text-slate-700">
                {step.type === 'RECEIVED' ? 'Units received' : 'Units dispatched'}
                <input
                  type="number"
                  min={0}
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  className={fieldClass}
                />
              </label>
            )}
            {step.type === 'DISPATCHED' && (
              <>
                <label className="block text-xs font-semibold text-slate-700">
                  Send to
                  <select value={to} onChange={(e) => setTo(e.target.value as any)} className={fieldClass}>
                    <option value="logistics">Logistics fleet</option>
                    <option value="distributor">Distributor</option>
                    <option value="retailer">Retail store</option>
                  </select>
                </label>
                <CitySelect label="Destination" value={destination} onChange={setDestination} />
              </>
            )}
            <FormFooter busy={busy} error={error} submitLabel={STEP_LABEL[step.type]} />
          </form>
        </Modal>
      )}
    </>
  );
}
