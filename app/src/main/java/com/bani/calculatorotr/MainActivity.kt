package com.bani.calculatorotr

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.webkit.*
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import androidx.webkit.WebViewAssetLoader
import java.io.File

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    // Pemilih file untuk upload Excel (Update Data)
    private val fileChooser =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
            val data = res.data
            val result = if (res.resultCode == RESULT_OK && data != null)
                WebChromeClient.FileChooserParams.parseResult(res.resultCode, data) else null
            fileCallback?.onReceiveValue(result)
            fileCallback = null
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, true)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)

        // Sajikan file di assets/ lewat https://appassets.androidplatform.net (origin aman, localStorage berfungsi)
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            setSupportZoom(false)
        }

        // Jembatan untuk mengirim gambar simulasi (JPG) ke WhatsApp nasabah
        webView.addJavascriptInterface(ShareBridge(), "AndroidShare")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == "appassets.androidplatform.net") return false
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url)); true
                } catch (e: Exception) { true }
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                w: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = cb
                return try {
                    fileChooser.launch(params.createIntent()); true
                } catch (e: Exception) {
                    fileCallback = null; false
                }
            }

            // confirm() JS (Reset, Kembalikan data bawaan)
            override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean {
                AlertDialog.Builder(this@MainActivity)
                    .setMessage(message)
                    .setPositiveButton("OK") { _, _ -> result.confirm() }
                    .setNegativeButton("Batal") { _, _ -> result.cancel() }
                    .setOnCancelListener { result.cancel() }
                    .show()
                return true
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // Biarkan aplikasi web menangani Back (kembali ke layar sebelumnya); keluar hanya bila sudah di layar utama.
                webView.evaluateJavascript("(window.otrBack && window.otrBack()) ? 1 : 0") { r ->
                    if (r != "1") {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                    }
                }
            }
        })

        if (savedInstanceState != null) webView.restoreState(savedInstanceState)
        else webView.loadUrl(BuildConfig.START_URL)
    }

    /** Dipanggil dari JavaScript: window.AndroidShare.shareImage(base64Jpeg, noWa, teks). */
    inner class ShareBridge {
        @JavascriptInterface
        fun shareImage(base64: String, phone: String, caption: String): Boolean {
            return try {
                val bytes = Base64.decode(base64, Base64.DEFAULT)
                val dir = File(cacheDir, "shared").apply { mkdirs() }
                dir.listFiles()?.forEach { it.delete() }
                val file = File(dir, "simulasi_${System.currentTimeMillis()}.jpg")
                file.writeBytes(bytes)
                val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.fileprovider", file)
                runOnUiThread { launchShare(uri, phone, caption) }
                true
            } catch (e: Exception) {
                false
            }
        }
    }

    private fun launchShare(uri: Uri, phone: String, caption: String) {
        val base = Intent(Intent.ACTION_SEND).apply {
            type = "image/jpeg"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_TEXT, caption)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        if (phone.isNotEmpty()) {
            // Buka langsung obrolan dengan nomor nasabah (WhatsApp / WhatsApp Business)
            for (pkg in listOf("com.whatsapp", "com.whatsapp.w4b")) {
                try {
                    val direct = Intent(base).apply {
                        setPackage(pkg)
                        putExtra("jid", "$phone@s.whatsapp.net")
                    }
                    startActivity(direct)
                    return
                } catch (e: Exception) {
                    // aplikasi tidak terpasang, coba berikutnya
                }
            }
        }
        startActivity(Intent.createChooser(base, "Kirim gambar simulasi"))
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onResume() { super.onResume(); webView.onResume() }
    override fun onPause() { webView.onPause(); super.onPause() }
    override fun onDestroy() { webView.destroy(); super.onDestroy() }
}
