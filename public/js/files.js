// Excel, PDF and merge builders. Pure functions: no page or database access.

const COLS = [
  {k:"date", h:"DATE", w:12}, {k:"type", h:"TYPE", w:11}, {k:"slip", h:"SLIP NO.", w:11}, {k:"party", h:"PARTY NAME", w:28},
  {k:"vehicle", h:"VEHICLE NO.", w:15}, {k:"item", h:"ITEM", w:16},
  {k:"net", h:"NET WT. (QTL)", w:14, n:1, f:"#,##0.00"},
  {k:"deduction", h:"DEDUCTION (KG)", w:15, n:1, f:"#,##0.00"}, {k:"final", h:"FINAL WT. (QTL)", w:15, n:1, f:"#,##0.00"}, {k:"rate", h:"RATE (PER QTL)", w:14, n:1},
  {k:"amount", h:"AMOUNT", w:15, n:1}, {k:"byName", h:"ENTERED BY", w:18}
];
const SUMK = ["net","deduction","final","amount"];
const MERGE_SUMK = ["gross","tare","net","deduction","final","amount"];
const p2 = n => String(n).padStart(2,"0");
const xDate = s => { if(!s) return null; const a=s.split("-").map(Number); return new Date(Date.UTC(a[0], a[1]-1, a[2])); };
const colL = n => { let s=""; while(n>0){ const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26); } return s; };
const clone = o => o ? JSON.parse(JSON.stringify(o)) : {};
const fmtD = s => { if(!s) return ""; const p=s.split("-"); return p[2]+"-"+p[1]+"-"+p[0]; };
const nfA = new Intl.NumberFormat("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
const fA = v => (v==null||v==="") ? "" : nfA.format(v);
const nfT = new Intl.NumberFormat("en-IN",{minimumFractionDigits:2,maximumFractionDigits:3});
const nfK = new Intl.NumberFormat("en-IN",{maximumFractionDigits:3});
const fT = v => (v==null||v==="") ? "" : nfT.format(v);
const fK = v => (v==null||v==="") ? "" : nfK.format(v);
function totals(rows){
  const t={}; SUMK.forEach(k => t[k]=0);
  rows.forEach(e => SUMK.forEach(k => { const v=Number(e[k]); if(e[k]!=null && e[k]!=="" && Number.isFinite(v)) t[k]+=v; }));
  SUMK.forEach(k => t[k]=Math.round(t[k]*1000)/1000);
  return t;
}

async function buildXlsx(ExcelJS, rows, meta){
  meta = meta || {};
  const wb = new ExcelJS.Workbook(); wb.creator = meta.company || "Weighbridge register"; wb.created = new Date();
  const HR = 4; // heading row
  const ws = wb.addWorksheet("REGISTER", {views:[{state:"frozen", ySplit:HR}], pageSetup:{orientation:"landscape", fitToPage:true, fitToWidth:1, fitToHeight:0, paperSize:9}});
  COLS.forEach((c,i) => { ws.getColumn(i+1).width = c.w; });
  const thin = {style:"thin", color:{argb:"FFDCE3EF"}};
  const border = {top:thin, left:thin, bottom:thin, right:thin};
  const last = colL(COLS.length);
  ws.mergeCells("A1:"+last+"1"); ws.mergeCells("A2:"+last+"2");
  ws.getCell("A1").value = meta.company || "Weighbridge register";
  ws.getCell("A1").font = {bold:true, size:16};
  const d = new Date(), gen = p2(d.getDate())+"-"+p2(d.getMonth()+1)+"-"+d.getFullYear()+" "+p2(d.getHours())+":"+p2(d.getMinutes());
  ws.getCell("A2").value = [meta.address, (meta.label || "All entries"), rows.length+" entries", "Downloaded "+gen+(meta.by ? " by "+meta.by : "")].filter(Boolean).join("   |   ");
  ws.getCell("A2").font = {color:{argb:"FF56636F"}};
  const hr = ws.getRow(HR); hr.height = 22;
  COLS.forEach((c,i) => {
    const cell = hr.getCell(i+1); cell.value = c.h;
    cell.font={bold:true, color:{argb:"FFFFFFFF"}}; cell.fill={type:"pattern", pattern:"solid", fgColor:{argb:"FF0A1A3F"}};
    cell.alignment={horizontal:"center", vertical:"middle"}; cell.border=border;
  });
  rows.forEach((e, idx) => {
    const row = ws.getRow(HR+1+idx);
    COLS.forEach((c,i) => {
      const v = e[c.k], cell = row.getCell(i+1);
      cell.value = c.k==="date" ? xDate(v) : (v==null || v==="" ? null : v);
      cell.border = border;
      if(c.k==="date") cell.numFmt = "dd-mm-yyyy"; else if(c.n) cell.numFmt = c.f || "#,##0.00";
    });
  });
  const n = rows.length;
  if(n){
    const t = totals(rows), tr = ws.getRow(HR+n+1), first = HR+1, lastR = HR+n;
    for(let i=1;i<=COLS.length;i++){ const c=tr.getCell(i); c.font={bold:true}; c.fill={type:"pattern", pattern:"solid", fgColor:{argb:"FFEEF2FA"}}; c.border=border; }
    tr.getCell(1).value = "TOTAL";
    COLS.forEach((c,i) => { if(SUMK.includes(c.k)){ const L=colL(i+1), cell=tr.getCell(i+1); cell.value = {formula:"SUM("+L+first+":"+L+lastR+")", result:t[c.k]}; cell.numFmt=c.f || "#,##0.00"; } });
    ws.autoFilter = {from:{row:HR, column:1}, to:{row:lastR, column:COLS.length}};
  }
  addSummary(wb, "PURCHASE-SALES", "TYPE", rows, e => e.type || "(no type)", border);
  addSummary(wb, "PARTY SUMMARY", "PARTY NAME", rows, e => (e.type ? e.type + ": " : "") + e.party, border);
  addSummary(wb, "ITEM SUMMARY", "ITEM", rows, e => e.item, border);
  return await wb.xlsx.writeBuffer();
}

function addSummary(wb, title, label, rows, keyFn, border){
  const ws = wb.addWorksheet(title, {views:[{state:"frozen", ySplit:1}]});
  const heads = [label, "ENTRIES", "NET WT. (QTL)", "FINAL WT. (QTL)", "AMOUNT"];
  const widths = [30, 10, 15, 15, 17];
  heads.forEach((h,i) => {
    ws.getColumn(i+1).width = widths[i];
    const c = ws.getRow(1).getCell(i+1); c.value=h; c.font={bold:true, color:{argb:"FFFFFFFF"}};
    c.fill={type:"pattern", pattern:"solid", fgColor:{argb:"FF0A1A3F"}}; c.border=border; c.alignment={horizontal:"center"};
  });
  const g = new Map();
  rows.forEach(e => {
    const k = String(keyFn(e) || "(blank)").trim();
    const a = g.get(k.toLowerCase()) || {name:k, n:0, net:0, final:0, amount:0};
    a.n++; a.net += Number(e.net)||0; a.final += Number(e.final)||0; a.amount += Number(e.amount)||0;
    g.set(k.toLowerCase(), a);
  });
  const list = Array.from(g.values()).sort((a,b) => b.final - a.final);
  list.forEach((a,i) => {
    const r = ws.getRow(i+2);
    [a.name, a.n, Math.round(a.net*1000)/1000, Math.round(a.final*1000)/1000, Math.round(a.amount*100)/100].forEach((v,j) => {
      const c = r.getCell(j+1); c.value=v; c.border=border; if(j>=2) c.numFmt = "#,##0.00";
    });
  });
  if(list.length){
    const r = ws.getRow(list.length+2), L = list.length+1;
    r.getCell(1).value = "TOTAL";
    r.getCell(2).value = {formula:"SUM(B2:B"+L+")", result:rows.length};
    const tot = [list.reduce((s,a)=>s+a.net,0), list.reduce((s,a)=>s+a.final,0), list.reduce((s,a)=>s+a.amount,0)];
    ["C","D","E"].forEach((col,j) => { const c=r.getCell(j+3); c.value={formula:"SUM("+col+"2:"+col+L+")", result:Math.round(tot[j]*1000)/1000}; c.numFmt = "#,##0.00"; });
    for(let i=1;i<=5;i++){ const c=r.getCell(i); c.font={bold:true}; c.border=border; c.fill={type:"pattern", pattern:"solid", fgColor:{argb:"FFEEF2FA"}}; }
  }
}

function buildPdf(jsPDF, rows, label, meta){
  meta = meta || {};
  const doc = new jsPDF({orientation:"landscape", unit:"mm", format:"a4"});
  const d = new Date(), gen = p2(d.getDate())+"-"+p2(d.getMonth()+1)+"-"+d.getFullYear();
  doc.setFont("helvetica","bold"); doc.setFontSize(15); doc.text(meta.company || "Weighbridge register", 14, 14);
  doc.setFont("helvetica","normal"); doc.setFontSize(9);
  doc.text([meta.address, label, "Entries: "+rows.length, "Generated: "+gen].filter(Boolean).join("     "), 14, 20);
  const head = [["Date","Type","Slip no.","Party name","Vehicle no.","Item","Net wt. (qtl)","Ded. (kg)","Final wt. (qtl)","Rate/qtl","Amount"]];
  const body = rows.map(e => [fmtD(e.date), e.type||"", e.slip||"", e.party||"", e.vehicle||"", e.item||"", fT(e.net), fK(e.deduction), fT(e.final), fA(e.rate), fA(e.amount)]);
  const t = totals(rows);
  const foot = [["Total","","","","","",fT(t.net),fK(t.deduction),fT(t.final),"",fA(t.amount)]];
  const right = {}; for(let i=6;i<=10;i++) right[i] = {halign:"right"};
  doc.autoTable({
    startY:24, head, body, foot, showFoot:"lastPage", theme:"grid",
    styles:{font:"helvetica", fontSize:7.5, cellPadding:1.4, lineColor:[220,227,239], lineWidth:0.1, textColor:[23,33,43]},
    headStyles:{fillColor:[10,26,63], textColor:255, fontStyle:"bold"},
    footStyles:{fillColor:[238,242,250], textColor:[23,33,43], fontStyle:"bold"},
    columnStyles:right,
    didDrawPage: () => {
      doc.setFontSize(8);
      doc.text("Page "+doc.internal.getNumberOfPages(), doc.internal.pageSize.getWidth()-14, doc.internal.pageSize.getHeight()-8, {align:"right"});
    }
  });
  return doc.output("arraybuffer");
}

/* ----- merge ----- */
const RULES = [
  ["by", h => /ENTERED ?BY|CREATED ?BY/.test(h)],
  ["skip", h => /MODIF|TIME|^ID$/.test(h)],
  ["sr", h => /^(SR|S|SL)NO$|SERIAL/.test(h.replace(/[^A-Z]/g,""))],
  ["type", h => /^TYPE$|ENTRY TYPE|PURCHASE|SALE/.test(h)],
  ["slip", h => /SLIP|TOKEN|RST/.test(h)],
  ["vehicle", h => /VEHICLE|VEH\b|TRUCK|LORRY/.test(h)],
  ["party", h => /PARTY|CUSTOMER|SUPPLIER|^NAME/.test(h)],
  ["item", h => /ITEM|MATERIAL|PRODUCT|COMMODITY/.test(h)],
  ["gross", h => /GROSS/.test(h)],
  ["tare", h => /TARE/.test(h)],
  ["final", h => /FINAL/.test(h)],
  ["net", h => /NET/.test(h)],
  ["deduction", h => /DEDUC|^DED\b/.test(h)],
  ["rate", h => /RATE|PRICE/.test(h)],
  ["amount", h => /AMOUNT|AMT/.test(h)],
  ["date", h => /DATE/.test(h)]
];
function cellVal(cell){
  let v = cell.value;
  if(v==null) return null;
  if(v instanceof Date) return v;
  if(typeof v==="object"){
    if("result" in v) v = v.result;
    else if(v.richText) return v.richText.map(t => t.text).join("");
    else if("text" in v) return v.text;
    else if("formula" in v || "sharedFormula" in v) return null;
    else if(v.error) return null;
  }
  if(v && typeof v==="object" && !(v instanceof Date)) return v.error ? null : String(v);
  return v;
}
const ymd = (y,m,d) => (m<1||m>12||d<1||d>31) ? null : y+"-"+p2(m)+"-"+p2(d);
function parseAnyDate(v){
  if(v==null || v==="") return null;
  if(v instanceof Date) return isNaN(v) ? null : ymd(v.getUTCFullYear(), v.getUTCMonth()+1, v.getUTCDate());
  if(typeof v==="number"){ if(v>20000 && v<80000){ const d=new Date(Math.round((v-25569)*86400000)); return ymd(d.getUTCFullYear(), d.getUTCMonth()+1, d.getUTCDate()); } return null; }
  const s = String(v).trim(); let m;
  if((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) return ymd(+m[1], +m[2], +m[3]);
  if((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/))){ let y=+m[3]; if(y<100) y+=2000; return ymd(y, +m[2], +m[1]); }
  if((m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s,]+(\d{2,4})/))){
    const i = "janfebmaraprmayjunjulaugsepoctnovdec".indexOf(m[2].toLowerCase());
    if(i>=0 && i%3===0){ let y=+m[3]; if(y<100) y+=2000; return ymd(y, i/3+1, +m[1]); }
  }
  return null;
}
const keyOf = s => String(s==null?"":s).trim().toLowerCase();
const norm = v => String(v==null ? "" : v).toUpperCase().replace(/\s+/g," ").trim();

