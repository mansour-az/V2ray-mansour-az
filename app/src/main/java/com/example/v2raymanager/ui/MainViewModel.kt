package com.example.v2raymanager.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.v2raymanager.data.db.AppDatabase
import com.example.v2raymanager.data.db.NodeRepository
import com.example.v2raymanager.data.model.NodeParser
import com.example.v2raymanager.data.model.V2RayNode
import com.example.v2raymanager.data.network.DetailedPingResult
import com.example.v2raymanager.data.network.PingService
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.random.Random

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

    private var trafficJob: Job? = null
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
    }

    fun clearMessage() {
        _userMessage.value = null
    }

    fun showMessage(msg: String) {
        _userMessage.value = msg
    }

    fun toggleConnection() {
        val current = _connectionStats.value.isConnected
        if (!current) {
            val node = activeNode.value
            if (node == null) {
                _userMessage.value = "Please select an active node first"
                return
            }
            _connectionStats.value = _connectionStats.value.copy(
                isConnected = true,
                currentPingMs = if (node.lastPingMs > 0) node.lastPingMs else 85L
            )
            startTrafficSimulation()
            _userMessage.value = "Connected to ${node.name}"
        } else {
            trafficJob?.cancel()
            _connectionStats.value = _connectionStats.value.copy(
                isConnected = false,
                uploadSpeedKbps = 0.0,
                downloadSpeedKbps = 0.0
            )
            _userMessage.value = "Disconnected"
        }
    }

    private fun startTrafficSimulation() {
        trafficJob?.cancel()
        trafficJob = viewModelScope.launch {
            while (isActive) {
                delay(1000)
                if (_connectionStats.value.isConnected) {
                    val up = Random.nextDouble(12.0, 180.0)
                    val down = Random.nextDouble(45.0, 950.0)
                    val addedUp = (up * 1024 / 8).toLong()
                    val addedDown = (down * 1024 / 8).toLong()
                    _connectionStats.value = _connectionStats.value.copy(
                        uploadSpeedKbps = up,
                        downloadSpeedKbps = down,
                        totalUploadBytes = _connectionStats.value.totalUploadBytes + addedUp,
                        totalDownloadBytes = _connectionStats.value.totalDownloadBytes + addedDown,
                        connectionDurationSecs = _connectionStats.value.connectionDurationSecs + 1
                    )
                }
            }
        }
    }

    fun setActiveNode(node: V2RayNode) {
        viewModelScope.launch {
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
                delay(100) // gentle delay between sequential pings
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
            val bestNode = onlineNodes.minByOrNull { it.lastPingMs }
            if (bestNode != null) {
                repository.setActive(bestNode.id)
                _userMessage.value = "Selected lowest latency node: ${bestNode.name} (${bestNode.lastPingMs}ms)"
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
        } else {
            _userMessage.value = "Failed to parse link format"
            return false
        }
    }

    fun importBatch(text: String): Int {
        val lines = text.lines()
        val imported = mutableListOf<V2RayNode>()
        for (line in lines) {
            val trimmed = line.trim()
            if (trimmed.isNotEmpty()) {
                val parsed = NodeParser.parseLink(trimmed)
                if (parsed != null) {
                    imported.add(parsed)
                }
            }
        }
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
