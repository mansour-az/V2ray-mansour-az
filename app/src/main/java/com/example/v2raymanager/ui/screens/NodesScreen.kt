package com.example.v2raymanager.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Autorenew
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.v2raymanager.data.model.NodeParser
import com.example.v2raymanager.data.model.V2RayNode
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
import com.example.v2raymanager.ui.theme.DarkSurfaceCard
import com.example.v2raymanager.ui.theme.DarkSurfaceVariant
import com.example.v2raymanager.ui.theme.NeonCyan
import com.example.v2raymanager.ui.theme.TextMuted
import com.example.v2raymanager.ui.theme.TextPrimary
import com.example.v2raymanager.ui.theme.TextSecondary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NodesScreen(
    nodes: List<V2RayNode>,
    isPingingAll: Boolean,
    onSetActive: (V2RayNode) -> Unit,
    onPingNode: (V2RayNode) -> Unit,
    onPingAll: () -> Unit,
    onSaveNode: (V2RayNode) -> Unit,
    onDeleteNode: (V2RayNode) -> Unit,
    onImportLink: (String) -> Boolean,
    onImportBatch: (String) -> Int
) {
    val context = LocalContext.current
    var searchQuery by remember { mutableStateOf("") }
    var selectedProtocolFilter by remember { mutableStateOf("ALL") }

    var showEditDialog by remember { mutableStateOf(false) }
    var editingNode by remember { mutableStateOf<V2RayNode?>(null) }

    var showImportDialog by remember { mutableStateOf(false) }
    var importText by remember { mutableStateOf("") }

    val filteredNodes = nodes.filter { node ->
        val matchesSearch = node.name.contains(searchQuery, ignoreCase = true) ||
                node.address.contains(searchQuery, ignoreCase = true)
        val matchesProtocol = selectedProtocolFilter == "ALL" ||
                node.protocol.equals(selectedProtocolFilter, ignoreCase = true)
        matchesSearch && matchesProtocol
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Search Bar & Filter Row
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("node_search_input"),
                placeholder = { Text("Search node name or server IP/host...", color = TextMuted) },
                leadingIcon = {
                    Icon(
                        imageVector = Icons.Default.Search,
                        contentDescription = "Search",
                        tint = CyberCyan
                    )
                },
                singleLine = true,
                shape = RoundedCornerShape(14.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = CyberCyan,
                    unfocusedBorderColor = DarkBorder,
                    focusedTextColor = TextPrimary,
                    unfocusedTextColor = TextPrimary,
                    focusedContainerColor = DarkSurfaceCard,
                    unfocusedContainerColor = DarkSurfaceCard
                )
            )

            // Filter Chips + Ping All Button
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    modifier = Modifier
                        .weight(1f)
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    val filters = listOf("ALL", "VMESS", "VLESS", "TROJAN")
                    filters.forEach { filter ->
                        val isSelected = selectedProtocolFilter == filter
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(
                                    if (isSelected) CyberCyan.copy(alpha = 0.2f) else DarkSurfaceCard
                                )
                                .border(
                                    1.dp,
                                    if (isSelected) CyberCyan else DarkBorder,
                                    RoundedCornerShape(8.dp)
                                )
                                .clickable { selectedProtocolFilter = filter }
                                .padding(horizontal = 10.dp, vertical = 6.dp)
                        ) {
                            Text(
                                text = filter,
                                color = if (isSelected) CyberCyan else TextSecondary,
                                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold)
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.width(8.dp))

                // Ping All Button
                OutlinedButton(
                    onClick = { onPingAll() },
                    enabled = !isPingingAll && nodes.isNotEmpty(),
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = CyberCyan
                    ),
                    modifier = Modifier.testTag("ping_all_button")
                ) {
                    if (isPingingAll) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(14.dp),
                            color = CyberCyan,
                            strokeWidth = 2.dp
                        )
                    } else {
                        Icon(
                            imageVector = Icons.Default.Refresh,
                            contentDescription = "Test all ping",
                            modifier = Modifier.size(16.dp)
                        )
                    }
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Test Ping", fontSize = 12.sp)
                }
            }

            // Top Action bar: Quick Import / Quick Presets
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Button(
                    onClick = { showImportDialog = true },
                    modifier = Modifier
                        .weight(1f)
                        .testTag("import_link_button"),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = DarkSurfaceVariant,
                        contentColor = CyberCyan
                    )
                ) {
                    Icon(
                        imageVector = Icons.Default.FileDownload,
                        contentDescription = "Import",
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Import Link / Sub", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                }

                Button(
                    onClick = {
                        editingNode = V2RayNode(
                            name = "New VLESS Node",
                            protocol = "VLESS",
                            address = "example.com",
                            port = 443,
                            uuid = NodeParser.generateUUID(),
                            security = "none",
                            network = "ws",
                            path = "/vless",
                            tls = "tls"
                        )
                        showEditDialog = true
                    },
                    modifier = Modifier
                        .weight(1f)
                        .testTag("create_node_button"),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = CyberCyan,
                        contentColor = Color(0xFF060B12)
                    )
                ) {
                    Icon(
                        imageVector = Icons.Default.Add,
                        contentDescription = "Add node",
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Add Node", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                }
            }

            // Node List
            if (filteredNodes.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text(
                            text = if (nodes.isEmpty()) "No nodes in database" else "No matching nodes found",
                            color = TextSecondary,
                            style = MaterialTheme.typography.bodyLarge
                        )
                        Text(
                            text = "Tap 'Import Link' or 'Add Node' to configure a server",
                            color = TextMuted,
                            style = MaterialTheme.typography.bodyMedium.copy(fontSize = 12.sp)
                        )
                    }
                }
            } else {
                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    items(filteredNodes, key = { it.id }) { node ->
                        NodeItemCard(
                            node = node,
                            onSetActive = { onSetActive(node) },
                            onPing = { onPingNode(node) },
                            onEdit = {
                                editingNode = node
                                showEditDialog = true
                            },
                            onDelete = { onDeleteNode(node) }
                        )
                    }
                }
            }
        }
    }

    // Add / Edit Dialog
    if (showEditDialog && editingNode != null) {
        NodeEditDialog(
            initialNode = editingNode!!,
            onDismiss = {
                showEditDialog = false
                editingNode = null
            },
            onSave = { updated ->
                onSaveNode(updated)
                showEditDialog = false
                editingNode = null
            }
        )
    }

    // Import Dialog
    if (showImportDialog) {
        AlertDialog(
            onDismissRequest = { showImportDialog = false },
            title = {
                Text(
                    text = "Import Nodes",
                    color = TextPrimary,
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
                )
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        text = "Paste raw vmess://, vless://, trojan:// link or multi-line subscription text below:",
                        color = TextSecondary,
                        fontSize = 13.sp
                    )
                    OutlinedTextField(
                        value = importText,
                        onValueChange = { importText = it },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(140.dp)
                            .testTag("import_text_field"),
                        placeholder = { Text("vless://... or vmess://...", color = TextMuted, fontSize = 12.sp) },
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = CyberCyan,
                            unfocusedBorderColor = DarkBorder,
                            focusedTextColor = TextPrimary,
                            unfocusedTextColor = TextPrimary
                        ),
                        shape = RoundedCornerShape(10.dp)
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        if (importText.isNotBlank()) {
                            val count = onImportBatch(importText)
                            if (count > 0) {
                                importText = ""
                                showImportDialog = false
                            }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = CyberCyan, contentColor = Color(0xFF0A0F18))
                ) {
                    Text("Import")
                }
            },
            dismissButton = {
                TextButton(onClick = { showImportDialog = false }) {
                    Text("Cancel", color = TextSecondary)
                }
            },
            containerColor = DarkSurfaceCard
        )
    }
}

