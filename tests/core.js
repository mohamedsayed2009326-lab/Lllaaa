/*CORE_START*/
'use strict';
/* ===== ثوابت وتوحيد النصوص ===== */
const LETTERS = 'ابجحدرسصطعفقكلمنهوي';
function normText(s) {
  s = String(s == null ? '' : s);
  s = s.replace(/[\u0660-\u0669]/g, c => String(c.charCodeAt(0) - 0x660));
  s = s.replace(/[\u06F0-\u06F9]/g, c => String(c.charCodeAt(0) - 0x6F0));
  s = s.replace(/[\u064B-\u065F\u0670\u0640\u200c\u200d\u200e\u200f\u061c]/g, '');
  s = s.replace(/[أإآٱ]/g, 'ا').replace(/[ىی]/g, 'ي').replace(/[ھہ]/g, 'ه').replace(/ک/g, 'ك');
  s = s.replace(/\u066B/g, '.').replace(/[\u060C\u066C]/g, ',');
  return s;
}
const LETTER_NAMES = {
  'الف': 'ا', 'باء': 'ب', 'با': 'ب', 'جيم': 'ج', 'حاء': 'ح', 'دال': 'د', 'راء': 'ر', 'را': 'ر',
  'سين': 'س', 'صاد': 'ص', 'طاء': 'ط', 'عين': 'ع', 'قاف': 'ق', 'كاف': 'ك', 'لام': 'ل', 'ميم': 'م',
  'نون': 'ن', 'هاء': 'ه', 'واو': 'و', 'ياء': 'ي', 'فاء': 'ف'
};
const DIGIT_WORDS = {
  'صفر': 0, 'زيرو': 0, 'واحد': 1, 'واحده': 1, 'واحدة': 1, 'اتنين': 2, 'اثنين': 2, 'اثنان': 2, 'اتنان': 2, 'تنين': 2,
  'تلاته': 3, 'تلاتة': 3, 'ثلاثه': 3, 'ثلاثة': 3, 'تلات': 3, 'اربعه': 4, 'اربعة': 4, 'خمسه': 5, 'خمسة': 5,
  'سته': 6, 'ستة': 6, 'سبعه': 7, 'سبعة': 7, 'تمانيه': 8, 'تمانية': 8, 'ثمانيه': 8, 'ثمانية': 8, 'تمنية': 8,
  'تسعه': 9, 'تسعة': 9
};
const TYPES = {
  'ملاكي': 'ملاكي', 'نقل': 'نقل', 'مركونه': 'مركونة', 'مركونة': 'مركونة', 'ونيت': 'ونيت', 'وانيت': 'ونيت',
  'تاكسي': 'تاكسي', 'ميكروباص': 'ميكروباص', 'ميكروبص': 'ميكروباص', 'هايلوكس': 'هاي لوكس', 'هيلوكس': 'هاي لوكس',
  'هايس': 'هاي اس'
};
const HAI2 = { 'لوكس': 'هاي لوكس', 'لكس': 'هاي لوكس', 'اس': 'هاي اس', 'ايس': 'هاي اس', 'س': 'هاي اس' };
const STOP = new Set(['من', 'عن', 'في', 'لا', 'ما', 'يا', 'او', 'ان', 'لو', 'بس', 'كل', 'مع', 'على', 'علي', 'هو', 'هي', 'ده', 'دي', 'دا', 'ود', 'يعني', 'اه', 'ايه', 'ايوه']);
const TYPE_LIST = ['ملاكي', 'نقل', 'هاي لوكس', 'هاي اس', 'مركونة', 'ونيت', 'تاكسي', 'ميكروباص'];
const VOCAB = ['ألف', 'باء', 'جيم', 'حاء', 'دال', 'راء', 'سين', 'صاد', 'طاء', 'عين', 'قاف', 'كاف', 'لام', 'ميم', 'نون', 'هاء', 'واو', 'ياء'].concat(TYPE_LIST);

