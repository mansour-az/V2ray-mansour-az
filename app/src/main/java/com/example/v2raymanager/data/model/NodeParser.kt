package com.example.v2raymanager.data.model

import android.util.Base64
import org.json.JSONObject
import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.UUID

object NodeParser {

    fun generateUUID(): String {
        return UUID.randomUUID().toString()
    }

    /**
     * Parses a V2Ray link (vless://, vmess://, trojan://, ss://) into a V2RayNode
     */
    fun parseLink(link: String): V2RayNode? {
        val trimmed = link.trim()
        return try {
            when {
                trimmed.startsWith("vless://", ignoreCase = true) -> parseVless(trimmed)
                trimmed.startsWith("vmess://", ignoreCase = true) -> parseVmess(trimmed)
                trimmed.startsWith("trojan://", ignoreCase = true) -> parseTrojan(trimmed)
                else -> null
            }
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }

    private fun parseVless(link: String): V2RayNode {
        // format: vless://uuid@host:port?params#name
        val uri = URI(link)
        val uuid = uri.userInfo ?: ""
        val host = uri.host ?: "127.0.0.1"
        val port = if (uri.port != -1) uri.port else 443
        val rawFragment = uri.rawFragment ?: "VLESS Node"
        val name = try { URLDecoder.decode(rawFragment, "UTF-8") } catch (e: Exception) { rawFragment }

        val queryParams = parseQueryParams(uri.rawQuery ?: "")
        val type = queryParams["type"] ?: "ws"
        val security = queryParams["security"] ?: "tls"
        val rawPath = queryParams["path"] ?: "/vless"
        val path = try { URLDecoder.decode(rawPath, "UTF-8") } catch (e: Exception) { rawPath }
        val sni = queryParams["sni"] ?: queryParams["host"] ?: ""
        val alpn = queryParams["alpn"] ?: ""

        return V2RayNode(
            name = name,
            protocol = "VLESS",
            address = host,
            port = port,
            uuid = uuid,
            security = "none",
            network = type,
            path = path,
            tls = security,
            sni = sni,
            alpn = alpn
        )
    }

    private fun parseVmess(link: String): V2RayNode {
        val base64Data = link.substring(8).trim()
        val decodedBytes = Base64.decode(base64Data, Base64.DEFAULT)
        val jsonStr = String(decodedBytes, StandardCharsets.UTF_8)
        val json = JSONObject(jsonStr)

        val name = json.optString("ps", "VMess Node")
        val address = json.optString("add", "127.0.0.1")
        val port = json.optInt("port", 443)
        val uuid = json.optString("id", "")
        val alterId = json.optInt("aid", 0)
        val security = json.optString("scy", "auto")
        val network = json.optString("net", "ws")
        val path = json.optString("path", "/vmess")
        val tls = json.optString("tls", "tls")
        val sni = json.optString("sni", json.optString("host", ""))
        val alpn = json.optString("alpn", "")

        return V2RayNode(
            name = name,
            protocol = "VMess",
            address = address,
            port = port,
            uuid = uuid,
            alterId = alterId,
            security = security,
            network = network,
            path = path,
            tls = tls,
            sni = sni,
            alpn = alpn
        )
    }

    private fun parseTrojan(link: String): V2RayNode {
        val uri = URI(link)
        val password = uri.userInfo ?: ""
        val host = uri.host ?: "127.0.0.1"
        val port = if (uri.port != -1) uri.port else 443
        val rawFragment = uri.rawFragment ?: "Trojan Node"
        val name = try { URLDecoder.decode(rawFragment, "UTF-8") } catch (e: Exception) { rawFragment }

        val queryParams = parseQueryParams(uri.rawQuery ?: "")
        val type = queryParams["type"] ?: "tcp"
        val sni = queryParams["sni"] ?: ""

        return V2RayNode(
            name = name,
            protocol = "Trojan",
            address = host,
            port = port,
            uuid = password,
            security = "tls",
            network = type,
            path = queryParams["path"] ?: "",
            tls = "tls",
            sni = sni
        )
    }

    private fun parseQueryParams(query: String): Map<String, String> {
        val map = mutableMapOf<String, String>()
        if (query.isBlank()) return map
        val pairs = query.split("&")
        for (pair in pairs) {
            val idx = pair.indexOf("=")
            if (idx > 0 && idx < pair.length - 1) {
                val key = pair.substring(0, idx)
                val value = pair.substring(idx + 1)
                map[key] = value
            }
        }
        return map
    }

    fun toShareUri(node: V2RayNode): String {
        return when (node.protocol.uppercase()) {
            "VLESS" -> {
                val encodedPath = try { URLEncoder.encode(node.path, "UTF-8") } catch (e: Exception) { node.path }
                val encodedName = try { URLEncoder.encode(node.name, "UTF-8") } catch (e: Exception) { node.name }
                val sniParam = if (node.sni.isNotBlank()) "&sni=${node.sni}" else ""
                "vless://${node.uuid}@${node.address}:${node.port}?encryption=none&security=${node.tls}&type=${node.network}&path=$encodedPath$sniParam#$encodedName"
            }
            "VMESS" -> {
                val json = JSONObject().apply {
                    put("v", "2")
                    put("ps", node.name)
                    put("add", node.address)
                    put("port", node.port.toString())
                    put("id", node.uuid)
                    put("aid", node.alterId.toString())
                    put("scy", node.security)
                    put("net", node.network)
                    put("type", "none")
                    put("host", node.sni)
                    put("path", node.path)
                    put("tls", node.tls)
                    put("sni", node.sni)
                    put("alpn", node.alpn)
                }
                val encoded = Base64.encodeToString(json.toString().toByteArray(StandardCharsets.UTF_8), Base64.NO_WRAP)
                "vmess://$encoded"
            }
            "TROJAN" -> {
                val encodedName = try { URLEncoder.encode(node.name, "UTF-8") } catch (e: Exception) { node.name }
                "trojan://${node.uuid}@${node.address}:${node.port}?security=${node.tls}&type=${node.network}#$encodedName"
            }
            else -> {
                "vless://${node.uuid}@${node.address}:${node.port}#${node.name}"
            }
        }
    }

    fun generateClientJson(node: V2RayNode): String {
        val isVless = node.protocol.equals("VLESS", ignoreCase = true)
        val isVmess = node.protocol.equals("VMESS", ignoreCase = true)

        val outboundProtocol = if (isVless) "vless" else if (isVmess) "vmess" else "trojan"
        val serverObj = JSONObject().apply {
            put("address", node.address)
            put("port", node.port)
            val userObj = JSONObject().apply {
                put("id", node.uuid)
                if (isVmess) {
                    put("alterId", node.alterId)
                    put("security", node.security)
                } else if (isVless) {
                    put("encryption", "none")
                }
            }
            put("users", org.json.JSONArray().apply { put(userObj) })
        }

        val streamSettings = JSONObject().apply {
            put("network", node.network)
            put("security", node.tls)
            if (node.tls == "tls") {
                put("tlsSettings", JSONObject().apply {
                    put("serverName", if (node.sni.isNotBlank()) node.sni else node.address)
                    put("allowInsecure", false)
                })
            }
            if (node.network == "ws") {
                put("wsSettings", JSONObject().apply {
                    put("path", node.path)
                    put("headers", JSONObject().apply {
                        put("Host", if (node.sni.isNotBlank()) node.sni else node.address)
                    })
                })
            }
        }

        val clientConfig = JSONObject().apply {
            put("log", JSONObject().apply {
                put("loglevel", "warning")
            })
            put("inbounds", org.json.JSONArray().apply {
                put(JSONObject().apply {
                    put("port", 10808)
                    put("listen", "127.0.0.1")
                    put("protocol", "socks")
                    put("settings", JSONObject().apply {
                        put("auth", "noauth")
                        put("udp", true)
                    })
                })
                put(JSONObject().apply {
                    put("port", 10809)
                    put("listen", "127.0.0.1")
                    put("protocol", "http")
                })
            })
            put("outbounds", org.json.JSONArray().apply {
                put(JSONObject().apply {
                    put("protocol", outboundProtocol)
                    put("settings", JSONObject().apply {
                        put("vnext", org.json.JSONArray().apply { put(serverObj) })
                    })
                    put("streamSettings", streamSettings)
                    put("tag", "proxy")
                })
                put(JSONObject().apply {
                    put("protocol", "freedom")
                    put("tag", "direct")
                })
                put(JSONObject().apply {
                    put("protocol", "blackhole")
                    put("tag", "block")
                })
            })
            put("dns", JSONObject().apply {
                put("servers", org.json.JSONArray().apply {
                    put("8.8.8.8")
                    put("1.1.1.1")
                    put("localhost")
                })
            })
        }

        return clientConfig.toString(2)
    }

    fun generateDopraxServerConfig(uuid: String, vmessPath: String, vlessPath: String): String {
        return """
{
  "log": {
    "access": "/dev/null",
    "error": "/dev/null",
    "loglevel": "warning"
  },
  "inbounds": [
    {
      "port": 10000,
      "listen": "127.0.0.1",
      "protocol": "vmess",
      "settings": {
        "clients": [
          {
            "id": "$uuid",
            "alterId": 0
          }
        ]
      },
      "streamSettings": {
        "network": "ws",
        "wsSettings": {
          "path": "$vmessPath"
        }
      }
    },
    {
      "port": 20000,
      "listen": "127.0.0.1",
      "protocol": "vless",
      "settings": {
        "clients": [
          {
            "id": "$uuid"
          }
        ],
        "decryption": "none"
      },
      "streamSettings": {
        "network": "ws",
        "wsSettings": {
          "path": "$vlessPath"
        }
      }
    }
  ],
  "outbounds": [
    {
      "protocol": "freedom",
      "settings": {}
    }
  ],
  "dns": {
    "server": [
      "8.8.8.8",
      "8.8.4.4",
      "localhost"
    ]
  }
}
        """.trimIndent()
    }

    fun generateDopraxDockerfile(uuid: String, vmessPath: String, vlessPath: String): String {
        return """
FROM nginx:mainline-alpine-slim
EXPOSE 80
USER root

RUN apk update && apk add --no-cache supervisor wget unzip curl

ENV UUID $uuid
ENV VMESS_WSPATH $vmessPath
ENV VLESS_WSPATH $vlessPath

COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY nginx.conf /etc/nginx/nginx.conf

RUN mkdir /etc/v2ray /usr/local/v2ray
COPY config.json /etc/v2ray/
COPY entrypoint.sh /usr/local/v2ray/

RUN wget -q -O /tmp/v2ray-linux-64.zip https://github.com/v2fly/v2ray-core/releases/download/v4.45.0/v2ray-linux-64.zip && \
    unzip -d /usr/local/v2ray /tmp/v2ray-linux-64.zip v2ray && \
    wget -q -O /usr/local/v2ray/geosite.dat https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat && \
    wget -q -O /usr/local/v2ray/geoip.dat https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat && \
    chmod a+x /usr/local/v2ray/entrypoint.sh && \
    apk del wget unzip && \
    rm -rf /tmp/v2ray-linux-64.zip /var/cache/apk/* /tmp/*

ENTRYPOINT [ "/usr/local/v2ray/entrypoint.sh" ]
        """.trimIndent()
    }

    fun generateNginxConf(vmessPath: String, vlessPath: String): String {
        return """
user  nginx;
worker_processes  auto;

error_log  /var/log/nginx/error.log notice;
pid        /var/run/nginx.pid;

events {
    worker_connections  1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    log_format  main  '${'$'}remote_addr - ${'$'}remote_user [${'$'}time_local] "${'$'}request" '
                      '${'$'}status ${'$'}body_bytes_sent "${'$'}http_referer" '
                      '"${'$'}http_user_agent" "${'$'}http_x_forwarded_for"';

    access_log  /var/log/nginx/access.log  main;
    sendfile        on;
    keepalive_timeout  65;

    server {
        listen 80;
        server_name localhost;

        location / {
            root   /usr/share/nginx/html;
            index  index.html index.htm;
        }

        location $vmessPath {
            proxy_redirect off;
            proxy_pass http://127.0.0.1:10000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade ${'$'}http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host ${'$'}http_host;
            proxy_read_timeout 300s;
        }

        location $vlessPath {
            proxy_redirect off;
            proxy_pass http://127.0.0.1:20000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade ${'$'}http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host ${'$'}http_host;
            proxy_read_timeout 300s;
        }
    }
}
        """.trimIndent()
    }
}
