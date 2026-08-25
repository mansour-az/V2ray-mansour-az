package com.example.v2raymanager.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Autorenew
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.DataObject
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRowDefaults
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.v2raymanager.data.model.NodeParser
import com.example.v2raymanager.data.model.V2RayNode
import com.example.v2raymanager.ui.components.CodeBlockWithCopy
import com.example.v2raymanager.ui.components.CyberCard
import com.example.v2raymanager.ui.theme.CyberCyan
import com.example.v2raymanager.ui.theme.CyberGreen
import com.example.v2raymanager.ui.theme.CyberPink
import com.example.v2raymanager.ui.theme.CyberPurple
import com.example.v2raymanager.ui.theme.DarkBackground
import com.example.v2raymanager.ui.theme.DarkBorder
import com.example.v2raymanager.ui.theme.DarkSurfaceCard
import com.example.v2raymanager.ui.theme.DarkSurfaceVariant
import com.example.v2raymanager.ui.theme.NeonCyan
import com.example.v2raymanager.ui.theme.TextMuted
import com.example.v2raymanager.ui.theme.TextPrimary
import com.example.v2raymanager.ui.theme.TextSecondary

@Composable
fun GeneratorScreen(
    nodes: List<V2RayNode>,
    activeNode: V2RayNode?
) {
    val context = LocalContext.current
    val scrollState = rememberScrollState()

    var selectedTabIndex by remember { mutableIntStateOf(0) }
    val tabTitles = listOf("Client JSON", "Doprax Server", "UUID Generator", "URI Share")

    // Doprax generator states
    var serverUuid by remember { mutableStateOf("de04add9-5c68-8bab-950c-08cd5320df18") }
    var vmessPath by remember { mutableStateOf("/vmess") }
    var vlessPath by remember { mutableStateOf("/vless") }

    // Client JSON node selector
    var selectedNodeForJson by remember(nodes, activeNode) {
        mutableStateOf(activeNode ?: nodes.firstOrNull())
    }

    // UUID Generator states
    var generatedUuids by remember {
        mutableStateOf(List(4) { NodeParser.generateUUID() })
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Tab Header
        ScrollableTabRow(
            selectedTabIndex = selectedTabIndex,
            containerColor = DarkSurfaceCard,
            contentColor = CyberCyan,
            edgePadding = 8.dp,
            indicator = { tabPositions ->
                if (selectedTabIndex < tabPositions.size) {
                    TabRowDefaults.SecondaryIndicator(
                        modifier = Modifier.tabIndicatorOffset(tabPositions[selectedTabIndex]),
                        color = CyberCyan
                    )
                }
            },
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .border(1.dp, DarkBorder, RoundedCornerShape(12.dp))
        ) {
            tabTitles.forEachIndexed { index, title ->
                Tab(
                    selected = selectedTabIndex == index,
                    onClick = { selectedTabIndex = index },
                    text = {
                        Text(
                            text = title,
                            fontWeight = if (selectedTabIndex == index) FontWeight.Bold else FontWeight.Normal,
                            color = if (selectedTabIndex == index) CyberCyan else TextSecondary,
                            fontSize = 13.sp
                        )
                    }
                )
            }
        }

        when (selectedTabIndex) {
            0 -> {
                // Tab 0: Client JSON Generator
                Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Text(
                        text = "V2Ray / Xray Client Configuration",
                        color = TextPrimary,
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
                    )
                    Text(
                        text = "Select a node to generate full JSON configuration for V2RayN, V2RayNG, Clash, or xray-core.",
                        color = TextSecondary,
                        fontSize = 13.sp
                    )

                    // Node selector chips
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        nodes.forEach { node ->
                            val isSelected = selectedNodeForJson?.id == node.id
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(if (isSelected) CyberCyan.copy(alpha = 0.2f) else DarkSurfaceCard)
                                    .border(1.dp, if (isSelected) CyberCyan else DarkBorder, RoundedCornerShape(8.dp))
                                    .clickable { selectedNodeForJson = node }
                                    .padding(horizontal = 12.dp, vertical = 6.dp)
                            ) {
                                Text(
                                    text = "${node.protocol}: ${node.name}",
                                    color = if (isSelected) CyberCyan else TextSecondary,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                    }

                    val targetNode = selectedNodeForJson ?: (nodes.firstOrNull() ?: V2RayNode(
                        name = "Sample VMess",
                        protocol = "VMess",
                        address = "localhost",
                        port = 443,
                        uuid = serverUuid
                    ))

                    val generatedJson = NodeParser.generateClientJson(targetNode)
                    CodeBlockWithCopy(
                        title = "config.json (Client)",
                        code = generatedJson
                    )
                }
            }

            1 -> {
                // Tab 1: Doprax Server Deployment Configs (From Original Repo)
                Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Text(
                        text = "Doprax PaaS Server Configs",
                        color = TextPrimary,
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
                    )
                    Text(
                        text = "Generates Nginx + WebSocket + VMess/VLess + TLS server configurations for deployment on Doprax, Replit, or Docker VPS.",
                        color = TextSecondary,
                        fontSize = 13.sp
                    )

                    CyberCard(modifier = Modifier.fillMaxWidth()) {
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            OutlinedTextField(
                                value = serverUuid,
                                onValueChange = { serverUuid = it },
                                label = { Text("Server UUID") },
                                modifier = Modifier.fillMaxWidth(),
                                trailingIcon = {
                                    IconButton(onClick = { serverUuid = NodeParser.generateUUID() }) {
                                        Icon(
                                            imageVector = Icons.Default.Autorenew,
                                            contentDescription = "New UUID",
                                            tint = CyberCyan
                                        )
                                    }
                                },
                                singleLine = true
                            )

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                OutlinedTextField(
                                    value = vmessPath,
                                    onValueChange = { vmessPath = it },
                                    label = { Text("VMess Path") },
                                    modifier = Modifier.weight(1f),
                                    singleLine = true
                                )
                                OutlinedTextField(
                                    value = vlessPath,
                                    onValueChange = { vlessPath = it },
                                    label = { Text("VLess Path") },
                                    modifier = Modifier.weight(1f),
                                    singleLine = true
                                )
                            }
                        }
                    }

                    // Server config.json
                    val serverJson = NodeParser.generateDopraxServerConfig(serverUuid, vmessPath, vlessPath)
                    CodeBlockWithCopy(
                        title = "Server config.json",
                        code = serverJson
                    )

                    // Dockerfile
                    val dockerfile = NodeParser.generateDopraxDockerfile(serverUuid, vmessPath, vlessPath)
                    CodeBlockWithCopy(
                        title = "Dockerfile (Alpine V2Ray + Nginx)",
                        code = dockerfile
                    )

                    // Nginx.conf
                    val nginxConf = NodeParser.generateNginxConf(vmessPath, vlessPath)
                    CodeBlockWithCopy(
                        title = "nginx.conf (WebSocket Reverse Proxy)",
                        code = nginxConf
                    )
                }
            }

            2 -> {
                // Tab 2: UUID v4 Generator
                Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "UUID v4 Generator",
                            color = TextPrimary,
                            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
                        )
                        Button(
                            onClick = {
                                generatedUuids = List(4) { NodeParser.generateUUID() }
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = CyberCyan, contentColor = Color(0xFF070C15)),
                            shape = RoundedCornerShape(8.dp)
                        ) {
                            Icon(imageVector = Icons.Default.Autorenew, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Regenerate", fontSize = 12.sp)
                        }
                    }

                    Text(
                        text = "V2Ray and Xray protocols use standard UUID v4 strings for client authorization IDs.",
                        color = TextSecondary,
                        fontSize = 13.sp
                    )

                    generatedUuids.forEachIndexed { idx, uid ->
                        CyberCard(modifier = Modifier.fillMaxWidth()) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = uid,
                                    color = TextPrimary,
                                    fontFamily = FontFamily.Monospace,
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                IconButton(
                                    onClick = {
                                        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                        val clip = ClipData.newPlainText("UUID", uid)
                                        clipboard.setPrimaryClip(clip)
                                        Toast.makeText(context, "UUID copied", Toast.LENGTH_SHORT).show()
                                    }
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.ContentCopy,
                                        contentDescription = "Copy",
                                        tint = CyberCyan,
                                        modifier = Modifier.size(18.dp)
                                    )
                                }
                            }
                        }
                    }
                }
            }

            3 -> {
                // Tab 3: URI Share & Link preview
                Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Text(
                        text = "Node URI Links & Sharing",
                        color = TextPrimary,
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
                    )
                    Text(
                        text = "Standard URI links for importing directly into mobile and desktop V2Ray clients.",
                        color = TextSecondary,
                        fontSize = 13.sp
                    )

                    nodes.forEach { node ->
                        val shareUri = NodeParser.toShareUri(node)
                        CodeBlockWithCopy(
                            title = "${node.protocol}: ${node.name}",
                            code = shareUri
                        )
                    }
                }
            }
        }
    }
}
