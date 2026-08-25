package com.example.v2raymanager

import com.example.v2raymanager.data.model.NodeParser
import com.example.v2raymanager.data.model.V2RayNode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NodeLatencyTest {

    @Test
    fun testGenerateUUID() {
        val uuid = NodeParser.generateUUID()
        assertNotNull(uuid)
        assertEquals(36, uuid.length)
    }

    @Test
    fun testVlessLinkParsing() {
        val vlessLink = "vless://de04add9-5c68-8bab-950c-08cd5320df18@example.com:443?type=ws&security=tls&path=%2Fvless#US%20Fast%20Server"
        val node = NodeParser.parseLink(vlessLink)
        assertNotNull(node)
        assertEquals("VLESS", node?.protocol)
        assertEquals("example.com", node?.address)
        assertEquals(443, node?.port)
        assertEquals("/vless", node?.path)
        assertEquals("US Fast Server", node?.name)
    }

    @Test
    fun testShareUriGeneration() {
        val node = V2RayNode(
            name = "Test Node",
            protocol = "VLESS",
            address = "1.2.3.4",
            port = 443,
            uuid = "de04add9-5c68-8bab-950c-08cd5320df18",
            network = "ws",
            path = "/vless",
            tls = "tls"
        )
        val uri = NodeParser.toShareUri(node)
        assertTrue(uri.startsWith("vless://"))
        assertTrue(uri.contains("1.2.3.4:443"))
    }
}
