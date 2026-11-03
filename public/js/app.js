import {
  $, $$, getClient, api, loginEmail, todayStr, monthEnd, fmtDate, fmtDateTime, fmtW, fmtA, num, r3, r2,
  toast, td, el, dbMsg, loadScript, saveFile, askConfirm, USERNAME_RE, passwordProblem
} from './common.js';
import * as WB from './files.js';

const S = {
  sb: null, me: null, settings: null, perms: {},
  editing: null, profiles: new Map(), selected: new Map(),
  rec: { rows: [], done: false, loading: false, stale: true },
  users: [], idleTimer: null, tab: 'entry'
};
const PAGE = 100;
const ROLE_NAME = { owner: 'Owner', admin: 'Admin', manager: 'Manager' };
const TYPE_NAME = { purchase: 'Purchase', sales: 'Sales' };
const typeBadge = t => el('td', null, t ? el('span', { class: 'badge ' + t, text: TYPE_NAME[t] }) : el('span', { class: 'muted', text: '—' }));
const ENTRY_COLS = 'id,entry_date,entry_type,slip_no,party_name,vehicle_no,item,net_wt,deduction,final_wt,rate,amount,created_by,created_at,updated_by,updated_at';
const PAGES = {
  entry: ['New entry', 'Record a weighbridge slip.'],
  records: ['Records', 'Search, check and correct saved slips.'],
  download: ['Download', 'Excel and PDF reports, and merging with an old register.'],
  activity: ['Activity', 'Every change, with who made it and when.'],
  settings: ['Settings', 'Business details, permissions and people.'],
  account: ['My account', 'Your details and password.']
};
const icon = name => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'i'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + name); s.append(u); return s; };
const initials = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

/* =============================== start-up =============================== */
async function boot() {
  try { S.sb = await getClient(); }
  catch (e) { return gate('The site isn’t connected yet', e.message); }
  const { data: { session } } = await S.sb.auth.getSession();
  if (!session) return location.replace('/');

  const { data: prof } = await S.sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  if (!prof || !prof.active) { await S.sb.auth.signOut(); return location.replace('/?m=off'); }
  S.me = prof;
  if (!(await loadSettings())) return gate('Couldn’t load settings', 'Reload the page. If this keeps happening, tell the owner.');
  computePerms();

  S.sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') location.replace('/?m=out'); });
  $$('[data-signout]').forEach(b => { b.onclick = async () => { await S.sb.auth.signOut(); location.replace('/?m=out'); }; });

  const myName = prof.full_name || prof.username;
  $$('[data-myname]').forEach(e => { e.textContent = myName; });
  $$('[data-myrole]').forEach(e => { e.textContent = ROLE_NAME[prof.role]; });
  $$('[data-initials]').forEach(e => { e.textContent = initials(myName); });
  $('#acctUser').textContent = `Username: ${prof.username}  |  Role: ${ROLE_NAME[prof.role]}`;
  $('#sideFoot').hidden = false;
  $('#gate').hidden = true;
  $('#today').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  applyPermsToUI();
  bindEntry(); bindRecords(); bindDownload(); bindActivity(); bindSettings(); bindAccount();
  startIdleTimer();

  if (S.perms.viewAll) { await loadProfiles(); subscribeLive(); }
  const t = todayStr();
  $('#fFrom').value = t.slice(0, 8) + '01'; $('#fTo').value = monthEnd(t);
  $('#xFrom').value = t.slice(0, 8) + '01'; $('#xTo').value = t;
  resetForm();
  loadToday();
  window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));
  showTab(location.hash.slice(1) || 'entry');
}

function gate(title, text) {
  $('#gate').hidden = false;
  $('#gateTitle').textContent = title; $('#gateText').textContent = text;
  $('#pageTitle').textContent = 'Weighbridge register'; $('#pageSub').textContent = '';
}

async function loadSettings() {
  const { data, error } = await S.sb.from('settings').select('*').eq('id', 1).maybeSingle();
  if (error || !data) return false;
  S.settings = data;
  $$('[data-company]').forEach(e => { e.textContent = data.company_name || 'Weighbridge'; });
  document.title = data.company_name || 'Weighbridge register';
  return true;
}

// Mirrors the database rules so the screen only shows what each person may use.
// The database enforces the same rules on its own, whatever the screen shows.
function computePerms() {
  const r = S.me.role, s = S.settings;
  const owner = r === 'owner', admin = r === 'admin';
  S.perms = {
    owner,
    viewAll: owner || admin,
    edit: owner || (admin && s.admin_can_edit),
    del: owner || (admin && s.admin_can_delete),
    export: owner || (admin && s.admin_can_export),
    audit: owner || (admin && s.admin_can_view_audit),
    settings: owner,
    ownToday: owner || admin || (r === 'manager' && s.manager_can_view_own_today)
  };
}

