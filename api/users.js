// Owner-only user management: add, change role/name, turn on/off, reset password, delete.
import {
  handle, send, adminClient, requireUser, cleanUsername, checkPassword, cleanName,
  emailFor, audit, ROLES, HttpError
} from './_lib.js';

const BAN_FOREVER = '876000h'; // ~100 years

async function activeOwnerCount(sb, exceptId) {
  let q = sb.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'owner').eq('active', true);
  if (exceptId) q = q.neq('id', exceptId);
  const { count } = await q;
  return count || 0;
}

async function getProfile(sb, id) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'Unknown user.');
  const { data } = await sb.from('profiles').select('*').eq('id', id).maybeSingle();
  if (!data) throw new HttpError(404, 'That user no longer exists.');
  return data;
}

export default handle(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  const sb = adminClient();
  const me = await requireUser(req, sb, { role: 'owner' });
  const b = req.body || {};

  switch (b.action) {
    case 'create': {
      const username = cleanUsername(b.username);
      const password = checkPassword(b.password);
      const role = ROLES.includes(b.role) ? b.role : null;
      if (!role) throw new HttpError(400, 'Choose a role.');
      const fullName = cleanName(b.fullName);
      const { data: taken } = await sb.from('profiles').select('id').eq('username', username).maybeSingle();
      if (taken) throw new HttpError(409, 'That username is taken.');
      const { data, error } = await sb.auth.admin.createUser({
        email: emailFor(username), password, email_confirm: true, user_metadata: { username }
      });
      if (error) throw new HttpError(400, /already/i.test(error.message) ? 'That username is taken.' : error.message);
      const { error: pErr } = await sb.from('profiles').insert({ id: data.user.id, username, full_name: fullName, role, active: true });
      if (pErr) { await sb.auth.admin.deleteUser(data.user.id); throw new HttpError(400, pErr.message); }
      await audit(sb, me.id, 'USER', `Added ${role} “${username}”`);
      return send(res, 200, { ok: true });
    }

    case 'update': {
      const target = await getProfile(sb, b.id);
      const patch = {};
      const notes = [];
      if (b.fullName !== undefined) { patch.full_name = cleanName(b.fullName); notes.push('name'); }
      if (b.role !== undefined) {
        if (!ROLES.includes(b.role)) throw new HttpError(400, 'Choose a role.');
        if (target.id === me.id && b.role !== 'owner') throw new HttpError(400, 'You can’t remove your own owner role.');
        if (target.role === 'owner' && b.role !== 'owner' && await activeOwnerCount(sb, target.id) === 0)
          throw new HttpError(400, 'There must always be at least one active owner.');
        patch.role = b.role; notes.push(`role → ${b.role}`);
      }
      if (b.active !== undefined) {
        const active = Boolean(b.active);
        if (target.id === me.id && !active) throw new HttpError(400, 'You can’t turn off your own account.');
        if (!active && target.role === 'owner' && await activeOwnerCount(sb, target.id) === 0)
          throw new HttpError(400, 'There must always be at least one active owner.');
        const { error } = await sb.auth.admin.updateUserById(target.id, { ban_duration: active ? 'none' : BAN_FOREVER });
        if (error) throw new HttpError(400, error.message);
        patch.active = active; notes.push(active ? 'turned on' : 'turned off');
      }
      if (!notes.length) throw new HttpError(400, 'Nothing to change.');
      const { error } = await sb.from('profiles').update(patch).eq('id', target.id);
      if (error) throw new HttpError(400, error.message);
      await audit(sb, me.id, 'USER', `Changed “${target.username}”: ${notes.join(', ')}`);
      return send(res, 200, { ok: true });
    }

    case 'reset_password': {
      const target = await getProfile(sb, b.id);
      const password = checkPassword(b.password);
      const { error } = await sb.auth.admin.updateUserById(target.id, { password });
      if (error) throw new HttpError(400, error.message);
      await audit(sb, me.id, 'USER', `Reset password for “${target.username}”`);
      return send(res, 200, { ok: true });
    }

    case 'delete': {
      const target = await getProfile(sb, b.id);
      if (target.id === me.id) throw new HttpError(400, 'You can’t delete your own account.');
      if (target.role === 'owner' && await activeOwnerCount(sb, target.id) === 0)
        throw new HttpError(400, 'There must always be at least one active owner.');
      const { error } = await sb.auth.admin.deleteUser(target.id);
      if (error) throw new HttpError(400, error.message);
      await audit(sb, me.id, 'USER', `Deleted user “${target.username}” (their saved entries are kept)`);
      return send(res, 200, { ok: true });
    }

    default:
      throw new HttpError(400, 'Unknown action.');
  }
});
