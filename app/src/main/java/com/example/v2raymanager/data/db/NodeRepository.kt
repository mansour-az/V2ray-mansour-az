package com.example.v2raymanager.data.db

import com.example.v2raymanager.data.model.V2RayNode
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.firstOrNull

class NodeRepository(private val nodeDao: NodeDao) {

    val allNodes: Flow<List<V2RayNode>> = nodeDao.getAllNodes()
    val activeNode: Flow<V2RayNode?> = nodeDao.getActiveNode()

    fun getNodeById(id: Int): Flow<V2RayNode?> = nodeDao.getNodeById(id)

    suspend fun insert(node: V2RayNode): Long = nodeDao.insertNode(node)

    suspend fun insertAll(nodes: List<V2RayNode>) = nodeDao.insertNodes(nodes)

    suspend fun update(node: V2RayNode) = nodeDao.updateNode(node)

    suspend fun delete(node: V2RayNode) = nodeDao.deleteNode(node)

    suspend fun deleteById(id: Int) = nodeDao.deleteNodeById(id)

    suspend fun setActive(nodeId: Int) {
        nodeDao.clearActiveNode()
        nodeDao.setActiveNode(nodeId)
    }

    suspend fun clearActive() {
        nodeDao.clearActiveNode()
    }

    suspend fun updatePing(id: Int, pingMs: Long) {
        nodeDao.updatePing(id, pingMs)
    }

    suspend fun checkAndSeedInitialNodes() {
        val existing = nodeDao.getAllNodes().firstOrNull()
        if (existing.isNullOrEmpty()) {
            val initialPresets = listOf(
                V2RayNode(
                    name = "Doprax VMess WebSocket (Default)",
                    protocol = "VMess",
                    address = "doprax.hicairo.com",
                    port = 443,
                    uuid = "de04add9-5c68-8bab-950c-08cd5320df18",
                    alterId = 0,
                    security = "auto",
                    network = "ws",
                    path = "/vmess",
                    tls = "tls",
                    sni = "doprax.hicairo.com",
                    isActive = true
                ),
                V2RayNode(
                    name = "Doprax VLESS WebSocket TLS",
                    protocol = "VLESS",
                    address = "doprax.hicairo.com",
                    port = 443,
                    uuid = "de04add9-5c68-8bab-950c-08cd5320df18",
                    alterId = 0,
                    security = "none",
                    network = "ws",
                    path = "/vless",
                    tls = "tls",
                    sni = "doprax.hicairo.com",
                    isActive = false
                ),
                V2RayNode(
                    name = "Cloudflare CDN Edge VMess",
                    protocol = "VMess",
                    address = "104.16.1.1",
                    port = 443,
                    uuid = "de04add9-5c68-8bab-950c-08cd5320df18",
                    alterId = 0,
                    security = "auto",
                    network = "ws",
                    path = "/vmess",
                    tls = "tls",
                    sni = "free.doprax.rocks",
                    isActive = false
                ),
                V2RayNode(
                    name = "Fast Trojan TLS Direct",
                    protocol = "Trojan",
                    address = "node-us.v2ray.network",
                    port = 443,
                    uuid = "de04add9-5c68-8bab-950c-08cd5320df18",
                    security = "tls",
                    network = "tcp",
                    path = "",
                    tls = "tls",
                    sni = "node-us.v2ray.network",
                    isActive = false
                )
            )
            nodeDao.insertNodes(initialPresets)
        }
    }
}
