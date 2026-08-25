package com.example.v2raymanager.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Analytics
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.NetworkCheck
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Route
import androidx.compose.material.icons.filled.Sensors
import androidx.compose.material.icons.filled.ShowChart
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.v2raymanager.data.model.V2RayNode
import com.example.v2raymanager.data.network.DetailedPingResult
import com.example.v2raymanager.data.network.PingService
import com.example.v2raymanager.ui.DiagnosticsProgress
import com.example.v2raymanager.ui.components.CodeBlockWithCopy
import com.example.v2raymanager.ui.components.CyberCard
import com.example.v2raymanager.ui.components.PingIndicator
import com.example.v2raymanager.ui.components.ProtocolBadge
import com.example.v2raymanager.ui.theme.CyberCyan
import com.example.v2raymanager.ui.theme.CyberGreen
import com.example.v2raymanager.ui.theme.CyberPink
import com.example.v2raymanager.ui.theme.CyberPurple
import com.example.v2raymanager.ui.theme.CyberRed
import com.example.v2raymanager.ui.theme.CyberYellow
import com.example.v2raymanager.ui.theme.DarkBackground
import com.example.v2raymanager.ui.theme.DarkBorder
import com.example.v2raymanager.ui.theme.DarkSurface
import com.example.v2raymanager.ui.theme.DarkSurfaceCard
import com.example.v2raymanager.ui.theme.DarkSurfaceVariant
import com.example.v2raymanager.ui.theme.NeonCyan
import com.example.v2raymanager.ui.theme.TextMuted
import com.example.v2raymanager.ui.theme.TextPrimary
import com.example.v2raymanager.ui.theme.TextSecondary
import kotlinx.coroutines.launch

data class BenchmarkTarget(
    val name: String,
    val host: String,
    val port: Int,
    var latencyMs: Long = -1L,
    var isChecking: Boolean = false
)

data class DnsBenchmark(
    val provider: String,
    val serverIp: String,
    var resolveTimeMs: Long = -1L,
    var isChecking: Boolean = false
)

enum class LatencyFilter(val label: String) {
    ALL("All"),
    FAST("Fast (<150ms)"),
    MEDIUM("150-300ms"),
    SLOW(">300ms"),
    TIMEOUT("Timeout"),
    UNTESTED("Untested")
}

enum class SortMode(val label: String) {
    FASTEST("Fastest"),
    NAME("Name"),
    ACTIVE("Active First")
}

