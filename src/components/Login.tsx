import React, { useState } from 'react';
import { ShieldCheck, Factory, Truck, LogIn } from 'lucide-react';

export type Persona = 'manufacturer' | 'logistics' | 'consumer';
export interface Session {
  email: string;
  persona: Persona;
}

// Fake auth: the email domain decides the portal. No password check, nothing leaves the browser.
const DOMAIN_PERSONA: Record<string, Persona> = {
  'gmail.com': 'consumer',
  'logistics.com': 'logistics',
  'retailer.com': 'manufacturer',
};

const STORAGE_KEY = 'provchain-session';

export function loadSession(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return s?.email && s?.persona ? s : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

const DEMO_ACCOUNTS = [
  { email: 'priya@gmail.com', label: 'Consumer', icon: ShieldCheck },
  { email: 'ops@logistics.com', label: 'Logistics', icon: Truck },
  { email: 'store@retailer.com', label: 'Manufacturer & Retail', icon: Factory },
];

export default function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  function login(rawEmail: string) {
    const clean = rawEmail.trim().toLowerCase();
    const persona = DOMAIN_PERSONA[clean.split('@')[1] || ''];
    if (!/^[^\s@]+@[^\s@]+$/.test(clean) || !persona) {
      setError('Use an @gmail.com (consumer), @logistics.com (logistics) or @retailer.com (manufacturer) email.');
      return;
    }
    const session = { email: clean, persona };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {}
    onLogin(session);
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans antialiased">
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">ProvChain</h1>
          <p className="text-xs text-slate-500">Sign in to your supply chain portal</p>
        </div>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            login(email);
          }}
        >
          <label className="block text-xs font-semibold text-slate-700">
            Email
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              placeholder="you@gmail.com"
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-normal focus:outline-none focus:border-blue-500"
            />
          </label>
          <label className="block text-xs font-semibold text-slate-700">
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Any password (demo)"
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-normal focus:outline-none focus:border-blue-500"
            />
          </label>
          {error && (
            <p role="alert" className="text-xs text-rose-600">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg py-2 transition cursor-pointer"
          >
            <LogIn className="w-4 h-4" /> Sign in
          </button>
        </form>

        <div className="pt-4 border-t border-slate-100 space-y-2">
          <p className="text-[11px] uppercase font-bold tracking-wider text-slate-400">Demo accounts</p>
          {DEMO_ACCOUNTS.map(({ email: demoEmail, label, icon: Icon }) => (
            <button
              key={demoEmail}
              onClick={() => login(demoEmail)}
              className="w-full flex items-center justify-between text-xs border border-slate-200 hover:bg-slate-50 rounded-lg px-3 py-2 transition cursor-pointer"
            >
              <span className="flex items-center gap-2 font-semibold text-slate-700">
                <Icon className="w-4 h-4 text-slate-500" /> {label}
              </span>
              <span className="font-mono text-slate-400">{demoEmail}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
