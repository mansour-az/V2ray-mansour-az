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

    /**
     * v1 shipped four demonstration records that were never real Venzo service
     * credentials. Keeping them makes TCP ping look like VPN availability and
     * was one source of the old "ping works but VPN does not" behaviour.
     *
     * v3 never seeds a server. It only removes the exact legacy demo records;
     * real imported/subscription nodes are left untouched.
     */
    suspend fun checkAndSeedInitialNodes() {
        val existing = nodeDao.getAllNodes().firstOrNull().orEmpty()
        val legacyNames = setOf(
            "Doprax VMess WebSocket (Default)",
            "Doprax VLESS WebSocket TLS",
            "Cloudflare CDN Edge VMess",
            "Fast Trojan TLS Direct"
        )
        existing
            .filter { it.name in legacyNames && it.uuid == "de04add9-5c68-8bab-950c-08cd5320df18" }
            .forEach { nodeDao.deleteNode(it) }
    }
}