@Composable
fun DiagnosticsScreen(
    nodes: List<V2RayNode> = emptyList(),
    activeNode: V2RayNode? = null,
    isPingingAll: Boolean = false,
    diagnosticsProgress: DiagnosticsProgress = DiagnosticsProgress(),
    detailedPingResults: Map<Int, DetailedPingResult> = emptyMap(),
    activeTestingNodeId: Int? = null,
    onPingNode: (V2RayNode) -> Unit = {},
    onRunDetailedDiagnostic: (V2RayNode) -> Unit = {},
    onPingAllNodes: () -> Unit = {},
    onAutoSelectBestNode: () -> Unit = {},
    onSetActiveNode: (V2RayNode) -> Unit = {}
) {
    val scrollState = rememberScrollState()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    var selectedFilter by remember { mutableStateOf(LatencyFilter.ALL) }
    var selectedSort by remember { mutableStateOf(SortMode.FASTEST) }
    var expandedNodeId by remember { mutableStateOf<Int?>(null) }

    // Public Internet Benchmark targets
    var publicTargets by remember {
        mutableStateOf(
            listOf(
                BenchmarkTarget("Cloudflare DNS", "1.1.1.1", 53),
                BenchmarkTarget("Google DNS", "8.8.8.8", 53),
                BenchmarkTarget("Cloudflare Edge (HTTPS)", "104.16.1.1", 443),
                BenchmarkTarget("Quad9 DNS", "9.9.9.9", 53),
                BenchmarkTarget("OpenDNS", "208.67.222.222", 53),
                BenchmarkTarget("GitHub (TLS 443)", "github.com", 443)
            )
        )
    }

    var dnsTargets by remember {
        mutableStateOf(
            listOf(
                DnsBenchmark("Cloudflare (1.1.1.1)", "one.one.one.one"),
                DnsBenchmark("Google (8.8.8.8)", "dns.google"),
                DnsBenchmark("OpenDNS", "resolver1.opendns.com"),
                DnsBenchmark("Quad9", "dns.quad9.net")
            )
        )
    }

    var isRunningPublicBenchmark by remember { mutableStateOf(false) }

    fun runPublicBenchmarks() {
        scope.launch {
            isRunningPublicBenchmark = true
            publicTargets = publicTargets.map { it.copy(isChecking = true) }

            for (i in publicTargets.indices) {
                val t = publicTargets[i]
                val ping = PingService.pingTcp(t.host, t.port, 2500)
                publicTargets = publicTargets.mapIndexed { idx, item ->
                    if (idx == i) item.copy(latencyMs = ping, isChecking = false) else item
                }
            }

            dnsTargets = dnsTargets.map { it.copy(isChecking = true) }
            for (i in dnsTargets.indices) {
                val d = dnsTargets[i]
                val (_, time) = PingService.testDns(d.serverIp)
                dnsTargets = dnsTargets.mapIndexed { idx, item ->
                    if (idx == i) item.copy(resolveTimeMs = time, isChecking = false) else item
                }
            }

            isRunningPublicBenchmark = false
        }
    }

    // Filter & Sort Stored Nodes
    val filteredNodes = nodes.filter { node ->
        when (selectedFilter) {
            LatencyFilter.ALL -> true
            LatencyFilter.FAST -> node.lastPingMs in 1..149
            LatencyFilter.MEDIUM -> node.lastPingMs in 150..300
            LatencyFilter.SLOW -> node.lastPingMs > 300
            LatencyFilter.TIMEOUT -> node.lastPingMs == -2L
            LatencyFilter.UNTESTED -> node.lastPingMs == -1L
        }
    }.let { list ->
        when (selectedSort) {
            SortMode.FASTEST -> list.sortedWith(
                compareBy(
                    { if (it.lastPingMs > 0) 0 else 1 },
                    { if (it.lastPingMs > 0) it.lastPingMs else Long.MAX_VALUE }
                )
            )
            SortMode.NAME -> list.sortedBy { it.name.lowercase() }
            SortMode.ACTIVE -> list.sortedByDescending { it.isActive }
        }
    }

    val onlineNodes = nodes.filter { it.lastPingMs > 0 }
    val avgLatency = if (onlineNodes.isNotEmpty()) (onlineNodes.sumOf { it.lastPingMs } / onlineNodes.size) else 0L
    val bestNode = onlineNodes.minByOrNull { it.lastPingMs }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Page Title & Subtitle
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    text = "Latency Diagnostics",
                    color = TextPrimary,
                    style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold)
                )
                Text(
                    text = "Ping stored proxy nodes & measure real-time TCP latency",
                    color = TextSecondary,
                    fontSize = 13.sp
                )
            }
        }

        // Live Diagnostic Progress Banner (when running)
        AnimatedVisibility(
            visible = isPingingAll || diagnosticsProgress.isRunning,
            enter = fadeIn(),
            exit = fadeOut()
        ) {
            CyberCard(
                borderColor = CyberCyan,
                backgroundColor = DarkSurfaceVariant,
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                color = CyberCyan,
                                strokeWidth = 2.dp
                            )
                            Text(
                                text = "Pinging Stored Proxy Nodes...",
                                color = CyberCyan,
                                fontWeight = FontWeight.Bold,
                                fontSize = 13.sp
                            )
                        }
                        Text(
                            text = "${diagnosticsProgress.current} / ${diagnosticsProgress.total}",
                            color = TextPrimary,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 12.sp
                        )
                    }

                    if (diagnosticsProgress.total > 0) {
                        val progress = diagnosticsProgress.current.toFloat() / diagnosticsProgress.total.toFloat()
                        LinearProgressIndicator(
                            progress = { progress },
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(6.dp)
                                .clip(RoundedCornerShape(3.dp)),
                            color = CyberCyan,
                            trackColor = DarkBorder
                        )
                    }

                    Text(
                        text = "Testing: ${diagnosticsProgress.currentNodeName}",
                        color = TextMuted,
                        fontSize = 11.sp,
                        fontFamily = FontFamily.Monospace
                    )
                }
            }
        }

        // Section 1: Stored Proxy Nodes Latency Diagnostic Suite
        CyberCard(
            modifier = Modifier.fillMaxWidth(),
            borderColor = CyberCyan.copy(alpha = 0.5f)
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                // Section Header
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(32.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(CyberCyan.copy(alpha = 0.15f)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                imageVector = Icons.Default.Sensors,
                                contentDescription = null,
                                tint = CyberCyan,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                        Column {
                            Text(
                                text = "Stored Proxy Nodes Diagnostic",
                                color = TextPrimary,
                                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
                            )
                            Text(
                                text = "${nodes.size} nodes stored • ${onlineNodes.size} responsive",
                                color = TextMuted,
                                fontSize = 11.sp
                            )
                        }
                    }
                }

                // Summary Stats Grid
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    // Stat 1: Online
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(10.dp))
                            .background(DarkBackground)
                            .border(1.dp, DarkBorder, RoundedCornerShape(10.dp))
                            .padding(vertical = 10.dp, horizontal = 12.dp)
                    ) {
                        Column {
                            Text("ONLINE", color = TextMuted, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                            Spacer(modifier = Modifier.height(2.dp))
                            Text(
                                text = "${onlineNodes.size}/${nodes.size}",
                                color = if (onlineNodes.isNotEmpty()) CyberGreen else TextMuted,
                                fontSize = 16.sp,
                                fontWeight = FontWeight.Bold,
                                fontFamily = FontFamily.Monospace
                            )
                        }
                    }

                    // Stat 2: Avg Latency
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(10.dp))
                            .background(DarkBackground)
                            .border(1.dp, DarkBorder, RoundedCornerShape(10.dp))
                            .padding(vertical = 10.dp, horizontal = 12.dp)
                    ) {
                        Column {
                            Text("AVG LATENCY", color = TextMuted, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                            Spacer(modifier = Modifier.height(2.dp))
                            Text(
                                text = if (avgLatency > 0) "${avgLatency}ms" else "--",
                                color = if (avgLatency in 1..150) CyberGreen else if (avgLatency in 151..300) CyberYellow else CyberCyan,
                                fontSize = 16.sp,
                                fontWeight = FontWeight.Bold,
                                fontFamily = FontFamily.Monospace
                            )
                        }
                    }

                    // Stat 3: Best Node
                    Box(
                        modifier = Modifier
                            .weight(1.2f)
                            .clip(RoundedCornerShape(10.dp))
                            .background(DarkBackground)
                            .border(1.dp, DarkBorder, RoundedCornerShape(10.dp))
                            .padding(vertical = 10.dp, horizontal = 12.dp)
                    ) {
                        Column {
                            Text("FASTEST NODE", color = TextMuted, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                            Spacer(modifier = Modifier.height(2.dp))
                            Text(
                                text = if (bestNode != null) "${bestNode.lastPingMs}ms" else "--",
                                color = CyberGreen,
                                fontSize = 16.sp,
                                fontWeight = FontWeight.Bold,
                                fontFamily = FontFamily.Monospace
                            )
                        }
                    }
                }

                // Action Buttons: Ping All Stored & Auto-Select Best
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Button(
                        onClick = onPingAllNodes,
                        enabled = !isPingingAll && nodes.isNotEmpty(),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = CyberCyan,
                            contentColor = Color(0xFF070E18)
                        ),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier
                            .weight(1.3f)
                            .testTag("ping_all_stored_nodes_button")
                    ) {
                        if (isPingingAll) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                color = Color(0xFF070E18),
                                strokeWidth = 2.dp
                            )
                        } else {
                            Icon(imageVector = Icons.Default.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                        }
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = if (isPingingAll) "Pinging All..." else "Ping All Nodes",
                            fontWeight = FontWeight.Bold,
                            fontSize = 13.sp
                        )
                    }

                    OutlinedButton(
                        onClick = onAutoSelectBestNode,
                        enabled = onlineNodes.isNotEmpty(),
                        colors = ButtonDefaults.outlinedButtonColors(
                            contentColor = CyberGreen
                        ),
                        border = androidx.compose.foundation.BorderStroke(1.dp, CyberGreen.copy(alpha = 0.6f)),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier
                            .weight(1.1f)
                            .testTag("auto_select_fastest_node_button")
                    ) {
                        Icon(imageVector = Icons.Default.Bolt, contentDescription = null, modifier = Modifier.size(16.dp), tint = CyberGreen)
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Auto Select", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                    }
                }

                // Filters & Sorting Horizontal Row
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    LatencyFilter.values().forEach { filter ->
                        val isSelected = selectedFilter == filter
                        FilterChip(
                            selected = isSelected,
                            onClick = { selectedFilter = filter },
                            label = { Text(filter.label, fontSize = 11.sp, fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal) },
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = CyberCyan.copy(alpha = 0.2f),
                                selectedLabelColor = CyberCyan,
                                containerColor = DarkBackground,
                                labelColor = TextSecondary
                            ),
                            border = FilterChipDefaults.filterChipBorder(
                                enabled = true,
                                selected = isSelected,
                                borderColor = DarkBorder,
                                selectedBorderColor = CyberCyan
                            )
                        )
                    }
                }

                // List of Nodes with Latency Diagnostics
                if (filteredNodes.isEmpty()) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 24.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Dns,
                                contentDescription = null,
                                tint = TextMuted,
                                modifier = Modifier.size(32.dp)
                            )
                            Text(
                                text = if (nodes.isEmpty()) "No stored proxy nodes found" else "No nodes match this filter",
                                color = TextMuted,
                                fontSize = 13.sp
                            )
                        }
                    }
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        filteredNodes.forEach { node ->
                            val isCurrentlyTesting = activeTestingNodeId == node.id
                            val isExpanded = expandedNodeId == node.id
                            val detailedResult = detailedPingResults[node.id]

                            StoredNodeDiagnosticCard(
                                node = node,
                                isActive = activeNode?.id == node.id,
                                isTesting = isCurrentlyTesting,
                                isExpanded = isExpanded,
                                detailedResult = detailedResult,
                                onQuickPing = { onPingNode(node) },
                                onDeepDiagnostic = { onRunDetailedDiagnostic(node) },
                                onToggleExpand = {
                                    expandedNodeId = if (isExpanded) null else node.id
                                },
                                onSetActive = { onSetActiveNode(node) }
                            )
                        }
                    }
                }
            }
        }

        // Section 2: Global Internet & Public DNS Benchmark
        CyberCard(modifier = Modifier.fillMaxWidth()) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Icon(imageVector = Icons.Default.Speed, contentDescription = null, tint = CyberCyan)
                        Text(
                            text = "Global Internet & DNS Gateways",
                            color = TextPrimary,
                            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
                        )
                    }

                    IconButton(
                        onClick = { runPublicBenchmarks() },
                        enabled = !isRunningPublicBenchmark,
                        modifier = Modifier.testTag("run_public_benchmark_button")
                    ) {
                        if (isRunningPublicBenchmark) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                color = CyberCyan,
                                strokeWidth = 2.dp
                            )
                        } else {
                            Icon(imageVector = Icons.Default.Refresh, contentDescription = "Benchmark Public Gateways", tint = CyberCyan)
                        }
                    }
                }

                publicTargets.forEach { target ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(Color(0xFF0D1424))
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column {
                            Text(
                                text = target.name,
                                color = TextPrimary,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                            Text(
                                text = "${target.host}:${target.port}",
                                color = TextMuted,
                                fontSize = 11.sp,
                                fontFamily = FontFamily.Monospace
                            )
                        }

                        if (target.isChecking) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(14.dp),
                                color = CyberCyan,
                                strokeWidth = 2.dp
                            )
                        } else {
                            val (dotColor, text) = when {
                                target.latencyMs == -1L -> Pair(TextMuted, "Untested")
                                target.latencyMs == -2L -> Pair(CyberRed, "Timeout")
                                target.latencyMs < 100L -> Pair(CyberGreen, "${target.latencyMs}ms")
                                target.latencyMs < 250L -> Pair(CyberYellow, "${target.latencyMs}ms")
                                else -> Pair(CyberRed, "${target.latencyMs}ms")
                            }
                            Text(
                                text = text,
                                color = dotColor,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                fontFamily = FontFamily.Monospace
                            )
                        }
                    }
                }
            }
        }

        // Section 3: DNS Resolution Speed
        CyberCard(modifier = Modifier.fillMaxWidth()) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(imageVector = Icons.Default.Dns, contentDescription = null, tint = CyberPurple)
                    Text(
                        text = "DNS Resolution Speed",
                        color = TextPrimary,
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
                    )
                }

                dnsTargets.forEach { dns ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(Color(0xFF0D1424))
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column {
                            Text(
                                text = dns.provider,
                                color = TextPrimary,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                            Text(
                                text = dns.serverIp,
                                color = TextMuted,
                                fontSize = 11.sp,
                                fontFamily = FontFamily.Monospace
                            )
                        }

                        if (dns.isChecking) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(14.dp),
                                color = CyberPurple,
                                strokeWidth = 2.dp
                            )
                        } else {
                            val text = if (dns.resolveTimeMs >= 0) "${dns.resolveTimeMs}ms" else "Untested"
                            val color = if (dns.resolveTimeMs in 1..100) CyberGreen else if (dns.resolveTimeMs > 100) CyberYellow else TextMuted
                            Text(
                                text = text,
                                color = color,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                fontFamily = FontFamily.Monospace
                            )
                        }
                    }
                }
            }
        }

        // Section 4: TradingView Pine Script Helper
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(imageVector = Icons.Default.ShowChart, contentDescription = null, tint = CyberYellow)
                Text(
                    text = "TradingView UT Supertrend Script",
                    color = TextPrimary,
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
                )
            }
            Text(
                text = "Helper script from repository for fixing UT Supertrend indicator desync overlay on TradingView charts.",
                color = TextSecondary,
                fontSize = 13.sp
            )

            val pineScript = """
//@version=5
indicator("UT Supertrend Overlay Fix", "UT Supertrend Overlay Fix", overlay=true, scale=scale.right, max_bars_back=5000)

// === Input configuration ===
atrLength = input.int(10, "ATR Length", minval=1)
factor = input.float(3.0, "ATR Multiplier", minval=0.1, step=0.1)
sourceChoice = input.source(close, "Source", tooltip="Price source used for the trend calculation")
useChartPrice = input.bool(true, "Use chart price", tooltip="Force the script to read data from the current chart symbol/timeframe to avoid desync")
tfInput = input.timeframe("", "Higher timeframe (optional)", tooltip="Leave empty to use the chart timeframe")
showSignals = input.bool(true, "Show direction labels")

// === Helpers ===
getTf() => tfInput == "" ? timeframe.period : tfInput
seriesFromTf(expr) => request.security(syminfo.tickerid, getTf(), expr, lookahead=barmerge.lookahead_off)

float src = useChartPrice or tfInput != "" ? seriesFromTf(sourceChoice) : sourceChoice
float atrSeries = useChartPrice or tfInput != "" ? seriesFromTf(ta.atr(atrLength)) : ta.atr(atrLength)

// === Core Supertrend calculation ===
basicUpper = src + factor * atrSeries
basicLower = src - factor * atrSeries

var float upperBand = na
var float lowerBand = na

upperBand := basicUpper < nz(upperBand[1]) or src[1] > nz(upperBand[1]) ? basicUpper : nz(upperBand[1])
lowerBand := basicLower > nz(lowerBand[1]) or src[1] < nz(lowerBand[1]) ? basicLower : nz(lowerBand[1])

var int direction = 1
direction := nz(direction[1], 1)
direction := direction == -1 and src > nz(upperBand[1]) ? 1 : direction == 1 and src < nz(lowerBand[1]) ? -1 : direction

supertrend = direction == 1 ? lowerBand : upperBand

plot(supertrend, title="Supertrend", color=direction == 1 ? color.new(color.green, 0) : color.new(color.red, 0), linewidth=2)
bgcolor(direction == 1 ? color.new(color.green, 90) : color.new(color.red, 90), title="Background")
            """.trimIndent()

            CodeBlockWithCopy(
                title = "ut_supertrend_overlay_fix.pine",
                code = pineScript
            )
        }
    }
}

