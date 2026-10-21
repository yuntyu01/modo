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
import com.yuntyu01.naegirok.ModoEvents
import com.yuntyu01.naegirok.NotesDb
import com.yuntyu01.naegirok.nativelib.R
import com.yuntyu01.naegirok.SurfaceTheme
import com.yuntyu01.naegirok.WidgetEditActivity
import com.yuntyu01.naegirok.Work
import kotlin.math.roundToInt

/**
 * 홈 화면(지원하면 잠금화면) 위젯. 폴더의 메모와 남은 할 일을 보여 준다. 동그라미를 한 번 누르면 완료(목록에서 빠진다),
 * 할 일 글자를 누르면 그 자리에서 고치는 작은 입력창(WidgetEditActivity)이 뜬다.
 * 홈 화면 모양은 HomeWidget(메모 + 할 일을 위아래로 굴리는 목록). 잠금화면은 이 파일의 예전 모양(widget_notes_lock).
 * 데이터는 앱과 같은 SQLite 파일을 직접 읽고, 바꾼 내용은 outbox에 남아 앱이 열릴 때 동기화된다.
 */
open class NotesWidgetProvider : AppWidgetProvider() {
  // 놓을 때·재부팅 뒤처럼 시스템이 부를 때. 그리기는 DB를 열어 뒤에서(Work), 날이 바뀔 때 다시 그릴 알람도 여기서 건다
  override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
    Work.run(this) {
      ModoEvents.scheduleMidnight(ctx)
      val loc = AppLocale.wrap(ctx)
      for (id in ids) draw(loc, mgr, id)
    }
  }

  override fun onDeleted(ctx: Context, ids: IntArray) {
    ids.forEach { WidgetPrefs.delete(ctx, it) }
  }

  override fun onAppWidgetOptionsChanged(ctx: Context, mgr: AppWidgetManager, id: Int, options: android.os.Bundle) {
    Work.run(this) { update(ctx, mgr, id) }
  }

  /**
   * 할 일 완료(반복은 이번 회차만). 먼저 그 줄의 동그라미가 채워지며 체크가 톡 나타나는 모습을 잠깐 보여 주고
   * (COMPLETE_MS, 사용자 요청 2026-10-22) 저장해 목록에서 뺀다. 그사이 또 눌러도 한 번만. 로그아웃한 뒤 남은 위젯 화면을 눌러도 바꾸지 않는다
   */
  private fun complete(ctx: Context, todoId: String) {
    if (!completing.add(todoId)) return
    Work.run(this) {
      try {
        if (NotesDb.use(ctx) { NotesDb.signedIn(it) } != true) return@run
        refreshAll(ctx)
        Thread.sleep(COMPLETE_MS)
        NotesDb.write(ctx) { if (NotesDb.signedIn(it)) NotesDb.complete(it, todoId) }
      } finally {
        completing.remove(todoId)
      }
      ModoEvents.afterWrite(ctx, "todos")
    }
  }

  override fun onReceive(ctx: Context, intent: Intent) {
    if (intent.action == ACTION_TOGGLE) {
      intent.getStringExtra(EXTRA_TODO)?.let { complete(ctx, it) }
      return
    }
    // 홈 위젯 목록 안을 누름(HomeWidget.fill): 완료는 여기서, 고치기·앱 열기는 그 화면을 띄운다
    // (위젯을 누른 손짓이라 런처가 화면을 띄울 권한을 넘겨 준다)
    if (intent.action == ACTION_ITEM) {
      val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
      val todo = intent.getStringExtra(EXTRA_TODO)
      val folder = intent.getStringExtra(EXTRA_FOLDER)?.takeIf { it.isNotEmpty() }
      val edit = Intent(ctx, WidgetEditActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
      when (intent.getStringExtra(EXTRA_ITEM)) {
        ITEM_TOGGLE -> todo?.let { complete(ctx, it) }
        ITEM_EDIT -> if (todo != null) ctx.startActivity(edit.putExtra(WidgetEditActivity.EXTRA_TODO, todo).setData(Uri.parse("naegirok://edit/todo/$todo/$id")))
        ITEM_MEMO -> ctx.startActivity(
          edit.putExtra(WidgetEditActivity.EXTRA_MEMO_FOLDER, folder ?: WidgetEditActivity.BASE).setData(Uri.parse("naegirok://edit/memo/${folder ?: "base"}/$id")),
        )
        ITEM_OPEN -> ctx.startActivity(openFolder(ctx, folder).setData(Uri.parse("naegirok://?folder=${folder ?: "base"}&w=$id")))
      }
      return
    }
    // 홈 위젯: 폴더 탭을 누르면 그 폴더로, 목록은 맨 위로(위젯마다 따로 저장)
    if (intent.action == ACTION_FOLDER) {
      val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
      if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return
      val folder = intent.getStringExtra(EXTRA_FOLDER)?.takeIf { it.isNotEmpty() }
      Work.run(this) {
        // 지금 폴더를 다시 눌러도 목록 맨 위로
        WidgetPrefs.load(ctx, id).withFolder(folder).save(ctx, id)
        update(ctx, AppWidgetManager.getInstance(ctx), id, scrollTop = true)
      }
      return
    }
    if (intent.action == ACTION_PAGE) {
      val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
      if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return
      val step = intent.getIntExtra(EXTRA_STEP, 1)
      val target = intent.getIntExtra(EXTRA_INDEX, -1)
      Work.run(this) {
        // 기본 → 폴더들 → 다시 기본 순서로 돈다. 고른 폴더는 이 위젯의 설정으로 남는다.
        val pages = listOf<String?>(null) + (NotesDb.use(ctx) { NotesDb.folders(it).map { f -> f.id } } ?: emptyList())
        val wp = WidgetPrefs.load(ctx, id)
        val cur = pages.indexOf(wp.folderId).coerceAtLeast(0)
        // 점을 누르면 그 자리로, ‹ ›는 한 칸씩
        val next = if (target in pages.indices) target else Math.floorMod(cur + step, pages.size)
        wp.withFolder(pages[next]).save(ctx, id)
        update(ctx, AppWidgetManager.getInstance(ctx), id)
      }
      return
    }
    // 한 줄 모양: 다음 할 일(끝에서 누르면 처음으로)
    if (intent.action == ACTION_NEXT) {
      val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
      if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return
      Work.run(this) {
        val wp = WidgetPrefs.load(ctx, id)
        wp.copy(pos = wp.pos + 1).save(ctx, id)
        update(ctx, AppWidgetManager.getInstance(ctx), id)
      }
      return
    }
    super.onReceive(ctx, intent)
  }

  companion object {
    const val ACTION_TOGGLE = "com.yuntyu01.naegirok.widget.TOGGLE"
    const val ACTION_PAGE = "com.yuntyu01.naegirok.widget.PAGE"
    const val ACTION_ITEM = "com.yuntyu01.naegirok.widget.ITEM"
    const val ACTION_NEXT = "com.yuntyu01.naegirok.widget.NEXT"
    const val ACTION_FOLDER = "com.yuntyu01.naegirok.widget.FOLDER"
    const val EXTRA_FOLDER = "folder"
    const val EXTRA_ITEM = "item"
    /** 목록 안을 누름(EXTRA_ITEM): 완료 · 할 일 고치기 · 메모 고치기 · 앱의 그 폴더 */
    const val ITEM_TOGGLE = "toggle"
    const val ITEM_EDIT = "edit"
    const val ITEM_MEMO = "memo"
    const val ITEM_OPEN = "open"
    const val EXTRA_STEP = "step"
    const val EXTRA_INDEX = "index"
    const val EXTRA_TODO = "todo_id"

    /** 동그라미를 눌러 완료하는 중인 할 일(그릴 때 채운 동그라미 + 체크로, HomeWidget) */
    val completing: MutableSet<String> = java.util.Collections.synchronizedSet(mutableSetOf())
    /** 완료 모습을 보여 주는 시간: 체크가 나타나는 움직임(0.26초) 뒤 잠깐 머문다 */
    private const val COMPLETE_MS = 650L

    /** 크기별로 따로 놓는 같은 위젯들(WidgetSizes.kt): 다시 그릴 때 모두 */
    val PROVIDERS = listOf(
      NotesWidgetProvider::class.java, NotesWidgetProvider2x2::class.java, NotesWidgetProvider4x4::class.java, NotesWidgetProvider4x1::class.java,
    )

    fun refreshAll(base: Context) {
      val mgr = AppWidgetManager.getInstance(base)
      val ids = PROVIDERS.flatMap { mgr.getAppWidgetIds(ComponentName(base, it)).toList() }
      if (ids.isEmpty()) return
      // 앱 언어는 한 번만 맞춘다(예전엔 위젯마다 DB를 열어 언어를 다시 읽었다)
      val ctx = AppLocale.wrap(base)
      for (id in ids) draw(ctx, mgr, id)
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

    fun update(base: Context, mgr: AppWidgetManager, id: Int, scrollTop: Boolean = false) = draw(AppLocale.wrap(base), mgr, id, scrollTop)


    /**
     * ctx: 앱 언어로 맞춘 Context. 위젯 하나가 실패해도(읽을 수 없는 DB 값 등) 나머지는 그리고, 그 위젯은 흰 빈 상자로 남지 않게
     * 로고만 있는 기본 모양(누르면 앱)으로 둔다. 예전엔 한 위젯의 오류가 refreshAll·onUpdate의 반복을 끊어 모든 위젯이 그대로 남았다
     */
    private fun draw(ctx: Context, mgr: AppWidgetManager, id: Int, scrollTop: Boolean = false) {
      try {
        drawOrThrow(ctx, mgr, id, scrollTop)
      } catch (e: Exception) {
        android.util.Log.w("modo", "widget $id draw failed", e)
        runCatching { mgr.updateAppWidget(id, HomeWidget.fallback(ctx, id)) }
      }
    }

    private fun drawOrThrow(ctx: Context, mgr: AppWidgetManager, id: Int, scrollTop: Boolean) {
      // 잠금화면에 놓인 위젯인지(배치·공개 범위가 다르다)
      val options = mgr.getAppWidgetOptions(id)
      val keyguard = options.getInt(AppWidgetManager.OPTION_APPWIDGET_HOST_CATEGORY, -1) ==
        android.appwidget.AppWidgetProviderInfo.WIDGET_CATEGORY_KEYGUARD
      // 큰 칸: 홈 화면은 새 시안(HomeWidget: 메모 + 할 일 목록), 잠금화면은 아래의 예전 모양(widget_notes_lock).
      // 작은 칸(동그라미·낮은 칸)은 둘 다 HomeWidget.responsive가 크기에 맞는 모양으로
      val full = if (keyguard) lockViews(ctx, id, options) else HomeWidget.render(ctx, mgr, id, scrollTop)
      mgr.updateAppWidget(id, HomeWidget.responsive(ctx, mgr, id, keyguard, full))
    }

    private fun lockViews(ctx: Context, id: Int, options: android.os.Bundle): RemoteViews {
      val wp = WidgetPrefs.load(ctx, id)
      // 위젯마다 고른 폴더(null = 기본). 지워졌거나 공유가 끊긴 폴더면 기본으로.
      data class Head(
        val theme: SurfaceTheme, val folderId: String?, val title: String, val pages: List<String?>, val lock: String, val count: Int,
        val signedIn: Boolean,
      )
      val head = NotesDb.use(ctx) { db ->
        val prefs = NotesDb.prefs(db)
        val name = NotesDb.folderName(db, wp.folderId)
        val fid = if (name != null) wp.folderId else null
        Head(
          SurfaceTheme.from(ctx, prefs),
          fid,
          name ?: ctx.getString(R.string.base_folder),
          listOf<String?>(null) + NotesDb.folders(db).map { it.id },
          prefs.optJSONObject("lock")?.optString("visibility", "private") ?: "private",
          NotesDb.countTodos(db, fid),
          NotesDb.signedIn(db),
        )
      } ?: Head(SurfaceTheme.from(ctx, org.json.JSONObject()), null, ctx.getString(R.string.base_folder), listOf(null), "private", 0, false)
      val theme = head.theme
      val v = RemoteViews(ctx.packageName, R.layout.widget_notes_lock)

      // 배경(시안): 카드색을 투명도만큼 깐다
      v.setInt(R.id.widget_bg, "setColorFilter", theme.card)
      // 잠금화면 위젯은 꾸미기의 잠금화면 위젯 투명도(홈과 따로)
      v.setInt(R.id.widget_bg, "setImageAlpha", ((wp.opacity ?: theme.lockOpacity) * 255).roundToInt())
      v.setInt(R.id.widget_mark, "setColorFilter", theme.mark)
      v.setTextViewText(R.id.widget_title, head.title)
      v.setTextColor(R.id.widget_title, theme.text)
      v.setTextViewTextSize(R.id.widget_title, TypedValue.COMPLEX_UNIT_SP, wp.textSize + 1)
      v.setTextColor(R.id.widget_empty, theme.muted)

      // 폴더 넘기기 ‹ ›: 위젯 하나 안에서 옆으로 밀기는 Android가 받지 않아서 버튼으로 넘긴다. 폴더가 없으면 숨긴다.
      val many = head.pages.size > 1
      for ((view, step) in listOf(R.id.widget_prev to -1, R.id.widget_next to 1)) {
        v.setViewVisibility(view, if (many) View.VISIBLE else View.GONE)
        v.setInt(view, "setColorFilter", theme.text)
        v.setInt(view, "setImageAlpha", 230)
        val page = Intent(ctx, NotesWidgetProvider::class.java).setAction(ACTION_PAGE)
          .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id).putExtra(EXTRA_STEP, step)
          .setData(Uri.parse("naegirok://widget-page/$id/$step"))
        v.setOnClickPendingIntent(view, pi(ctx, id, page, activity = false))
      }

      // 제목 → 앱의 그 폴더 화면
      val open = pi(ctx, id, openFolder(ctx, head.folderId).setData(Uri.parse("naegirok://?folder=${head.folderId ?: "base"}&w=$id")), activity = true)
      v.setOnClickPendingIntent(R.id.widget_title, open)

      // 잠금화면 공개 범위(내용 보이기/개수만/숨기기)를 따른다.
      val visibility = head.lock

      // 줄은 위젯 높이에 들어가는 만큼만 직접 그린다(나머지는 '더 보기'). 줄마다 누르는 곳이 달라 목록 위젯 대신 이렇게 한다.
      v.removeAllViews(R.id.widget_rows)
      val heightDp = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0).takeIf { it > 0 } ?: 180
      val budget = heightDp - 12 - 44 - 12
      val rows = if (visibility == "public" && head.signedIn) WidgetRows.build(ctx, id, wp, head.folderId, theme, budget) else emptyList()
      rows.forEach { v.addView(R.id.widget_rows, it) }
      val emptyText = when {
        !head.signedIn -> ctx.getString(R.string.login_first)
        // 할 일 수는 다 센다(예전엔 50개까지만 읽어 '할 일 50개'에서 멈췄다)
        visibility == "private" -> ctx.getString(R.string.lock_title, head.count)
        visibility == "secret" -> ctx.getString(R.string.lock_hidden)
        // 할 일이 없으면 아무 글 없이(홈 위젯과 같다, 사용자 요청 2026-10-21)
        else -> ""
      }
      v.setTextViewText(R.id.widget_empty, emptyText)
      v.setViewVisibility(R.id.widget_empty, if (rows.isEmpty() && emptyText.isNotEmpty()) View.VISIBLE else View.GONE)
      v.setViewVisibility(R.id.widget_rows, if (rows.isEmpty()) View.GONE else View.VISIBLE)
      return v
    }
  }
}
