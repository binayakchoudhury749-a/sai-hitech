// Shared helpers for every page.
export const $ = (s, el) => (el || document).querySelector(s);
export const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

let cfgPromise;
export function getConfig() {
  if (!cfgPromise) {
    cfgPromise = fetch('/api/config', { cache: 'no-store' }).then(async r => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'The server isn’t set up yet.');
      return j;
    });
  }
  return cfgPromise;
}

// "Keep me signed in": the session lives in localStorage (survives closing the browser);
// otherwise in sessionStorage (closing the browser signs the person out).
const REMEMBER = 'wb-remember';
const remembered = () => { try { return localStorage.getItem(REMEMBER) === '1'; } catch { return false; } };
const area = () => (remembered() ? window.localStorage : window.sessionStorage);
const sessionStore = {
  getItem: k => { try { return area().getItem(k); } catch { return null; } },
  setItem: (k, v) => { try { area().setItem(k, v); } catch { /* storage blocked */ } },
  removeItem: k => { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch { /* ignore */ } }
};
export function setRemember(on) {
  try { if (on) localStorage.setItem(REMEMBER, '1'); else localStorage.removeItem(REMEMBER); } catch { /* ignore */ }
}

let client;
export async function getClient() {
  if (client) return client;
  const cfg = await getConfig();
  client = window.supabase.createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storage: sessionStore, storageKey: 'wb-session' }
  });
  return client;
}

export async function loginEmail(username) {
  const cfg = await getConfig();
  return `${String(username).trim().toLowerCase()}@${cfg.domain}`;
}

// Call one of our server functions with the signed-in person's token.
export async function api(path, body) {
  const sb = await getClient();
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {})
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'The server didn’t answer. Try again.');
  return j;
}

/* ---------- formatting ---------- */
export const pad = n => String(n).padStart(2, '0');
export function todayStr() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function monthEnd(s) { const y = +s.slice(0, 4), m = +s.slice(5, 7); return s.slice(0, 8) + pad(new Date(y, m, 0).getDate()); }
export function fmtDate(s) { if (!s) return ''; const p = String(s).slice(0, 10).split('-'); return `${p[2]}-${p[1]}-${p[0]}`; }
export function fmtDateTime(s) {
  if (!s) return '';
  const d = new Date(s);
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const nf2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfW = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
export const fmtW = v => (v == null || v === '') ? '' : nfW.format(Number(v));
export const fmtA = v => (v == null || v === '') ? '' : nf2.format(Number(v));
export function num(v) { if (v === '' || v == null) return null; const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : NaN; }
export const r3 = n => Math.round(n * 1000) / 1000;
export const r2 = n => Math.round(n * 100) / 100;

/* ---------- small UI pieces ---------- */
let toastT;
export function toast(msg) {
  const t = $('#toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 4000);
}
export function td(text, cls) {
  const c = document.createElement('td');
  if (cls) c.className = cls;
  c.textContent = text == null ? '' : String(text);
  return c;
}
export function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  kids.flat().forEach(k => k != null && e.append(k));
  return e;
}

// Turn a database error into a plain sentence.
export function dbMsg(e) {
  if (!e) return 'Something went wrong. Try again.';
  const m = String(e.message || '');
  if (e.code === '23505') return 'That slip number is already saved. Use a different slip number.';
  if (/TYPE_REQUIRED/.test(m)) return 'Choose Purchase or Sales for this entry.';
  if (/RATE_REQUIRED/.test(m)) return 'Enter the rate. The owner has made it compulsory.';
  if (e.code === '23514') return 'Check the numbers: deduction can’t be more than net weight, and weights can’t be negative.';
  if (e.code === '42501' || /row-level security/i.test(m)) return 'Your account isn’t allowed to do this.';
  if (/JWT|session/i.test(m)) return 'Your session has ended. Sign in again.';
  if (/fetch|network/i.test(m)) return 'No connection to the server. Check the internet and try again.';
  return m || 'Something went wrong. Try again.';
}

export function loadScript(src) {
  loadScript.c = loadScript.c || {};
  if (!loadScript.c[src]) loadScript.c[src] = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = res; s.onerror = () => { delete loadScript.c[src]; rej(new Error('A download tool couldn’t load. Reload the page and try again.')); };
    document.head.appendChild(s);
  });
  return loadScript.c[src];
}

export function saveFile(filename, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function askConfirm(title, text, yesLabel = 'Delete') {
  const d = $('#confirmDlg');
  $('#cfTitle').textContent = title; $('#cfText').textContent = text; $('#cfYes').textContent = yesLabel;
  return new Promise(res => {
    const done = v => { d.close(); $('#cfYes').onclick = null; $('#cfNo').onclick = null; res(v); };
    $('#cfYes').onclick = () => done(true);
    $('#cfNo').onclick = () => done(false);
    d.oncancel = () => done(false);
    d.showModal();
  });
}

export const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
export function passwordProblem(p) {
  if (!p || p.length < 8) return 'Password must be at least 8 characters.';
  if (p.length > 72) return 'Password must be 72 characters or fewer.';
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return 'Password must contain at least one letter and one number.';
  return '';
}
