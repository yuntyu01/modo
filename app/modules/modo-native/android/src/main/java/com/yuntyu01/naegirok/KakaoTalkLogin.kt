package com.yuntyu01.naegirok

import android.app.Activity
import android.content.pm.PackageManager
import com.kakao.sdk.auth.TokenManagerProvider
import com.kakao.sdk.common.KakaoSdk
import com.kakao.sdk.common.model.ClientError
import com.kakao.sdk.common.model.ClientErrorCause
import com.kakao.sdk.user.UserApiClient
import expo.modules.kotlin.Promise
import java.util.concurrent.atomic.AtomicBoolean

/** Uses only Kakao's login module. Provider tokens never go into modo's database/logs. */
object KakaoTalkLogin {
  private val busy = AtomicBoolean(false)

  fun start(activity: Activity, promise: Promise) {
    if (!busy.compareAndSet(false, true)) {
      promise.reject("ERR_KAKAO_BUSY", "Login already in progress", null)
      return
    }
    try {
      val info = activity.packageManager.getApplicationInfo(activity.packageName, PackageManager.GET_META_DATA)
      val key = info.metaData?.getString("modo.kakao.native_app_key")
      if (key.isNullOrBlank()) {
        busy.set(false)
        promise.resolve(null)
        return
      }
      KakaoSdk.init(activity.applicationContext, key)
      if (!UserApiClient.instance.isKakaoTalkLoginAvailable(activity)) {
        busy.set(false)
        promise.resolve(null)
        return
      }
      UserApiClient.instance.loginWithKakaoTalk(activity) { token, error ->
        // modo only needs this token once to obtain its own PKCE-bound login code.
        TokenManagerProvider.instance.manager.clear()
        busy.set(false)
        when {
          error is ClientError && error.reason == ClientErrorCause.Cancelled ->
            promise.reject("ERR_KAKAO_CANCELLED", "Login cancelled", null)
          error != null || token == null ->
            promise.reject("ERR_KAKAO_FAILED", "Kakao Talk login failed", null)
          else -> promise.resolve(token.accessToken)
        }
      }
    } catch (_: Exception) {
      busy.set(false)
      promise.reject("ERR_KAKAO_FAILED", "Kakao Talk login failed", null)
    }
  }
}