/* ===== مفتاح اللوحة (للمطابقة مع الملف) ===== */
function normalizePlateKey(s) {
  const n = normText(s);
  if (!n || n.length > 24 || /[A-Za-z]/.test(n)) return null;
  const letters = (n.match(/[\u0621-\u064A]/g) || []).join('');
  const digits = (n.match(/[0-9]/g) || []).join('');
  if (letters.length < 2 || letters.length > 4 || digits.length < 1 || digits.length > 4) return null;
  return letters + digits.padStart(4, '0');
}
function looksLikePlate(s) { return s != null && normalizePlateKey(s) !== null; }

/* ===== محلل الكلام → لوحة (بيحتفظ بحالة بين الشظايا) ===== */
function createParser(opts) {
  const o = Object.assign({ typeWindow: 8000, silence: 1500, lettersTimeout: 4000, onPlate: null, onType: null }, opts || {});
  const st = { letters: '', digits: '', hai: false, lastFeed: 0, last: null };
  const pad = d => (d.length >= 1 && d.length < 4) ? d.padStart(4, '0') : d;
  function finalize(t) {
    if (!st.letters && st.digits.length < 4) { st.digits = ''; return null; } // أرقام يتيمة = ضوضاء
    const digits = pad(st.digits);
    const ok = st.letters.length === 3 && digits.length === 4;
    const p = { letters: st.letters, digits, plate: st.letters + digits, type: '', status: ok ? 'ok' : 'err', ts: t };
    st.letters = ''; st.digits = ''; st.last = p;
    if (o.onPlate) o.onPlate(p);
    return p;
  }
  function setTypeOn(p, type) { if (!p) return; p.type = type; if (o.onType) o.onType(p); }
  function addLetter(c, t) {
    if (st.digits.length > 0) finalize(t);
    st.letters += c;
    if (st.letters.length > 3) st.letters = st.letters.slice(-3);
  }
  function addDigits(d) {
    st.digits += d;
    if (st.digits.length >= 4) { st.digits = st.digits.slice(0, 4); finalize(st.lastFeed); }
  }
  function typeWord(type, t) {
    if (st.letters && st.digits.length > 0) { setTypeOn(finalize(t), type); return; }
    if (st.letters) {
      if (type === 'نقل') { for (const c of 'نقل') addLetter(c, t); return; }
      setTypeOn(finalize(t), type); return;
    }
    if (st.last && !st.last.type && t - st.last.ts <= o.typeWindow) { setTypeOn(st.last, type); return; }
    if (type === 'نقل') for (const c of 'نقل') addLetter(c, t);
  }
  function handle(tok, t) {
    if (/^[0-9]+$/.test(tok)) { addDigits(tok); return; }
    if (st.hai) { st.hai = false; if (HAI2[tok]) { typeWord(HAI2[tok], t); return; } }
    if (tok === 'هاي') { st.hai = true; return; }
    if (TYPES[tok]) { typeWord(TYPES[tok], t); return; }
    if (LETTER_NAMES[tok]) { addLetter(LETTER_NAMES[tok], t); return; }
    if (DIGIT_WORDS[tok] !== undefined) { addDigits(String(DIGIT_WORDS[tok])); return; }
    if (tok.length === 1 && LETTERS.includes(tok)) { addLetter(tok, t); return; }
    if (tok.length >= 2 && tok.length <= 3 && !STOP.has(tok) && [...tok].every(c => LETTERS.includes(c))) {
      for (const c of tok) addLetter(c, t); return;
    }
    /* غير ذلك: كلام عادي يتجاهل */
  }
  return {
    feed(text, t) {
      st.lastFeed = t;
      const toks = normText(text).match(/[0-9]+|[\u0621-\u064A]+/g) || [];
      for (const tok of toks) handle(tok, t);
    },
    tick(t) {
      if (!st.letters && !st.digits) return;
      const idle = t - st.lastFeed;
      if (st.digits.length > 0 && idle >= o.silence) finalize(t);
      else if (st.digits.length === 0 && st.letters && idle >= o.lettersTimeout) finalize(t);
    },
    turnComplete(t) { if (st.letters || st.digits) finalize(t); },
    reset() { st.letters = ''; st.digits = ''; st.hai = false; st.last = null; },
    pending() { return { letters: st.letters, digits: st.digits }; }
  };
}
/* تحليل نص مكتوب/ملصوق بنفس القواعد: بيرجّع كل اللوحات */
function parseManual(text, now) {
  const t = now == null ? Date.now() : now;
  const res = [];
  const p = createParser({ onPlate: x => res.push(x) });
  p.feed(text, t); p.turnComplete(t);
  return res;
}


