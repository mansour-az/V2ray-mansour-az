package com.example.v2raymanager.vpn

import com.example.v2raymanager.data.model.V2RayNode
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

object XrayConfigBuilder {

    fun build(node: V2RayNode, tunFd: Int): String {
        require(tunFd > 0) { "Invalid TUN file descriptor" }
        require(node.address.isNotBlank()) { "Server address is empty" }
        require(node.port in 1..65535) { "Invalid server port" }
        require(node.uuid.isNotBlank()) { "Credential is empty" }

        val protocol = node.protocol.lowercase()
        require(protocol in setOf("vmess", "vless", "trojan", "shadowsocks")) {
            "Unsupported protocol: ${node.protocol}"
        }
        require(node.tls.lowercase() != "reality") {
            "REALITY requires public-key/short-id fields that are not present in the current node model"
        }

        return buildJsonObject {
            putJsonObject("env") {
                put("xray.tun.fd", tunFd.toString())
            }
            putJsonObject("log") {
                put("loglevel", "warning")
            }
            putJsonObject("dns") {
                putJsonArray("servers") {
                    add(JsonPrimitive("1.1.1.1"))
                    add(JsonPrimitive("8.8.8.8"))
                }
            }
            putJsonArray("inbounds") {
                add(buildJsonObject {
                    put("tag", "venzo-tun")
                    put("port", 0)
                    put("protocol", "tun")
                    putJsonObject("settings") {
                        put("name", "venzo0")
                        put("mtu", 1500)
                    }
                })
            }
            putJsonArray("outbounds") {
                add(buildOutbound(node))
                add(buildJsonObject {
                    put("tag", "direct")
                    put("protocol", "freedom")
                })
                add(buildJsonObject {
                    put("tag", "block")
                    put("protocol", "blackhole")
                })
            }
            putJsonObject("routing") {
                put("domainStrategy", "IPIfNonMatch")
                put("rules", JsonArray(emptyList()))
            }
            putJsonObject("policy") {
                putJsonObject("system") {
                    put("statsInboundUplink", true)
                    put("statsInboundDownlink", true)
                    put("statsOutboundUplink", true)
                    put("statsOutboundDownlink", true)
                }
            }
            put("stats", JsonObject(emptyMap()))
        }.toString()
    }

    private fun buildOutbound(node: V2RayNode): JsonObject = buildJsonObject {
        val protocol = node.protocol.lowercase()
        put("tag", "proxy")
        put("protocol", protocol)

        when (protocol) {
            "vmess", "vless" -> putJsonObject("settings") {
                putJsonArray("vnext") {
                    add(buildJsonObject {
                        put("address", node.address)
                        put("port", node.port)
                        putJsonArray("users") {
                            add(buildJsonObject {
                                put("id", node.uuid)
                                if (protocol == "vmess") {
                                    put("alterId", node.alterId)
                                    put("security", node.security.ifBlank { "auto" })
                                } else {
                                    put("encryption", "none")
                                }
                            })
                        }
                    })
                }
            }

            "trojan" -> putJsonObject("settings") {
                putJsonArray("servers") {
                    add(buildJsonObject {
                        put("address", node.address)
                        put("port", node.port)
                        put("password", node.uuid)
                    })
                }
            }

            "shadowsocks" -> putJsonObject("settings") {
                putJsonArray("servers") {
                    add(buildJsonObject {
                        put("address", node.address)
                        put("port", node.port)
                        put("method", node.security.ifBlank { "aes-128-gcm" })
                        put("password", node.uuid)
                    })
                }
            }
        }

        put("streamSettings", buildStreamSettings(node))
    }

    private fun buildStreamSettings(node: V2RayNode): JsonObject = buildJsonObject {
        val network = node.network.lowercase().ifBlank { "tcp" }
        val tlsMode = node.tls.lowercase()
        put("network", network)
        put("security", if (tlsMode == "tls") "tls" else "none")

        if (tlsMode == "tls") {
            putJsonObject("tlsSettings") {
                if (node.sni.isNotBlank()) put("serverName", node.sni)
                put("allowInsecure", false)
                if (node.alpn.isNotBlank()) {
                    putJsonArray("alpn") {
                        node.alpn.split(',').map { it.trim() }.filter { it.isNotBlank() }
                            .forEach { add(JsonPrimitive(it)) }
                    }
                }
            }
        }

        when (network) {
            "ws" -> putJsonObject("wsSettings") {
                put("path", node.path.ifBlank { "/" })
                if (node.sni.isNotBlank()) {
                    putJsonObject("headers") { put("Host", node.sni) }
                }
            }
            "grpc" -> putJsonObject("grpcSettings") {
                put("serviceName", node.path.trim('/'))
            }
        }
    }
}