@Composable
fun StoredNodeDiagnosticCard(
    node: V2RayNode,
    isActive: Boolean,
    isTesting: Boolean,
    isExpanded: Boolean,
    detailedResult: DetailedPingResult?,
    onQuickPing: () -> Unit,
    onDeepDiagnostic: () -> Unit,
    onToggleExpand: () -> Unit,
    onSetActive: () -> Unit
) {
    val borderColor = if (isActive) CyberCyan else DarkBorder

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Color(0xFF0D1424))
            .border(1.dp, borderColor, RoundedCornerShape(12.dp))
            .animateContentSize()
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        // Main Row
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    ProtocolBadge(protocol = node.protocol)
                    Text(
                        text = node.name,
                        color = TextPrimary,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1
                    )
                }

                Text(
                    text = "${node.address}:${node.port} • ${node.network.uppercase()} • ${node.tls.uppercase()}",
                    color = TextMuted,
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace
                )
            }

            // Latency indicator & Quick Ping button
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                if (isTesting) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        color = CyberCyan,
                        strokeWidth = 2.dp
                    )
                } else {
                    PingIndicator(
                        pingMs = node.lastPingMs,
                        onClick = onQuickPing,
                        modifier = Modifier.testTag("ping_node_${node.id}_badge")
                    )
                }

                IconButton(
                    onClick = onQuickPing,
                    enabled = !isTesting,
                    modifier = Modifier
                        .size(32.dp)
                        .testTag("quick_ping_node_${node.id}")
                ) {
                    Icon(
                        imageVector = Icons.Default.Refresh,
                        contentDescription = "Ping",
                        tint = if (isTesting) TextMuted else CyberCyan,
                        modifier = Modifier.size(16.dp)
                    )
                }

                IconButton(
                    onClick = onToggleExpand,
                    modifier = Modifier.size(32.dp)
                ) {
                    Icon(
                        imageVector = if (isExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                        contentDescription = "Details",
                        tint = TextSecondary,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }
        }

        // Expanded Deep Diagnostic Metrics
        AnimatedVisibility(visible = isExpanded) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(DarkSurfaceVariant)
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Deep Diagnostic Telemetry",
                        color = CyberCyan,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold
                    )

                    Button(
                        onClick = onDeepDiagnostic,
                        enabled = !isTesting,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = CyberPurple,
                            contentColor = Color.White
                        ),
                        shape = RoundedCornerShape(6.dp),
                        modifier = Modifier
                            .height(28.dp)
                            .testTag("deep_diagnostic_node_${node.id}")
                    ) {
                        Icon(imageVector = Icons.Default.Analytics, contentDescription = null, modifier = Modifier.size(12.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Run 4-Sample Test", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    }
                }

                if (detailedResult != null) {
                    // 4-Sample Results Metrics Grid
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        MetricBox(label = "MIN", value = if (detailedResult.minMs > 0) "${detailedResult.minMs}ms" else "--", color = CyberGreen)
                        MetricBox(label = "AVG", value = if (detailedResult.avgMs > 0) "${detailedResult.avgMs}ms" else "--", color = CyberCyan)
                        MetricBox(label = "MAX", value = if (detailedResult.maxMs > 0) "${detailedResult.maxMs}ms" else "--", color = CyberYellow)
                        MetricBox(label = "JITTER", value = "${detailedResult.jitterMs}ms", color = CyberPurple)
                        MetricBox(label = "LOSS", value = "${detailedResult.packetLossPercent}%", color = if (detailedResult.packetLossPercent == 0) CyberGreen else CyberRed)
                    }

                    // Individual Sample Pills
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Samples:", color = TextMuted, fontSize = 10.sp)
                        detailedResult.samples.forEachIndexed { idx, s ->
                            val color = if (s > 0) CyberGreen else CyberRed
                            val text = if (s > 0) "${s}ms" else "✕"
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(color.copy(alpha = 0.15f))
                                    .border(1.dp, color.copy(alpha = 0.4f), RoundedCornerShape(4.dp))
                                    .padding(horizontal = 6.dp, vertical = 2.dp)
                            ) {
                                Text(
                                    text = "#${idx + 1}: $text",
                                    color = color,
                                    fontSize = 10.sp,
                                    fontFamily = FontFamily.Monospace,
                                    fontWeight = FontWeight.SemiBold
                                )
                            }
                        }
                    }

                    if (detailedResult.dnsTimeMs > 0) {
                        Text(
                            text = "DNS Lookup Time: ${detailedResult.dnsTimeMs}ms",
                            color = TextSecondary,
                            fontSize = 11.sp,
                            fontFamily = FontFamily.Monospace
                        )
                    }
                } else {
                    Text(
                        text = "Run a multi-sample deep test to measure jitter, packet stability, and DNS resolution.",
                        color = TextMuted,
                        fontSize = 11.sp
                    )
                }

                // Action Bar for this Node
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    if (!isActive) {
                        Button(
                            onClick = onSetActive,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = CyberCyan.copy(alpha = 0.15f),
                                contentColor = CyberCyan
                            ),
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier.height(32.dp)
                        ) {
                            Icon(imageVector = Icons.Default.CheckCircle, contentDescription = null, modifier = Modifier.size(14.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Set as Active Node", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        }
                    } else {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            Icon(imageVector = Icons.Default.CheckCircle, contentDescription = null, tint = CyberGreen, modifier = Modifier.size(14.dp))
                            Text("Currently Active", color = CyberGreen, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MetricBox(label: String, value: String, color: Color) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(DarkBackground)
            .border(1.dp, DarkBorder, RoundedCornerShape(6.dp))
            .padding(vertical = 4.dp, horizontal = 6.dp)
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(label, color = TextMuted, fontSize = 9.sp, fontWeight = FontWeight.Bold)
            Text(
                value,
                color = color,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace
            )
        }
    }
}
