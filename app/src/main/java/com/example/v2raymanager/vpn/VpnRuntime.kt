package com.example.v2raymanager.vpn

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class VpnRuntimeState(
    val isConnecting: Boolean = false,
    val isConnected: Boolean = false,
    val nodeName: String = "",
    val publicIp: String? = null,
    val startedAt: Long = 0L,
    val error: String? = null
)

object VpnRuntime {
    private val _state = MutableStateFlow(VpnRuntimeState())
    val state: StateFlow<VpnRuntimeState> = _state.asStateFlow()

    fun connecting(nodeName: String) {
        _state.value = VpnRuntimeState(isConnecting = true, nodeName = nodeName)
    }

    fun connected(nodeName: String, publicIp: String?) {
        _state.value = VpnRuntimeState(
            isConnected = true,
            nodeName = nodeName,
            publicIp = publicIp,
            startedAt = System.currentTimeMillis()
        )
    }

    fun failed(nodeName: String, message: String) {
        _state.value = VpnRuntimeState(nodeName = nodeName, error = message)
    }

    fun disconnected() {
        _state.value = VpnRuntimeState()
    }
}
