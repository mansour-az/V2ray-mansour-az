package com.example.v2raymanager

import android.app.Activity
import android.net.VpnService
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.Speed
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.v2raymanager.ui.MainViewModel
import com.example.v2raymanager.ui.screens.DiagnosticsScreen
import com.example.v2raymanager.ui.screens.GeneratorScreen
import com.example.v2raymanager.ui.screens.HomeScreen
import com.example.v2raymanager.ui.screens.NodesScreen
import com.example.v2raymanager.ui.theme.CyberCyan
import com.example.v2raymanager.ui.theme.DarkBackground
import com.example.v2raymanager.ui.theme.DarkBorder
import com.example.v2raymanager.ui.theme.DarkSurfaceCard
import com.example.v2raymanager.ui.theme.TextMuted
import com.example.v2raymanager.ui.theme.TextSecondary
import com.example.v2raymanager.ui.theme.V2RayManagerTheme

data class NavItem(
    val title: String,
    val selectedIcon: ImageVector,
    val unselectedIcon: ImageVector,
    val testTag: String
)

class MainActivity : ComponentActivity() {

    private val viewModel: MainViewModel by viewModels()

    private val vpnPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            viewModel.startVpn()
        } else {
            viewModel.showMessage("VPN permission is required to connect")
        }
    }

    private fun requestVpnToggle() {
        if (viewModel.connectionStats.value.isConnected) {
            viewModel.stopVpn()
            return
        }
        val permissionIntent = VpnService.prepare(this)
        if (permissionIntent == null) {
            viewModel.startVpn()
        } else {
            vpnPermissionLauncher.launch(permissionIntent)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            V2RayManagerTheme {
                val nodes by viewModel.nodes.collectAsStateWithLifecycle()
                val activeNode by viewModel.activeNode.collectAsStateWithLifecycle()
                val connectionStats by viewModel.connectionStats.collectAsStateWithLifecycle()
                val isPingingAll by viewModel.isPingingAll.collectAsStateWithLifecycle()
                val diagnosticsProgress by viewModel.diagnosticsProgress.collectAsStateWithLifecycle()
                val detailedPingResults by viewModel.detailedPingResults.collectAsStateWithLifecycle()
                val activeTestingNodeId by viewModel.activeTestingNodeId.collectAsStateWithLifecycle()
                val userMessage by viewModel.userMessage.collectAsStateWithLifecycle()

                val snackbarHostState = remember { SnackbarHostState() }

                LaunchedEffect(userMessage) {
                    userMessage?.let { msg ->
                        snackbarHostState.showSnackbar(msg)
                        viewModel.clearMessage()
                    }
                }

                var selectedTab by remember { mutableIntStateOf(0) }

                val navItems = listOf(
                    NavItem("Dashboard", Icons.Filled.Dashboard, Icons.Outlined.Dashboard, "nav_dashboard"),
                    NavItem("Nodes", Icons.Filled.Dns, Icons.Outlined.Dns, "nav_nodes"),
                    NavItem("Generator", Icons.Filled.Code, Icons.Outlined.Code, "nav_generator"),
                    NavItem("Diagnostics", Icons.Filled.Speed, Icons.Outlined.Speed, "nav_diagnostics")
                )

                Scaffold(
                    modifier = Modifier.fillMaxSize(),
                    containerColor = DarkBackground,
                    contentWindowInsets = WindowInsets.safeDrawing,
                    snackbarHost = { SnackbarHost(snackbarHostState) },
                    bottomBar = {
                        NavigationBar(
                            modifier = Modifier
                                .windowInsetsPadding(WindowInsets.navigationBars)
                                .border(1.dp, DarkBorder)
                                .testTag("bottom_navigation_bar"),
                            containerColor = DarkSurfaceCard,
                            tonalElevation = 8.dp
                        ) {
                            navItems.forEachIndexed { index, item ->
                                val isSelected = selectedTab == index
                                NavigationBarItem(
                                    selected = isSelected,
                                    onClick = { selectedTab = index },
                                    icon = {
                                        Icon(
                                            imageVector = if (isSelected) item.selectedIcon else item.unselectedIcon,
                                            contentDescription = item.title
                                        )
                                    },
                                    label = {
                                        Text(
                                            text = item.title,
                                            fontSize = 11.sp,
                                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                                        )
                                    },
                                    colors = NavigationBarItemDefaults.colors(
                                        selectedIconColor = DarkBackground,
                                        selectedTextColor = CyberCyan,
                                        indicatorColor = CyberCyan,
                                        unselectedIconColor = TextSecondary,
                                        unselectedTextColor = TextMuted
                                    ),
                                    modifier = Modifier.testTag(item.testTag)
                                )
                            }
                        }
                    }
                ) { innerPadding ->
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(innerPadding)
                            .background(DarkBackground)
                    ) {
                        when (selectedTab) {
                            0 -> HomeScreen(
                                activeNode = activeNode,
                                connectionStats = connectionStats,
                                onToggleConnection = { requestVpnToggle() },
                                onNavigateToNodes = { selectedTab = 1 },
                                onPingActiveNode = { activeNode?.let { viewModel.pingNode(it) } }
                            )
                            1 -> NodesScreen(
                                nodes = nodes,
                                isPingingAll = isPingingAll,
                                onSetActive = { viewModel.setActiveNode(it) },
                                onPingNode = { viewModel.pingNode(it) },
                                onPingAll = { viewModel.pingAllNodes() },
                                onSaveNode = { viewModel.saveNode(it) },
                                onDeleteNode = { viewModel.deleteNode(it) },
                                onImportLink = { viewModel.importFromLink(it) },
                                onImportBatch = { viewModel.importBatch(it) }
                            )
                            2 -> GeneratorScreen(nodes = nodes, activeNode = activeNode)
                            3 -> DiagnosticsScreen(
                                nodes = nodes,
                                activeNode = activeNode,
                                isPingingAll = isPingingAll,
                                diagnosticsProgress = diagnosticsProgress,
                                detailedPingResults = detailedPingResults,
                                activeTestingNodeId = activeTestingNodeId,
                                onPingNode = { viewModel.pingNode(it) },
                                onRunDetailedDiagnostic = { viewModel.runDetailedDiagnostic(it) },
                                onPingAllNodes = { viewModel.pingAllNodes() },
                                onAutoSelectBestNode = { viewModel.autoSelectBestNode() },
                                onSetActiveNode = { viewModel.setActiveNode(it) }
                            )
                        }
                    }
                }
            }
        }
    }
}