function applyPermsToUI() {
  $$('[data-perm]').forEach(e => { e.hidden = !S.perms[e.dataset.perm]; });
  $('#todayBox').hidden = !S.perms.ownToday;
  $('#rateHint').textContent = S.settings.rate_required ? 'per qty, compulsory' : 'per qty';
}

function showTab(name) {
  const btn = $(`#sideNav [data-tab="${CSS.escape(name || '')}"]`);
  if (!btn || btn.hidden) name = 'entry';
  S.tab = name;
  $$('.nav-item[data-tab]').forEach(b => { if (b.dataset.tab === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  $('#pageTitle').textContent = PAGES[name][0]; $('#pageSub').textContent = PAGES[name][1];
  window.scrollTo(0, 0);
  ['entry', 'records', 'download', 'activity', 'settings', 'account'].forEach(t => { $('#tab-' + t).hidden = t !== name; });
  if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
  if (name === 'records' && S.rec.stale) loadRecords(true);
  if (name === 'download') $('#selCount').textContent = String(S.selected.size);
  if (name === 'activity') loadActivity();
  if (name === 'settings') loadSettingsPage();
  if (name === 'account') showAccount();
}

function startIdleTimer() {
  const mins = Math.max(5, Number(S.settings.session_timeout_minutes) || 30);
  let last = Date.now();
  const bump = () => { last = Date.now(); };
  ['pointerdown', 'keydown', 'scroll', 'touchstart', 'mousemove'].forEach(ev => window.addEventListener(ev, bump, { passive: true }));
  S.idleTimer = setInterval(async () => {
    if (Date.now() - last > mins * 60000) {
      clearInterval(S.idleTimer);
      await S.sb.auth.signOut();
      location.replace('/?m=timeout');
    }
  }, 30000);
}

async function loadProfiles() {
  const { data } = await S.sb.from('profiles').select('id,username,full_name,role,active,created_at').order('created_at');
  S.users = data || [];
  S.profiles = new Map(S.users.map(p => [p.id, p]));
}
const personName = id => { const p = id && S.profiles.get(id); return p ? (p.full_name || p.username) : (id === S.me.id ? (S.me.full_name || S.me.username) : (id ? 'Removed user' : '')); };

let liveT;
function subscribeLive() {
  S.sb.channel('entries-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, () => {
      clearTimeout(liveT);
      liveT = setTimeout(() => {
        S.rec.stale = true;
        if (S.tab === 'records') loadRecords(false);
        loadToday();
      }, 600);
    })
    .subscribe();
}

/* =============================== entry form =============================== */
const FIELDS = ['type', 'date', 'slip', 'party', 'vehicle', 'item', 'net', 'deduction', 'rate'];
function readForm() {
  const f = $('#entryForm'), o = {};
  FIELDS.forEach(k => { o[k] = f.elements.namedItem(k).value.trim(); });
  o.vehicle = o.vehicle.toUpperCase();
  return o;
}
function calc(v) {
  const n = num(v.net), d = num(v.deduction), rate = num(v.rate);
  const net = (n != null && !isNaN(n)) ? r3(n) : null;
  const ded = (d != null && !isNaN(d)) ? r3(d) : null;
  const fin = net == null ? null : r3(net - ((d != null && !isNaN(d)) ? d : 0));
  const amt = (fin == null || rate == null || isNaN(rate)) ? null : r2(fin * rate);
  return { net, ded, fin, amt };
}
function validate(v) {
  if (!v.type) return { field: 'type', msg: 'Choose Purchase or Sales.' };
  const req = [['date', 'the date'], ['slip', 'the slip no.'], ['party', 'the party name'], ['vehicle', 'the vehicle no.'], ['item', 'the item']];
  for (const [k, l] of req) if (!v[k]) return { field: k, msg: 'Enter ' + l + '.' };
  const n = num(v.net);
  if (n == null || isNaN(n) || n < 0) return { field: 'net', msg: 'Enter the net weight as a number.' };
  if (v.deduction !== '') {
    const d = num(v.deduction);
    if (isNaN(d) || d < 0) return { field: 'deduction', msg: 'Enter the deduction as a number, or leave it empty.' };
    if (d > n) return { field: 'deduction', msg: 'Deduction can’t be more than net weight.' };
  }
  if (v.rate === '' && S.settings.rate_required) return { field: 'rate', msg: 'Enter the rate. It’s compulsory.' };
  if (v.rate !== '') { const r = num(v.rate); if (isNaN(r) || r < 0) return { field: 'rate', msg: 'Enter the rate as a number.' }; }
  return null;
}
function updateReadout() {
  const c = calc(readForm());
  const set = (id, v, f) => { const b = $(id); b.textContent = v == null ? '—' : f(v); b.classList.toggle('empty-val', v == null); };
  const kg = v => fmtW(v) + ' kg';
  const tv = readForm().type, st = $('#sumType');
  st.textContent = tv ? TYPE_NAME[tv] : '—'; st.classList.toggle('empty-val', !tv);
  const sel = $('#entryForm').elements.namedItem('type');
  sel.classList.toggle('is-purchase', tv === 'purchase'); sel.classList.toggle('is-sales', tv === 'sales');
  if (!S.editing && !$('#saveBtn').disabled) $('#saveBtn').textContent = tv ? `Save ${TYPE_NAME[tv].toLowerCase()} entry` : 'Save entry';
  $('#partyLabel').textContent = tv === 'purchase' ? 'Party name (supplier)' : tv === 'sales' ? 'Party name (customer)' : 'Party name';
  set('#sumNet', c.net, kg); set('#sumDed', c.ded, kg); set('#sumFinal', c.fin, kg); set('#sumAmt', c.amt, v => '₹ ' + fmtA(v));
}
function showErr(b) {
  $$('#entryForm input').forEach(i => i.removeAttribute('aria-invalid'));
  $('#formErr').textContent = b.msg || '';
  if (b.field) { const i = $('#entryForm').elements.namedItem(b.field); i.setAttribute('aria-invalid', 'true'); i.focus(); }
}
function resetForm() {
  const f = $('#entryForm'); f.reset(); f.elements.date.value = todayStr();
  S.editing = null;
  $('#editBanner').hidden = true; $('#delEditBtn').hidden = true;
  $('#saveBtn').textContent = 'Save entry'; $('#clearBtn').textContent = 'Clear form';
  showErr({ msg: '' }); updateReadout();
}
function startEdit(e) {
  resetForm();
  S.editing = e;
  const f = $('#entryForm');
  f.elements.namedItem('type').value = e.entry_type || '';
  f.elements.date.value = e.entry_date; f.elements.slip.value = e.slip_no; f.elements.party.value = e.party_name;
  f.elements.vehicle.value = e.vehicle_no; f.elements.namedItem('item').value = e.item;
  f.elements.net.value = e.net_wt ?? '';
  f.elements.deduction.value = e.deduction ?? ''; f.elements.rate.value = e.rate ?? '';
  $('#editText').textContent = `Editing slip ${e.slip_no}. Change the details, then save.`;
  $('#editBanner').hidden = false;
  $('#saveBtn').textContent = 'Save changes'; $('#clearBtn').textContent = 'Cancel editing';
  $('#delEditBtn').hidden = !S.perms.del;
  updateReadout(); showTab('entry'); f.elements.slip.focus();
}

function bindEntry() {
  const f = $('#entryForm');
  f.addEventListener('input', () => { updateReadout(); if ($('#formErr').textContent) showErr({ msg: '' }); });
  f.addEventListener('submit', async ev => {
    ev.preventDefault();
    const v = readForm(), bad = validate(v);
    if (bad) return showErr(bad);
    const payload = {
      entry_type: v.type, entry_date: v.date, slip_no: v.slip, party_name: v.party, vehicle_no: v.vehicle, item: v.item,
      net_wt: num(v.net),
      deduction: v.deduction === '' ? null : num(v.deduction), rate: v.rate === '' ? null : num(v.rate)
    };
    const editing = S.editing, btn = $('#saveBtn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      if (editing) {
        const { data, error } = await S.sb.from('entries').update(payload).eq('id', editing.id).select('id');
        if (error) throw error;
        if (!data || !data.length) throw { message: 'This entry wasn’t changed. It may have been deleted, or your account can’t edit entries.' };
      } else {
        const { error } = await S.sb.from('entries').insert(payload);
        if (error) throw error;
      }
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      toast(`${editing ? 'Updated' : 'Saved'} ${TYPE_NAME[payload.entry_type].toLowerCase()} entry, slip ${payload.slip_no}`);
      $('#lastSaved').textContent = `${editing ? 'Last updated' : 'Last saved'}: slip ${payload.slip_no} at ${time}`;
      resetForm();
      S.rec.stale = true;
      loadToday();
      if (editing) showTab('records');
    } catch (e) {
      const m = dbMsg(e);
      showErr(e.code === '23505' ? { field: 'slip', msg: m } : { msg: m });
    } finally {
      btn.disabled = false; btn.textContent = S.editing ? 'Save changes' : 'Save entry';
    }
  });
  $('#clearBtn').onclick = () => { const was = !!S.editing; resetForm(); if (was) showTab('records'); };
  $('#delEditBtn').onclick = async () => { if (S.editing && await deleteEntry(S.editing)) { resetForm(); showTab('records'); } };
}

async function deleteEntry(e) {
  if (!await askConfirm(`Delete slip ${e.slip_no}?`, `${e.party_name}, ${fmtDate(e.entry_date)}. It will be removed for everyone. The Activity history keeps a copy.`)) return false;
  const { data, error } = await S.sb.from('entries').delete().eq('id', e.id).select('id');
  if (error) { toast(dbMsg(error)); return false; }
  if (!data || !data.length) { toast('Not deleted: it may already be gone, or your account can’t delete entries.'); return false; }
  S.selected.delete(e.id);
  toast(`Deleted slip ${e.slip_no}`);
  S.rec.stale = true;
  if (S.tab === 'records') loadRecords(false);
  return true;
}

async function loadToday() {
  if (!S.perms.ownToday) return;
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const { data, error } = await S.sb.from('entries')
    .select('entry_type,slip_no,party_name,vehicle_no,item,net_wt,final_wt,amount,created_at')
    .eq('created_by', S.me.id).gte('created_at', start.toISOString())
    .order('created_at', { ascending: false }).limit(100);
  if (error) return;
  const tb = $('#todayBody');
  tb.replaceChildren(...(data || []).map(e => el('tr', null,
    td(new Date(e.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })), typeBadge(e.entry_type),
    td(e.slip_no, 'strong'), td(e.party_name, 'clip'), td(e.vehicle_no), td(e.item),
    td(fmtW(e.net_wt), 'n'), td(fmtW(e.final_wt), 'n'), td(fmtA(e.amount), 'n amt'))));
  $('#todayEmpty').hidden = !!(data && data.length);
}

