// One-time creation of the first owner account. Works only while SETUP_KEY is set
// in Vercel AND no owner exists yet.
import { handle, send, adminClient, cleanUsername, checkPassword, cleanName, emailFor, safeEqual, audit, HttpError } from './_lib.js';

async function ownerExists(sb) {
  const { count, error } = await sb.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'owner');
  if (error || typeof count !== 'number')
    throw new HttpError(500, 'Can’t reach the database. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel, and that supabase/schema.sql was run in the Supabase SQL Editor.');
  return count > 0;
}

export default handle(async (req, res) => {
  const sb = adminClient();
  if (req.method === 'GET') {
    return send(res, 200, { enabled: Boolean(process.env.SETUP_KEY), done: await ownerExists(sb) });
  }
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  if (!process.env.SETUP_KEY) throw new HttpError(403, 'Setup is turned off.');
  const b = req.body || {};
  if (!safeEqual(b.setupKey, process.env.SETUP_KEY)) {
    await new Promise(r => setTimeout(r, 1200));
    throw new HttpError(403, 'Wrong setup key.');
  }
  if (await ownerExists(sb)) throw new HttpError(409, 'An owner account already exists. Sign in instead.');

  const username = cleanUsername(b.username);
  const password = checkPassword(b.password);
  const fullName = cleanName(b.fullName);

  const { data, error } = await sb.auth.admin.createUser({
    email: emailFor(username), password, email_confirm: true, user_metadata: { username }
  });
  if (error) throw new HttpError(400, error.message);
  const { error: pErr } = await sb.from('profiles').insert({ id: data.user.id, username, full_name: fullName, role: 'owner', active: true });
  if (pErr) {
    await sb.auth.admin.deleteUser(data.user.id);
    throw new HttpError(400, pErr.code === '23505' ? 'That username is taken.' : pErr.message);
  }
  await audit(sb, data.user.id, 'USER', `Owner account “${username}” created during setup`);
  send(res, 200, { ok: true });
});
