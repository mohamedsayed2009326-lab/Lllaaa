# أبو السيد — إصدار آمن مع تفعيل جهاز واحد

## البنية
- GitHub Actions يبني APK من نوع Release ويوقّعه بمفتاح خاص محفوظ في GitHub Secrets.
- Cloudflare Worker يشغّل المصادقة وإدارة التفعيل وإصدار Gemini ephemeral tokens.
- Cloudflare D1 تحفظ بصمة رمز التفعيل والجهاز والجلسات ومحاولات الدخول.
- مفتاح Gemini لا يدخل التطبيق؛ يبقى في Cloudflare Secret، والتطبيق يحصل على رمز Gemini مؤقت أحادي الاستخدام.

## 1) إعداد Cloudflare
1. استخدم قاعدة D1 التي أنشأتها من لوحة Cloudflare باسم `abu-sabra-db`، ولا تنشئ قاعدة ثانية.
2. من صفحة D1 > `abu-sabra-db` > Overview انسخ Database ID كاملًا وضعه في `cloudflare/wrangler.toml` بدل `REPLACE_WITH_D1_DATABASE_ID`.
3. اربط D1 بالـ Worker باسم المتغير `DB` من Settings > Bindings. ثم من مجلد `cloudflare` نفّذ:
   - `npx wrangler d1 migrations apply abu-sabra-db --remote`
   - `npx wrangler secret put ADMIN_SECRET` (أدخل كلمة سر إدارة طويلة وفريدة لا تشاركها مع المستخدمين)
   - `npx wrangler secret put GEMINI_API_KEY`
   - `npx wrangler deploy`
4. اسم الـ Worker المعتمد هو `abu-sabra-auth`، وعنوانه الحالي مضبوط مسبقًا في التطبيق: `https://abu-sabra-auth.mohamedsayed2009326.workers.dev`.
5. ارفع المشروع إلى GitHub بعد التأكد من إعداد `database_id` كاملًا في ملف Wrangler.

يمكن ضبط اسم موديل Gemini من Worker Secret اختياريًا:
`npx wrangler secret put GEMINI_LIVE_MODEL`
والقيمة الافتراضية الحالية هي `models/gemini-3.5-transcribe-live`، ويجب التأكد أن الموديل متاح لمفتاح Gemini الخاص بك.

## 2) إدارة أكواد التفعيل
- افتح `https://YOUR-WORKER-DOMAIN/admin`.
- أدخل قيمة `ADMIN_SECRET` التي أنشأتها.
- اختر مدة الكود بالأيام ثم أنشئ الكود.
- أرسل الكود للمستخدم. أول جهاز يفعّله يرتبط به نهائيًا.
- لإلغاء كود، أدخله في قسم الإلغاء. الإلغاء ينهي الجلسات التابعة له.
- رقم التواصل الظاهر للمستخدم: `0554573839`.

## 3) توقيع APK على GitHub
أنشئ مفتاح توقيع Release خاصًا بك ولا ترفعه إلى المستودع. مثال على كمبيوتر عليه JDK:
`keytool -genkeypair -v -keystore abu-sabra-release.jks -alias abu-sabra -keyalg RSA -keysize 2048 -validity 10000`
حوّل الملف إلى Base64 (Linux/macOS: `base64 -w 0 abu-sabra-release.jks`؛ PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes('abu-sabra-release.jks'))`). ضع الناتج في GitHub Secret باسم `ANDROID_KEYSTORE_BASE64`، واحفظ القيم التالية كـ Secrets منفصلة:
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

ارفع ملفات المشروع بعد فك الضغط، أو ارفع ملف ZIP واحدًا في جذر المستودع (الـ workflow يفكّه تلقائيًا). بعد ذلك شغّل GitHub Actions. الناتج سيكون في Artifact باسم `AbuAlSayed-secure-apk` وفي Release.

**مهم:** لا تغيّر مفتاح التوقيع بعد أول إصدار Release؛ Android لن يقبل تحديثًا موقّعًا بمفتاح مختلف. إذا كان عندك إصدار قديم موقّع بمفتاح Debug المضمّن في النسخة السابقة، فالإصدار الجديد بمفتاح Release جديد قد يتطلب إزالة النسخة القديمة أولًا، وقد يؤدي ذلك لفقد بياناتها المحلية. صدّر بياناتك قبل الانتقال.

## 4) الحماية المضافة
- رمز تفعيل واحد يرتبط بأول `ANDROID_ID` يفعّله.
- جلسة خادمية مدتها 12 ساعة، والتحقق منها كل دقيقة وعند العودة للتطبيق.
- رمز جلسة عشوائي محفوظ في Android EncryptedSharedPreferences.
- حد أقصى 5 محاولات فاشلة خلال 15 دقيقة لكل بصمة IP + جهاز.
- رموز Gemini مؤقتة أحادية الاستخدام، ولا يوجد مفتاح API داخل APK أو LocalStorage.
- فحص نوع وحجم ملفات الاستيراد (XLSX/CSV حتى 50MB) وحدود النص الملصوق.
- HTTPS فقط ورفض mixed content في WebView.

## ملاحظات أمنية
- عنوان Worker في `AUTH_API` يجب ضبطه قبل البناء.
- لا تضع `ADMIN_SECRET` أو `GEMINI_API_KEY` في GitHub repository أو داخل ملفات التطبيق.
- لا يمكن منع العبث بجهاز Android مروّت أو نسخة معدّلة بنسبة 100%؛ الربط الخادمي يمنع إعادة استخدام الكود على جهاز آخر في الاستخدام الطبيعي.
- يجب اختبار إصدار Gemini Live والموديل على حسابك قبل التوزيع؛ الرمز المؤقت يحمي المفتاح الدائم لكنه لا يلغي استهلاك Gemini.
