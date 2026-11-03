import { $, USERNAME_RE, passwordProblem } from './common.js';

const form = $('#setupForm'), err = $('#err'), btn = $('#setupBtn');

(async () => {
  try {
    const r = await fetch('/api/setup', { cache: 'no-store' });
    const s = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(s.error || 'The server isn’t set up yet.');
    if (s.done) { $('#lead').textContent = 'The owner account already exists. Sign in instead.'; $('#fields').hidden = true; }
    else if (!s.enabled) { $('#lead').textContent = 'Setup is turned off. Add SETUP_KEY in Vercel’s environment variables and redeploy.'; $('#fields').hidden = true; }
  } catch (e) { err.textContent = e.message; $('#fields').hidden = true; }
})();

form.addEventListener('submit', async ev => {
  ev.preventDefault();
  err.textContent = '';
  const v = Object.fromEntries(new FormData(form));
  v.username = String(v.username || '').trim().toLowerCase();
  if (!v.setupKey) return (err.textContent = 'Enter the setup key.');
  if (!USERNAME_RE.test(v.username)) return (err.textContent = 'Username must be 3–30 characters: letters, numbers, dot, dash or underscore.');
  const pp = passwordProblem(v.password); if (pp) return (err.textContent = pp);
  if (v.password !== v.password2) return (err.textContent = 'The two passwords don’t match.');
  btn.disabled = true; btn.textContent = 'Creating…';
  try {
    const r = await fetch('/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setupKey: v.setupKey, username: v.username, fullName: v.fullName, password: v.password }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Setup failed.');
    $('#lead').textContent = 'Owner account created. Now remove SETUP_KEY from Vercel, then sign in.';
    $('#fields').hidden = true;
    setTimeout(() => location.replace('/'), 2500);
  } catch (e) { err.textContent = e.message; }
  finally { btn.disabled = false; btn.textContent = 'Create owner account'; }
});
