package com.example.v2raymanager.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import androidx.core.app.NotificationCompat
import com.example.v2raymanager.MainActivity
import com.example.v2raymanager.R
import com.example.v2raymanager.data.model.V2RayNode
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import libXray.DialerController
import libXray.LibXray
import java.net.HttpURLConnection
import java.net.URL

class VenzoVpnService : VpnService(), DialerController {

    companion object {
        const val ACTION_START = "com.example.v2raymanager.vpn.START"
        const val ACTION_STOP = "com.example.v2raymanager.vpn.STOP"
        const val EXTRA_NODE_JSON = "node_json"
        private const val CHANNEL_ID = "venzo_vpn"
        private const val NOTIFICATION_ID = 3001
    }

    private val serviceScope = CoroutineScope(Dispatchers.IO + Job())
    private var tunInterface: ParcelFileDescriptor? = null
    private var activeNode: V2RayNode? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        // Xray's upstream sockets must bypass the Android VPN interface or the
        // core would route its own connection back into the TUN indefinitely.
        LibXray.registerDialerController(this)
        LibXray.registerListenerController(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> serviceScope.launch { stopTunnel(true) }
            ACTION_START -> {
                val json = intent.getStringExtra(EXTRA_NODE_JSON)
                val node = runCatching { json?.let { Json.decodeFromString<V2RayNode>(it) } }.getOrNull()
                if (node == null) {
                    VpnRuntime.failed("", "Invalid VPN node configuration")
                    stopSelf()
                } else {
                    startForeground(NOTIFICATION_ID, buildNotification("Connecting to ${node.name}…"))
                    serviceScope.launch { startTunnel(node) }
                }
            }
        }
        return START_NOT_STICKY
    }

    private suspend fun startTunnel(node: V2RayNode) {
        if (VpnRuntime.state.value.isConnected || VpnRuntime.state.value.isConnecting) stopTunnel(false)

        activeNode = node
        VpnRuntime.connecting(node.name)

        try {
            val builder = Builder()
                .setSession("Venzo VPN — ${node.name}")
                .setMtu(1500)
                .addAddress("172.19.0.2", 30)
                .addRoute("0.0.0.0", 0)
                .addDnsServer("1.1.1.1")
                .addDnsServer("8.8.8.8")

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) builder.setMetered(false)

            val tun = builder.establish() ?: error("Android rejected VPN interface creation")
            tunInterface = tun

            LibXray.setDNS(this, "1.1.1.1:53")

            val xrayJson = XrayConfigBuilder.build(node, tun.fd)
            val testResponse = LibXray.invoke(buildInvokeRequest("testXray", xrayJson))
            require(isSuccessResponse(testResponse)) {
                "Xray config validation failed: ${extractError(testResponse)}"
            }

            val runResponse = LibXray.invoke(buildInvokeRequest("runXray", xrayJson))
            require(isSuccessResponse(runResponse)) {
                "Xray failed to start: ${extractError(runResponse)}"
            }

            val verification = verifyRealInternet()
            if (!verification.success) {
                throw IllegalStateException(verification.error ?: "VPN tunnel started but internet verification failed")
            }

            VpnRuntime.connected(node.name, verification.publicIp)
            getSystemService(NotificationManager::class.java).notify(
                NOTIFICATION_ID,
                buildNotification("Connected • ${node.name}${verification.publicIp?.let { " • $it" } ?: ""}")
            )
        } catch (t: Throwable) {
            runCatching { stopCore() }
            runCatching { tunInterface?.close() }
            runCatching { LibXray.resetDNS() }
            tunInterface = null
            VpnRuntime.failed(node.name, t.message ?: "VPN connection failed")
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    private suspend fun verifyRealInternet(): VerificationResult {
        repeat(4) { attempt ->
            val result = runCatching {
                val connection = (URL("https://api.ipify.org").openConnection() as HttpURLConnection).apply {
                    connectTimeout = 5000
                    readTimeout = 5000
                    requestMethod = "GET"
                    instanceFollowRedirects = true
                    useCaches = false
                }
                try {
                    val code = connection.responseCode
                    if (code !in 200..299) error("IP verification HTTP $code")
                    val ip = connection.inputStream.bufferedReader().use { it.readText().trim() }
                    require(ip.isNotBlank()) { "Empty public IP response" }
                    VerificationResult(true, ip, null)
                } finally {
                    connection.disconnect()
                }
            }.getOrElse { VerificationResult(false, null, it.message) }

            if (result.success) return result
            if (attempt < 3) delay(1200)
        }
        return VerificationResult(false, null, "No verified internet access through the selected node")
    }

    private fun buildInvokeRequest(method: String, xrayJson: String? = null): String =
        buildJsonObject {
            put("apiVersion", 2)
            put("method", method)
            put("payload", buildJsonObject {
                if (xrayJson != null) put("xrayJson", xrayJson)
            })
        }.toString()

    private fun isSuccessResponse(response: String): Boolean =
        runCatching {
            Json.parseToJsonElement(response).jsonObject["success"]?.toString() == "true"
        }.getOrDefault(false)

    private fun extractError(response: String): String =
        runCatching {
            Json.parseToJsonElement(response).jsonObject["error"]?.toString()?.trim('"')
        }.getOrNull().orEmpty().ifBlank { response.take(240) }

    private suspend fun stopTunnel(stopService: Boolean) {
        runCatching { stopCore() }
        runCatching { LibXray.resetDNS() }
        runCatching { tunInterface?.close() }
        tunInterface = null
        activeNode = null
        VpnRuntime.disconnected()
        stopForeground(STOP_FOREGROUND_REMOVE)
        if (stopService) stopSelf()
    }

    private fun stopCore() {
        val response = LibXray.invoke(buildInvokeRequest("stopXray"))
        if (!isSuccessResponse(response)) {
            throw IllegalStateException("Xray stop failed: ${extractError(response)}")
        }
    }

    override fun protectFd(fd: Int): Boolean = protect(fd)

    override fun onRevoke() {
        serviceScope.launch { stopTunnel(true) }
        super.onRevoke()
    }

    override fun onDestroy() {
        runCatching { stopCore() }
        runCatching { LibXray.resetDNS() }
        runCatching { tunInterface?.close() }
        serviceScope.cancel()
        VpnRuntime.disconnected()
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Venzo VPN", NotificationManager.IMPORTANCE_LOW)
            )
        }
    }

    private fun buildNotification(text: String): Notification {
        val pending = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Venzo VPN")
            .setContentText(text)
            .setContentIntent(pending)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
    }

    private data class VerificationResult(
        val success: Boolean,
        val publicIp: String?,
        val error: String?
    )
}
