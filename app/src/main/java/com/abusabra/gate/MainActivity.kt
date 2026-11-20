package com.abusabra.gate

import android.Manifest
import android.content.ClipData
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import android.provider.OpenableColumns
import android.util.Base64
import android.view.WindowManager
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private lateinit var assetLoader: WebViewAssetLoader
    private var pageLoaded = false
    private val authPrefs by lazy {
        val masterKey = MasterKey.Builder(this).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(
            this, "secure_auth", masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    // صلاحيات معلّقة بانتظار رد المستخدم
    private var pendingWebPerm: PermissionRequest? = null
    private var pendingGeo: Pair<String, GeolocationPermissions.Callback>? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    // ملف مشترك (من واتساب مثلاً) بانتظار الصفحة
    @Volatile private var pendingShared: String = ""

    // كتابة الملفات القادمة من JS على دفعات
    private val ioLock = Any()
    private var outStream: FileOutputStream? = null
    private var outFile: File? = null
    private var outName = ""
    private var outMime = ""

    private val permLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { res ->
            val micOk = res[Manifest.permission.RECORD_AUDIO] == true || hasPerm(Manifest.permission.RECORD_AUDIO)
            val locOk = res[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
                res[Manifest.permission.ACCESS_COARSE_LOCATION] == true ||
                hasPerm(Manifest.permission.ACCESS_FINE_LOCATION)
            pendingWebPerm?.let { r ->
                if (micOk) r.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) else r.deny()
                pendingWebPerm = null
            }
            pendingGeo?.let { (origin, cb) ->
                cb.invoke(origin, locOk, false)
                pendingGeo = null
            }
        }

    private val chooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
            val uris = WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data)
            fileCallback?.onReceiveValue(uris)
            fileCallback = null
        }

    private fun hasPerm(p: String) =
        ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        assetLoader = WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler(
                "/shared/",
                WebViewAssetLoader.InternalStoragePathHandler(this, File(cacheDir, "shared").apply { mkdirs() })
            )
            .build()

        web = WebView(this)
        setContentView(web)
        web.settings.apply {
            javaScriptEnabled = true
            javaScriptCanOpenWindowsAutomatically = false
            allowFileAccessFromFileURLs = false
            allowUniversalAccessFromFileURLs = false
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            setSupportZoom(false)
            textZoom = 100
            setGeolocationEnabled(true)
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }

        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                if (u.host == "appassets.androidplatform.net") return false
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, u))
                } catch (_: Exception) {
                }
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                pageLoaded = true
                if (pendingShared.isNotEmpty()) notifyShared()
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    if (!request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                        request.deny(); return@runOnUiThread
                    }
                    if (hasPerm(Manifest.permission.RECORD_AUDIO)) {
                        request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                    } else {
                        pendingWebPerm?.deny()
                        pendingWebPerm = request
                        permLauncher.launch(arrayOf(Manifest.permission.RECORD_AUDIO))
                    }
                }
            }

            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                if (hasPerm(Manifest.permission.ACCESS_FINE_LOCATION)) {
                    callback.invoke(origin, true, false)
                } else {
                    pendingGeo = Pair(origin, callback)
                    permLauncher.launch(
                        arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
                    )
                }
            }

            override fun onShowFileChooser(
                webView: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    chooserLauncher.launch(params.createIntent())
                    true
                } catch (e: Exception) {
                    fileCallback = null
                    callback.onReceiveValue(null)
                    false
                }
            }
        }

        web.addJavascriptInterface(Bridge(), "Android")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("(window.__back&&window.__back())?'1':'0'") { r ->
                    if (r != "\"1\"") moveTaskToBack(true)
                }
            }
        })

        // طلب الميكروفون والموقع من أول تشغيل
        val need = mutableListOf<String>()
        if (!hasPerm(Manifest.permission.RECORD_AUDIO)) need.add(Manifest.permission.RECORD_AUDIO)
        if (!hasPerm(Manifest.permission.ACCESS_FINE_LOCATION)) {
            need.add(Manifest.permission.ACCESS_FINE_LOCATION); need.add(Manifest.permission.ACCESS_COARSE_LOCATION)
        }
        if (need.isNotEmpty()) permLauncher.launch(need.toTypedArray())

        handleIntent(intent)
        web.loadUrl("https://appassets.androidplatform.net/assets/index.html")
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    /** ملف xlsx/csv جاي بالمشاركة أو "فتح باستخدام": بنسخه في cache/shared/file وبنقول للصفحة */
    private fun handleIntent(intent: Intent?) {
        if (intent == null) return
        val uri: Uri? = when (intent.action) {
            Intent.ACTION_SEND ->
                if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_STREAM)
            Intent.ACTION_VIEW -> intent.data
            else -> null
        }
        if (uri == null) return
        Thread {
            try {
                val dir = File(cacheDir, "shared").apply { mkdirs() }
                val target = File(dir, "file")
                contentResolver.openInputStream(uri)?.use { input ->
                    FileOutputStream(target).use { out ->
                        val buffer = ByteArray(64 * 1024); var total = 0L
                        while (true) {
                            val n = input.read(buffer); if (n < 0) break
                            total += n
                            if (total > 50L * 1024 * 1024) throw IllegalArgumentException("file too large")
                            out.write(buffer, 0, n)
                        }
                    }
                } ?: return@Thread
                var name = uri.lastPathSegment ?: "file.xlsx"
                try {
                    contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                        if (c.moveToFirst()) name = c.getString(0) ?: name
                    }
                } catch (_: Exception) {
                }
                val js = JSONObject()
                js.put("name", name)
                js.put("mime", contentResolver.getType(uri) ?: "")
                js.put("size", target.length())
                pendingShared = js.toString()
                runOnUiThread { if (pageLoaded) notifyShared() }
            } catch (_: Exception) {
            }
        }.start()
    }

    private fun notifyShared() {
        web.evaluateJavascript("window.onSharedFile&&window.onSharedFile()", null)
    }

    private fun safeName(n: String) = n.replace(Regex("[^A-Za-z0-9._-]"), "_").ifEmpty { "export.xlsx" }

    private fun openOut(file: File, name: String, mime: String): String = synchronized(ioLock) {
        try {
            val allowedMimes = setOf("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel", "text/csv")
            if (name.length > 160 || mime !in allowedMimes) return "err:invalid metadata"
            outStream?.close()
            file.parentFile?.mkdirs()
            if (file.exists()) file.delete()
            outFile = file; outName = name; outMime = mime
            outStream = FileOutputStream(file)
            "ok"
        } catch (e: Exception) {
            "err:" + (e.message ?: "open")
        }
    }

    private fun writeChunk(b64: String): String = synchronized(ioLock) {
        try {
            if (b64.length > 700_000 || !b64.matches(Regex("[A-Za-z0-9+/=\\r\\n]*"))) return "err:invalid chunk"
            val s = outStream ?: return "err:no stream"
            s.write(Base64.decode(b64, Base64.DEFAULT))
            "ok"
        } catch (e: Exception) {
            "err:" + (e.message ?: "write")
        }
    }

    private fun closeOut(): File? = synchronized(ioLock) {
        try {
            outStream?.flush(); outStream?.close()
        } catch (_: Exception) {
        }
        outStream = null
        outFile
    }

    inner class Bridge {
        @JavascriptInterface
        fun getDeviceId(): String = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID) ?: ""

        @JavascriptInterface
        fun getAuthToken(): String = try { authPrefs.getString("session_token", "") ?: "" } catch (_: Exception) { "" }

        @JavascriptInterface
        fun setAuthToken(value: String): String {
            if (value.length > 256 || !value.matches(Regex("[a-f0-9]{64}"))) return "err:invalid token"
            return try { authPrefs.edit().putString("session_token", value).apply(); "ok" } catch (_: Exception) { "err:secure storage" }
        }

        @JavascriptInterface
        fun clearAuthToken(): String = try { authPrefs.edit().remove("session_token").apply(); "ok" } catch (_: Exception) { "err:secure storage" }

        @JavascriptInterface
        fun getPendingShared(): String {
            val s = pendingShared
            pendingShared = ""
            return s
        }

        // ---- تنزيل في Downloads ----
        @JavascriptInterface
        fun saveStart(name: String, mime: String): String = openOut(File(cacheDir, "save.tmp"), safeName(name), mime)

        @JavascriptInterface
        fun saveChunk(b64: String): String = writeChunk(b64)

        @JavascriptInterface
        fun saveEnd(): String {
            val f = closeOut() ?: return "err:no file"
            return try {
                val v = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, outName)
                    put(MediaStore.Downloads.MIME_TYPE, outMime)
                    put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v)
                    ?: return "err:MediaStore"
                contentResolver.openOutputStream(uri)?.use { o -> f.inputStream().use { it.copyTo(o) } }
                    ?: return "err:output"
                v.clear(); v.put(MediaStore.Downloads.IS_PENDING, 0)
                contentResolver.update(uri, v, null, null)
                f.delete()
                "ok"
            } catch (e: Exception) {
                "err:" + (e.message ?: "save")
            }
        }

        // ---- مشاركة (بدون نسخة في Downloads) ----
        @JavascriptInterface
        fun shareStart(name: String, mime: String): String {
            val dir = File(cacheDir, "share")
            dir.listFiles()?.forEach { it.delete() }
            return openOut(File(dir, safeName(name)), safeName(name), mime)
        }

        @JavascriptInterface
        fun shareChunk(b64: String): String = writeChunk(b64)

        @JavascriptInterface
        fun shareEnd(): String {
            val f = closeOut() ?: return "err:no file"
            return try {
                val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.fileprovider", f)
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = outMime
                    putExtra(Intent.EXTRA_STREAM, uri)
                    clipData = ClipData.newRawUri("", uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                runOnUiThread {
                    startActivity(Intent.createChooser(send, "مشاركة السجل"))
                }
                "ok"
            } catch (e: Exception) {
                "err:" + (e.message ?: "share")
            }
        }
    }

    override fun onDestroy() {
        try { web.destroy() } catch (_: Exception) { }
        super.onDestroy()
    }
}
