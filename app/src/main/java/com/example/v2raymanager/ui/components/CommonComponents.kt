package com.example.v2raymanager.ui.components

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.v2raymanager.ui.theme.CyberCyan
import com.example.v2raymanager.ui.theme.CyberGreen
import com.example.v2raymanager.ui.theme.CyberPink
import com.example.v2raymanager.ui.theme.CyberPurple
import com.example.v2raymanager.ui.theme.CyberRed
import com.example.v2raymanager.ui.theme.CyberYellow
import com.example.v2raymanager.ui.theme.DarkBorder
import com.example.v2raymanager.ui.theme.DarkSurfaceCard
import com.example.v2raymanager.ui.theme.NeonCyan
import com.example.v2raymanager.ui.theme.TextMuted
import com.example.v2raymanager.ui.theme.TextPrimary
import com.example.v2raymanager.ui.theme.TextSecondary
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun ProtocolBadge(protocol: String, modifier: Modifier = Modifier) {
    val (bgColor, textColor) = when (protocol.uppercase()) {
        "VMESS" -> Pair(CyberPurple.copy(alpha = 0.2f), CyberPurple)
        "VLESS" -> Pair(CyberCyan.copy(alpha = 0.2f), CyberCyan)
        "TROJAN" -> Pair(CyberPink.copy(alpha = 0.2f), CyberPink)
        "SHADOWSOCKS", "SS" -> Pair(CyberYellow.copy(alpha = 0.2f), CyberYellow)
        else -> Pair(NeonCyan.copy(alpha = 0.2f), NeonCyan)
    }

    Box(
        modifier = modifier
            .clip(RoundedCornerShape(6.dp))
            .background(bgColor)
            .border(1.dp, textColor.copy(alpha = 0.4f), RoundedCornerShape(6.dp))
            .padding(horizontal = 8.dp, vertical = 3.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = protocol.uppercase(),
            color = textColor,
            style = MaterialTheme.typography.labelSmall.copy(
                fontWeight = FontWeight.Bold,
                fontSize = 10.sp
            )
        )
    }
}

@Composable
fun PingIndicator(pingMs: Long, modifier: Modifier = Modifier, onClick: (() -> Unit)? = null) {
    val (dotColor, text) = when {
        pingMs == -1L -> Pair(TextMuted, "Untested")
        pingMs == -2L -> Pair(CyberRed, "Timeout")
        pingMs < 150L -> Pair(CyberGreen, "${pingMs}ms")
        pingMs < 300L -> Pair(CyberYellow, "${pingMs}ms")
        else -> Pair(CyberRed, "${pingMs}ms")
    }

    Row(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(dotColor.copy(alpha = 0.12f))
            .then(if (onClick != null) Modifier.clickable { onClick() } else Modifier)
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        Box(
            modifier = Modifier
                .size(7.dp)
                .clip(CircleShape)
                .background(dotColor)
        )
        Text(
            text = text,
            color = dotColor,
            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold)
        )
    }
}

@Composable
fun CyberCard(
    modifier: Modifier = Modifier,
    borderColor: Color = DarkBorder,
    backgroundColor: Color = DarkSurfaceCard,
    content: @Composable () -> Unit
) {
    Surface(
        modifier = modifier
            .clip(RoundedCornerShape(16.dp))
            .border(1.dp, borderColor, RoundedCornerShape(16.dp)),
        color = backgroundColor,
        tonalElevation = 2.dp
    ) {
        Box(modifier = Modifier.padding(16.dp)) {
            content()
        }
    }
}

@Composable
fun CodeBlockWithCopy(
    title: String,
    code: String,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var copied by remember { mutableStateOf(false) }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Color(0xFF070B12))
            .border(1.dp, DarkBorder, RoundedCornerShape(12.dp))
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color(0xFF101726))
                .padding(horizontal = 12.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = title,
                color = TextSecondary,
                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold)
            )
            IconButton(
                onClick = {
                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    val clip = ClipData.newPlainText(title, code)
                    clipboard.setPrimaryClip(clip)
                    copied = true
                    Toast.makeText(context, "Copied to clipboard", Toast.LENGTH_SHORT).show()
                    scope.launch {
                        delay(2000)
                        copied = false
                    }
                },
                modifier = Modifier
                    .size(32.dp)
                    .testTag("copy_code_button")
            ) {
                Icon(
                    imageVector = if (copied) Icons.Default.Check else Icons.Default.ContentCopy,
                    contentDescription = "Copy code",
                    tint = if (copied) CyberGreen else CyberCyan,
                    modifier = Modifier.size(16.dp)
                )
            }
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp)
        ) {
            Text(
                text = code,
                color = TextPrimary,
                fontFamily = FontFamily.Monospace,
                fontSize = 12.sp,
                lineHeight = 17.sp
            )
        }
    }
}
