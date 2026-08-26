package com.example.v2raymanager.ui

import android.app.Application
import android.content.Intent
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.v2raymanager.data.db.AppDatabase
import com.example.v2raymanager.data.db.NodeRepository
import com.example.v2raymanager.data.model.NodeParser
import com.example.v2raymanager.data.model.V2RayNode
import com.example.v2raymanager.data.network.DetailedPingResult
import com.example.v2raymanager.data.network.PingService
import com.example.v2raymanager.vpn.VenzoVpnService
import com.example.v2raymanager.vpn.VpnRuntime
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

data class ConnectionStats(
    val isConnected: Boolean = false,
    val uploadSpeedKbps: Double = 0.0,
    val downloadSpeedKbps: Double = 0.0,
    val totalUploadBytes: Long = 0L,
    val totalDownloadBytes: Long = 0L,
    val connectionDurationSecs: Long = 0L,
    val currentPingMs: Long = 0L
)

data class DiagnosticsProgress(
    val isRunning: Boolean = false,
    val current: Int = 0,
    val total: Int = 0,
    val currentNodeName: String = "",
    val activeNodeIdTesting: Int? = null
)

class MainViewModel(application: Application) : AndroidViewModel(application) {

    private val repository: NodeRepository

    val nodes: StateFlow<List<V2RayNode>>
    val activeNode: StateFlow<V2RayNode?>

    private val _connectionStats = MutableStateFlow(ConnectionStats())
    val connectionStats: StateFlow<ConnectionStats> = _connectionStats.asStateFlow()

    private val _isPingingAll = MutableStateFlow(false)
    val isPingingAll: StateFlow<Boolean> = _isPingingAll.asStateFlow()

    private val _diagnosticsProgress = MutableStateFlow(DiagnosticsProgress())
    val diagnosticsProgress: StateFlow<DiagnosticsProgress> = _diagnosticsProgress.asStateFlow()

    private val _detailedPingResults = MutableStateFlow<Map<Int, DetailedPingResult>>(emptyMap())
    val detailedPingResults: StateFlow<Map<Int, DetailedPingResult>> = _detailedPingResults.asStateFlow()

    private val _activeTestingNodeId = MutableStateFlow<Int?>(null)
    val activeTestingNodeId: StateFlow<Int?> = _activeTestingNodeId.asStateFlow()

    private val _userMessage = MutableStateFlow<String?>(null)
    val userMessage: StateFlow<String?> = _userMessage.asStateFlow()

    private var durationJob: Job? = null
    private var pingJob: Job? = null

    init {
        val db = AppDatabase.getDatabase(application)
        repository = NodeRepository(db.nodeDao())

        nodes = repository.allNodes.stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = emptyList()
        )