/* لوحات ظهرت في النص المبدئي ومش موجودة في النهائي.
   بترجع الزيادة بس لو كل لوحات النهائي مؤكدة جوه المبدئي (عشان منسجّلش تخمين غلط) */
function missingFromInterim(interimText, finalText) {
  const okOnly = t => parseManual(t, 0).filter(p => p.status === 'ok');
  const I = okOnly(interimText), F = okOnly(finalText);
  if (I.length <= F.length) return [];
  const pool = I.slice(), extras = [];
  for (const f of F) { const i = pool.findIndex(x => x.plate === f.plate); if (i < 0) return []; pool.splice(i, 1); }
  return pool;
}

/* ===== المناطق (مربعات) ===== */
function makeZone(name, pts) {
  const cy = pts.reduce((a, p) => a + p[0], 0) / pts.length, cx = pts.reduce((a, p) => a + p[1], 0) / pts.length; // cy=lat, cx=lng
  const ord = pts.slice().sort((a, b) => Math.atan2(a[0] - cy, a[1] - cx) - Math.atan2(b[0] - cy, b[1] - cx));
  const lats = ord.map(p => p[0]), lngs = ord.map(p => p[1]);
  let a = 0;
  for (let i = 0; i < ord.length; i++) { const j = (i + 1) % ord.length; a += ord[i][1] * ord[j][0] - ord[j][1] * ord[i][0]; }
  return { name, pts: ord, bbox: [Math.min(...lats), Math.min(...lngs), Math.max(...lats), Math.max(...lngs)], area: Math.abs(a) / 2 };
}
function parseZones(text) {
  const zones = [], errors = [];
  const blocks = normText(text).replace(/\r/g, '').split(/\n\s*\n/);
  for (const b of blocks) {
    const lines = b.split('\n').map(x => x.trim()).filter(Boolean);
    if (!lines.length) continue;
    const name = lines[0], pts = [];
    for (const ln of lines.slice(1)) {
      const nums = ln.match(/-?\d+(?:\.\d+)?/g);
      if (nums && nums.length >= 2) {
        const lat = parseFloat(nums[0]), lng = parseFloat(nums[1]);
        if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) pts.push([lat, lng]);
      }
    }
    if (pts.length !== 4) { errors.push(`"${name}": محتاج 4 إحداثيات (لقيت ${pts.length})`); continue; }
    zones.push(makeZone(name, pts));
  }
  return { zones, errors };
}
function pointInZone(z, lat, lng) {
  const b = z.bbox;
  if (lat < b[0] || lat > b[2] || lng < b[1] || lng > b[3]) return false;
  let inside = false;
  const p = z.pts;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const yi = p[i][0], xi = p[i][1], yj = p[j][0], xj = p[j][1];
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function zoneFor(zones, lat, lng) {
  let best = null;
  for (const z of zones) if (pointInZone(z, lat, lng) && (!best || z.area < best.area)) best = z;
  return best ? best.name : null;
}
function mergeZones(oldList, newList) {
  const out = oldList.slice();
  for (const z of newList) { const i = out.findIndex(x => x.name === z.name); if (i >= 0) out[i] = z; else out.push(z); }
  return out;
}

/* ===== ZIP (كتابة بدون ضغط) ===== */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStore(files) {
  const enc = new TextEncoder(), chunks = [], central = [];
  let offset = 0;
  for (const f of files) {
    const nm = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
    const lh = new Uint8Array(30 + nm.length), dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true); dv.setUint16(8, 0, true);
    dv.setUint16(10, 0, true); dv.setUint16(12, 33, true); dv.setUint32(14, crc, true); dv.setUint32(18, sz, true);
    dv.setUint32(22, sz, true); dv.setUint16(26, nm.length, true); dv.setUint16(28, 0, true); lh.set(nm, 30);
    const ch = new Uint8Array(46 + nm.length), cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 33, true); cv.setUint32(16, crc, true);
    cv.setUint32(20, sz, true); cv.setUint32(24, sz, true); cv.setUint16(28, nm.length, true); cv.setUint32(42, offset, true); ch.set(nm, 46);
    chunks.push(lh, f.data); central.push(ch); offset += lh.length + sz;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  const all = chunks.concat(central, [end]);
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0; for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}

