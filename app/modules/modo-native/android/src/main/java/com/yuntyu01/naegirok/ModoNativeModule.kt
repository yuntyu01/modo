package com.yuntyu01.naegirok

import com.yuntyu01.naegirok.nativelib.R
import android.app.StatusBarManager
import android.content.BroadcastReceiver
import android.content.IntentFilter
import androidx.core.content.ContextCompat
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import com.yuntyu01.naegirok.notify.Reminders
import com.yuntyu01.naegirok.widget.NotesWidgetProvider
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JS(src/native/bridge.ts) 계약. 실제 일은 위젯·알림 클래스가 하고 여기선 연결만 한다. */
class ModoNativeModule : Module() {
  private val ctx: Context
    get() = appContext.reactContext ?: throw CodedException("ERR_NO_CONTEXT", "React context is not available", null)

  override fun definition() = ModuleDefinition {
    Name("ModoNative")

    Events("onDataChanged")

    // :native 프로세스가 DB를 바꾸면 알려 온다 → JS가 다시 읽는다.
    OnCreate {
      val c = appContext.reactContext ?: return@OnCreate
      val r = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) = sendEvent("onDataChanged", emptyMap<String, Any>())
      }
      ContextCompat.registerReceiver(c, r, IntentFilter(ModoEvents.ACTION_DATA_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED)
      receiver = r
      ModoEvents.requestRefresh(c)
    }
    OnDestroy {
      receiver?.let { r -> runCatching { appContext.reactContext?.unregisterReceiver(r) } }
      receiver = null
    }

    // 앱 프로세스에서는 DB를 직접 열지 않는다(위 ModoEvents 설명). 갱신은 :native에 맡긴다.
    AsyncFunction("refresh") { ModoEvents.requestRefresh(ctx) }

    // null means Talk is unavailable: JS keeps the existing browser/PKCE flow.
    AsyncFunction("loginWithKakaoTalk") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("ERR_KAKAO_UNAVAILABLE", "No foreground activity", null)
      } else {
        activity.runOnUiThread { KakaoTalkLogin.start(activity, promise) }
      }
    }

    AsyncFunction("requestPinWidget") {
      val mgr = AppWidgetManager.getInstance(ctx)
      if (Build.VERSION.SDK_INT < 26 || !mgr.isRequestPinAppWidgetSupported) return@AsyncFunction false
      mgr.requestPinAppWidget(ComponentName(ctx, NotesWidgetProvider::class.java), null, null)
    }

    AsyncFunction("requestAddTile") { promise: Promise ->
      if (Build.VERSION.SDK_INT < 33) return@AsyncFunction promise.resolve("unsupported")
      val sbm = ctx.getSystemService(StatusBarManager::class.java)
      sbm.requestAddTileService(
        ComponentName(ctx, QuickAddTileService::class.java),
        ctx.getString(R.string.tile_label),
        Icon.createWithResource(ctx, R.drawable.naegirok_tile),
        ctx.mainExecutor,
      ) { result ->
        promise.resolve(
          when (result) {
            StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED -> "added"
            StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED -> "already"
            StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_NOT_ADDED -> "dismissed"
            else -> "unsupported"
          },
        )
      }
    }

    /**
     * 잠금화면 위젯 지원 여부. 공개 API로 확실히 알 수 없어 알려진 경우만 '지원'으로 본다:
     * Android 4.2~4.4(키가드 위젯), Android 15+ 태블릿(잠금화면 위젯 허브). 휴대폰은 대부분 미지원.
     */
    AsyncFunction("lockScreenWidgetSupport") {
      val tablet = ctx.resources.configuration.smallestScreenWidthDp >= 600
      // Android 16 QPR2(SDK 36.1)부터 휴대폰도 잠금화면 위젯(잠금화면을 옆으로 밀면 나오는 위젯 화면)이 생겼다.
      // 켜는 메뉴는 제조사가 열어 줘야 해서(Pixel 등) 앱이 확실히 알 수 없다 → 'maybe'로 안내한다.
      val full = runCatching { Build.VERSION::class.java.getField("SDK_INT_FULL").getInt(null) }.getOrDefault(Build.VERSION.SDK_INT * 100_000)
      when {
        Build.VERSION.SDK_INT in 17..20 -> mapOf("supported" to true, "maybe" to false, "reason" to "Android ${Build.VERSION.RELEASE}")
        Build.VERSION.SDK_INT >= 35 && tablet -> mapOf("supported" to true, "maybe" to false, "reason" to "Android ${Build.VERSION.RELEASE} · tablet")
        full >= 36 * 100_000 + 1 -> mapOf("supported" to true, "maybe" to true, "reason" to "Android ${Build.VERSION.RELEASE} QPR2+")
        else -> mapOf("supported" to false, "maybe" to false, "reason" to "Android ${Build.VERSION.RELEASE}${if (tablet) " · tablet" else ""}")
      }
    }

    AsyncFunction("notificationPermission") {
      if (NotificationManagerCompat.from(ctx).areNotificationsEnabled()) "granted" else "denied"
    }

    AsyncFunction("canScheduleExactAlarms") { Reminders.canExact(ctx) }

    AsyncFunction("openExactAlarmSettings") {
      if (Build.VERSION.SDK_INT >= 31) {
        ctx.startActivity(
          Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${ctx.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
      }
    }
  }

  private var receiver: BroadcastReceiver? = null
}
