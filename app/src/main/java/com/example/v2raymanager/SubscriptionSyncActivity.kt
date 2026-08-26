package com.example.v2raymanager

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import com.example.v2raymanager.data.db.AppDatabase
import com.example.v2raymanager.data.db.NodeRepository
import com.example.v2raymanager.data.model.NodeParser
import com.example.v2raymanager.data.model.V2RayNode
import com.example.v2raymanager.data.network.VenzoApiClient
import com.example.v2raymanager.ui.theme.V2RayManagerTheme
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class SubscriptionSyncActivity : ComponentActivity() {

    private var statusText by mutableStateOf("Syncing Venzo subscription…")
    private var running by mutableStateOf(true)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            V2RayManagerTheme {
                Column(
                    modifier = Modifier.fillMaxSize().padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    if (running) CircularProgressIndicator()
                    Text(
                        text = statusText,
                        style = MaterialTheme.typography.bodyLarge,
                        modifier = Modifier.padding(top = 18.dp)
                    )
                }
            }
        }

        lifecycleScope.launch { handleSubscriptionIntent() }
    }

    private suspend fun handleSubscriptionIntent() {
        val uri = intent?.data
        if (uri == null || uri.scheme != "venzo" || uri.host != "subscription") {
            finishWithMessage("Invalid Venzo subscription link")
            return
        }

        val api = uri.getQueryParameter("api")?.trim().orEmpty()
        val token = uri.getQueryParameter("token")?.trim().orEmpty()
        if (!api.startsWith("https://") || token.length < 8) {
            finishWithMessage("Incomplete Venzo subscription link")
            return
        }

        runCatching {
            val links = VenzoApiClient.fetchSubscriptionLinks(api, token)
            require(links.isNotEmpty()) { "Subscription contains no supported servers" }

            val repository = NodeRepository(AppDatabase.getDatabase(application).nodeDao())
            val existing = repository.allNodes.first()
            val existingKeys = existing.map(::nodeKey).toHashSet()
            val parsed = links.mapNotNull(NodeParser::parseLink)
            require(parsed.isNotEmpty()) { "No supported configuration could be parsed" }

            val fresh = parsed.filter { nodeKey(it) !in existingKeys }
            if (fresh.isNotEmpty()) repository.insertAll(fresh)

            getSharedPreferences("venzo_subscription", MODE_PRIVATE)
                .edit()
                .putString("api_base_url", api)
                .putString("subscription_token", token)
                .apply()

            "Subscription synced: ${parsed.size} servers (${fresh.size} new)"
        }.onSuccess { message ->
            finishWithMessage(message)
        }.onFailure { error ->
            finishWithMessage(error.message ?: "Subscription synchronization failed")
        }
    }

    private fun nodeKey(node: V2RayNode): String = listOf(
        node.protocol.lowercase(),
        node.address.lowercase(),
        node.port.toString(),
        node.uuid,
        node.network.lowercase(),
        node.path,
        node.tls.lowercase(),
        node.sni.lowercase()
    ).joinToString("|")

    private fun finishWithMessage(message: String) {
        statusText = message
        running = false
        startActivity(
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra("venzo_sync_message", message)
            }
        )
        finish()
    }
}
