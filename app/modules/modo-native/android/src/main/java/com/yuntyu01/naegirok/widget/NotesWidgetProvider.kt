package com.yuntyu01.naegirok.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import com.yuntyu01.naegirok.AppLocale
import com.yuntyu01.naegirok.NotesDb
import com.yuntyu01.naegirok.QuickAddActivity
import com.yuntyu01.naegirok.nativelib.R
import com.yuntyu01.naegirok.SurfaceTheme
import com.yuntyu01.naegirok.notify.LockNotifier
import com.yuntyu01.naegirok.notify.Reminders
import kotlin.math.roundToInt

/**
 * 홈 화면(지원하면 잠금화면) 위젯. 폴더의 메모와 할 일을 보여 준다. 동그라미를 한 번 누르면 완료/완료 취소,
 * 할 일 글자를 누르면 그 자리에서 고치는 작은 입력창(WidgetEditActivity)이 뜬다.
 * 홈 화면 모양·쪽 넘기기는 HomeWidget(메모 쪽 + 할 일 쪽, 메모 읽기 모드). 잠금화면은 이 파일의 예전 모양(widget_notes_lock).
 * 데이터는 앱과 같은 SQLite 파일을 직접 읽고, 바꾼 내용은 outbox에 남아 앱이 열릴 때 동기화된다.
 */
class NotesWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
    for (id in ids) update(ctx, mgr, id)
  }

  override fun onDeleted(ctx: Context, ids: IntArray) {
    ids.forEach { WidgetPrefs.delete(ctx, it) }
  }

  override fun onAppWidgetOptionsChanged(ctx: Context, mgr: AppWidgetManager, id: Int, options: android.os.Bundle) {
    update(ctx, mgr, id)
  }

  override fun onReceive(ctx: Context, intent: Intent) {
    if (intent.action == ACTION_TOGGLE) {
      val todoId = intent.getStringExtra(EXTRA_TODO) ?: return
      val done = intent.getBooleanExtra(EXTRA_DONE, false)
      val pending = goAsync()
      Thread {
        try {
          NotesDb.write(ctx) { if (done) NotesDb.uncheck(it, todoId) else NotesDb.complete(it, todoId) }
          com.yuntyu01.naegirok.ModoEvents.dataChanged(ctx)
          refreshAll(ctx)
          LockNotifier.refresh(ctx)
          Reminders.scheduleAll(ctx)
        } finally {
          pending.finish()
        }
      }.start()
      return
    }
    // 홈 위젯: 메모 읽기 켜기/끄기, 점으로 쪽 고르기(위젯마다 따로 저장)
    if (intent.action == ACTION_MEMO || intent.action == ACTION_GO) {
      val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
      if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return
      val pending = goAsync()
      Thread {
        try {
          val wp = WidgetPrefs.load(ctx, id)
          val next = when {
            // 읽기 모드에서 다시 누르면 기본 모드의 메모 쪽으로
            intent.action == ACTION_MEMO && wp.reading -> wp.copy(reading = false, page = 0, anchorTodo = null, anchorIndex = -1)
            intent.action == ACTION_MEMO -> wp.copy(reading = true, readPage = 0, readOffset = 0)
            intent.getStringExtra(EXTRA_KIND) == HomeWidget.KIND_READ -> wp.copy(readPage = intent.getIntExtra(EXTRA_INDEX, 0), readOffset = -1)
            // 점으로 고른 쪽: 그 쪽의 첫 할 일은 그릴 때 정해 둔다
            else -> wp.copy(page = intent.getIntExtra(EXTRA_INDEX, 0), anchorTodo = null, anchorIndex = -1)
          }
          next.save(ctx, id)
          update(ctx, AppWidgetManager.getInstance(ctx), id)
        } finally {
          pending.finish()
        }
      }.start()
      return
    }
    if (intent.action == ACTION_PAGE) {
      val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
      if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return
      val step = intent.getIntExtra(EXTRA_STEP, 1)
      val target = intent.getIntExtra(EXTRA_INDEX, -1)
      val pending = goAsync()
      Thread {
        try {
          // 기본 → 폴더들 → 다시 기본 순서로 돈다. 고른 폴더는 이 위젯의 설정으로 남는다.
          val pages = listOf<String?>(null) + (NotesDb.use(ctx) { NotesDb.folders(it).map { f -> f.id } } ?: emptyList())
          val wp = WidgetPrefs.load(ctx, id)
          val cur = pages.indexOf(wp.folderId).coerceAtLeast(0)
          // 점을 누르면 그 자리로, ‹ ›는 한 칸씩
          val next = if (target in pages.indices) target else Math.floorMod(cur + step, pages.size)
          wp.copy(folderId = pages[next]).save(ctx, id)
          update(ctx, AppWidgetManager.getInstance(ctx), id)
        } finally {
          pending.finish()
        }
      }.start()
      return
    }
    super.onReceive(ctx, intent)
  }

  companion object {
    const val ACTION_TOGGLE = "com.yuntyu01.naegirok.widget.TOGGLE"
    const val ACTION_PAGE = "com.yuntyu01.naegirok.widget.PAGE"
    const val ACTION_MEMO = "com.yuntyu01.naegirok.widget.MEMO"
    const val ACTION_GO = "com.yuntyu01.naegirok.widget.GO"
    const val EXTRA_KIND = "kind"
    const val EXTRA_STEP = "step"
    const val EXTRA_INDEX = "index"
    const val EXTRA_TODO = "todo_id"
    const val EXTRA_DONE = "done"

    fun refreshAll(ctx: Context) {
      val mgr = AppWidgetManager.getInstance(ctx)
      val ids = mgr.getAppWidgetIds(ComponentName(ctx, NotesWidgetProvider::class.java))
      for (id in ids) update(ctx, mgr, id)
    }

    private fun pi(ctx: Context, code: Int, intent: Intent, activity: Boolean): PendingIntent {
      val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
      return if (activity) PendingIntent.getActivity(ctx, code, intent, flags) else PendingIntent.getBroadcast(ctx, code, intent, flags)
    }

    /** 앱을 그 폴더 화면으로 연다(null = 기본). */
    private fun openFolder(ctx: Context, folderId: String?) =
      Intent(Intent.ACTION_VIEW, Uri.parse("naegirok://?folder=${folderId ?: "base"}"))
        .setPackage(ctx.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    fun update(base: Context, mgr: AppWidgetManager, id: Int) {
      val ctx = AppLocale.wrap(base)
      // 잠금화면에 놓인 위젯인지(배치·공개 범위가 다르다)
      val options = mgr.getAppWidgetOptions(id)
      val keyguard = options.getInt(AppWidgetManager.OPTION_APPWIDGET_HOST_CATEGORY, -1) ==
        android.appwidget.AppWidgetProviderInfo.WIDGET_CATEGORY_KEYGUARD
      // 홈 화면은 새 시안(HomeWidget: 메모 쪽 + 할 일 쪽). 잠금화면은 아래의 예전 모양 그대로
      if (!keyguard) return mgr.updateAppWidget(id, HomeWidget.render(ctx, mgr, id))
      val wp = WidgetPrefs.load(ctx, id)
      // 위젯마다 고른 폴더(null = 기본). 지워졌거나 공유가 끊긴 폴더면 기본으로.
      data class Head(val theme: SurfaceTheme, val folderId: String?, val title: String, val pages: List<String?>, val lock: String)
      val head = NotesDb.use(ctx) { db ->
        val prefs = NotesDb.prefs(db)
        val name = NotesDb.folderName(db, wp.folderId)
        Head(
          SurfaceTheme.from(ctx, prefs),
          if (name != null) wp.folderId else null,
          name ?: ctx.getString(R.string.base_folder),
          listOf<String?>(null) + NotesDb.folders(db).map { it.id },
          prefs.optJSONObject("lock")?.optString("visibility", "private") ?: "private",
        )
      } ?: Head(SurfaceTheme.from(ctx, org.json.JSONObject()), null, ctx.getString(R.string.base_folder), listOf(null), "private")
      val theme = head.theme
      val v = RemoteViews(ctx.packageName, R.layout.widget_notes_lock)

      // 배경(시안): 카드색을 투명도만큼 깐다
      v.setInt(R.id.widget_bg, "setColorFilter", theme.card)
      v.setInt(R.id.widget_bg, "setImageAlpha", ((wp.opacity ?: theme.opacity) * 255).roundToInt())
      v.setInt(R.id.widget_mark, "setColorFilter", theme.mark)
      v.setTextViewText(R.id.widget_title, head.title)
      v.setTextColor(R.id.widget_title, theme.text)
      v.setTextViewTextSize(R.id.widget_title, TypedValue.COMPLEX_UNIT_SP, wp.textSize + 1)
      v.setTextColor(R.id.widget_empty, theme.muted)
      if (!keyguard) {
        v.setInt(R.id.widget_add, "setColorFilter", theme.accent)
        v.setTextColor(R.id.widget_more, SurfaceTheme.mixInt(theme.text, theme.card, 0.3))
        // 레이아웃에 적힌 글은 런처의 언어로 풀려서, 앱 언어로 다시 넣는다.
        v.setTextViewText(R.id.widget_more, ctx.getString(R.string.more))
      }

      // 폴더 넘기기 ‹ ›: 위젯 하나 안에서 옆으로 밀기는 Android가 받지 않아서 버튼으로 넘긴다. 폴더가 없으면 숨긴다.
      val many = head.pages.size > 1
      for ((view, step) in listOf(R.id.widget_prev to -1, R.id.widget_next to 1)) {
        v.setViewVisibility(view, if (many) View.VISIBLE else View.GONE)
        v.setInt(view, "setColorFilter", theme.text)
        v.setInt(view, "setImageAlpha", if (keyguard) 230 else 200)
        val page = Intent(ctx, NotesWidgetProvider::class.java).setAction(ACTION_PAGE)
          .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id).putExtra(EXTRA_STEP, step)
          .setData(Uri.parse("naegirok://widget-page/$id/$step"))
        v.setOnClickPendingIntent(view, pi(ctx, id, page, activity = false))
      }

      // 제목·더 보기 → 앱의 그 폴더 화면, + → 빠른 추가(이 폴더로)
      val open = pi(ctx, id, openFolder(ctx, head.folderId).setData(Uri.parse("naegirok://?folder=${head.folderId ?: "base"}&w=$id")), activity = true)
      v.setOnClickPendingIntent(R.id.widget_title, open)
      if (!keyguard) {
        v.setOnClickPendingIntent(R.id.widget_more, open)
        val add = Intent(ctx, QuickAddActivity::class.java)
          .putExtra(QuickAddActivity.EXTRA_FOLDER, head.folderId)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
          .setData(Uri.parse("naegirok://quickadd/$id"))
        v.setOnClickPendingIntent(R.id.widget_add, pi(ctx, id, add, activity = true))
      }

      // 잠금화면에 놓인 위젯이면 잠금화면 공개 범위(내용 보이기/개수만/숨기기)를 따른다.
      val visibility = if (keyguard) head.lock else "public"

      // 줄은 위젯 높이에 들어가는 만큼만 직접 그린다(나머지는 '더 보기'). 줄마다 누르는 곳이 달라 목록 위젯 대신 이렇게 한다.
      v.removeAllViews(R.id.widget_rows)
      val heightDp = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0).takeIf { it > 0 } ?: 180
      val budget = if (keyguard) heightDp - 12 - 44 - 12 else heightDp - 12 - 44 - 40 - 6
      val rows = if (visibility == "public") WidgetRows.build(ctx, id, wp, head.folderId, theme, budget, keyguard) else emptyList()
      rows.forEach { v.addView(R.id.widget_rows, it) }
      val emptyText = when {
        visibility == "private" -> ctx.getString(R.string.lock_title, NotesDb.use(ctx) { NotesDb.todos(it, head.folderId, includeDone = false).size } ?: 0)
        visibility == "secret" -> ctx.getString(R.string.lock_hidden)
        else -> ctx.getString(R.string.widget_empty)
      }
      v.setTextViewText(R.id.widget_empty, emptyText)
      v.setViewVisibility(R.id.widget_empty, if (rows.isEmpty()) View.VISIBLE else View.GONE)
      v.setViewVisibility(R.id.widget_rows, if (rows.isEmpty()) View.GONE else View.VISIBLE)
      mgr.updateAppWidget(id, v)
    }
  }
}