function findHeader(wb){
  for(const ws of wb.worksheets){
    const lim = Math.min(30, ws.rowCount);
    for(let r=1; r<=lim; r++){
      const row = ws.getRow(r), map = {};
      row.eachCell({includeEmpty:false}, (cell, col) => {
        const h = norm(cellVal(cell)); if(!h) return;
        for(const [k, test] of RULES){ if(test(h)){ if(k!=="skip" && !(k in map)) map[k]=col; break; } }
      });
      if(map.slip && (map.date || map.net)) return {ws, hr:r, map};
    }
  }
  return null;
}

async function mergeIntoWorkbook(ExcelJS, buffer, webRows){
  const wb = new ExcelJS.Workbook();
  try{ await wb.xlsx.load(buffer); }
  catch(e){ throw {userMsg:"Couldn’t read this file. Save it in Excel as .xlsx without a password and try again."}; }
  const found = findHeader(wb);
  if(!found) throw {userMsg:"No heading row with Date and Slip no. was found in the first 30 rows of any sheet."};
  const {ws, hr, map} = found;
  const maxCol = Math.max(ws.columnCount, ws.getRow(hr).cellCount, 1);

  // read old rows
  const old = []; let totalsRow = null, firstData = null, lastConsumed = hr;
  for(let r=hr+1; r<=ws.rowCount; r++){
    const row = ws.getRow(r), vals = [];
    for(let c=1; c<=maxCol; c++) vals[c] = cellVal(row.getCell(c));
    const filled = vals.slice(1).some(v => v!=null && v!=="");
    if(!filled) continue;
    const date = map.date ? parseAnyDate(vals[map.date]) : null;
    const slip = map.slip && vals[map.slip]!=null ? String(vals[map.slip]).trim() : "";
    const isTotal = vals.some(v => typeof v==="string" && /\bTOTAL\b/i.test(v));
    if(isTotal && !date && !slip){
      const styles=[]; for(let c=1;c<=maxCol;c++) styles[c]=clone(row.getCell(c).style);
      let labelCol = 1; for(let c=1;c<=maxCol;c++) if(typeof vals[c]==="string" && /\bTOTAL\b/i.test(vals[c])){ labelCol=c; break; }
      totalsRow = {styles, height:row.height, labelCol, label:vals[labelCol]};
      lastConsumed = r; break;
    }
    if(date || slip){ if(!firstData) firstData=r; old.push({src:"old", date, slip, vals, order:old.length}); lastConsumed=r; }
    else break;
  }

  // template styles for data rows
  const tmplRow = ws.getRow(firstData || hr+1), tmpl = [];
  for(let c=1;c<=maxCol;c++) tmpl[c] = firstData ? clone(tmplRow.getCell(c).style) : {};
  const tmplHeight = firstData ? tmplRow.height : undefined;
  if(map.date && (!tmpl[map.date].numFmt || /general/i.test(tmpl[map.date].numFmt))) tmpl[map.date].numFmt = "dd-mm-yyyy";

  // rows after the table (notes, signatures)
  const tail = [];
  for(let r=lastConsumed+1; r<=ws.rowCount; r++){
    const row = ws.getRow(r), cells = [];
    row.eachCell({includeEmpty:true}, (cell, c) => cells.push({c, value:cell.value, style:clone(cell.style)}));
    tail.push({height:row.height, cells});
  }
  while(tail.length && !tail[tail.length-1].cells.some(x => x.value!=null && x.value!=="")) tail.pop();

  // combine
  const webKeys = new Set(webRows.map(e => keyOf(e.slip)));
  const kept = old.filter(o => !(o.slip && webKeys.has(keyOf(o.slip))));
  const replaced = old.length - kept.length;
  const web = webRows.map((e,i) => ({src:"web", date:e.date, slip:e.slip, e, order:100000+i}));
  const merged = kept.concat(web).sort((a,b) => {
    if(a.date && b.date && a.date!==b.date) return a.date < b.date ? -1 : 1;
    if(!a.date !== !b.date) return a.date ? -1 : 1;
    const s = String(a.slip||"").localeCompare(String(b.slip||""), undefined, {numeric:true});
    return s || a.order - b.order;
  });

  // clear old rows below the heading and write the merged ones
  const origCount = ws.rowCount;
  for(let r=hr+1; r<=origCount; r++){
    const row = ws.getRow(r), w = Math.max(maxCol, row.cellCount);
    for(let c=1; c<=w; c++){ const cell=row.getCell(c); cell.value=null; cell.style={}; }
  }
  let rr = hr+1;
  const fieldKeys = ["date","type","slip","party","vehicle","item","net","deduction","final","rate","amount"];
  merged.forEach((m, i) => {
    const row = ws.getRow(rr);
    if(tmplHeight) row.height = tmplHeight;
    for(let c=1;c<=maxCol;c++) row.getCell(c).style = clone(tmpl[c]);
    if(m.src==="old"){
      for(let c=1;c<=maxCol;c++){ const v=m.vals[c]; if(v!=null && v!=="") row.getCell(c).value = v; }
      if(map.date && m.date) row.getCell(map.date).value = xDate(m.date);
    } else {
      fieldKeys.forEach(k => { if(map[k]){ const v = m.e[k]; row.getCell(map[k]).value = k==="date" ? xDate(v) : (v==null || v==="" ? null : v); } });
      if(map.by) row.getCell(map.by).value = m.e.byName || null;
    }
    if(map.sr) row.getCell(map.sr).value = i+1;
    rr++;
  });
  const lastDataRow = rr-1;

  if(totalsRow && merged.length){
    const row = ws.getRow(rr);
    if(totalsRow.height) row.height = totalsRow.height;
    for(let c=1;c<=maxCol;c++) row.getCell(c).style = clone(totalsRow.styles[c]);
    row.getCell(totalsRow.labelCol).value = totalsRow.label || "TOTAL";
    MERGE_SUMK.forEach(k => {
      if(!map[k] || map[k]===totalsRow.labelCol) return;
      const L = colL(map[k]);
      let sum = 0; for(let r=hr+1; r<=lastDataRow; r++){ const v=Number(cellVal(ws.getRow(r).getCell(map[k]))); if(Number.isFinite(v)) sum+=v; }
      row.getCell(map[k]).value = {formula:"SUM("+L+(hr+1)+":"+L+lastDataRow+")", result:Math.round(sum*1000)/1000};
    });
    rr++;
  }
  tail.forEach(t => {
    const row = ws.getRow(rr);
    if(t.height) row.height = t.height;
    t.cells.forEach(x => { const c=row.getCell(x.c); c.value = x.value; c.style = x.style; });
    rr++;
  });
  if(ws.autoFilter) ws.autoFilter = colL(1)+hr+":"+colL(maxCol)+Math.max(hr, lastDataRow);

  const buf = await wb.xlsx.writeBuffer();
  return {buffer:buf, oldRows:old.length, webRows:webRows.length, replaced, total:merged.length, sheet:ws.name};
}

export { buildXlsx, buildPdf, mergeIntoWorkbook, parseAnyDate, findHeader };