        activeNode = repository.activeNode.stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = null
        )

        viewModelScope.launch {
            repository.checkAndSeedInitialNodes()
        }

        viewModelScope.launch {
            VpnRuntime.state.collect { state ->
                val node = activeNode.value
                _connectionStats.value = _connectionStats.value.copy(
                    isConnected = state.isConnected,
                    currentPingMs = if (state.isConnected && node != null && node.lastPingMs > 0) node.lastPingMs else 0L,
                    uploadSpeedKbps = 0.0,
                    downloadSpeedKbps = 0.0,
                    connectionDurationSecs = if (state.isConnected && state.startedAt > 0) {
                        (System.currentTimeMillis() - state.startedAt) / 1000L
                    } else 0L
                )

                if (state.isConnected) {
                    startDurationTicker(state.startedAt)
                    _userMessage.value = buildString {
                        append("Connected to ${state.nodeName}")
                        state.publicIp?.let { append(" • IP $it") }
                    }
                } else {
                    durationJob?.cancel()
                    if (!state.error.isNullOrBlank()) {
                        _userMessage.value = state.error
                    }
                }
            }
        }
    }

    fun clearMessage() {
        _userMessage.value = null
    }

    fun showMessage(msg: String) {
        _userMessage.value = msg
    }

    fun startVpn() {
        val node = activeNode.value
        if (node == null) {
            _userMessage.value = "Please select an active node first"
            return
        }

        val intent = Intent(getApplication(), VenzoVpnService::class.java).apply {
            action = VenzoVpnService.ACTION_START
            putExtra(VenzoVpnService.EXTRA_NODE_JSON, Json.encodeToString(node))
        }
        ContextCompat.startForegroundService(getApplication(), intent)
        _userMessage.value = "Verifying ${node.name}…"
    }

    fun stopVpn() {
        val intent = Intent(getApplication(), VenzoVpnService::class.java).apply {
            action = VenzoVpnService.ACTION_STOP
        }
        getApplication<Application>().startService(intent)
    }

    fun toggleConnectionAfterPermission() {
        if (_connectionStats.value.isConnected) stopVpn() else startVpn()
    }

    private fun startDurationTicker(startedAt: Long) {
        durationJob?.cancel()
        durationJob = viewModelScope.launch {
            while (isActive && VpnRuntime.state.value.isConnected) {
                _connectionStats.value = _connectionStats.value.copy(
                    connectionDurationSecs = (System.currentTimeMillis() - startedAt) / 1000L
                )
                delay(1000)
            }
        }
    }

    fun setActiveNode(node: V2RayNode) {
        viewModelScope.launch {
            if (_connectionStats.value.isConnected) {
                stopVpn()
            }
            repository.setActive(node.id)
            _userMessage.value = "Switched active node to ${node.name}"
            pingNode(node)
        }
    }

    fun pingNode(node: V2RayNode) {
        viewModelScope.launch {
            _activeTestingNodeId.value = node.id
            val ping = PingService.pingTcp(node.address, node.port, 2500)
            repository.updatePing(node.id, ping)
            _activeTestingNodeId.value = null
            if (_connectionStats.value.isConnected && activeNode.value?.id == node.id) {
                _connectionStats.value = _connectionStats.value.copy(currentPingMs = if (ping > 0) ping else 999L)
            }
        }
    }

    fun runDetailedDiagnostic(node: V2RayNode) {
        viewModelScope.launch {
            _activeTestingNodeId.value = node.id
            val result = PingService.runDetailedDiagnostic(node, sampleCount = 4, timeoutMs = 2500)
            _detailedPingResults.value = _detailedPingResults.value + (node.id to result)
            if (result.isSuccess) {
                repository.updatePing(node.id, result.avgMs)
            } else {
                repository.updatePing(node.id, -2L)
            }
            _activeTestingNodeId.value = null
            _userMessage.value = "Diagnostic complete for ${node.name}: ${if (result.isSuccess) "${result.avgMs}ms avg" else "Timeout"}"
        }
    }

    fun pingAllNodes() {
        pingJob?.cancel()
        pingJob = viewModelScope.launch {
            _isPingingAll.value = true
            val list = nodes.value
            if (list.isEmpty()) {
                _isPingingAll.value = false
                _userMessage.value = "No stored nodes to ping"
                return@launch
            }

            _diagnosticsProgress.value = DiagnosticsProgress(
                isRunning = true,
                current = 0,
                total = list.size,
                currentNodeName = list.first().name,
                activeNodeIdTesting = list.first().id
            )

            for (i in list.indices) {
                val node = list[i]
                _diagnosticsProgress.value = DiagnosticsProgress(
                    isRunning = true,
                    current = i + 1,
                    total = list.size,
                    currentNodeName = node.name,
                    activeNodeIdTesting = node.id
                )
                val ping = PingService.pingTcp(node.address, node.port, 2500)
                repository.updatePing(node.id, ping)
                delay(100)
            }

            _diagnosticsProgress.value = DiagnosticsProgress(isRunning = false)
            _isPingingAll.value = false
            _userMessage.value = "Latency test finished for ${list.size} stored nodes"
        }
    }

    fun autoSelectBestNode() {
        viewModelScope.launch {
            val list = nodes.value
            val onlineNodes = list.filter { it.lastPingMs > 0 }
            if (onlineNodes.isEmpty()) {
                _userMessage.value = "No responsive nodes found. Run a ping test first."
                return@launch
            }
            val candidates = onlineNodes.sortedBy { it.lastPingMs }.take(5)
            var selected: V2RayNode? = null
            for (candidate in candidates) {
                val result = PingService.runDetailedDiagnostic(candidate, sampleCount = 2, timeoutMs = 2500)
                if (result.isSuccess) {
                    selected = candidate
                    repository.updatePing(candidate.id, result.avgMs)
                    break
                }
            }
            if (selected != null) {
                repository.setActive(selected.id)
                _userMessage.value = "Selected verified node: ${selected.name}"
            } else {
                _userMessage.value = "Servers answered TCP ping but none passed the detailed test"
            }
        }
    }

    fun saveNode(node: V2RayNode) {
        viewModelScope.launch {
            if (node.id == 0) {
                val id = repository.insert(node)
                _userMessage.value = "Added node '${node.name}'"
                pingNode(node.copy(id = id.toInt()))
            } else {
                repository.update(node)
                _userMessage.value = "Updated node '${node.name}'"
                pingNode(node)
            }
        }
    }

    fun deleteNode(node: V2RayNode) {
        viewModelScope.launch {
            repository.delete(node)
            _userMessage.value = "Deleted node '${node.name}'"
        }
    }

    fun importFromLink(link: String): Boolean {
        val parsed = NodeParser.parseLink(link)
        if (parsed != null) {
            viewModelScope.launch {
                val id = repository.insert(parsed)
                _userMessage.value = "Imported node: ${parsed.name}"
                pingNode(parsed.copy(id = id.toInt()))
            }
            return true
        }
        _userMessage.value = "Failed to parse link format"
        return false
    }

    fun importBatch(text: String): Int {
        val imported = text.lines()
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .mapNotNull { NodeParser.parseLink(it) }

        if (imported.isNotEmpty()) {
            viewModelScope.launch {
                repository.insertAll(imported)
                _userMessage.value = "Successfully imported ${imported.size} nodes"
                pingAllNodes()
            }
        } else {
            _userMessage.value = "No valid node links found"
        }
        return imported.size
    }
}
