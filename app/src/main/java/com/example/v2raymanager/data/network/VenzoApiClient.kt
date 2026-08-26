package com.example.v2raymanager.data.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.net.HttpURLConnection
import java.net.URL

@Serializable
data class SubscriptionLinksResponse(
    val ok: Boolean = false,
    val count: Int = 0,
    val links: List<String> = emptyList(),
    val fetched_at: String? = null,
    val error: String? = null
)

object VenzoApiClient {
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun fetchSubscriptionLinks(apiBaseUrl: String, subscriptionToken: String): List<String> =
        withContext(Dispatchers.IO) {
            require(apiBaseUrl.startsWith("https://")) { "Venzo API must use HTTPS" }
            require(subscriptionToken.length >= 8) { "Invalid subscription token" }

            val endpoint = apiBaseUrl.trimEnd('/') + "/api/v3/subscription/links"
            val connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                connectTimeout = 8000
                readTimeout = 12000
                requestMethod = "GET"
                setRequestProperty("Accept", "application/json")
                setRequestProperty("X-Subscription-Token", subscriptionToken)
                setRequestProperty("User-Agent", "VenzoVPN/3.0")
                useCaches = false
            }

            try {
                val status = connection.responseCode
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                val body = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
                if (status !in 200..299) {
                    val parsed = runCatching { json.decodeFromString<SubscriptionLinksResponse>(body) }.getOrNull()
                    error(parsed?.error ?: "Venzo API returned HTTP $status")
                }

                val response = json.decodeFromString<SubscriptionLinksResponse>(body)
                require(response.ok) { response.error ?: "Subscription synchronization failed" }
                response.links.filter { link ->
                    link.startsWith("vmess://", true) ||
                        link.startsWith("vless://", true) ||
                        link.startsWith("trojan://", true) ||
                        link.startsWith("ss://", true)
                }
            } finally {
                connection.disconnect()
            }
        }
}
