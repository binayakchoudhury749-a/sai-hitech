import { $, getClient, getConfig, loginEmail, USERNAME_RE } from './common.js';

const form = $('#loginForm'), err = $('#err'), btn = $('#loginBtn');
let fails = 0;

const params = new URLSearchParams(location.search);
const notices = {
  timeout: 'You were signed out after a period of no activity.',
  off: 'This account is turned off. Ask the owner.',
  out: 'You have signed out.'
};
if (notices[params.get('m')]) { $('#notice').textContent = notices[params.get('m')]; $('#notice').hidden = false; }

$('#showPw').onclick = () => {
  const i = form.elements.password, show = i.type === 'password';
  i.type = show ? 'text' : 'password';
  $('#showPw').textContent = show ? 'Hide' : 'Show';
  $('#showPw').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
};

(async () => {
  try {
    await getConfig();
    const sb = await getClient();
    const { data } = await sb.auth.getSession();
    if (data.session) { location.replace('/app'); return; }
    const r = await fetch('/api/setup', { cache: 'no-store' });
    if (r.ok) { const s = await r.json(); $('#setupLink').hidden = !(s.enabled && !s.done); }
  } catch (e) {
    err.textContent = e.message;
  }
})();

form.addEventListener('submit', async ev => {
  ev.preventDefault();
  err.textContent = '';
  const username = form.elements.username.value.trim().toLowerCase();
  const password = form.elements.password.value;
  if (!username || !password) { err.textContent = 'Enter your username and password.'; return; }
  if (!USERNAME_RE.test(username)) { err.textContent = 'Wrong username or password.'; return; }
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    if (fails >= 3) await new Promise(r => setTimeout(r, Math.min(8000, 1000 * fails)));
    const sb = await getClient();
    const { error } = await sb.auth.signInWithPassword({ email: await loginEmail(username), password });
    if (error) {
      fails++;
      err.textContent = /banned/i.test(error.message) ? 'This account is turned off. Ask the owner.'
        : /rate|too many/i.test(error.message) ? 'Too many tries. Wait a few minutes and try again.'
        : 'Wrong username or password.';
      form.elements.password.value = '';
      return;
    }
    location.replace('/app');
  } catch (e) {
    err.textContent = e.message || 'Couldn’t reach the server. Check the internet and try again.';
  } finally {
    btn.disabled = false; btn.textContent = 'Sign in';
  }
});