/* ===== كتابة xlsx (RTL، نصوص inline، HYPERLINK) ===== */
function xmlEsc(s) { return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function colName(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
/* cell: string | number | {link:url, text:name} */
function buildXlsx(headers, rows, widths) {
  const enc = new TextEncoder();
  let sd = '<row r="1">' + headers.map((h, i) => `<c r="${colName(i)}1" t="inlineStr" s="1"><is><t>${xmlEsc(h)}</t></is></c>`).join('') + '</row>';
  rows.forEach((row, ri) => {
    const r = ri + 2;
    sd += `<row r="${r}">` + row.map((v, ci) => {
      const ref = colName(ci) + r;
      if (v && typeof v === 'object' && v.link) {
        const url = String(v.link).replace(/"/g, '""'), txt = String(v.text).replace(/"/g, '""');
        const f = `HYPERLINK("${url}","${txt}")`;
        if (url.length + txt.length + 14 > 250 || f.length > 250) return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v.text)}</t></is></c>`;
        return `<c r="${ref}" t="str" s="2"><f>${xmlEsc(f)}</f><v>${xmlEsc(v.text)}</v></c>`;
      }
      if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
    }).join('') + '</row>';
  });
  const cols = '<cols>' + headers.map((h, i) => `<col min="${i + 1}" max="${i + 1}" width="${(widths && widths[i]) || 16}" customWidth="1"/>`).join('') + '</cols>';
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${sd}</sheetData></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><u/><sz val="11"/><color rgb="FF0563C1"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9EAD3"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`;
  const files = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="السجل" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/styles.xml', styles],
    ['xl/worksheets/sheet1.xml', sheet]
  ];
  return zipStore(files.map(f => ({ name: f[0], data: enc.encode(f[1]) })));
}

/* ===== قراءة ZIP/XLSX تدفقياً ===== */
async function readU(blob, start, len) { return new Uint8Array(await blob.slice(start, start + len).arrayBuffer()); }
async function zipEntries(blob) {
  const size = blob.size;
  if (size < 22) throw new Error('الملف مش xlsx (صغير جداً)');
  const tailLen = Math.min(size, 65557);
  const tail = await readU(blob, size - tailLen, tailLen), dv = new DataView(tail.buffer);
  let i = tail.length - 22;
  for (; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) break;
  if (i < 0) throw new Error('الملف مش xlsx صحيح (مفيش فهرس zip)');
  const cdSize = dv.getUint32(i + 12, true), cdOff = dv.getUint32(i + 16, true);
  if (cdOff === 0xFFFFFFFF) throw new Error('ملف zip64 مش مدعوم');
  const cd = await readU(blob, cdOff, cdSize), cv = new DataView(cd.buffer), dec = new TextDecoder();
  const map = {};
  let p = 0;
  while (p + 46 <= cd.length && cv.getUint32(p, true) === 0x02014b50) {
    const method = cv.getUint16(p + 10, true), csize = cv.getUint32(p + 20, true), usize = cv.getUint32(p + 24, true);
    const nl = cv.getUint16(p + 28, true), el = cv.getUint16(p + 30, true), cl = cv.getUint16(p + 32, true), lho = cv.getUint32(p + 42, true);
    map[dec.decode(cd.subarray(p + 46, p + 46 + nl))] = { method, csize, usize, lho };
    p += 46 + nl + el + cl;
  }
  return map;
}
async function entryTextStream(blob, e) {
  const lh = await readU(blob, e.lho, 30), lv = new DataView(lh.buffer);
  const start = e.lho + 30 + lv.getUint16(26, true) + lv.getUint16(28, true);
  let s = blob.slice(start, start + e.csize).stream();
  if (e.method === 8) s = s.pipeThrough(new DecompressionStream('deflate-raw'));
  else if (e.method !== 0) throw new Error('نوع ضغط مش مدعوم في xlsx');
  return s.pipeThrough(new TextDecoderStream('utf-8'));
}
async function* textChunks(stream) {
  const r = stream.getReader();
  try { for (;;) { const { done, value } = await r.read(); if (done) return; if (value) yield value; } } finally { try { r.releaseLock(); } catch (e) { } }
}
async function entryText(blob, e) { let s = ''; for await (const c of textChunks(await entryTextStream(blob, e))) s += c; return s; }
function xmlUnesc(s) {
  return s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, g) => {
    if (g[0] === '#') { const n = g[1] === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10); try { return String.fromCodePoint(n); } catch (e) { return ''; } }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[g];
  });
}
function siText(inner) {
  inner = inner.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '', m; const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  while ((m = re.exec(inner))) out += m[1];
  return xmlUnesc(out);
}
async function readSharedStrings(blob, entries) {
  const e = entries['xl/sharedStrings.xml'];
  if (!e) return [];
  const arr = []; let buf = '';
  for await (const chunk of textChunks(await entryTextStream(blob, e))) {
    buf += chunk; let pos = 0;
    for (;;) {
      const re = /<si(?:\s[^>]*)?(\/?)>/g; re.lastIndex = pos;
      const m = re.exec(buf); if (!m) break;
      if (m[1] === '/') { arr.push(''); pos = m.index + m[0].length; continue; }
      const end = buf.indexOf('</si>', m.index + m[0].length);
      if (end < 0) { pos = m.index; break; }
      arr.push(siText(buf.slice(m.index + m[0].length, end))); pos = end + 5;
    }
    buf = buf.slice(pos);
  }
  return arr;
}
async function findSheetPath(blob, entries) {
  try {
    const wb = await entryText(blob, entries['xl/workbook.xml']);
    const rels = await entryText(blob, entries['xl/_rels/workbook.xml.rels']);
    const m = /<sheet\b[^>]*?\br:id="([^"]+)"/.exec(wb);
    if (m) {
      for (const tag of rels.match(/<Relationship\b[^>]*>/g) || []) {
        if (new RegExp('\\bId="' + m[1] + '"').test(tag)) {
          const t = /\bTarget="([^"]+)"/.exec(tag);
          if (t) { const path = t[1][0] === '/' ? t[1].slice(1) : 'xl/' + t[1].replace(/^\.\//, ''); if (entries[path]) return path; }
        }
      }
    }
  } catch (e) { }
  if (entries['xl/worksheets/sheet1.xml']) return 'xl/worksheets/sheet1.xml';
  const k = Object.keys(entries).filter(x => /^xl\/worksheets\/[^/]+\.xml$/.test(x)).sort()[0];
  if (!k) throw new Error('مفيش شيت جوه الملف');
  return k;
}
function colIndex(letters) { let n = 0; for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; }
function parseCells(inner, sst) {
  const vals = []; const re = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let m;
  while ((m = re.exec(inner))) {
    if (m[2] === undefined) continue;
    const a = m[1], ref = /\br="([A-Z]+)\d*"/.exec(a); if (!ref) continue;
    const t = /\bt="(\w+)"/.exec(a), tp = t ? t[1] : 'n';
    let v;
    if (tp === 'inlineStr') v = siText(m[2]);
    else { const vm = /<v>([\s\S]*?)<\/v>/.exec(m[2]); if (!vm) continue; v = tp === 's' ? (sst[parseInt(vm[1], 10)] || '') : xmlUnesc(vm[1]); }
    vals[colIndex(ref[1])] = v;
  }
  return vals;
}
async function streamXlsxRows(blob, entries, sheetPath, sst, onRow) {
  let buf = '';
  for await (const chunk of textChunks(await entryTextStream(blob, entries[sheetPath]))) {
    buf += chunk; let pos = 0;
    for (;;) {
      const re = /<row(?=[\s>\/])/g; re.lastIndex = pos;
      const rm = re.exec(buf); if (!rm) { pos = Math.max(pos, buf.length - 5); break; }
      const gt = buf.indexOf('>', rm.index); if (gt < 0) { pos = rm.index; break; }
      if (buf[gt - 1] === '/') { pos = gt + 1; continue; }
      const end = buf.indexOf('</row>', gt); if (end < 0) { pos = rm.index; break; }
      const rn = /\sr="(\d+)"/.exec(buf.slice(rm.index, gt));
      const cells = parseCells(buf.slice(gt + 1, end), sst);
      pos = end + 6;
      if (cells.length) { let r = onRow(rn ? parseInt(rn[1], 10) : 0, cells); if (r && r.then) r = await r; if (r === false) return; }
    }
    buf = buf.slice(pos);
  }
}

