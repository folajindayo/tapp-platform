package com.usezoracle.tappmerchant.hce

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.nfc.NfcAdapter
import android.nfc.cardemulation.CardEmulation
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * JS-facing bridge for the NDEF Type 4 HCE service. The merchant app
 * calls `start(url, ttlMs)` to broadcast a checkout URL via NFC.
 *
 * Method names mirror the TS facade at `src/hce/NfcHce.ts`.
 */
class NfcHceModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "NfcHce"

  private val appContext: Context get() = reactApplicationContext

  @ReactMethod
  fun isHceSupported(promise: Promise) {
    val pm = appContext.packageManager
    val hasHce = pm.hasSystemFeature(PackageManager.FEATURE_NFC_HOST_CARD_EMULATION)
    val hasNfc = pm.hasSystemFeature(PackageManager.FEATURE_NFC) ||
      (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && pm.hasSystemFeature(PackageManager.FEATURE_NFC_ANY))
    promise.resolve(hasHce && hasNfc && NfcAdapter.getDefaultAdapter(appContext) != null)
  }

  @ReactMethod
  fun start(payloadUrl: String, ttlMs: Double, promise: Promise) {
    try {
      TappHceService.setPayload(payloadUrl)
      requestPreferredService(enable = true)
      // ttlMs is currently advisory — JS layer enforces expiry by calling stop().
      // Kept in the signature so future native scheduling stays binary-compatible.
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("HCE_START_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      TappHceService.setPayload(null)
      requestPreferredService(enable = false)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("HCE_STOP_FAILED", e.message, e)
    }
  }

  private fun requestPreferredService(enable: Boolean) {
    val activity = currentActivity ?: return
    val adapter = NfcAdapter.getDefaultAdapter(appContext) ?: return
    val emulation = CardEmulation.getInstance(adapter)
    val component = ComponentName(appContext, TappHceService::class.java)
    if (enable) {
      emulation.setPreferredService(activity, component)
    } else {
      emulation.unsetPreferredService(activity)
    }
  }
}
