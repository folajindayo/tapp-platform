package com.usezoracle.tappmerchant.hce

import android.content.Intent
import android.nfc.cardemulation.HostApduService
import android.os.Bundle
import android.util.Log

/**
 * Emulates an NFC Forum Type 4 Tag exposing a single NDEF URI record.
 *
 * The payload (a Zoracle checkout URL) is set at runtime via
 * [setPayload] — the React Native bridge calls into here when the
 * merchant taps "broadcast".
 *
 * Type 4 Tag spec used:
 *  - SELECT AID                → 90 00
 *  - SELECT CC (e1 03)         → 90 00
 *  - READ_BINARY CC (15 bytes) → CC + 90 00
 *  - SELECT NDEF (e1 04)       → 90 00
 *  - READ_BINARY NDEF length   → 2-byte BE length + 90 00
 *  - READ_BINARY NDEF data     → bytes + 90 00
 */
class TappHceService : HostApduService() {

  private enum class Selected { NONE, CC, NDEF }
  private var selected: Selected = Selected.NONE

  override fun onCreate() {
    super.onCreate()
    Log.d(TAG, "TappHceService onCreate")
  }

  override fun processCommandApdu(commandApdu: ByteArray?, extras: Bundle?): ByteArray {
    if (commandApdu == null) return SW_FAILURE
    Log.d(TAG, "APDU in: ${commandApdu.toHex()}")

    return when {
      // SELECT AID (NDEF tag application)
      commandApdu.startsWith(SELECT_AID_HEADER) -> {
        selected = Selected.NONE
        SW_OK
      }
      // SELECT FILE CC (e1 03)
      commandApdu.startsWith(SELECT_CC_FILE) -> {
        selected = Selected.CC
        SW_OK
      }
      // SELECT FILE NDEF (e1 04)
      commandApdu.startsWith(SELECT_NDEF_FILE) -> {
        selected = Selected.NDEF
        SW_OK
      }
      // READ_BINARY
      commandApdu.size >= 5 && commandApdu[0] == 0x00.toByte() && commandApdu[1] == 0xB0.toByte() -> {
        readBinary(commandApdu)
      }
      else -> SW_FAILURE
    }
  }

  private fun readBinary(apdu: ByteArray): ByteArray {
    val offset = ((apdu[2].toInt() and 0xFF) shl 8) or (apdu[3].toInt() and 0xFF)
    val length = apdu[4].toInt() and 0xFF
    return when (selected) {
      Selected.CC -> sliceWithStatus(ccFile(), offset, length)
      Selected.NDEF -> sliceWithStatus(ndefFile(), offset, length)
      else -> SW_FAILURE
    }
  }

  private fun ccFile(): ByteArray {
    // Capability Container, 15 bytes per NFC Forum Type 4 Tag v3.0.
    val ndefMaxLen = MAX_NDEF_LEN
    return byteArrayOf(
      0x00, 0x0F,                         // CCLEN
      0x20,                               // Mapping version 2.0
      0x00, 0x3B,                         // MLe (max R-APDU)
      0x00, 0x34,                         // MLc (max C-APDU)
      0x04, 0x06,                         // NDEF File Control TLV: T=4, L=6
      0xE1.toByte(), 0x04,                // NDEF file id
      (ndefMaxLen shr 8).toByte(),
      (ndefMaxLen and 0xFF).toByte(),     // Max NDEF size
      0x00,                               // Read access (granted)
      0xFF.toByte()                       // Write access (denied)
    )
  }

  private fun ndefFile(): ByteArray {
    val payload = currentPayload()
    val ndef = buildNdefUri(payload)
    val len = ndef.size
    return byteArrayOf(
      (len shr 8).toByte(),
      (len and 0xFF).toByte()
    ) + ndef
  }

  private fun currentPayload(): String = synchronized(LOCK) { payloadUrl ?: DEFAULT_PAYLOAD }

  override fun onDeactivated(reason: Int) {
    Log.d(TAG, "onDeactivated reason=$reason")
    selected = Selected.NONE
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    return super.onStartCommand(intent, flags, startId)
  }

  companion object {
    private const val TAG = "TappHceService"
    private const val MAX_NDEF_LEN = 0x7FFF
    private const val DEFAULT_PAYLOAD = "https://checkout.zoracle.com"

    private val SW_OK = byteArrayOf(0x90.toByte(), 0x00)
    private val SW_FAILURE = byteArrayOf(0x6A.toByte(), 0x82.toByte())

    private val SELECT_AID_HEADER = byteArrayOf(
      0x00, 0xA4.toByte(), 0x04, 0x00, 0x07,
      0xD2.toByte(), 0x76.toByte(), 0x00, 0x00,
      0x85.toByte(), 0x01, 0x01
    )
    private val SELECT_CC_FILE = byteArrayOf(
      0x00, 0xA4.toByte(), 0x00, 0x0C, 0x02, 0xE1.toByte(), 0x03
    )
    private val SELECT_NDEF_FILE = byteArrayOf(
      0x00, 0xA4.toByte(), 0x00, 0x0C, 0x02, 0xE1.toByte(), 0x04
    )

    private val LOCK = Any()
    private var payloadUrl: String? = null

    fun setPayload(url: String?) = synchronized(LOCK) { payloadUrl = url }

    private fun sliceWithStatus(file: ByteArray, offset: Int, length: Int): ByteArray {
      if (offset < 0 || offset > file.size) return SW_FAILURE
      val end = minOf(offset + length, file.size)
      val chunk = file.copyOfRange(offset, end)
      return chunk + SW_OK
    }

    private fun ByteArray.startsWith(prefix: ByteArray): Boolean {
      if (size < prefix.size) return false
      for (i in prefix.indices) {
        if (this[i] != prefix[i]) return false
      }
      return true
    }

    private fun ByteArray.toHex(): String =
      joinToString(" ") { "%02X".format(it.toInt() and 0xFF) }

    private fun buildNdefUri(url: String): ByteArray {
      val (idCode, rest) = compressUri(url)
      val payload = byteArrayOf(idCode) + rest.toByteArray(Charsets.UTF_8)
      val payloadLen = payload.size

      return if (payloadLen < 256) {
        // Short Record
        byteArrayOf(
          0xD1.toByte(),         // MB=1, ME=1, CF=0, SR=1, IL=0, TNF=001
          0x01,                  // type length
          payloadLen.toByte(),
          0x55                   // 'U' (URI)
        ) + payload
      } else {
        byteArrayOf(
          0xC1.toByte(),         // MB=1, ME=1, CF=0, SR=0, IL=0, TNF=001
          0x01,
          ((payloadLen shr 24) and 0xFF).toByte(),
          ((payloadLen shr 16) and 0xFF).toByte(),
          ((payloadLen shr 8) and 0xFF).toByte(),
          (payloadLen and 0xFF).toByte(),
          0x55
        ) + payload
      }
    }

    /** URI identifier codes per NFC Forum URI RTD 1.0 §3.2.2. */
    private fun compressUri(url: String): Pair<Byte, String> {
      val prefixes = listOf(
        0x01 to "http://www.",
        0x02 to "https://www.",
        0x03 to "http://",
        0x04 to "https://",
      )
      for ((code, prefix) in prefixes) {
        if (url.startsWith(prefix)) return code.toByte() to url.substring(prefix.length)
      }
      return 0x00.toByte() to url
    }
  }
}
