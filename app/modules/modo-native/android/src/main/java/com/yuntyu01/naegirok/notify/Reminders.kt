package com.yuntyu01.naegirok.notify

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.yuntyu01.naegirok.NotesDb
import com.yuntyu01.naegirok.nativelib.R
import com.yuntyu01.naegirok.SurfaceTheme
import com.yuntyu01.naegirok.widget.NotesWidgetProvider

/**
 * 할 일 알림. remind_at은 절대 시각(epoch ms)이라 시간대가 바뀌어도 같은 순간에 울린다.
 * 정확한 알람 권한이 없으면(Android 14+ 기본) setWindow로 10분 안에 울리게 하고 앱이 그 사실을 안내한다.
 * 재부팅·시간 변경·앱 업데이트 뒤에는 BootReceiver가 다시 예약한다.
 */
object Reminders {
  const val CHANNEL = "reminders"
  private const val STORE = "naegirok_reminders"
  const val ACTION_FIRE = "com.yuntyu01.naegirok.REMIND"
  const val ACTION_DONE = "com.yuntyu01.naegirok.REMIND_DONE"
  const val EXTRA_ID = "todo_id"

  fun canExact(ctx: Context): Boolean {
    val am = ctx.getSystemService(AlarmManager::class.java)
    return Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()
  }

  /** 정확하지 않은 알람은 시각 뒤 최대 10분 안에 울린다. 그 사이 다시 예약해도 취소되지 않게 여유를 둔다. */
  private const val GRACE = 15 * 60 * 1000L

  fun scheduleAll(ctx: Context) {
    val now = System.currentTimeMillis()
    val store = ctx.getSharedPreferences(STORE, Context.MODE_PRIVATE)
    val fired = store.getStringSet("fired", emptySet()) ?: emptySet()
    // 이미 울린 알림(id@시각)은 빼고, 시각이 지났어도 아직 안 울렸으면 남겨 둔다(지난 시각이면 바로 울린다).
    val pending = (NotesDb.use(ctx) { NotesDb.pendingReminders(it, now - GRACE) } ?: emptyList())
      .filter { (todo, at) -> "${todo.id}@$at" !in fired }
    val am = ctx.getSystemService(AlarmManager::class.java)
    val before = store.getStringSet("ids", emptySet()) ?: emptySet()
    val nowIds = pending.map { it.first.id }.toSet()
    for (id in before - nowIds) am.cancel(intent(ctx, id))
    for ((todo, at) in pending) {
      val pi = intent(ctx, todo.id)
      if (canExact(ctx)) {
        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
      } else {
        am.setWindow(AlarmManager.RTC_WAKEUP, at, 10 * 60 * 1000L, pi)
      }
    }
    // 여유 시간이 지난 '울림' 기록은 더 볼 일이 없으니 정리한다.
    val keepFired = fired.filter { k -> (k.substringAfterLast('@').toLongOrNull() ?: 0) > now - GRACE }
    store.edit().putStringSet("ids", nowIds).putStringSet("fired", keepFired.toSet()).apply()
  }

  fun markFired(ctx: Context, id: String, at: Long) {
    val store = ctx.getSharedPreferences(STORE, Context.MODE_PRIVATE)
    val fired = (store.getStringSet("fired", emptySet()) ?: emptySet()) + "$id@$at"
    store.edit().putStringSet("fired", fired).apply()
  }

  fun intent(ctx: Context, id: String): PendingIntent = PendingIntent.getBroadcast(
    ctx, id.hashCode(),
    Intent(ctx, ReminderReceiver::class.java).setAction(ACTION_FIRE).putExtra(EXTRA_ID, id),
    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
  )

  fun ensureChannel(ctx: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    val nm = ctx.getSystemService(NotificationManager::class.java)
    if (nm.getNotificationChannel(CHANNEL) == null) {
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL, ctx.getString(R.string.channel_reminders), NotificationManager.IMPORTANCE_HIGH),
      )
    }
  }
}

class ReminderReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    val id = intent.getStringExtra(Reminders.EXTRA_ID) ?: return
    val pending = goAsync()
    Thread {
      try {
        when (intent.action) {
          Reminders.ACTION_FIRE -> show(ctx, id)
          Reminders.ACTION_DONE -> {
            NotesDb.write(ctx) { NotesDb.complete(it, id) }
            com.yuntyu01.naegirok.ModoEvents.dataChanged(ctx)
            NotificationManagerCompat.from(ctx).cancel(id.hashCode())
            NotesWidgetProvider.refreshAll(ctx)
            LockNotifier.refresh(ctx)
          }
        }
      } finally {
        pending.finish()
      }
    }.start()
  }

  private fun show(base: Context, id: String) {
    val ctx = com.yuntyu01.naegirok.AppLocale.wrap(base)
    // 울리는 순간 다시 확인: 그 사이 완료·삭제됐거나 알림 시각이 아직이면(다른 기기에서 미룸) 보내지 않는다.
    val now = System.currentTimeMillis()
    val found = NotesDb.use(ctx) { db ->
      NotesDb.pendingReminders(db, 0).firstOrNull { it.first.id == id } to SurfaceTheme.from(ctx, NotesDb.prefs(db))
    } ?: return
    val (hit, theme) = found
    val (todo, at) = hit ?: return
    if (at > now + 60_000) {
      Reminders.scheduleAll(ctx)
      return
    }
    Reminders.markFired(ctx, id, at)
    Reminders.ensureChannel(ctx)
    val open = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.let {
      PendingIntent.getActivity(ctx, id.hashCode(), it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val done = PendingIntent.getBroadcast(
      ctx, id.hashCode() + 1,
      Intent(ctx, ReminderReceiver::class.java).setAction(Reminders.ACTION_DONE).putExtra(Reminders.EXTRA_ID, id),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val n = NotificationCompat.Builder(ctx, Reminders.CHANNEL)
      .setSmallIcon(R.drawable.naegirok_tile)
      .setColor(theme.accent)
      .setContentTitle(ctx.getString(R.string.reminder_title))
      .setContentText(todo.text)
      .setStyle(NotificationCompat.BigTextStyle().bigText(todo.text))
      .setContentIntent(open)
      .setAutoCancel(true)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setCategory(NotificationCompat.CATEGORY_REMINDER)
      .addAction(0, ctx.getString(R.string.mark_done_short), done)
      .build()
    try {
      NotificationManagerCompat.from(ctx).notify(id.hashCode(), n)
    } catch (_: SecurityException) {
    }
  }
}

/** 재부팅·시간/시간대 변경·앱 업데이트 뒤 알람과 위젯, 잠금화면 알림을 다시 맞춘다. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    val pending = goAsync()
    Thread {
      try {
        Reminders.scheduleAll(ctx)
        LockNotifier.refresh(ctx)
        NotesWidgetProvider.refreshAll(ctx)
      } finally {
        pending.finish()
      }
    }.start()
  }
}
