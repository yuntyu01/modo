package com.yuntyu01.naegirok

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

  /** :native → 앱: DB를 바꿨으니 다시 읽어라(앱 프로세스의 모듈이 받아 JS로 이벤트를 보낸다). */
  fun dataChanged(ctx: Context) {
    ctx.sendBroadcast(Intent(ACTION_DATA_CHANGED).setPackage(ctx.packageName))
  }

  /** 앱 → :native: 위젯·잠금화면 알림·리마인더를 DB 기준으로 다시 맞춰라. */
  fun requestRefresh(ctx: Context) {
    ctx.sendBroadcast(Intent(ctx, RefreshReceiver::class.java).setAction(ACTION_REFRESH))
  }
}

/** ':native' 프로세스에서 위젯·알림·리마인더를 다시 맞춘다. */
class RefreshReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    val pending = goAsync()
    Thread {
      try {
        NotesWidgetProvider.refreshAll(ctx)
        LockNotifier.refresh(ctx)
        Reminders.scheduleAll(ctx)
      } finally {
        pending.finish()
      }
    }.start()
  }
}
