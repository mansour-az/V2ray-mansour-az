package com.example.v2raymanager.data.network

import com.example.v2raymanager.data.model.V2RayNode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import kotlin.math.abs

data class DetailedPingResult(
    val nodeId: Int,
    val nodeName: String,
    val host: String,
    val port: Int,
    val minMs: Long,
    val maxMs: Long,
    val avgMs: Long,
    val jitterMs: Long,
    val packetLossPercent: Int,
    val dnsTimeMs: Long,
    val samples: List<Long>,
    val isSuccess: Boolean,
    val testedAt: Long = System.currentTimeMillis()
)

object PingService {

    /**
     * Measures single TCP connection latency to host:port in milliseconds.
     * Returns latency in ms, or -2 if unreachable/timeout.
     */
    suspend fun pingTcp(host: String, port: Int, timeoutMs: Int = 3000): Long = withContext(Dispatchers.IO) {
        val cleanHost = host.trim().removePrefix("http://").removePrefix("https://").split("/")[0].split(":")[0]
        if (cleanHost.isBlank() || port <= 0 || port > 65535) {
            return@withContext -2L
        }

        try {
            val startTime = System.currentTimeMillis()
            val socket = Socket()
            socket.use {
                val socketAddress = InetSocketAddress(cleanHost, port)
                it.connect(socketAddress, timeoutMs)
            }
            val elapsed = System.currentTimeMillis() - startTime
            if (elapsed < 1) 1L else elapsed
        } catch (e: Exception) {
            -2L
        }
    }

    /**
     * Runs a multi-sample deep diagnostic ping against a proxy node.
     * Calculates Min, Max, Average, Jitter, and Packet Loss.
     */
    suspend fun runDetailedDiagnostic(
        node: V2RayNode,
        sampleCount: Int = 4,
        timeoutMs: Int = 2500
    ): DetailedPingResult = withContext(Dispatchers.IO) {
        val cleanHost = node.address.trim().removePrefix("http://").removePrefix("https://").split("/")[0].split(":")[0]
        
        // 1. Measure DNS resolution time
        val dnsStart = System.currentTimeMillis()
        var dnsTimeMs = -1L
        try {
            InetAddress.getByName(cleanHost)
            dnsTimeMs = System.currentTimeMillis() - dnsStart
        } catch (e: Exception) {
            dnsTimeMs = -1L
        }

        // 2. Measure TCP latency samples
        val samples = mutableListOf<Long>()
        var successfulCount = 0

        for (i in 0 until sampleCount) {
            val latency = pingTcp(cleanHost, node.port, timeoutMs)
            if (latency > 0) {
                samples.add(latency)
                successfulCount++
            } else {
                samples.add(-2L) // timeout
            }
        }

        val validSamples = samples.filter { it > 0 }
        val isSuccess = validSamples.isNotEmpty()
        val lossPercent = ((sampleCount - successfulCount) * 100) / sampleCount

        val minMs = if (isSuccess) validSamples.minOrNull() ?: -2L else -2L
        val maxMs = if (isSuccess) validSamples.maxOrNull() ?: -2L else -2L
        val avgMs = if (isSuccess) (validSamples.sum() / validSamples.size) else -2L

        // Jitter: average variation between consecutive samples
        val jitterMs = if (validSamples.size > 1) {
            var diffSum = 0L
            for (i in 0 until validSamples.size - 1) {
                diffSum += abs(validSamples[i + 1] - validSamples[i])
            }
            diffSum / (validSamples.size - 1)
        } else {
            0L
        }

        DetailedPingResult(
            nodeId = node.id,
            nodeName = node.name,
            host = cleanHost,
            port = node.port,
            minMs = minMs,
            maxMs = maxMs,
            avgMs = avgMs,
            jitterMs = jitterMs,
            packetLossPercent = lossPercent,
            dnsTimeMs = dnsTimeMs,
            samples = samples,
            isSuccess = isSuccess
        )
    }

    /**
     * Tests DNS resolution time for a given host.
     */
    suspend fun testDns(host: String): Pair<Boolean, Long> = withContext(Dispatchers.IO) {
        val cleanHost = host.trim().removePrefix("http://").removePrefix("https://").split("/")[0].split(":")[0]
        try {
            val start = System.currentTimeMillis()
            val address = InetAddress.getByName(cleanHost)
            val elapsed = System.currentTimeMillis() - start
            Pair(address != null, elapsed)
        } catch (e: Exception) {
            Pair(false, -1L)
        }
    }
}
