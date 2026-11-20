const C = require('./core.js');
let pass = 0, fail = 0;
const eq = (name, got, exp) => { const ok = JSON.stringify(got) === JSON.stringify(exp); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got=' + JSON.stringify(got) + ' exp=' + JSON.stringify(exp))); };
function run(frags, silenceAfter) {
  const out = []; let t = 1000;
  const p = C.createParser({ onPlate: x => out.push(x) });
  for (const f of frags) { p.feed(f, t); t += 300; }
  if (silenceAfter) p.tick(t + 1600);
  return out.map(x => x.plate + (x.type ? '|' + x.type : ''));
}
eq('ر ح م 3249', run(['ر ح م 3249']), ['رحم3249']);
eq('ر ح م 324 + صمت', run(['ر ح م 324'], true), ['رحم0324']);
eq('را با لام ٢٠٢٠ ملاكي', run(['را با لام ٢٠٢٠ ملاكي']), ['ربل2020|ملاكي']);
eq('ربل 27 + صمت', run(['ربل 27'], true), ['ربل0027']);
eq('لوحتين + نقل', run(['ا ب ج 1234 س ص ع 5555 نقل']), ['ابج1234', 'سصع5555|نقل']);
eq('ر ب ل 6 4 9 2', run(['ر ب ل 6 4 9 2']), ['ربل6492']);
eq('شظايا متقطعة', run(['ر ح', 'م 32', '49']), ['رحم3249']);
eq('64 92', run(['ربل 64 92']), ['ربل6492']);
eq('ارقام كلمات', run(['ر ب ل اتنين صفر اتنين صفر']), ['ربل2020']);
eq('الف باء جيم', run(['الف باء جيم واحد اتنين تلاتة اربعة']), ['ابج1234']);
eq('هاي لوكس', run(['ر ب ل 1234 هاي لوكس']), ['ربل1234|هاي لوكس']);
eq('نوع في شظية لاحقة', run(['ر ب ل 1234', 'ميكروباص']), ['ربل1234|ميكروباص']);
eq('نقل قبل حروف = ن ق ل', run(['نقل 1234']), ['نقل1234']);
eq('تشكيل وتطويل وترقيم', run(['رَحـم، 3249.']), ['رحم3249']);
eq('حرفين = خطأ', (() => { const o = []; const p = C.createParser({ onPlate: x => o.push(x) }); p.feed('ر ب 1234', 1); return o.map(x => x.plate + ':' + x.status); })(), ['رب1234:err']);
eq('turnComplete', (() => { const o = []; const p = C.createParser({ onPlate: x => o.push(x) }); p.feed('ر ح م 12', 1); p.turnComplete(2); return o.map(x => x.plate); })(), ['رحم0012']);
eq('نوع بعد 8 ثواني يتجاهل', (() => { const o = []; const p = C.createParser({ onPlate: x => o.push(x) }); p.feed('ر ح م 1234', 1000); p.feed('ملاكي', 10000); return o.map(x => x.type); })(), ['']);
eq('parseManual نوع', C.parseManual('رحم3249 ملاكي', 1).map(x => x.plate + '|' + x.type), ['رحم3249|ملاكي']);
eq('key ملف تطويل', C.normalizePlateKey('بحهـ 12'), 'بحه0012');
eq('key همزة وهندي', C.normalizePlateKey('أبج ١٢٣٤'), 'ابج1234');
eq('key مش لوحة', C.normalizePlateKey('اعلان مهم'), null);

eq('3 لوحات ورا بعض في جملة', run(['ر ح م 3249 س ص ع 5555 ا ب ج 1234']), ['رحم3249', 'سصع5555', 'ابج1234']);
eq('3 لوحات في شظايا منفصلة', run(['ر ح م 3249', 'س ص ع 5555', 'ا ب ج 1234']), ['رحم3249', 'سصع5555', 'ابج1234']);
eq('لوحات بحرف و بينهم', run(['رحم 3249 و سصع 5555 و ابج 1234']), ['رحم3249', 'سصع5555', 'ابج1234']);
eq('لوحة ناقصة ثم لوحة', run(['ر ح م 32 س ص ع 5555']), ['رحم0032', 'سصع5555']);
eq('لوحات بأنواع', run(['ر ح م 3249 ملاكي س ص ع 5555 نقل']), ['رحم3249|ملاكي', 'سصع5555|نقل']);
eq('لوحات بحروف ملزوقة وأرقام مقسمة', run(['رحم 32 49 سصع 55 55']), ['رحم3249', 'سصع5555']);
eq('لوحة مطلوبة وبعدها لوحات (flush)', (() => { const o = []; const p = C.createParser({ onPlate: x => o.push(x.plate) }); p.feed('ر ح م 3249', 1); p.feed('س ص ع 55', 2); p.turnComplete(3); return o; })(), ['رحم3249', 'سصع0055']);

eq('مبدئي فيه لوحة زيادة', C.missingFromInterim('رحم 3249 سصع 5555', 'رحم 3249').map(p => p.plate), ['سصع5555']);
eq('مبدئي = نهائي', C.missingFromInterim('رحم 3249', 'رحم 3249'), []);
eq('مبدئي مختلف عن النهائي (متتسجلش تخمين)', C.missingFromInterim('رحم 3248 سصع 5555', 'رحم 3249'), []);
eq('مبدئي بأكتر من لوحة والنهائي فاضي', C.missingFromInterim('رحم 3249 سصع 5555', 'ااا').map(p => p.plate), ['رحم3249', 'سصع5555']);
const z = C.parseZones('جني — الرمال\n30.0, 31.0\n30.0, 31.1\n30.1, 31.1\n30.1, 31.0\n\nصغيرة\n30.04,31.04\n30.04,31.06\n30.06,31.06\n30.06,31.04');
eq('zones parsed', z.zones.length, 2);
eq('زون: الأصغر', C.zoneFor(z.zones, 30.05, 31.05), 'صغيرة');
eq('زون: الكبير', C.zoneFor(z.zones, 30.01, 31.01), 'جني — الرمال');
eq('زون: بره', C.zoneFor(z.zones, 31, 31), null);
eq('زون فراشة', C.zoneFor(C.parseZones('ف\n30,31\n30.1,31.1\n30,31.1\n30.1,31').zones, 30.05, 31.05), 'ف');
(async () => {
  const bytes = C.buildXlsx(['اللوحه', 'النوع', 'البنك'], [['رحم3249', 'ملاكي', 'بنك 1'], [{ link: 'https://maps.google.com/?q=1,2', text: 'حي' }, 'x', 'y']]);
  const blob = new Blob([bytes]); blob.name = 'a.xlsx';
  const got = [];
  await C.importMatchFile(blob, { begin: async () => {}, putBatch: async l => got.push(...l), finish: async () => {} }, {});
  eq('round trip xlsx (كتابة ثم قراءة)', got.map(g => g.k), ['رحم3249']);
  const fs = require('fs');
  if (fs.existsSync('/tmp/big.xlsx')) {
    const b2 = new Blob([fs.readFileSync('/tmp/big.xlsx')]); b2.name = 'big.xlsx';
    const g2 = [], meta = {}; const t0 = Date.now();
    await C.importMatchFile(b2, { begin: async (h, c) => { meta.h = h; meta.c = c; }, putBatch: async l => g2.push(...l), finish: async () => {} }, {});
    eq('xlsx مضغوط: عدد اللوحات (تجاهل صف الإعلان والفاضي)', g2.length, 20000);
    eq('xlsx: عمود اللوحة + العناوين', [meta.c, meta.h[0], meta.h[3]], [0, 'اللوحه', 'رقم الشهادة']);
    eq('xlsx: أول صف', [g2[0].k, g2[0].r[1]], ['بحه1234', 'ملاكي']);
    console.log('زمن قراءة 23 ألف صف (ms):', Date.now() - t0);
  }
  const csv = new Blob(['\uFEFFاللوحه,النوع\n"ر ب ل 20",نقل\nاعلان,\n']); csv.name = 'x.csv';
  const g3 = []; await C.importMatchFile(csv, { begin: async () => {}, putBatch: async l => g3.push(...l), finish: async () => {} }, {});
  eq('csv', g3.map(x => x.k), ['ربل0020']);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
