// Public settings the browser needs. The anon key is designed to be public;
// the database security rules (RLS) protect the data.
import { handle, send, LOGIN_DOMAIN, HttpError } from './_lib.js';

export default handle(async (req, res) => {
  if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
  const url = process.env.SUPABASE_URL, anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new HttpError(500, 'Server setup is incomplete: SUPABASE_URL or SUPABASE_ANON_KEY is missing in Vercel.');
  send(res, 200, { url, anonKey, domain: LOGIN_DOMAIN });
});