/* =============================== records =============================== */
function recFilter() {
  let from = $('#fFrom').value || '1900-01-01', to = $('#fTo').value || '2999-12-31';
  if (from > to) [from, to] = [to, from];
  const q = $('#fQ').value.replace(/[,%()*\\:"'.]/g, ' ').replace(/\s+/g, ' ').trim();
  return { from, to, q, type: $('#fType').value };
}
function applyFilter(query, { from, to, q, type }) {
  let x = query.gte('entry_date', from).lte('entry_date', to);
  if (type) x = x.eq('entry_type', type);
  if (q) x = x.or(['slip_no', 'party_name', 'vehicle_no', 'item'].map(c => `${c}.ilike."%${q}%"`).join(','));
  return x;
}

async function loadRecords(reset) {
  if (!S.perms.viewAll || S.rec.loading) return;
  S.rec.loading = true;
  const f = recFilter();
  const want = reset ? PAGE : Math.max(PAGE, S.rec.rows.length);
  const offset = reset === 'more' ? S.rec.rows.length : 0;
  const size = reset === 'more' ? PAGE : want;
  $('#recNote').textContent = 'Loading…';
  try {
    const { data, error } = await applyFilter(S.sb.from('entries').select(ENTRY_COLS), f)
      .order('entry_date', { ascending: false }).order('id', { ascending: false })
      .range(offset, offset + size - 1);
    if (error) throw error;
    S.rec.rows = reset === 'more' ? S.rec.rows.concat(data) : data;
    S.rec.done = data.length < size;
    S.rec.stale = false;
    $('#recNote').textContent = 'Newest first. Updates live when anyone saves.';
    renderRecords();
    loadTotals(f);
  } catch (e) {
    $('#recNote').textContent = dbMsg(e);
  } finally { S.rec.loading = false; }
}

async function loadTotals(f) {
  const { data, error } = await S.sb.rpc('entry_totals', { p_from: f.from, p_to: f.to, p_q: f.q, p_type: f.type || '' });
  const t = (!error && data && data[0]) || null;
  const stat = (ic, cls, l, v) => el('div', { class: 'stat' }, el('span', { class: 'chip ' + cls }, icon(ic)), el('div', null, el('span', { text: l }), el('b', { text: v })));
  $('#stats').replaceChildren(
    stat('i-hash', '', 'Entries', t ? String(t.cnt) : '—'),
    stat('i-scale', '', 'Net wt.', t ? (fmtW(t.net) || '0') + ' kg' : '—'),
    stat('i-truck', 'green', 'Final wt.', t ? (fmtW(t.final) || '0') + ' kg' : '—'),
    stat('i-rupee', 'amber', 'Amount', t ? '₹ ' + fmtA(t.amount) : '—'));
}

function renderRecords() {
  const rows = S.rec.rows, canSel = S.perms.export;
  const frag = document.createDocumentFragment();
  for (const e of rows) {
    const tr = el('tr');
    if (canSel) {
      const cb = el('input', { type: 'checkbox', class: 'tick', 'aria-label': `Tick slip ${e.slip_no}` });
      cb.checked = S.selected.has(e.id);
      cb.addEventListener('change', () => { if (cb.checked) S.selected.set(e.id, e); else S.selected.delete(e.id); $('#selCount').textContent = String(S.selected.size); });
      tr.append(el('td', null, cb));
    }
    tr.append(td(fmtDate(e.entry_date)), typeBadge(e.entry_type), td(e.slip_no, 'strong'), td(e.party_name, 'clip'), el('td', { class: 'two' }, el('b', { text: e.vehicle_no }), el('span', { text: e.item })),
      td(fmtW(e.net_wt), 'n'), td(fmtW(e.deduction), 'n'),
      td(fmtW(e.final_wt), 'n strong'), td(fmtA(e.rate), 'n'), td(fmtA(e.amount), 'n amt'), td(personName(e.created_by), 'muted'));
    const act = el('div', { class: 'acts' });
    if (S.perms.edit) act.append(el('button', { class: 'icon-btn', title: 'Edit', 'aria-label': `Edit slip ${e.slip_no}`, onclick: () => startEdit(e) }, icon('i-edit')));
    if (S.perms.del) act.append(el('button', { class: 'icon-btn del', title: 'Delete', 'aria-label': `Delete slip ${e.slip_no}`, onclick: () => deleteEntry(e) }, icon('i-trash')));
    tr.append(el('td', null, act));
    frag.append(tr);
  }
  $('#recBody').replaceChildren(frag);
  $('#recEmpty').hidden = rows.length > 0;
  $('#moreBtn').hidden = S.rec.done;
}

function bindRecords() {
  let qT;
  $('#fFrom').addEventListener('change', () => loadRecords(true));
  $('#fTo').addEventListener('change', () => loadRecords(true));
  $('#fType').addEventListener('change', () => loadRecords(true));
  $('#fQ').addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(() => loadRecords(true), 350); });
  $('#moreBtn').onclick = () => loadRecords('more');
  $('#selAll').addEventListener('change', ev => {
    S.rec.rows.forEach(e => { if (ev.target.checked) S.selected.set(e.id, e); else S.selected.delete(e.id); });
    $('#selCount').textContent = String(S.selected.size);
    renderRecords();
  });
}

