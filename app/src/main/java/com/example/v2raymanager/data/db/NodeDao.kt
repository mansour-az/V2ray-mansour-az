package com.example.v2raymanager.data.db

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.example.v2raymanager.data.model.V2RayNode
import kotlinx.coroutines.flow.Flow

@Dao
interface NodeDao {
    @Query("SELECT * FROM v2ray_nodes ORDER BY isActive DESC, createdAt DESC")
    fun getAllNodes(): Flow<List<V2RayNode>>

    @Query("SELECT * FROM v2ray_nodes WHERE id = :id LIMIT 1")
    fun getNodeById(id: Int): Flow<V2RayNode?>

    @Query("SELECT * FROM v2ray_nodes WHERE isActive = 1 LIMIT 1")
    fun getActiveNode(): Flow<V2RayNode?>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertNode(node: V2RayNode): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertNodes(nodes: List<V2RayNode>)

    @Update
    suspend fun updateNode(node: V2RayNode)

    @Delete
    suspend fun deleteNode(node: V2RayNode)

    @Query("DELETE FROM v2ray_nodes WHERE id = :id")
    suspend fun deleteNodeById(id: Int)

    @Query("UPDATE v2ray_nodes SET isActive = 0")
    suspend fun clearActiveNode()

    @Query("UPDATE v2ray_nodes SET isActive = 1 WHERE id = :id")
    suspend fun setActiveNode(id: Int)

    @Query("UPDATE v2ray_nodes SET lastPingMs = :pingMs WHERE id = :id")
    suspend fun updatePing(id: Int, pingMs: Long)

    @Query("DELETE FROM v2ray_nodes")
    suspend fun deleteAllNodes()
}
