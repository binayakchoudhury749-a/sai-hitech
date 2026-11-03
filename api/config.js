// Public settings the browser needs. The anon key is designed to be public;
// the database security rules (RLS) protect the data.
import { handle, send, LOGIN_DOMAIN, HttpError, supabaseUrl } from './_lib.js';

export default handle(async (req, res) => {
  if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  if (!anonKey) throw new HttpError(500, 'Server setup is incomplete: SUPABASE_ANON_KEY is missing in Vercel.');
  send(res, 200, { url: supabaseUrl(), anonKey, domain: LOGIN_DOMAIN });
});
