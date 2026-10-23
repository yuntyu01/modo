package com.yuntyu01.naegirok

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.yuntyu01.naegirok.notify.LockNotifier
import com.yuntyu01.naegirok.notify.Reminders
import com.yuntyu01.naegirok.widget.NotesWidgetProvider

/**
 * 프로세스 사이 신호.
 * DB를 직접 여는 네이티브 부품(빠른 추가·위젯·알림)은 모두 ':native' 프로세스에서 돈다.
 * 앱(expo-sqlite)과 같은 프로세스에서 Android SQLite로 같은 파일을 열면 'SQLite 사본 두 개' 문제로
 * 파일 잠금이 풀려 오래된 값을 읽거나 DB가 손상될 수 있기 때문이다(sqlite.org/howtocorrupt.html 2.2.1).
 */
object ModoEvents {
  const val ACTION_DATA_CHANGED = "com.yuntyu01.naegirok.DATA_CHANGED"
  const val ACTION_REFRESH = "com.yuntyu01.naegirok.REFRESH"

  /** :native → 앱: DB를 바꿨으니 다시 읽어라(앱 프로세스의 모듈이 받아 JS로 이벤트를 보낸다). tables = 바꾼 표(그 표만 다시 읽는다) */
  fun dataChanged(ctx: Context, tables: List<String>? = null) {
    val intent = Intent(ACTION_DATA_CHANGED).setPackage(ctx.packageName)
    if (tables != null) intent.putStringArrayListExtra(EXTRA_TABLES, ArrayList(tables))
    ctx.sendBroadcast(intent)
  }

  /**
   * :native가 DB를 바꾼 뒤(위젯 체크·고치기·빠른 추가·알림의 완료): 앱에 알리고 위젯·잠금화면 알림·알람을 맞춘다.
   * 서버로도 바로 보낸다(앱을 열지 않아도 PC에 보이게, NotesSync)
   */
  fun afterWrite(ctx: Context, vararg tables: String) {
    dataChanged(ctx, tables.toList())
    NotesSync.request(ctx)
    refresh(ctx, tables.toList())
  }

  /** 위젯·잠금화면 알림·알람을 DB에 맞춘다. 문단(메모)만 바뀌었으면 위젯만(잠금화면 알림·알람은 할 일만 쓴다). null·빈 목록 = 전부 */
  fun refresh(ctx: Context, tables: List<String>?) {
    scheduleMidnight(ctx)
    NotesWidgetProvider.refreshAll(ctx)
    if (!tables.isNullOrEmpty() && tables.all { it == "paragraphs" }) return
    LockNotifier.refresh(ctx)
    Reminders.scheduleAll(ctx)
  }

  /**
   * 날이 바뀌면(자정 조금 뒤) 위젯·잠금화면 알림을 다시 그린다: '오늘'·'내일', 지난 날 수, 다시 올라오는 반복은 날짜로만 바뀐다.
   * 기기를 깨우지 않는 알람이라 화면이 꺼져 있으면 다음에 켤 때 그린다. 예전엔 위젯이 30분마다 기기를 깨워 다시 그렸다.
   * 새로 고칠 때마다 다시 걸고(같은 알람을 바꿔 건다), 재부팅·시간/시간대 변경 뒤에는 BootReceiver가 건다.
   */
  fun scheduleMidnight(ctx: Context) {
    val zone = java.time.ZoneId.systemDefault()
    val at = java.time.LocalDate.now(zone).plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli() + 2_000
    val pi = PendingIntent.getBroadcast(
      ctx, 0, Intent(ctx, RefreshReceiver::class.java).setAction(ACTION_MIDNIGHT),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    // set()은 시스템이 한 시간까지 미뤄, 화면을 켜 둔 채로 자정을 넘기면 '오늘'이 늦게 바뀌었다. 10분 안에
    ctx.getSystemService(AlarmManager::class.java).setWindow(AlarmManager.RTC, at, 10 * 60 * 1000L, pi)
  }

  /** 조금 뒤 위젯·알림을 다시 맞춘다(기기를 깨우지 않는 알람) */
  fun refreshLater(ctx: Context, delayMs: Long) {
    val pi = PendingIntent.getBroadcast(
      ctx, 1, Intent(ctx, RefreshReceiver::class.java).setAction(ACTION_LATER),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    ctx.getSystemService(AlarmManager::class.java).set(AlarmManager.ELAPSED_REALTIME, android.os.SystemClock.elapsedRealtime() + delayMs, pi)
  }

  const val ACTION_LATER = "com.yuntyu01.naegirok.REFRESH_LATER"
  const val ACTION_MIDNIGHT = "com.yuntyu01.naegirok.MIDNIGHT"

  /** 앱을 연다(로그인하지 않았으면 로그인 화면이 보인다) */
  fun openApp(ctx: Context) {
    val intent = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return
    ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }

  /** 앱 → :native: 위젯·잠금화면 알림·리마인더를 DB 기준으로 다시 맞춰라. tables = 바뀐 표(null·빈 목록 = 전부). */
  fun requestRefresh(ctx: Context, tables: List<String>? = null) {
    val intent = Intent(ctx, RefreshReceiver::class.java).setAction(ACTION_REFRESH)
    if (tables != null) intent.putStringArrayListExtra(EXTRA_TABLES, ArrayList(tables))
    ctx.sendBroadcast(intent)
  }

  const val EXTRA_TABLES = "tables"
}

/** ':native' 프로세스에서 위젯·알림·리마인더를 다시 맞춘다(앱이 바꿨을 때, 자정). */
class RefreshReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    // 몰려 온 요청은 한 번으로: 아직 시작하지 않은 새로 고침이 있으면 거기에 표만 더한다
    if (!Queue.add(intent.getStringArrayListExtra(ModoEvents.EXTRA_TABLES)?.takeIf { it.isNotEmpty() })) return
    Work.run(this) { ModoEvents.refresh(ctx, Queue.take()) }
  }

  /** 아직 시작하지 않은 새로 고침과 그것이 맞출 표(null = 전부) */
  private object Queue {
    private var queued = false
    private var tables: MutableSet<String>? = null

    /** 걸린 새로 고침이 없을 때만 true(새로 하나 건다) */
    @Synchronized fun add(t: List<String>?): Boolean {
      val first = !queued
      tables = if (first) t?.toMutableSet() else tables?.takeIf { t != null }?.apply { addAll(t!!) }
      queued = true
      return first
    }

    @Synchronized fun take(): List<String>? {
      queued = false
      return tables?.toList().also { tables = null }
    }
  }
}
