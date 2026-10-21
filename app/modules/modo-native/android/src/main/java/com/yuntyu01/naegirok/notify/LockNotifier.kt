package com.yuntyu01.naegirok.notify

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.yuntyu01.naegirok.NotesDb
import com.yuntyu01.naegirok.QuickAddActivity
import com.yuntyu01.naegirok.nativelib.R
import com.yuntyu01.naegirok.Rich
import com.yuntyu01.naegirok.SurfaceTheme

/**
 * 잠금화면 위젯을 못 쓰는 기기를 위한 대안: 할 일을 보여주는 고정 알림.
 * 공개 범위(내용/개수만/숨김)는 사용자가 꾸미기 설정에서 고른다. '추가'를 누르면 잠금 해제 후 빠른 추가가 열린다.
 */
object LockNotifier {
  private const val CHANNEL = "lock_todos"
  private const val ID = 4100

  /** 보이는 줄 수(나머지는 '+N개 더') */
  private const val LINES = 6

  private class Data(val prefs: org.json.JSONObject, val visibility: String, val todos: List<NotesDb.Todo>, val count: Int)

  fun refresh(base: Context) {
    // 설정·할 일을 한 번에 읽는다. 꺼 두었으면 언어도 맞추지 않는다(예전엔 언어를 읽느라 DB를 따로 한 번 더 열었다)
    val data = NotesDb.use(base) { db ->
      val prefs = NotesDb.prefs(db)
      val lock = prefs.optJSONObject("lock")
      // 꺼 두었거나 로그인하지 않았으면 알림을 내린다
      if (lock?.optBoolean("enabled") != true || !NotesDb.signedIn(db)) return@use null
      Data(prefs, lock.optString("visibility", "private"), NotesDb.todos(db, null, limit = LINES, all = true), NotesDb.countTodos(db, null, all = true))
    }
    val mgr = NotificationManagerCompat.from(base)
    if (data == null || !mgr.areNotificationsEnabled()) {
      mgr.cancel(ID)
      return
    }
    val ctx = com.yuntyu01.naegirok.AppLocale.wrap(base, data.prefs)
    val theme = SurfaceTheme.from(ctx, data.prefs)
    val visibility = data.visibility
    val todos = data.todos
    ensureChannel(ctx)
    // 할 일 수는 다 센다(예전엔 30개까지만 읽어 '할 일 30개'에서 멈췄다)
    val title = ctx.getString(R.string.lock_title, data.count)
    val open = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.let {
      PendingIntent.getActivity(ctx, ID, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val add = PendingIntent.getActivity(
      ctx, ID + 1,
      Intent(ctx, QuickAddActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val style = NotificationCompat.InboxStyle().setBigContentTitle(title)
    todos.forEach { style.addLine("○  ${Rich.plain(it.text)}") }
    if (data.count > todos.size) style.setSummaryText(ctx.getString(R.string.lock_more, data.count - todos.size))

    val builder = NotificationCompat.Builder(ctx, CHANNEL)
      .setSmallIcon(R.drawable.naegirok_tile)
      .setColor(theme.accent)
      .setContentTitle(title)
      .setContentText(todos.firstOrNull()?.text?.let(Rich::plain) ?: ctx.getString(R.string.lock_empty))
      .setStyle(style)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setShowWhen(false)
      .setContentIntent(open)
      .addAction(0, ctx.getString(R.string.add), add)
      .setPriority(NotificationCompat.PRIORITY_LOW)
    when (visibility) {
      "public" -> builder.setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      "secret" -> builder.setVisibility(NotificationCompat.VISIBILITY_SECRET)
      else -> builder.setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setPublicVersion(
        NotificationCompat.Builder(ctx, CHANNEL)
          .setSmallIcon(R.drawable.naegirok_tile)
          .setColor(theme.accent)
          .setContentTitle(title)
          .setOngoing(true)
          .setSilent(true)
          .build(),
      )
    }
    try {
      mgr.notify(ID, builder.build())
    } catch (_: SecurityException) {
      // 알림 권한이 없으면 조용히 넘어간다(설정 화면이 안내함).
    }
  }

  private fun ensureChannel(ctx: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    val nm = ctx.getSystemService(NotificationManager::class.java)
    if (nm.getNotificationChannel(CHANNEL) != null) return
    nm.createNotificationChannel(
      NotificationChannel(CHANNEL, ctx.getString(R.string.channel_lock), NotificationManager.IMPORTANCE_LOW).apply {
        lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
        setShowBadge(false)
      },
    )
  }
}