/* ===== CSV ===== */
function parseCsvLine(line, d) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === d) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out;
}
async function csvRows(file, onRow) {
  let enc = 'utf-8';
  try { new TextDecoder('utf-8', { fatal: true }).decode(await readU(file, 0, Math.min(file.size, 65536)), { stream: true }); } catch (e) { enc = 'windows-1256'; }
  const stream = file.stream().pipeThrough(new TextDecoderStream(enc));
  let carry = '', n = 0, delim = null;
  const emit = async line => {
    n++;
    if (!delim) { const c = [',', ';', '\t'].map(d => [d, line.split(d).length]); c.sort((a, b) => b[1] - a[1]); delim = c[0][0]; }
    if (!line.trim()) return true;
    const cells = parseCsvLine(line, delim);
    let r = onRow(n, cells); if (r && r.then) r = await r;
    return r !== false;
  };
  for await (let chunk of textChunks(stream)) {
    if (n === 0 && !carry && chunk.charCodeAt(0) === 0xFEFF) chunk = chunk.slice(1);
    carry += chunk;
    const parts = carry.split('\n'); carry = parts.pop();
    let pending = '';
    for (const part of parts) {
      pending += (pending ? '\n' : '') + part.replace(/\r$/, '');
      if ((pending.match(/"/g) || []).length % 2) continue;
      if (!(await emit(pending))) return;
      pending = '';
    }
    carry = pending ? pending + '\n' + carry : carry;
  }
  if (carry.trim()) await emit(carry.replace(/\r$/, ''));
}

/* ===== استيراد ملف المطابقة ===== */
const nonEmpty = c => c !== undefined && c !== null && String(c).trim() !== '';
function detectPlateColumn(sample) {
  const maxCol = Math.max(0, ...sample.map(r => r.cells.length)) ;
  const ratio = col => { let ne = 0, pl = 0; for (const r of sample) { const v = r.cells[col]; if (nonEmpty(v)) { ne++; if (looksLikePlate(v)) pl++; } } return { ne, pl }; };
  const mkHeaders = (row, width) => { const h = []; for (let i = 0; i < width; i++) h.push(row && nonEmpty(row.cells[i]) ? String(row.cells[i]).trim() : 'عمود ' + (i + 1)); return h; };
  const width = maxCol;
  for (const r of sample.slice(0, 40)) {
    for (let i = 0; i < r.cells.length; i++) {
      const v = r.cells[i]; if (!nonEmpty(v)) continue;
      const s = normText(v).toLowerCase().trim();
      if (s.length <= 20 && (s.includes('لوح') || s.includes('plate'))) {
        const after = sample.filter(x => x.n > r.n), rt = (() => { let ne = 0, pl = 0; for (const x of after) { const y = x.cells[i]; if (nonEmpty(y)) { ne++; if (looksLikePlate(y)) pl++; } } return { ne, pl }; })();
        if (rt.ne > 0 && rt.pl / rt.ne >= 0.3) return { col: i, headerRow: r.n, headers: mkHeaders(r, width) };
      }
    }
  }
  let best = null;
  for (let i = 0; i < width; i++) { const q = ratio(i); if (q.ne >= 1 && q.pl / q.ne > 0.5 && (!best || q.pl > best.pl)) best = { col: i, pl: q.pl }; }
  if (!best) return null;
  return guessForCol(sample, best.col);
}
function guessForCol(sample, col) {
  const width = Math.max(1, ...sample.map(r => r.cells.length));
  const first = sample.find(r => looksLikePlate(r.cells[col]));
  let hdr = null;
  for (const r of sample) {
    if (first && r.n >= first.n) break;
    if (r.cells.filter(nonEmpty).length >= 2 && !looksLikePlate(r.cells[col])) hdr = r;
  }
  const headers = []; for (let i = 0; i < width; i++) headers.push(hdr && nonEmpty(hdr.cells[i]) ? String(hdr.cells[i]).trim() : 'عمود ' + (i + 1));
  return { col, headerRow: hdr ? hdr.n : 0, headers };
}
function describeColumns(sample) {
  const width = Math.max(0, ...sample.map(r => r.cells.length)), cols = [];
  for (let i = 0; i < width; i++) {
    const ex = []; for (const r of sample) { if (nonEmpty(r.cells[i])) ex.push(String(r.cells[i]).trim().slice(0, 30)); if (ex.length >= 3) break; }
    if (ex.length) cols.push({ idx: i, samples: ex });
  }
  return cols;
}
async function makeRowIterator(file) {
  const head = await readU(file, 0, 4);
  if (head[0] === 0x50 && head[1] === 0x4B) {
    const entries = await zipEntries(file);
    if (!entries['xl/workbook.xml']) throw new Error('الملف zip لكن مش xlsx');
    const sst = await readSharedStrings(file, entries), sheet = await findSheetPath(file, entries);
    return onRow => streamXlsxRows(file, entries, sheet, sst, onRow);
  }
  if (head[0] === 0xD0 && head[1] === 0xCF) throw new Error('الملف xls قديم — افتحه واحفظه بصيغة xlsx أو csv');
  if (/\.(xlsx?|xlsm)$/i.test(file.name || '')) throw new Error('الملف مش xlsx صحيح');
  return onRow => csvRows(file, onRow);
}
/* sink = { begin(headers, plateCol), putBatch([{k,r}]), finish(meta) } */
async function importMatchFile(file, sink, opts) {
  opts = opts || {};
  const onProgress = opts.onProgress || (() => { });
  const iter = await makeRowIterator(file);
  const sample = [];
  await iter((n, cells) => { if (cells.some(nonEmpty)) sample.push({ n, cells }); return sample.length < 400; });
  const det = opts.col != null ? guessForCol(sample, opts.col) : detectPlateColumn(sample);
  if (!det) { const e = new Error('NEED_COLUMN'); e.needColumn = true; e.columns = describeColumns(sample); throw e; }
  await sink.begin(det.headers, det.col);
  let batch = [], count = 0, skipped = 0, scanned = 0;
  const W = det.headers.length;
  await iter(async (n, cells) => {
    scanned++;
    if (n > det.headerRow) {
      const key = normalizePlateKey(cells[det.col]);
      if (key) {
        const r = new Array(W); for (let i = 0; i < W; i++) r[i] = nonEmpty(cells[i]) ? String(cells[i]).trim() : '';
        batch.push({ k: key, r }); count++;
        if (batch.length >= 5000) { const b = batch; batch = []; await sink.putBatch(b); }
      } else if (cells.some(nonEmpty)) skipped++;
    }
    if (scanned % 20000 === 0) { onProgress({ rows: scanned, plates: count }); await new Promise(r => setTimeout(r, 0)); }
  });
  if (batch.length) await sink.putBatch(batch);
  const meta = { name: file.name || 'file', count, skipped, headers: det.headers, plateCol: det.col };
  await sink.finish(meta);
  onProgress({ rows: scanned, plates: count, done: true });
  return meta;
}
function matchPairs(headers, r, plateCol) {
  const out = [];
  for (let i = 0; i < r.length; i++) if (i !== plateCol && r[i] !== '' && r[i] != null) out.push([headers[i] || ('عمود ' + (i + 1)), r[i]]);
  return out;
}
/*CORE_END*/
if (typeof module !== 'undefined') module.exports = { missingFromInterim, normText, normalizePlateKey, looksLikePlate, createParser, parseManual, parseZones, makeZone, zoneFor, pointInZone, mergeZones, zipStore, buildXlsx, importMatchFile, matchPairs, crc32, zipEntries, csvRows, parseCsvLine, colName };
