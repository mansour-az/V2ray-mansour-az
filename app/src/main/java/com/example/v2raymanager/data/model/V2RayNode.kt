package com.example.v2raymanager.data.model

import androidx.room.Entity
import androidx.room.PrimaryKey
import kotlinx.serialization.Serializable

@Serializable
@Entity(tableName = "v2ray_nodes")
data class V2RayNode(
    @PrimaryKey(autoGenerate = true)
    val id: Int = 0,
    val name: String,
    val protocol: String = "VMess", // VMess, VLESS, Trojan, Shadowsocks
    val address: String = "127.0.0.1",
    val port: Int = 443,
    val uuid: String = "de04add9-5c68-8bab-950c-08cd5320df18",
    val alterId: Int = 0,
    val security: String = "auto", // auto, none, aes-128-gcm, chacha20-poly1305
    val network: String = "ws", // ws, tcp, grpc, http
    val path: String = "/vmess",
    val tls: String = "tls", // tls, none, reality
    val sni: String = "",
    val alpn: String = "",
    val lastPingMs: Long = -1L, // -1: untested, -2: timeout/error, >0: latency in ms
    val isActive: Boolean = false,
    val createdAt: Long = System.currentTimeMillis()
)