/* =============================== downloads =============================== */
async function fetchAll(f) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = S.sb.from('entries').select(ENTRY_COLS);
    if (f) q = applyFilter(q, f);
    const { data, error } = await q.order('entry_date', { ascending: true }).order('id', { ascending: true }).range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}
const toFileRow = e => ({
  date: e.entry_date, type: TYPE_NAME[e.entry_type] || '', slip: e.slip_no, party: e.party_name, vehicle: e.vehicle_no, item: e.item,
  net: e.net_wt, deduction: e.deduction, final: e.final_wt,
  rate: e.rate, amount: e.amount, byName: personName(e.created_by)
});
async function gatherExport() {
  const scope = $('input[name=scope]:checked').value, xType = $('#xType').value;
  const typeLabel = xType ? `, ${TYPE_NAME[xType].toLowerCase()} only` : '';
  let rows, label;
  if (scope === 'selected') {
    rows = Array.from(S.selected.values()).filter(e => !xType || e.entry_type === xType); label = 'Selected rows' + typeLabel;
    if (!rows.length) throw { message: 'No ticked rows match. Tick rows in Records first.' };
    rows.sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.id - b.id);
  } else if (scope === 'view') {
    const f = recFilter(); if (xType) f.type = xType; rows = await fetchAll(f);
    label = `${fmtDate(f.from)} to ${fmtDate(f.to)}${f.type ? `, ${TYPE_NAME[f.type].toLowerCase()} only` : ''}${f.q ? `, search “${f.q}”` : ''}`;
  } else if (scope === 'range') {
    let from = $('#xFrom').value, to = $('#xTo').value;
    if (!from || !to) throw { message: 'Choose both dates first.' };
    if (from > to) [from, to] = [to, from];
    rows = await fetchAll({ from, to, q: '', type: xType }); label = `${fmtDate(from)} to ${fmtDate(to)}${typeLabel}`;
  } else {
    rows = await fetchAll({ from: '1900-01-01', to: '2999-12-31', q: '', type: xType }); label = 'All entries' + typeLabel;
  }
  return { rows: rows.map(toFileRow), label };
}
function meta(label) {
  return { company: S.settings.company_name, address: S.settings.company_address, label, by: S.me.full_name || S.me.username };
}
async function runExport(kind, btn) {
  const old = btn.textContent; btn.disabled = true; btn.textContent = 'Preparing…';
  try {
    const { rows, label } = await gatherExport();
    if (!rows.length) { toast('No entries match. Choose other dates or rows.'); return; }
    const name = `${(S.settings.company_name || 'weighbridge').replace(/[^\w-]+/g, '_')}_${todayStr()}`;
    if (kind === 'xlsx') {
      await loadScript('/vendor/exceljs.min.js');
      const buf = await WB.buildXlsx(window.ExcelJS, rows, meta(label));
      saveFile(name + '.xlsx', buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } else {
      await loadScript('/vendor/jspdf.umd.min.js'); await loadScript('/vendor/jspdf.plugin.autotable.min.js');
      saveFile(name + '.pdf', WB.buildPdf(window.jspdf.jsPDF, rows, label, meta(label)), 'application/pdf');
    }
    toast(`Downloaded ${rows.length} entries`);
  } catch (e) { toast(e.userMsg || dbMsg(e)); }
  finally { btn.disabled = false; btn.textContent = old; }
}
async function runMerge(btn) {
  const file = $('#oldFile').files[0]; if (!file) return;
  const old = btn.textContent; btn.disabled = true; btn.textContent = 'Merging…';
  $('#mergeResult').textContent = '';
  try {
    await loadScript('/vendor/exceljs.min.js');
    const { rows } = await gatherExport();
    const res = await WB.mergeIntoWorkbook(window.ExcelJS, await file.arrayBuffer(), rows);
    $('#mergeResult').textContent = `Earlier file: ${res.oldRows} rows. Website: ${res.webRows} entries` +
      (res.replaced ? ` (${res.replaced} had the same slip no. as the earlier file and replaced it)` : '') +
      `. Final file: ${res.total} rows, sorted by date, on sheet “${res.sheet}”.`;
    saveFile(file.name.replace(/\.xlsx$/i, '') + `_merged_${todayStr()}.xlsx`, res.buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  } catch (e) { toast(e.userMsg || dbMsg(e)); }
  finally { btn.disabled = !$('#oldFile').files[0]; btn.textContent = old; }
}
function bindDownload() {
  $('#dlXlsx').onclick = e => runExport('xlsx', e.currentTarget);
  $('#dlPdf').onclick = e => runExport('pdf', e.currentTarget);
  $('#oldFile').addEventListener('change', () => { $('#mergeBtn').disabled = !$('#oldFile').files[0]; $('#mergeResult').textContent = ''; });
  $('#mergeBtn').onclick = e => runMerge(e.currentTarget);
  $$('#xFrom,#xTo').forEach(i => i.addEventListener('change', () => { $('#scRange').checked = true; }));
}

/* =============================== activity =============================== */
const ACTION_NAME = { ADD: 'New entry', EDIT: 'Edit', DELETE: 'Delete', USER: 'People', SETTINGS: 'Settings' };
const FIELD_NAME = {
  entry_date: 'Date', entry_type: 'Type', slip_no: 'Slip no.', party_name: 'Party', vehicle_no: 'Vehicle', item: 'Item',
  net_wt: 'Net', deduction: 'Deduction', rate: 'Rate',
  company_name: 'Business name', company_address: 'Address', timezone: 'Time zone', session_timeout_minutes: 'Sign-out minutes',
  admin_can_edit: 'Admins edit', admin_can_delete: 'Admins delete', admin_can_export: 'Admins download',
  admin_can_view_audit: 'Admins see activity', manager_can_view_own_today: 'Managers see today', rate_required: 'Rate compulsory'
};
function describe(a) {
  if (a.details) return a.details;
  const o = a.old_data || {}, n = a.new_data || {};
  if (a.action === 'ADD') return `${TYPE_NAME[n.entry_type] || 'Entry'}: ${n.party_name}, ${n.vehicle_no}, ${n.item}: final ${fmtW(n.final_wt)}${n.amount != null ? ', ₹ ' + fmtA(n.amount) : ''}`;
  if (a.action === 'DELETE') return `Was: ${o.party_name}, ${fmtDate(o.entry_date)}, final ${fmtW(o.final_wt)}`;
  const ch = Object.keys(FIELD_NAME).filter(k => k in n && String(o[k] ?? '') !== String(n[k] ?? ''))
    .map(k => `${FIELD_NAME[k]}: ${o[k] ?? '—'} → ${n[k] ?? '—'}`);
  return ch.join('; ') || 'No visible change';
}
async function loadActivity() {
  if (!S.perms.audit) return;
  if (S.perms.viewAll && !S.profiles.size) await loadProfiles();
  let q = S.sb.from('audit_log').select('*').order('at', { ascending: false }).limit(300);
  const t = $('#actType').value; if (t) q = q.eq('action', t);
  const { data, error } = await q;
  if (error) { toast(dbMsg(error)); return; }
  $('#actBody').replaceChildren(...data.map(a => el('tr', null,
    td(fmtDateTime(a.at), 'muted'), td(personName(a.actor) || 'System', 'strong'),
    el('td', null, el('span', { class: 'badge act-' + a.action, text: ACTION_NAME[a.action] || a.action })),
    td(a.slip_no || ''), td(describe(a), 'wrap'))));
}
function bindActivity() {
  $('#actType').addEventListener('change', loadActivity);
}

/* =============================== settings (owner) =============================== */
function formMsg(form, text, ok) { const m = $('[data-msg]', form); m.textContent = text || ''; m.className = 'msg ' + (ok ? 'ok' : 'err'); }

async function loadSettingsPage() {
  if (!S.perms.settings) return;
  await loadSettings();
  const s = S.settings, cf = $('#companyForm'), pf = $('#permForm');
  ['company_name', 'company_address', 'timezone', 'session_timeout_minutes'].forEach(k => { cf.elements[k].value = s[k]; });
  ['admin_can_edit', 'admin_can_delete', 'admin_can_export', 'admin_can_view_audit', 'manager_can_view_own_today', 'rate_required']
    .forEach(k => { pf.elements[k].checked = !!s[k]; });
  await loadProfiles();
  renderUsers();
}

async function saveSettings(form, patch, okText) {
  const { data, error } = await S.sb.from('settings').update(patch).eq('id', 1).select('*');
  if (error || !data || !data.length) { formMsg(form, error ? dbMsg(error) : 'Not saved. Only the owner can change settings.'); return; }
  S.settings = data[0];
  $$('[data-company]').forEach(e => { e.textContent = S.settings.company_name; });
  computePerms(); applyPermsToUI();
  formMsg(form, okText, true);
}

function renderUsers() {
  $('#usersBody').replaceChildren(...S.users.map(u => el('tr', null,
    el('td', null, el('span', { class: 'person' }, el('span', { class: 'avatar sm', text: initials(u.full_name || u.username) }), el('b', { text: u.full_name || u.username }))),
    td(u.username, 'muted'),
    el('td', null, el('span', { class: 'badge ' + u.role, text: ROLE_NAME[u.role] })),
    el('td', null, el('span', { class: 'badge ' + (u.active ? 'on' : 'off'), text: u.active ? 'Active' : 'Turned off' })),
    td(fmtDate(u.created_at), 'muted'),
    el('td', null, el('div', { class: 'acts' },
      el('button', { class: 'icon-btn', title: 'Edit', 'aria-label': `Edit ${u.username}`, onclick: () => openUserEdit(u) }, icon('i-edit')),
      el('button', { class: 'icon-btn', title: 'Set a new password', 'aria-label': `New password for ${u.username}`, onclick: () => openReset(u) }, icon('i-key')),
      u.id === S.me.id ? null : el('button', { class: 'icon-btn del', title: 'Delete', 'aria-label': `Delete ${u.username}`, onclick: () => removeUser(u) }, icon('i-trash'))
    ))
  )));
}

let editUser = null;
function openUserEdit(u) {
  editUser = u;
  const f = $('#userEditForm');
  $('#ueWho').textContent = `Username: ${u.username}`;
  f.elements.fullName.value = u.full_name || ''; f.elements.role.value = u.role; f.elements.active.checked = u.active;
  formMsg(f, '');
  $('#userDlg').showModal();
}
function openReset(u) {
  editUser = u;
  const f = $('#resetForm'); f.reset(); formMsg(f, '');
  $('#rpWho').textContent = u.id === S.me.id ? 'This is your own account.' : `For ${u.full_name || u.username} (${u.username}). Tell them the new password in person.`;
  $('#resetDlg').showModal();
}
async function removeUser(u) {
  if (!await askConfirm(`Delete ${u.full_name || u.username}?`, 'They won’t be able to sign in again. Entries they saved are kept. To keep the account for later, turn it off instead.')) return;
  try { await api('/api/users', { action: 'delete', id: u.id }); toast(`Deleted ${u.username}`); await loadProfiles(); renderUsers(); }
  catch (e) { toast(e.message); }
}

function bindSettings() {
  $('#companyForm').addEventListener('submit', ev => {
    ev.preventDefault();
    const f = ev.currentTarget, name = f.elements.company_name.value.trim();
    const mins = parseInt(f.elements.session_timeout_minutes.value, 10);
    if (!name) return formMsg(f, 'Enter the business name.');
    if (!(mins >= 5 && mins <= 720)) return formMsg(f, 'Sign-out minutes must be between 5 and 720.');
    saveSettings(f, { company_name: name, company_address: f.elements.company_address.value.trim(), timezone: f.elements.timezone.value, session_timeout_minutes: mins }, 'Saved.');
  });
  $('#permForm').addEventListener('submit', ev => {
    ev.preventDefault();
    const f = ev.currentTarget, patch = {};
    ['admin_can_edit', 'admin_can_delete', 'admin_can_export', 'admin_can_view_audit', 'manager_can_view_own_today', 'rate_required']
      .forEach(k => { patch[k] = f.elements[k].checked; });
    saveSettings(f, patch, 'Saved. Others get the new permissions immediately; their screens update next time they reload.');
  });
  $('#addUserForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.currentTarget, btn = $('#addUserBtn');
    const v = { fullName: f.elements.fullName.value.trim(), username: f.elements.username.value.trim().toLowerCase(), role: f.elements.role.value, password: f.elements.password.value };
    if (!USERNAME_RE.test(v.username)) return formMsg(f, 'Username must be 3–30 characters: letters, numbers, dot, dash or underscore.');
    const pp = passwordProblem(v.password); if (pp) return formMsg(f, pp);
    btn.disabled = true;
    try {
      await api('/api/users', { action: 'create', ...v });
      f.reset(); formMsg(f, `Added ${v.username}. Give them their username and password.`, true);
      await loadProfiles(); renderUsers();
    } catch (e) { formMsg(f, e.message); }
    finally { btn.disabled = false; }
  });
  $('#userEditForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.currentTarget, u = editUser;
    const patch = { action: 'update', id: u.id };
    const name = f.elements.fullName.value.trim(); if (name !== (u.full_name || '')) patch.fullName = name;
    if (f.elements.role.value !== u.role) patch.role = f.elements.role.value;
    if (f.elements.active.checked !== u.active) patch.active = f.elements.active.checked;
    if (Object.keys(patch).length === 2) { $('#userDlg').close(); return; }
    try { await api('/api/users', patch); $('#userDlg').close(); toast(`Saved changes for ${u.username}`); await loadProfiles(); renderUsers(); }
    catch (e) { formMsg(f, e.message); }
  });
  $('#resetForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.currentTarget, pw = f.elements.password.value, pp = passwordProblem(pw);
    if (pp) return formMsg(f, pp);
    try { await api('/api/users', { action: 'reset_password', id: editUser.id, password: pw }); $('#resetDlg').close(); toast(`New password set for ${editUser.username}`); }
    catch (e) { formMsg(f, e.message); }
  });
  $$('dialog [data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
}

/* =============================== my account =============================== */
function showAccount() { /* details are filled in at start-up */ }
function bindAccount() {
  $('#pwForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.currentTarget, cur = f.elements.current.value, nx = f.elements.next.value;
    if (!cur) return formMsg(f, 'Enter your current password.');
    const pp = passwordProblem(nx); if (pp) return formMsg(f, pp);
    if (nx !== f.elements.next2.value) return formMsg(f, 'The two new passwords don’t match.');
    if (nx === cur) return formMsg(f, 'The new password must be different.');
    const { error: e1 } = await S.sb.auth.signInWithPassword({ email: await loginEmail(S.me.username), password: cur });
    if (e1) return formMsg(f, 'Your current password is wrong.');
    const { error } = await S.sb.auth.updateUser({ password: nx });
    if (error) return formMsg(f, error.message);
    f.reset(); formMsg(f, 'Password changed.', true);
  });
}

/* =============================== tabs =============================== */
$$('.nav-item[data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
boot().catch(e => { console.error(e); gate('Something went wrong', 'Reload the page. If this keeps happening, tell the owner.'); });
