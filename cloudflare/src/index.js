const SESSION_SECONDS = 12 * 60 * 60;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_MAX_ATTEMPTS = 5;
const encoder = new TextEncoder();

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });
}
function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  // APK WebView origin is appassets.androidplatform.net; no wildcard credentialed CORS.
  const allowed = origin === new URL(request.url).origin || origin === 'https://appassets.androidplatform.net';
  return allowed ? { 'access-control-allow-origin': origin, 'vary': 'Origin', 'access-control-allow-headers': 'authorization,content-type,x-device-id', 'access-control-allow-methods': 'GET,POST,OPTIONS' } : {};
}
async function sha(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function randomHex(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function bodyJson(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > 4096) throw new Error('payload_too_large');
  const raw = await request.text();
  if (raw.length > 4096) throw new Error('payload_too_large');
  return JSON.parse(raw || '{}');
}
function validId(s) { return typeof s === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(s); }
function bearer(request) { const v = request.headers.get('authorization') || ''; return v.startsWith('Bearer ') ? v.slice(7) : ''; }
async function authSession(request, env) {
  const token = bearer(request);
  const deviceId = request.headers.get('x-device-id') || '';
  if (!/^[a-f0-9]{64}$/.test(token) || !validId(deviceId)) return null;
  const hash = await sha(token), now = Math.floor(Date.now() / 1000);
  return env.DB.prepare(`SELECT s.token_hash,s.code_id,s.device_id,s.expires_at,c.status,c.expires_at AS code_expires
    FROM sessions s JOIN activation_codes c ON c.id=s.code_id
    WHERE s.token_hash=? AND s.device_id=? AND s.revoked_at IS NULL AND s.expires_at>? AND c.status='active' AND c.expires_at>?`)
    .bind(hash, deviceId, now, now).first();
}
async function login(request, env) {
  let data;
  try { data = await bodyJson(request); } catch { return json({ error: 'بيانات غير صالحة' }, 400); }
  const code = typeof data.code === 'string' ? data.code.trim().toUpperCase() : '';
  const deviceId = typeof data.deviceId === 'string' ? data.deviceId : '';
  if (!/^[A-Z0-9-]{8,40}$/.test(code) || !validId(deviceId)) return json({ error: 'راجع رمز التفعيل وحاول مرة أخرى' }, 400);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ipFingerprint = await sha('ip:' + ip);
  const deviceFingerprint = await sha('device:' + deviceId);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('DELETE FROM login_attempts WHERE attempted_at < ?').bind(now - 86400).run();
  const count = await env.DB.prepare(`SELECT MAX(n) AS n FROM (
    SELECT COUNT(*) AS n FROM login_attempts WHERE fingerprint=? AND attempted_at>? AND success=0
    UNION ALL
    SELECT COUNT(*) AS n FROM login_attempts WHERE fingerprint=? AND attempted_at>? AND success=0
  )`).bind(ipFingerprint, now - LOGIN_WINDOW_SECONDS, deviceFingerprint, now - LOGIN_WINDOW_SECONDS).first();
  if ((count?.n || 0) >= LOGIN_MAX_ATTEMPTS) return json({ error: 'محاولات كثيرة. انتظر 15 دقيقة ثم حاول مجددًا.' }, 429, { 'retry-after': '900' });
  const codeHash = await sha(code);
  const activation = await env.DB.prepare('SELECT id,status,expires_at,device_id FROM activation_codes WHERE code_hash=?').bind(codeHash).first();
  if (!activation || activation.status !== 'active' || activation.expires_at <= now || (activation.device_id && activation.device_id !== deviceId)) {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO login_attempts(fingerprint,attempted_at,success) VALUES(?,?,0)').bind(ipFingerprint, now),
      env.DB.prepare('INSERT INTO login_attempts(fingerprint,attempted_at,success) VALUES(?,?,0)').bind(deviceFingerprint, now)
    ]);
    return json({ error: 'رمز التفعيل غير صحيح أو منتهي أو مرتبط بجهاز آخر' }, 401);
  }
  // Conditional binding ensures two devices cannot claim an unused code concurrently.
  const claim = await env.DB.prepare(`UPDATE activation_codes SET device_id=COALESCE(device_id,?), activated_at=COALESCE(activated_at,?)
    WHERE id=? AND status='active' AND expires_at>? AND (device_id IS NULL OR device_id=?)`).bind(deviceId, now, activation.id, now, deviceId).run();
  if (!claim.meta?.changes) return json({ error: 'تعذر ربط الرمز بهذا الجهاز' }, 409);
  const token = randomHex(32), tokenHash = await sha(token), expiresAt = now + SESSION_SECONDS;
  await env.DB.prepare('INSERT INTO sessions(token_hash,code_id,device_id,expires_at,created_at) VALUES(?,?,?,?,?)')
    .bind(tokenHash, activation.id, deviceId, expiresAt, now).run();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO login_attempts(fingerprint,attempted_at,success) VALUES(?,?,1)').bind(ipFingerprint, now),
    env.DB.prepare('INSERT INTO login_attempts(fingerprint,attempted_at,success) VALUES(?,?,1)').bind(deviceFingerprint, now)
  ]);
  return json({ token, expiresAt, expiresIn: SESSION_SECONDS });
}
async function issueGeminiToken(request, env) {
  const session = await authSession(request, env);
  if (!session) return json({ error: 'انتهت الجلسة. سجّل الدخول مرة أخرى.' }, 401);
  if (!env.GEMINI_API_KEY) return json({ error: 'خدمة الصوت غير مهيأة على السيرفر' }, 503);
  const now = Date.now();
  const model = env.GEMINI_LIVE_MODEL || 'models/gemini-3.5-transcribe-live';
  const payload = {
    uses: 1,
    expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
    newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
    liveConnectConstraints: { model, config: { responseModalities: ['TEXT'], inputAudioTranscription: { languageCodes: ['ar-EG'] } } }
  };
  const upstream = await fetch('https://generativelanguage.googleapis.com/v1alpha/auth_tokens', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY }, body: JSON.stringify(payload)
  });
  const result = await upstream.json().catch(() => ({}));
  if (!upstream.ok || !result.name) return json({ error: 'تعذر تجهيز اتصال الصوت', detail: 'gemini_token_error' }, 502);
  return json({ token: result.name, expiresAt: result.expireTime || payload.expireTime });
}
async function admin(request, env, path) {
  const data = await bodyJson(request).catch(() => ({}));
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const adminFingerprint = await sha('admin:' + ip);
  const now = Math.floor(Date.now() / 1000);
  const failures = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE fingerprint=? AND attempted_at>? AND success=0').bind(adminFingerprint, now - LOGIN_WINDOW_SECONDS).first();
  if ((failures?.n || 0) >= 10) return json({ error: 'محاولات إدارة كثيرة. انتظر 15 دقيقة.' }, 429, { 'retry-after': '900' });
  if (!env.ADMIN_SECRET || typeof data.adminKey !== 'string' || !(await constantTimeEqual(data.adminKey, env.ADMIN_SECRET))) {
    await env.DB.prepare('INSERT INTO login_attempts(fingerprint,attempted_at,success) VALUES(?,?,0)').bind(adminFingerprint, now).run();
    return json({ error: 'غير مصرح' }, 401);
  }
  if (path === '/api/admin/create' && request.method === 'POST') {
    const days = Number(data.days);
    if (!Number.isInteger(days) || days < 1 || days > 3650) return json({ error: 'المدة يجب أن تكون من يوم إلى 10 سنوات' }, 400);
    const code = `AB-${randomHex(5).toUpperCase()}`;
    const now = Math.floor(Date.now() / 1000), expiresAt = now + days * 86400;
    await env.DB.prepare('INSERT INTO activation_codes(id,code_hash,expires_at,created_at) VALUES(?,?,?,?)')
      .bind(randomHex(16), await sha(code), expiresAt, now).run();
    return json({ code, expiresAt });
  }
  if (path === '/api/admin/revoke' && request.method === 'POST') {
    const code = typeof data.code === 'string' ? data.code.trim().toUpperCase() : '';
    if (!/^[A-Z0-9-]{8,40}$/.test(code)) return json({ error: 'رمز غير صالح' }, 400);
    const hash = await sha(code);
    const row = await env.DB.prepare('SELECT id FROM activation_codes WHERE code_hash=?').bind(hash).first();
    if (!row) return json({ error: 'الرمز غير موجود' }, 404);
    const now = Math.floor(Date.now() / 1000);
    await env.DB.batch([
      env.DB.prepare("UPDATE activation_codes SET status='revoked' WHERE id=?").bind(row.id),
      env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE code_id=? AND revoked_at IS NULL').bind(now, row.id)
    ]);
    return json({ ok: true });
  }
  if (path === '/api/admin/list' && request.method === 'POST') {
    const rows = await env.DB.prepare(`SELECT id,status,expires_at,created_at,activated_at,device_id FROM activation_codes ORDER BY created_at DESC LIMIT 100`).all();
    return json({ codes: rows.results || [] });
  }
  return json({ error: 'not_found' }, 404);
}
async function constantTimeEqual(a, b) {
  const aa = await sha(a), bb = await sha(b);
  let diff = 0; for (let i = 0; i < aa.length; i++) diff |= aa.charCodeAt(i) ^ bb.charCodeAt(i);
  return diff === 0;
}
const ADMIN_HTML = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>إدارة التفعيل</title><style>body{font:16px system-ui;background:#07130d;color:#e8f5ee;max-width:620px;margin:30px auto;padding:16px}section{background:#102319;border:1px solid #28533c;border-radius:14px;padding:16px;margin:12px 0}input,button{font:inherit;padding:12px;border-radius:9px;border:1px solid #456;background:#0b1b12;color:inherit;width:100%;box-sizing:border-box;margin:6px 0}button{background:#5eddaa;color:#04170f;font-weight:800;cursor:pointer}.code{font-size:1.4em;direction:ltr;text-align:center;color:#e8b84a;overflow-wrap:anywhere}small{color:#9bb8a7}</style><h2>إدارة أكواد تفعيل أبو صبرة</h2><section><label>مفتاح الإدارة</label><input id="key" type="password" autocomplete="off"><label>مدة الكود بالأيام</label><input id="days" type="number" min="1" max="3650" value="30"><button id="create">إنشاء كود جديد</button><p id="result" class="code"></p><small>احتفظ بالكود وارسله للمستخدم مرة واحدة. الكود يرتبط بأول جهاز يفعّله.</small></section><section><label>إدارة الأكواد</label><button id="refresh">عرض آخر 100 كود</button><div id="codes"></div><label>إلغاء كود</label><input id="revokeCode" placeholder="AB-..."><button id="revoke">إلغاء التفعيل والجلسات</button><p id="status"></p></section><script>const $=s=>document.querySelector(s);async function call(path,body){const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,adminKey:$('#key').value})});const d=await r.json();if(!r.ok)throw Error(d.error||'فشل الطلب');return d}$('#create').onclick=async()=>{try{const d=await call('/api/admin/create',{days:Number($('#days').value)});$('#result').textContent=d.code;$('#status').textContent='تم إنشاء الكود. انسخه الآن.'}catch(e){$('#status').textContent=e.message}};$('#revoke').onclick=async()=>{try{await call('/api/admin/revoke',{code:$('#revokeCode').value});$('#status').textContent='تم إلغاء الكود والجلسات المرتبطة به.';$('#refresh').click()}catch(e){$('#status').textContent=e.message}};$('#refresh').onclick=async()=>{try{const d=await call('/api/admin/list',{});$('#codes').innerHTML='<pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+d.codes.map(x=>(x.status==='active'?'نشط':'ملغي')+' | انتهاء: '+new Date(x.expires_at*1000).toLocaleString('ar')+' | جهاز: '+(x.device_id?x.device_id.slice(0,6)+'…':'غير مرتبط')).join('\n')+'</pre>'}catch(e){$('#status').textContent=e.message}};</script></html>`;

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url), path = url.pathname;
    try {
      let response;
      if (path === '/admin' && request.method === 'GET') response = new Response(ADMIN_HTML, { headers: { 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store', 'content-security-policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" } });
      else if (path === '/api/login' && request.method === 'POST') response = await login(request, env);
      else if (path === '/api/session' && request.method === 'GET') {
        const s = await authSession(request, env);
        response = s ? json({ valid: true, expiresAt: s.expires_at }) : json({ valid: false }, 401);
      } else if (path === '/api/logout' && request.method === 'POST') {
        const token = bearer(request), deviceId = request.headers.get('x-device-id') || '';
        if (/^[a-f0-9]{64}$/.test(token) && validId(deviceId)) await env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=? AND device_id=? AND revoked_at IS NULL').bind(Math.floor(Date.now()/1000), await sha(token), deviceId).run();
        response = json({ ok: true });
      } else if (path === '/api/gemini-token' && request.method === 'POST') response = await issueGeminiToken(request, env);
      else if (path.startsWith('/api/admin/')) response = await admin(request, env, path);
      else response = json({ error: 'not_found' }, 404);
      const headers = new Headers(response.headers); for (const [k,v] of Object.entries(cors)) headers.set(k,v);
      return new Response(response.body, { status: response.status, headers });
    } catch (e) {
      return json({ error: 'server_error' }, 500, cors);
    }
  }
};