@Composable
fun NodeItemCard(
    node: V2RayNode,
    onSetActive: () -> Unit,
    onPing: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit
) {
    val context = LocalContext.current
    var isExpanded by remember { mutableStateOf(false) }

    CyberCard(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { isExpanded = !isExpanded },
        borderColor = if (node.isActive) CyberCyan else DarkBorder,
        backgroundColor = if (node.isActive) Color(0xFF111C2E) else DarkSurfaceCard
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            // Header Row: Active Radio + Protocol + Name + Ping
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(
                    modifier = Modifier.weight(1f),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    IconButton(
                        onClick = { onSetActive() },
                        modifier = Modifier.size(24.dp)
                    ) {
                        Icon(
                            imageVector = if (node.isActive) Icons.Default.CheckCircle else Icons.Default.RadioButtonUnchecked,
                            contentDescription = "Active state",
                            tint = if (node.isActive) CyberCyan else TextMuted,
                            modifier = Modifier.size(20.dp)
                        )
                    }

                    ProtocolBadge(node.protocol)

                    Text(
                        text = node.name,
                        color = if (node.isActive) CyberCyan else TextPrimary,
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                        maxLines = 1
                    )
                }

                PingIndicator(
                    pingMs = node.lastPingMs,
                    onClick = onPing
                )
            }

            // Subtitle: Address:Port, Stream Network, TLS
            Text(
                text = "${node.address}:${node.port} • ${node.network.uppercase()}${if (node.tls.isNotBlank() && node.tls != "none") " • ${node.tls.uppercase()}" else ""}${if (node.path.isNotBlank()) " • ${node.path}" else ""}",
                color = TextSecondary,
                style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                maxLines = 1
            )

            // Expanded details and Action Row
            AnimatedVisibility(visible = isExpanded) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(Color(0xFF080D17))
                            .padding(8.dp)
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text("UUID / Pass: ${node.uuid}", color = TextMuted, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                            if (node.sni.isNotBlank()) {
                                Text("SNI: ${node.sni}", color = TextMuted, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                            }
                            if (node.alterId > 0) {
                                Text("AlterId: ${node.alterId}", color = TextMuted, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                            }
                        }
                    }

                    // Action buttons row
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            // Copy Share Link
                            IconButton(
                                onClick = {
                                    val uri = NodeParser.toShareUri(node)
                                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                    val clip = ClipData.newPlainText("V2Ray Link", uri)
                                    clipboard.setPrimaryClip(clip)
                                    Toast.makeText(context, "Link copied to clipboard", Toast.LENGTH_SHORT).show()
                                },
                                modifier = Modifier.size(32.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Share,
                                    contentDescription = "Share link",
                                    tint = CyberCyan,
                                    modifier = Modifier.size(18.dp)
                                )
                            }

                            // Edit Node
                            IconButton(
                                onClick = onEdit,
                                modifier = Modifier.size(32.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Edit,
                                    contentDescription = "Edit node",
                                    tint = NeonCyan,
                                    modifier = Modifier.size(18.dp)
                                )
                            }

                            // Delete Node
                            IconButton(
                                onClick = onDelete,
                                modifier = Modifier.size(32.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Delete,
                                    contentDescription = "Delete node",
                                    tint = CyberRed,
                                    modifier = Modifier.size(18.dp)
                                )
                            }
                        }

                        if (!node.isActive) {
                            TextButton(
                                onClick = onSetActive,
                                colors = ButtonDefaults.textButtonColors(contentColor = CyberCyan)
                            ) {
                                Text("Set Active", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NodeEditDialog(
    initialNode: V2RayNode,
    onDismiss: () -> Unit,
    onSave: (V2RayNode) -> Unit
) {
    var name by remember { mutableStateOf(initialNode.name) }
    var protocol by remember { mutableStateOf(initialNode.protocol) }
    var address by remember { mutableStateOf(initialNode.address) }
    var portText by remember { mutableStateOf(initialNode.port.toString()) }
    var uuid by remember { mutableStateOf(initialNode.uuid) }
    var alterIdText by remember { mutableStateOf(initialNode.alterId.toString()) }
    var network by remember { mutableStateOf(initialNode.network) }
    var path by remember { mutableStateOf(initialNode.path) }
    var tls by remember { mutableStateOf(initialNode.tls) }
    var sni by remember { mutableStateOf(initialNode.sni) }

    val protocols = listOf("VMess", "VLESS", "Trojan")
    val networks = listOf("ws", "tcp", "grpc", "http")
    val tlsModes = listOf("tls", "none", "reality")

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                text = if (initialNode.id == 0) "Add New Node" else "Edit Node",
                color = TextPrimary,
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
            )
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                // Name
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Remark / Name") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )

                // Protocol Selector
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    protocols.forEach { proto ->
                        val isSelected = protocol.equals(proto, ignoreCase = true)
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (isSelected) CyberCyan.copy(alpha = 0.25f) else Color(0xFF0F1728))
                                .border(1.dp, if (isSelected) CyberCyan else DarkBorder, RoundedCornerShape(8.dp))
                                .clickable { protocol = proto }
                                .padding(vertical = 8.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = proto,
                                color = if (isSelected) CyberCyan else TextSecondary,
                                fontWeight = FontWeight.Bold,
                                fontSize = 12.sp
                            )
                        }
                    }
                }

                // Server Address & Port
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedTextField(
                        value = address,
                        onValueChange = { address = it },
                        label = { Text("Server Host/IP") },
                        modifier = Modifier.weight(2f),
                        singleLine = true
                    )
                    OutlinedTextField(
                        value = portText,
                        onValueChange = { portText = it },
                        label = { Text("Port") },
                        modifier = Modifier.weight(1f),
                        singleLine = true
                    )
                }

                // UUID with generate button
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    OutlinedTextField(
                        value = uuid,
                        onValueChange = { uuid = it },
                        label = { Text("UUID / Password") },
                        modifier = Modifier.fillMaxWidth(),
                        trailingIcon = {
                            IconButton(onClick = { uuid = NodeParser.generateUUID() }) {
                                Icon(
                                    imageVector = Icons.Default.Autorenew,
                                    contentDescription = "Generate UUID",
                                    tint = CyberCyan
                                )
                            }
                        },
                        singleLine = true
                    )
                }

                // Stream Network & TLS Mode
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedTextField(
                        value = network,
                        onValueChange = { network = it },
                        label = { Text("Network (ws/tcp)") },
                        modifier = Modifier.weight(1f),
                        singleLine = true
                    )
                    OutlinedTextField(
                        value = tls,
                        onValueChange = { tls = it },
                        label = { Text("TLS Mode (tls/none)") },
                        modifier = Modifier.weight(1f),
                        singleLine = true
                    )
                }

                // Path & SNI
                OutlinedTextField(
                    value = path,
                    onValueChange = { path = it },
                    label = { Text("WebSocket Path (e.g. /vmess)") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )

                OutlinedTextField(
                    value = sni,
                    onValueChange = { sni = it },
                    label = { Text("SNI / Host Header") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    val port = portText.toIntOrNull() ?: 443
                    val alterId = alterIdText.toIntOrNull() ?: 0
                    val updated = initialNode.copy(
                        name = name.ifBlank { "V2Ray Node" },
                        protocol = protocol,
                        address = address.ifBlank { "127.0.0.1" },
                        port = port,
                        uuid = uuid.ifBlank { NodeParser.generateUUID() },
                        alterId = alterId,
                        network = network.ifBlank { "ws" },
                        path = path.ifBlank { "/vmess" },
                        tls = tls.ifBlank { "tls" },
                        sni = sni
                    )
                    onSave(updated)
                },
                colors = ButtonDefaults.buttonColors(containerColor = CyberCyan, contentColor = Color(0xFF090E16))
            ) {
                Text("Save")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel", color = TextSecondary)
            }
        },
        containerColor = DarkSurfaceCard
    )
}
