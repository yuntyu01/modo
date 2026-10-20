package com.yuntyu01.naegirok

import com.yuntyu01.naegirok.nativelib.R
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.IntentFilter
import androidx.core.content.ContextCompat
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import com.yuntyu01.naegirok.notify.Reminders
import com.yuntyu01.naegirok.widget.NotesWidgetProvider
import com.yuntyu01.naegirok.widget.NotesWidgetProvider4x4
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JS(src/native/bridge.ts) 계약. 실제 일은 위젯·알림 클래스가 하고 여기선 연결만 한다. */
class ModoNativeModule : Module() {
  private companion object {
    const val PERMS = "naegirok_permissions"
    // 위젯이 홈 화면에 실제로 놓였을 때 런처가 보내 주는 알림(requestPinWidget)
    const val ACTION_WIDGET_PINNED = "com.yuntyu01.naegirok.WIDGET_PINNED"
  }

  private val ctx: Context
    get() = appContext.reactContext ?: throw CodedException("ERR_NO_CONTEXT", "React context is not available", null)

  override fun definition() = ModuleDefinition {
    Name("ModoNative")

    Events("onDataChanged")

    // :native 프로세스가 DB를 바꾸면 알려 온다 → JS가 다시 읽는다.
    OnCreate {
      val c = appContext.reactContext ?: return@OnCreate
      val r = object : BroadcastReceiver() {
        // 바꾼 표를 함께 보내 앱이 그 표만 다시 읽게 한다(예전엔 위젯에서 체크 하나에도 모든 표를 다시 읽었다)
        override fun onReceive(context: Context, intent: Intent) {
          val tables = intent.getStringArrayListExtra(ModoEvents.EXTRA_TABLES)
          sendEvent("onDataChanged", if (tables != null) mapOf("tables" to tables) else emptyMap<String, Any>())
        }
      }
      ContextCompat.registerReceiver(c, r, IntentFilter(ModoEvents.ACTION_DATA_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED)
      receiver = r
      // 위젯을 놓았으면 앱을 내리고 홈 화면으로 가서 방금 놓인 위젯을 보여 준다(사용자 요청 2026-10-19)
      val p = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
          val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          runCatching { (appContext.currentActivity ?: context).startActivity(home) }
        }
      }
      ContextCompat.registerReceiver(c, p, IntentFilter(ACTION_WIDGET_PINNED), ContextCompat.RECEIVER_NOT_EXPORTED)
      pinnedReceiver = p
      ModoEvents.requestRefresh(c)
    }
    OnDestroy {
      receiver?.let { r -> runCatching { appContext.reactContext?.unregisterReceiver(r) } }
      receiver = null
      pinnedReceiver?.let { r -> runCatching { appContext.reactContext?.unregisterReceiver(r) } }
      pinnedReceiver = null
    }

    // 앱 프로세스에서는 DB를 직접 열지 않는다(위 ModoEvents 설명). 갱신은 :native에 맡긴다.
    AsyncFunction("refresh") { tables: List<String>? -> ModoEvents.requestRefresh(ctx, tables) }

    // null means Talk is unavailable: JS keeps the existing browser/PKCE flow.
    AsyncFunction("loginWithKakaoTalk") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("ERR_KAKAO_UNAVAILABLE", "No foreground activity", null)
      } else {
        activity.runOnUiThread { KakaoTalkLogin.start(activity, promise) }
      }
    }

    // size: '3x3'(기본) | '4x4' — 그 크기로 놓이는 위젯(WidgetSizes.kt)
    AsyncFunction("requestPinWidget") { size: String? ->
      val mgr = AppWidgetManager.getInstance(ctx)
      if (Build.VERSION.SDK_INT < 26 || !mgr.isRequestPinAppWidgetSupported) return@AsyncFunction false
      // 사용자가 '추가'를 눌러 위젯이 놓이면 런처가 이 알림을 보낸다(취소하면 오지 않는다)
      val pinned = Intent(ACTION_WIDGET_PINNED).setPackage(ctx.packageName)
      val callback = PendingIntent.getBroadcast(ctx, 0, pinned, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      val provider = if (size == "4x4") NotesWidgetProvider4x4::class.java else NotesWidgetProvider::class.java
      mgr.requestPinAppWidget(ComponentName(ctx, provider), null, callback)
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

    // Android 13+는 묻기 전에도 알림이 꺼져 있다. 앱이 아직 묻지 않았으면 'undetermined'로(꺼져 있다는 경고 대신 저장할 때 묻는다)
    AsyncFunction("notificationPermission") {
      when {
        NotificationManagerCompat.from(ctx).areNotificationsEnabled() -> "granted"
        Build.VERSION.SDK_INT >= 33 && !ctx.getSharedPreferences(PERMS, Context.MODE_PRIVATE).getBoolean("notifAsked", false) -> "undetermined"
        else -> "denied"
      }
    }

    AsyncFunction("markNotificationAsked") {
      ctx.getSharedPreferences(PERMS, Context.MODE_PRIVATE).edit().putBoolean("notifAsked", true).apply()
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
  private var pinnedReceiver: BroadcastReceiver? = null
}
