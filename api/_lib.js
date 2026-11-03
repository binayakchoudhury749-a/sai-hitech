// Shared helpers for the server functions. Files starting with "_" are not public routes.
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';

export const LOGIN_DOMAIN = (process.env.LOGIN_DOMAIN || 'weighbridge.app').toLowerCase();
export const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
export const ROLES = ['owner', 'admin', 'manager'];

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function adminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(500, 'Server setup is incomplete: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in Vercel.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function emailFor(username) { return `${username}@${LOGIN_DOMAIN}`; }

export function cleanUsername(u) {
  const v = String(u || '').trim().toLowerCase();
  if (!USERNAME_RE.test(v)) throw new HttpError(400, 'Username must be 3–30 characters: letters, numbers, dot, dash or underscore.');
  return v;
}

export function checkPassword(p) {
  if (typeof p !== 'string' || p.length < 8 || p.length > 72) throw new HttpError(400, 'Password must be 8–72 characters.');
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) throw new HttpError(400, 'Password must contain at least one letter and one number.');
  return p;
}

export function cleanName(n) { return String(n || '').trim().replace(/\s+/g, ' ').slice(0, 80); }

export function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && timingSafeEqual(x, y);
}

// Verifies the caller's login token and returns their profile.
export async function requireUser(req, sb, { role } = {}) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) throw new HttpError(401, 'Not signed in.');
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, 'Your session has ended. Sign in again.');
  const { data: p } = await sb.from('profiles').select('id, username, role, active').eq('id', data.user.id).maybeSingle();
  if (!p || !p.active) throw new HttpError(403, 'This account is turned off.');
  if (role && p.role !== role) throw new HttpError(403, 'Only the owner can do this.');
  return p;
}

export async function audit(sb, actor, action, details, extra = {}) {
  await sb.from('audit_log').insert({ actor, action, details, ...extra });
}

export function send(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json').send(JSON.stringify(body));
}

export function handle(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      send(res, status, { error: status === 500 && !(e instanceof HttpError) ? 'Something went wrong on the server.' : e.message });
    }
  };
}
