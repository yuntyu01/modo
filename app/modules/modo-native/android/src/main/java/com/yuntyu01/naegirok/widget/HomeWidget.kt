package com.yuntyu01.naegirok.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.text.Layout
import android.text.SpannableStringBuilder
import android.text.SpannableString
import android.text.Spanned
import android.text.StaticLayout
import android.text.TextPaint
import android.text.style.ForegroundColorSpan
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan
import android.util.SizeF
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import androidx.core.widget.RemoteViewsCompat
import com.yuntyu01.naegirok.NotesDb
import com.yuntyu01.naegirok.QuickAddActivity
import com.yuntyu01.naegirok.Rich
import com.yuntyu01.naegirok.SurfaceTheme
import com.yuntyu01.naegirok.WidgetEditActivity
import com.yuntyu01.naegirok.nativelib.R
import kotlin.math.roundToInt

/**
 * 홈 화면 위젯(시안): 로고 · 폴더 탭(한 줄, 앱과 같이 누르면 그 폴더로) / 메모와 할 일 목록 / +.
 *
 * - 몸통은 한 목록: 맨 위에 그 폴더의 메모 전체(문단 사이 빈 줄 그대로), 그 아래 남은 할 일. 손가락으로 위아래로 굴려 본다
 *   (사용자 요청 2026-10-21). 위젯은 옆으로 미는 손짓을 받을 수 없어서(런처가 홈 화면 쪽 넘기기에 쓴다) 예전엔 메모 쪽·할 일 쪽을
 *   나눠 아래 점으로 넘겼고, 긴 메모는 읽기 모드로 쪽을 넘겼다. 둘 다 없앴다.
 * - 메모를 누르면 메모 고치기 창, 할 일 동그라미 = 완료, 글자·줄 = 그 할 일 고치기. 보기만 공유된 폴더는 앱의 그 폴더로.
 * - 목록 안을 누르는 것은 목록 하나에 신호 틀 하나(itemTemplate)라, 무엇을 할지는 채워 넣는 값으로 알린다(NotesWidgetProvider.ACTION_ITEM).
 * - 폴더 탭을 누르면 목록 맨 위로. 할 일을 완료하거나 앱에서 고쳐 다시 그려도 보던 자리는 그대로(목록이 자리를 기억한다).
 *
 * 할 일 줄 높이는 위젯 글자 크기와 실제 글꼴(StaticLayout, 시스템 글자 크기 반영)로 잰다. 잠금화면 위젯은 NotesWidgetProvider의 예전 모양 그대로.
 */
object HomeWidget {
  // widget_home.xml의 여백(dp). 폴더 탭 폭 계산이 이 값에 기대므로 함께 바꿀 것
  private const val PAD_START = 22f
  private const val PAD_END = 12f
  /** 로고(높이 15, naegirok_mark 비율)와 탭 사이(widget_brand paddingEnd) */
  private const val MARK_W = 15f * 1148.5f / 432f
  private const val MARK_GAP = 14f
  /** 탭 사이(widget_home_tab.xml paddingEnd) */
  private const val TAB_GAP = 18f
  /** 가려진 폴더를 잘린 채로 보여 주는 끝 탭에 적어도 남길 폭("…" 하나). 끝 탭은 남는 폭을 다 쓴다(widget_home_tab_peek*.xml) */
  private const val PEEK_MIN = 14f
  /** 할 일 줄 위아래 여백 */
  private const val ROW_PAD_V = 6f
  private const val ROW_CHECK = 44f
  /** 제목과 보조 줄 사이(앱 카드와 같이 0: 줄 높이 안의 글자 여백만으로 붙는다). widget_home_todo.xml과 같게 */
  private const val META_GAP = 0f
  /** 작은 칸 모양을 고르는 크기(dp): 이 폭보다 좁으면 동그라미 모양, 이 높이부터 한 줄 모양의 위 줄(폴더), 이 높이부터 목록 */
  private const val SMALL_W = 110f
  /** 이 높이부터 위 줄 + 할 일 하나(card), 그보다 낮으면 한 줄(line) */
  private const val CARD_H = 56f
  /** card: 이 높이부터 할 일 아래 줄(날짜·반복)·두 줄 글·여러 줄 메모(낮으면 할 일 한 줄만: 위 줄 아래 24dp쯤뿐) */
  private const val ROOMY_H = 84f
  private const val FULL_H = 150f
  /** 눌러 넘겨 보는 할 일 수(그리는 것은 하나라 많아도 위젯 내용은 작다. 예전 카드 넘기기는 카드를 다 실어 30장까지였다) */
  private const val NEXT_LIMIT = 500
  /** 작은 칸 위젯(widget_lock*)의 양옆 여백과 로고 칸 폭(dp): 위 줄 폴더 탭이 쓸 폭을 셀 때 */
  private const val LOCK_SIDE_PAD = 12f
  private const val LOCK_BRAND_W = 38f
  /** 위젯 목록에 싣는 할 일 수(더 있으면 끝에 '외 N개'). 위젯 내용은 한 번에 시스템으로 넘어가서 너무 크면 그리지 못한다 */
  private const val MAX_ROWS = 150

  private val CHARCOAL = Color.rgb(42, 42, 44)
  private val NEUTRAL_TEXT = Color.rgb(245, 245, 247)
  private val NEUTRAL_MUTED = Color.rgb(161, 161, 166)
  private val NEUTRAL_CIRCLE = Color.rgb(176, 176, 181)
  /** 기한이 지난 날짜(앱 카드와 같은 빨간색) */
  private val LATE = Color.parseColor("#FF6B6B")

  /** memo = 메모 전체(문단 사이 빈 줄 그대로), todoCount = 남은 할 일 수(목록에는 MAX_ROWS까지) */
  /** readOk = DB를 읽었고 로그인돼 있다(아니면 고른 폴더를 잊지 않는다), readOnly = 보기만 공유된 폴더 */
  private data class Data(
    val colors: Colors, val folderId: String?, val memo: CharSequence, val todos: List<NotesDb.Todo>,
    val folders: List<NotesDb.Folder>, val signedIn: Boolean = true, val readOk: Boolean = false, val readOnly: Boolean = false,
    val todoCount: Int = 0,
  )

  /** 위젯 색 한 벌(라이트 또는 다크) */
  private class Pal(t: SurfaceTheme) {
    // 다크 바탕은 파란 기 없는 차콜(꾸미기에서 카드색을 직접 고르면 그 색). 글자·보조 글자·동그라미도 같은 회색 계열
    private val neutral = t.dark && !t.tinted
    val card = if (neutral) CHARCOAL else t.card
    val text = if (neutral) NEUTRAL_TEXT else t.text
    val muted = if (neutral) NEUTRAL_MUTED else t.muted
    val circle = if (neutral) NEUTRAL_CIRCLE else t.circle
    val mark = t.mark
    /** 완료하는 순간 채워지는 동그라미와 그 위 체크 */
    val accent = t.accent
    val onAccent = t.onAccent
    val opacity = t.opacity
    val checkEnd = t.checkEnd
  }

  /**
   * 라이트·다크 두 벌. 앱 화면 설정이 '시스템'이면 Android 12+에서는 두 색을 함께 넣어 두어, 기기가 다크 모드로 바뀌면
   * 다시 그리지 않아도 위젯이 따라간다(예전엔 위젯을 누르거나 앱이 바꿀 때까지 옛 색으로 남았다). 그 아래 버전은 지금 색만.
   */
  private class Colors(private val day: Pal, private val night: Pal, private val isNight: Boolean) {
    val now get() = if (isNight) night else day

    fun set(v: RemoteViews, id: Int, method: String, pick: (Pal) -> Int) {
      val d = pick(day)
      val n = pick(night)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && d != n) v.setColorInt(id, method, d, n) else v.setInt(id, method, pick(now))
    }

    companion object {
      /** surface: 홈 위젯(widget) · 잠금화면 위젯(SurfaceTheme.LOCK) 꾸미기 */
      fun of(ctx: Context, prefs: org.json.JSONObject, surface: String = "widget"): Colors {
        val cur = SurfaceTheme.from(ctx, prefs, surface)
        if (!SurfaceTheme.followsSystem(prefs)) return Pal(cur).let { Colors(it, it, cur.dark) }
        return Colors(Pal(SurfaceTheme.from(ctx, prefs, surface, dark = false)), Pal(SurfaceTheme.from(ctx, prefs, surface, dark = true)), cur.dark)
      }
    }
  }

  /** 메모 문단을 한 글로. 앞뒤의 빈 문단은 빼고(앱 미니창과 같다). 굵게·밑줄·취소선·링크는 꾸민 대로(Rich) */
  private fun memoText(paragraphs: List<String>): CharSequence =
    joinLines(paragraphs.dropWhile { Rich.plain(it).isBlank() }.dropLastWhile { Rich.plain(it).isBlank() })

  private fun joinLines(lines: List<String>): CharSequence {
    val sb = SpannableStringBuilder()
    lines.forEachIndexed { i, l ->
      if (i > 0) sb.append('\n')
      sb.append(Rich.spanned(l))
    }
    return sb
  }

  /** scrollTop: 목록을 맨 위로(폴더 탭을 눌렀을 때) */
  fun render(ctx: Context, mgr: AppWidgetManager, id: Int, scrollTop: Boolean = false): RemoteViews {
    val saved = WidgetPrefs.load(ctx, id)
    val data = NotesDb.use(ctx) { db ->
      // 로그인하지 않았으면 내용 없이 안내만(누르면 앱의 로그인 화면)
      if (!NotesDb.signedIn(db)) return@use Data(Colors.of(ctx, NotesDb.prefs(db)), null, "", emptyList(), emptyList(), signedIn = false)
      val folders = NotesDb.folders(db)
      // 지워졌거나 공유 권한이 사라진 폴더(앱이 지운 것으로 남긴다), 홈에서 숨긴 공유 폴더는 기본 폴더로
      val fid = saved.folderId?.takeIf { f -> folders.any { it.id == f } }
      Data(
        Colors.of(ctx, NotesDb.prefs(db)),
        fid,
        memoText(NotesDb.memo(db, fid)),
        NotesDb.todos(db, fid, limit = MAX_ROWS),
        folders,
        readOk = true,
        readOnly = NotesDb.viewOnly(db, fid),
        todoCount = NotesDb.countTodos(db, fid),
      )
    } ?: Data(Colors.of(ctx, org.json.JSONObject()), null, "", emptyList(), emptyList(), signedIn = false)
    // 고른 폴더를 기본으로 바꿔 남기는 것은 DB를 제대로 읽어 그 폴더가 정말 없을 때만(잠깐 못 읽었거나 로그아웃 중이면 그대로 둔다:
    // 예전엔 한 번 못 읽으면 위젯이 기본 폴더로 영영 바뀌었다)
    val wp = if (data.readOk) saved.withFolder(data.folderId) else saved
    if (wp != saved) wp.save(ctx, id)

    // 크기: 세로 화면에서 위젯 폭 = 최소 폭(폴더 탭을 몇 개 그릴지)
    val dm = ctx.resources.displayMetrics
    fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, dm)
    fun sp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, v, dm)
    val opts = mgr.getAppWidgetOptions(id)
    val wDp = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0).takeIf { it > 0 } ?: 320

    val titleSp = wp.textSize + 1
    val metaSp = wp.textSize - 2
    val memoSp = wp.textSize + 1

    val hasMemo = wp.show != WidgetPrefs.Show.TODOS && data.memo.isNotBlank()
    val showTodos = wp.show != WidgetPrefs.Show.MEMO

    // 할 일 한 줄 높이: 보조 줄이 있든 없든 같게(제목 + 보조 줄, 동그라미 44보다 작으면 44)
    val titlePaint = paint(sp(titleSp), -0.02f)
    val titleH = layout("가g", titlePaint, 4096, 1f).height
    val metaH = layout("가g", paint(sp(metaSp), 0f), 4096, 1f).height
    val blockH = titleH + dp(META_GAP).roundToInt() + metaH
    // 제목만인 줄은 앱 카드처럼 두 줄까지(넘치면 …). 두 줄이 줄 높이(동그라미 44 또는 제목 + 보조 줄) 안에 들 때만, 아니면(큰 글자) 한 줄
    val plainLines = if (layout("가g\n가g", titlePaint, 4096, 1f).height <= maxOf(dp(ROW_CHECK), blockH.toFloat())) 2 else 1
    val rowPad = dp(ROW_PAD_V).roundToInt()

    val c = data.colors
    val v = RemoteViews(ctx.packageName, R.layout.widget_home)
    c.set(v, R.id.widget_bg, "setColorFilter") { it.card }
    v.setInt(R.id.widget_bg, "setImageAlpha", ((wp.opacity ?: c.now.opacity) * 255).roundToInt())

    // 머리 왼쪽 로고(글자 없이) → 앱의 그 폴더. 쪽을 바꿔도 그대로
    c.set(v, R.id.widget_mark, "setColorFilter") { it.mark }
    v.setOnClickPendingIntent(R.id.widget_brand, activity(ctx, id, openApp(ctx, data.folderId, id)))
    v.setContentDescription(R.id.widget_brand, ctx.getString(R.string.widget_open_app))

    // 폴더 탭(로고 오른쪽, 누르면 그 폴더로): folderTabs
    folderTabs(ctx, v, R.id.widget_tabs, id, data.folders, data.folderId, c, dp(wDp - PAD_START - PAD_END - MARK_W - MARK_GAP))

    // 몸통: 메모(맨 위, 전체) + 남은 할 일을 한 목록으로. 위아래로 굴려 본다
    val lang = ctx.resources.configuration.locales[0].language
    val items = RemoteViewsCompat.RemoteCollectionItems.Builder().setViewTypeCount(3)
    var n = 0L
    if (data.signedIn && hasMemo) items.addItem(n++, memoItem(ctx, data, c, memoSp))
    if (data.signedIn && showTodos) {
      for (todo in data.todos) items.addItem(n++, todoRow(ctx, todo, lang, c, titleSp, metaSp, titleH, metaH, blockH, plainLines, rowPad, data.readOnly))
      val more = data.todoCount - data.todos.size
      if (more > 0) items.addItem(n++, moreItem(ctx, data.folderId, more, c, metaSp + 1))
    }
    RemoteViewsCompat.setRemoteAdapter(ctx, v, id, R.id.widget_list, items.build())
    v.setPendingIntentTemplate(R.id.widget_list, itemTemplate(ctx, id))
    if (scrollTop) v.setScrollPosition(R.id.widget_list, 0)
    // 할 일·메모가 없으면 아무 글 없이 비워 둔다(+만, 사용자 요청 2026-10-21). 로그인하지 않았을 때의 안내만 남긴다
    v.setViewVisibility(R.id.widget_list, if (data.signedIn) View.VISIBLE else View.GONE)
    v.setViewVisibility(R.id.widget_empty, if (!data.signedIn) View.VISIBLE else View.GONE)
    v.setTextViewText(R.id.widget_empty, ctx.getString(R.string.login_first))
    c.set(v, R.id.widget_empty, "setTextColor") { it.muted }
    if (!data.signedIn) v.setOnClickPendingIntent(R.id.widget_empty, activity(ctx, id, openApp(ctx, null, id)))

    // +: 이 폴더에 할 일 추가(메모만 보이는 위젯이면 메모 이어 쓰기). 보기만 공유된 폴더는 숨긴다
    val showAdd = data.signedIn && !data.readOnly
    v.setViewVisibility(R.id.widget_add, if (showAdd) View.VISIBLE else View.GONE)
    // 레이아웃에 적힌 글은 런처 언어로 풀려서, 앱 언어로 다시 넣는다
    v.setContentDescription(R.id.widget_add, ctx.getString(R.string.add))
    c.set(v, R.id.widget_add, "setColorFilter") { it.text }
    // +는 글자색을 조금 연하게(굵어진 선이 너무 진해 보였다, 사용자 요청 2026-10-21)
    v.setInt(R.id.widget_add, "setImageAlpha", 165)
    val add = Intent(ctx, QuickAddActivity::class.java)
      .putExtra(QuickAddActivity.EXTRA_FOLDER, data.folderId)
      .putExtra(QuickAddActivity.EXTRA_MODE, if (showTodos) QuickAddActivity.MODE_TODO else QuickAddActivity.MODE_MEMO)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
      .setData(Uri.parse("naegirok://quickadd/$id"))
    v.setOnClickPendingIntent(R.id.widget_add, activity(ctx, id, add))
    return v
  }

  /**
   * 폴더 탭 줄(로고 오른쪽, 누르면 그 폴더로. 홈 위젯 머리 · 작은 칸 위젯 위 줄이 같이 쓴다): 기본 + 폴더들.
   * 폭이 모자라면 지금 폴더를 가운데 두고 양옆을 채운 뒤 가려진 쪽 끝에 바로 옆 폴더를 잘린 채로("제주…") 보여 준다
   * (안 그리면 네 번째 폴더부터 있는지조차 몰랐다). 위젯은 옆으로 밀 수 없어서, 잘린 탭을 누르면 그 폴더로 가며 가운데로 오고 그 옆이 드러난다.
   * 맨 앞·맨 끝 폴더는 그 끝에 그대로 붙어 있다(가운데로 끌어오지 않는다). room = 탭이 쓸 수 있는 폭(px)
   */
  private fun folderTabs(ctx: Context, v: RemoteViews, container: Int, id: Int, folders: List<NotesDb.Folder>, current: String?, c: Colors, room: Float) {
    val dm = ctx.resources.displayMetrics
    fun dp(x: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, x, dm)
    fun sp(x: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, x, dm)
    v.removeAllViews(container)
    val tabs = listOf<Pair<String?, String>>(null to ctx.getString(R.string.base_folder)) + folders.map { it.id to it.name }
    val curTab = tabs.indexOfFirst { it.first == current }.coerceAtLeast(0)
    val tabPaint = paint(sp(15f), 0f)
    val boldPaint = paint(sp(15f), 0f).apply { typeface = Typeface.create("sans-serif", Typeface.BOLD) }
    val widths = tabs.mapIndexed { i, (_, name) -> (if (i == curTab) boldPaint else tabPaint).measureText(name) + dp(TAB_GAP) }
    /** 지금 폴더에서 시작해 오른쪽·왼쪽을 번갈아 채운 범위와 쓴 폭 */
    fun window(room: Float): Triple<Int, Int, Float> {
      var first = curTab
      var last = curTab
      var used = widths[curTab]
      while (true) {
        val right = last + 1 < tabs.size && used + widths[last + 1] <= room
        if (right) { last++; used += widths[last] }
        val left = first > 0 && used + widths[first - 1] <= room
        if (left) { first--; used += widths[first] }
        if (!right && !left) break
      }
      return Triple(first, last, used)
    }
    /** 가려진 쪽마다 끝 탭이 적어도 차지할 폭(왼쪽 끝 탭은 뒤 탭과의 사이까지) */
    fun peekRoom(first: Int, last: Int) = (if (first > 0) dp(PEEK_MIN + TAB_GAP) else 0f) + (if (last < tabs.size - 1) dp(PEEK_MIN) else 0f)
    var (first, last, used) = window(room)
    // 남는 폭이 끝 탭에 모자라면 그만큼 비우고 다시. 끝 탭이 둘이면 남는 폭을 반씩 나눠 쓴다
    val need = peekRoom(first, last) * (if (first > 0 && last < tabs.size - 1) 2 else 1)
    if (room - used < need) {
      val fit = window(room - need)
      first = fit.first
      last = fit.second
    }
    // 지금 폴더 이름이 줄보다 길면 끝을 …로(옆 폴더 탭이 들어갈 자리를 남긴다)
    val curMax = (room - peekRoom(first, last)).coerceAtLeast(dp(48f)).toInt()
    fun addTab(i: Int, layout: Int = R.layout.widget_home_tab) {
      val (fid, name) = tabs[i]
      val tab = RemoteViews(ctx.packageName, layout)
      val sel = i == curTab
      if (sel) tab.setInt(R.id.tab, "setMaxWidth", curMax)
      tab.setTextViewText(R.id.tab, if (sel) SpannableString(name).apply { setSpan(StyleSpan(Typeface.BOLD), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) } else name)
      c.set(tab, R.id.tab, "setTextColor") { if (sel) it.text else it.muted }
      val go = Intent(ctx, NotesWidgetProvider::class.java).setAction(NotesWidgetProvider.ACTION_FOLDER)
        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
        .putExtra(NotesWidgetProvider.EXTRA_FOLDER, fid ?: "")
        .setData(Uri.parse("naegirok://widget-folder/$id/${fid ?: "base"}"))
      tab.setOnClickPendingIntent(R.id.tab, broadcast(ctx, id, go))
      tab.setContentDescription(R.id.tab, ctx.getString(if (sel) R.string.widget_folder_tab_current else R.string.widget_folder_tab, name))
      v.addView(container, tab)
    }
    if (first > 0) addTab(first - 1, R.layout.widget_home_tab_peek_start)
    for (i in first..last) addTab(i)
    if (last < tabs.size - 1) addTab(last + 1, R.layout.widget_home_tab_peek)
  }

  /**
   * 목록 안을 누르면 이 신호 하나로 위젯 수신기에 온다(목록 하나에 틀 하나). 무엇을 할지는 줄마다 채워 넣는 값(fill)으로 알린다.
   * 채워 넣으려면 바꿀 수 있는(MUTABLE) 신호여야 한다. 받는 곳은 이 앱의 위젯 수신기로 정해 두어 다른 곳으로 바뀌지 않는다
   */
  private fun itemTemplate(ctx: Context, id: Int): PendingIntent {
    val tpl = Intent(ctx, NotesWidgetProvider::class.java).setAction(NotesWidgetProvider.ACTION_ITEM)
      .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
      .setData(Uri.parse("naegirok://widget-item/$id"))
    return PendingIntent.getBroadcast(ctx, id, tpl, PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  private fun fill(what: String, todo: String? = null, folder: String? = null) = Intent()
    .putExtra(NotesWidgetProvider.EXTRA_ITEM, what)
    .putExtra(NotesWidgetProvider.EXTRA_TODO, todo)
    .putExtra(NotesWidgetProvider.EXTRA_FOLDER, folder ?: "")

  /** 목록 맨 위의 메모 전체: 누르면 메모 고치기 창(보기만 공유된 폴더는 앱의 그 폴더) */
  private fun memoItem(ctx: Context, data: Data, c: Colors, memoSp: Float) =
    RemoteViews(ctx.packageName, R.layout.widget_home_memo).apply {
      setTextViewText(R.id.memo_text, data.memo)
      setTextViewTextSize(R.id.memo_text, TypedValue.COMPLEX_UNIT_SP, memoSp)
      c.set(this, R.id.memo_text, "setTextColor") { it.text }
      if (data.readOnly) {
        setOnClickFillInIntent(R.id.memo_text, fill(NotesWidgetProvider.ITEM_OPEN, folder = data.folderId))
        setContentDescription(R.id.memo_text, data.memo.take(200))
      } else {
        setOnClickFillInIntent(R.id.memo_text, fill(NotesWidgetProvider.ITEM_MEMO, folder = data.folderId))
        setContentDescription(R.id.memo_text, ctx.getString(R.string.edit_memo) + ": " + data.memo.take(200))
      }
    }

  /** 목록 끝 '외 N개': 위젯에 다 싣지 않은 할 일. 누르면 앱의 그 폴더 */
  private fun moreItem(ctx: Context, folderId: String?, more: Int, c: Colors, sizeSp: Float) =
    RemoteViews(ctx.packageName, R.layout.widget_home_more).apply {
      setTextViewText(R.id.more_text, ctx.getString(R.string.lock_more, more))
      setTextViewTextSize(R.id.more_text, TypedValue.COMPLEX_UNIT_SP, sizeSp)
      c.set(this, R.id.more_text, "setTextColor") { it.muted }
      setOnClickFillInIntent(R.id.more_text, fill(NotesWidgetProvider.ITEM_OPEN, folder = folderId))
    }

  /**
   * 홈 화면: 놓인 칸 크기에 맞는 모양(sized). 크면 full(메모 + 할 일 목록)
   */
  fun responsive(ctx: Context, mgr: AppWidgetManager, id: Int, scrollTop: Boolean, full: RemoteViews): RemoteViews =
    sized(ctx, mgr, id, loadSmall(ctx, id, keyguard = false), scrollTop, full)

  /**
   * 칸 크기에 맞는 모양. Android 12+는 크기별 모양을 함께 넘겨 런처·잠금화면이 실제 칸에 맞는 것을 고르고, 그 아래는 런처가 알려 준 크기로:
   * 폭 110dp 미만(동그라미 칸) = 로고 + 남은 개수, 높이 56dp 미만 = 한 줄(line), 그 위 = 위 줄(로고 · 폴더 · 이전/다음 폴더) + 할 일 하나(card),
   * full이 있으면(홈) 150dp부터 목록. 어느 모양이든 글자를 누르면 다음 할 일.
   * 작은 칸은 홈이든 잠금화면이든 같은 모양: 삼성 잠금화면이 잠금화면 위젯을 홈 화면 위젯처럼 알려 줘도 같게,
   * 넓은 칸의 높이가 30~40dp쯤이라 그보다 낮아도 한 줄로(예전엔 40dp 아래면 개수만 보였다, 사용자 제보 2026-10-23)
   */
  private fun sized(ctx: Context, mgr: AppWidgetManager, id: Int, s: Small, scrollTop: Boolean, full: RemoteViews?): RemoteViews {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val map = linkedMapOf(
        SizeF(40f, 40f) to tiny(ctx, id, s),
        SizeF(SMALL_W, 1f) to line(ctx, id, s),
        SizeF(SMALL_W, CARD_H) to card(ctx, id, s, roomy = false),
        SizeF(SMALL_W, ROOMY_H) to card(ctx, id, s, roomy = true),
      )
      if (full != null) map[SizeF(160f, FULL_H)] = full
      return RemoteViews(map)
    }
    val o = mgr.getAppWidgetOptions(id)
    val w = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)
    val h = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0)
    return when {
      w in 1 until SMALL_W.toInt() -> tiny(ctx, id, s)
      h in 1 until CARD_H.toInt() -> line(ctx, id, s)
      h in 1 until ROOMY_H.toInt() -> card(ctx, id, s, roomy = false)
      full != null && (h == 0 || h >= FULL_H) -> full
      else -> card(ctx, id, s, roomy = true)
    }
  }

  /** 작은 칸·잠금화면 모양에 쓰는 것: 지금 폴더·메모·남은 할 일·보던 자리. privacy = 잠금화면 공개 범위(홈은 늘 public) */
  private class Small(
    val colors: Colors, val folderId: String?, val folders: List<NotesDb.Folder>, val todos: List<NotesDb.Todo>, val count: Int,
    val signedIn: Boolean, val readOnly: Boolean, val privacy: String, val wp: WidgetPrefs, val keyguard: Boolean,
    val memo: CharSequence = "",
    /** 위젯 폭(dp, 세로 화면): 위 줄에 폴더 탭을 몇 개 그릴지 */
    val widthDp: Int = 260,
  )

  private fun loadSmall(ctx: Context, id: Int, keyguard: Boolean): Small {
    val wp = WidgetPrefs.load(ctx, id)
    val w = AppWidgetManager.getInstance(ctx).getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0).takeIf { it > 0 } ?: 260
    // 잠금화면에 놓인 위젯은 꾸미기 잠금 위젯 탭의 색 · 투명도 · 체크 위치
    val look = if (keyguard) SurfaceTheme.LOCK else "widget"
    return NotesDb.use(ctx) { db ->
      val prefs = NotesDb.prefs(db)
      // 잠금화면에서는 잠금화면 알림과 같은 공개 범위(내용 보이기 · 개수만 · 숨기기)를 따른다
      val privacy = if (keyguard) prefs.optJSONObject("lock")?.optString("visibility", "private") ?: "private" else "public"
      if (!NotesDb.signedIn(db)) return@use Small(Colors.of(ctx, prefs, look), null, emptyList(), emptyList(), 0, false, false, privacy, wp, keyguard, widthDp = w)
      // 홈에서 숨긴 공유 폴더·없어진 폴더는 기본 폴더로(큰 위젯과 같다)
      val folders = NotesDb.folders(db)
      val fid = folders.firstOrNull { it.id == wp.folderId }?.id
      Small(
        Colors.of(ctx, prefs, look), fid, folders, NotesDb.todos(db, fid, limit = NEXT_LIMIT), NotesDb.countTodos(db, fid),
        true, NotesDb.viewOnly(db, fid), privacy, wp, keyguard, memoText(NotesDb.memo(db, fid)), w,
      )
    } ?: Small(Colors.of(ctx, org.json.JSONObject(), look), null, emptyList(), emptyList(), 0, false, false, "private", wp, keyguard, widthDp = w)
  }

  /** 바탕: 위젯마다 고른 투명도가 없으면 꾸미기의 위젯 투명도(잠금화면이면 잠금 위젯 탭, Small.colors가 그 설정으로 만들어진다) */
  private fun background(v: RemoteViews, c: Colors, s: Small) {
    c.set(v, R.id.widget_bg, "setColorFilter") { it.card }
    v.setInt(R.id.widget_bg, "setImageAlpha", ((s.wp.opacity ?: c.now.opacity) * 255).roundToInt())
    c.set(v, R.id.widget_mark, "setColorFilter") { it.mark }
  }

  /** 동그라미·아주 작은 칸: 로고 + 남은 할 일 수(숨기기면 로고만). 누르면 앱의 그 폴더 */
  private fun tiny(ctx: Context, id: Int, s: Small) = RemoteViews(ctx.packageName, R.layout.widget_tiny).apply {
    background(this, s.colors, s)
    val show = s.signedIn && s.privacy != "secret"
    setViewVisibility(R.id.tiny_count, if (show) View.VISIBLE else View.GONE)
    setTextViewText(R.id.tiny_count, if (s.count > 99) "99+" else s.count.toString())
    s.colors.set(this, R.id.tiny_count, "setTextColor") { it.text }
    setOnClickPendingIntent(R.id.tiny_root, activity(ctx, id, openApp(ctx, s.folderId, id)))
    setContentDescription(R.id.tiny_root, if (show) ctx.getString(R.string.lock_title, s.count) else ctx.getString(R.string.widget_open_app))
  }

  /** 한 줄만 들어가는 낮은 칸: 동그라미 · 할 일 한 줄 · 몇 번째/몇 개(맨 오른쪽). 화살표 단추는 두지 않는다(사용자 요청 2026-10-23) */
  private fun line(ctx: Context, id: Int, s: Small) = RemoteViews(ctx.packageName, R.layout.widget_line).apply {
    background(this, s.colors, s)
    one(this, ctx, id, s, tall = false)
  }

  fun lock(ctx: Context, mgr: AppWidgetManager, id: Int, scrollTop: Boolean): RemoteViews =
    sized(ctx, mgr, id, loadSmall(ctx, id, keyguard = true), scrollTop, full = null)

  /**
   * 잠금화면·작은 칸 위젯: 할 일 하나씩(동그라미 · 할 일 · 아래 줄 · 몇 번째/몇 개), 누르면 다음 할 일(one).
   * 카드 넘기기(StackView)는 이상하게 보여 한 줄 칸과 같은 방식으로 바꿨다(사용자 요청 2026-10-23).
   * 위 줄(로고(누르면 앱) · 폴더 이름 · 이전/다음 폴더)은 늘 보인다: 예전엔 100dp부터라 잠금화면 칸에서는 빠져 로고·폴더 이름이 안 보였다
   * (사용자 제보 2026-10-23). 잠금화면 알림의 공개 범위(내용 · 개수만 · 숨기기)를 따른다.
   */
  private fun card(ctx: Context, id: Int, s: Small, roomy: Boolean) =
    RemoteViews(ctx.packageName, if (roomy) R.layout.widget_lock_roomy else R.layout.widget_lock).apply {
    val c = s.colors
    background(this, c, s)
    // 앱은 로고로만 연다(폴더 이름·빈 곳을 눌러 앱이 켜지지 않게)
    setOnClickPendingIntent(R.id.lock_brand, activity(ctx, id, openApp(ctx, s.folderId, id)))
    setContentDescription(R.id.lock_brand, ctx.getString(R.string.widget_open_app))
    // 폴더 이름들: 홈 위젯 머리와 같은 탭 줄(누르면 그 폴더로·가운데로, ‹ ›는 뺐다, 사용자 요청 2026-10-24)
    val room = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, s.widthDp - LOCK_SIDE_PAD * 2 - LOCK_BRAND_W, ctx.resources.displayMetrics)
    folderTabs(ctx, this, R.id.lock_tabs, id, s.folders, s.folderId, c, room)
    one(this, ctx, id, s, tall = true, roomy = roomy)
  }

  /**
   * 할 일 하나를 보이는 칸(한 줄 widget_line · 작은 칸 widget_lock, 같은 one_* id). 동그라미 = 완료(완료 움직임),
   * 글자나 몇 번째/몇 개를 누르면 다음 할 일(마지막이면 처음으로, WidgetPrefs.pos), 할 일이 하나뿐이면 누르면 고치기.
   * 할 일이 없으면 메모(누르면 메모 고치기) 또는 안내(로그인 · 개수만 · 숨기기, 누르면 앱).
   * tall = 작은 칸: 글자 한 단계 크게, 누르는 자리는 할 일과 아래 줄 전체(one_body). roomy = 넉넉한 작은 칸: 아래 줄(날짜·반복)·두 줄 글·여러 줄 메모
   */
  private fun one(v: RemoteViews, ctx: Context, id: Int, s: Small, tall: Boolean, roomy: Boolean = false) = v.apply {
    val c = s.colors
    // 체크 위치(꾸미기, 홈·잠금화면 따로). 동그라미가 오른쪽이면 글자가 왼쪽 끝(위 줄 로고 자리)에서 시작하게 줄 여백을 바꾼다
    val end = c.now.checkEnd
    val dp = ctx.resources.displayMetrics.density
    fun px(v: Float) = (v * dp).roundToInt()
    if (tall) setViewPadding(R.id.one_row, 0, 0, if (end) 0 else px(2f), 0)
    else setViewPadding(R.id.one_row, px(if (end) 10f else 6f), 0, px(if (end) 6f else 14f), 0)
    val size = if (tall) s.wp.textSize + 1 else s.wp.textSize
    setTextViewTextSize(R.id.one_text, TypedValue.COMPLEX_UNIT_SP, size)
    c.set(this, R.id.one_pos, "setTextColor") { it.muted }
    val tap = if (tall) R.id.one_body else R.id.one_text
    val open = activity(ctx, id, openApp(ctx, s.folderId, id))
    val note = when {
      !s.signedIn -> ctx.getString(R.string.login_first)
      s.privacy == "secret" -> ctx.getString(R.string.lock_hidden)
      s.privacy != "public" -> ctx.getString(R.string.lock_title, s.count)
      else -> null
    }
    val n = if (note == null && s.wp.show != WidgetPrefs.Show.MEMO) s.todos.size else 0
    if (n == 0) {
      // 할 일 대신: 안내, 또는 메모(누르면 메모 고치기)
      val memo = note == null && s.wp.show != WidgetPrefs.Show.TODOS && s.memo.isNotBlank()
      setViewVisibility(ONE_START.flip, View.GONE)
      setViewVisibility(ONE_END.flip, View.GONE)
      setViewVisibility(R.id.one_pos, View.GONE)
      if (tall) {
        setViewVisibility(R.id.one_meta, View.GONE)
        setInt(R.id.one_text, "setMaxLines", if (roomy) 4 else 1)
      }
      setTextViewText(R.id.one_text, note ?: if (memo) s.memo else "")
      c.set(this, R.id.one_text, "setTextColor") { if (note != null) it.muted else it.text }
      if (memo && !s.readOnly) {
        val edit = Intent(ctx, WidgetEditActivity::class.java)
          .putExtra(WidgetEditActivity.EXTRA_MEMO_FOLDER, s.folderId ?: WidgetEditActivity.BASE)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
          .setData(Uri.parse("naegirok://edit/memo/${s.folderId ?: "base"}/$id"))
        setOnClickPendingIntent(tap, activity(ctx, id, edit))
        setContentDescription(tap, ctx.getString(R.string.edit_memo) + ": " + s.memo.take(200))
      } else {
        setOnClickPendingIntent(tap, open)
      }
      return@apply
    }
    val i = Math.floorMod(s.wp.pos, n)
    val t = s.todos[i]
    val done = t.id in NotesWidgetProvider.completing
    setTextViewText(R.id.one_text, if (done) struck(Rich.spanned(t.text)) else Rich.spanned(t.text))
    c.set(this, R.id.one_text, "setTextColor") { if (done) it.muted else it.text }
    if (tall) {
      val parts = if (!roomy) emptyList() else CardMeta.parts(t.due, t.remindAt, t.repeatFreq, t.repeatDays, false, ctx.resources.configuration.locales[0].language)
      setViewVisibility(R.id.one_meta, if (parts.isEmpty()) View.GONE else View.VISIBLE)
      setInt(R.id.one_text, "setMaxLines", if (roomy && parts.isEmpty()) 2 else 1)
      if (parts.isNotEmpty()) {
        setTextViewText(R.id.one_meta, metaLine(parts))
        setTextViewTextSize(R.id.one_meta, TypedValue.COMPLEX_UNIT_SP, s.wp.textSize - 2)
        c.set(this, R.id.one_meta, "setTextColor") { it.muted }
      }
    }
    val ck = pick(this, end, ONE_START, ONE_END)
    setImageViewResource(ck.ring, if (t.repeatFreq != null) R.drawable.naegirok_check_repeat else R.drawable.naegirok_check_off)
    c.set(this, ck.ring, "setColorFilter") { it.circle }
    c.set(this, ck.fill, "setColorFilter") { it.accent }
    c.set(this, ck.tick, "setColorFilter") { it.onAccent }
    setDisplayedChild(ck.flip, if (done) 1 else 0)
    val toggle = Intent(ctx, NotesWidgetProvider::class.java).setAction(NotesWidgetProvider.ACTION_TOGGLE)
      .putExtra(NotesWidgetProvider.EXTRA_TODO, t.id)
      .setData(Uri.parse("naegirok://toggle/$id/${t.id}"))
    setOnClickPendingIntent(ck.flip, if (s.readOnly) open else broadcast(ctx, id, toggle))
    setContentDescription(ck.flip, if (s.readOnly) ctx.getString(R.string.widget_open_app) else ctx.getString(R.string.mark_done, Rich.plain(t.text)))
    // 몇 번째/몇 개: 맨 오른쪽(하나뿐이면 숨긴다)
    setViewVisibility(R.id.one_pos, if (s.count > 1) View.VISIBLE else View.GONE)
    setTextViewText(R.id.one_pos, "${i + 1}/${s.count}")
    if (n > 1) {
      val next = Intent(ctx, NotesWidgetProvider::class.java).setAction(NotesWidgetProvider.ACTION_NEXT)
        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
        .setData(Uri.parse("naegirok://widget-next/$id"))
      // 글자와 맨 오른쪽 몇 번째/몇 개 어느 쪽을 눌러도 다음 할 일
      setOnClickPendingIntent(tap, broadcast(ctx, id, next))
      setOnClickPendingIntent(R.id.one_pos, broadcast(ctx, id, next))
      setContentDescription(tap, Rich.plain(t.text) + ". " + ctx.getString(R.string.next_todo))
      setContentDescription(R.id.one_pos, "${i + 1}/${s.count}. " + ctx.getString(R.string.next_todo))
    } else {
      val edit = Intent(ctx, WidgetEditActivity::class.java)
        .putExtra(WidgetEditActivity.EXTRA_TODO, t.id)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        .setData(Uri.parse("naegirok://edit/todo/${t.id}/$id"))
      setOnClickPendingIntent(tap, if (s.readOnly) open else activity(ctx, id, edit))
      setContentDescription(tap, ctx.getString(R.string.edit_todo) + ": " + Rich.plain(t.text))
    }
  }

  /** 그리기에 실패한 위젯: 바탕 + 로고(누르면 앱)만. 흰 빈 상자로 남아 눌러도 아무 일이 없지 않게 */
  fun fallback(ctx: Context, id: Int): RemoteViews {
    val c = Colors.of(ctx, org.json.JSONObject())
    val v = RemoteViews(ctx.packageName, R.layout.widget_home)
    c.set(v, R.id.widget_bg, "setColorFilter") { it.card }
    c.set(v, R.id.widget_mark, "setColorFilter") { it.mark }
    v.setViewVisibility(R.id.widget_add, View.GONE)
    v.setOnClickPendingIntent(R.id.widget_brand, activity(ctx, id, openApp(ctx, null, id)))
    v.setOnClickPendingIntent(R.id.widget_root, activity(ctx, id, openApp(ctx, null, id)))
    v.setContentDescription(R.id.widget_brand, ctx.getString(R.string.widget_open_app))
    return v
  }

  private fun todoRow(
    ctx: Context, t: NotesDb.Todo, lang: String, c: Colors,
    titleSp: Float, metaSp: Float, titleH: Int, metaH: Int, blockH: Int, plainLines: Int, rowPad: Int, readOnly: Boolean,
  ) = RemoteViews(ctx.packageName, R.layout.widget_home_todo).apply {
    setViewPadding(R.id.item_row, 0, rowPad, 0, rowPad)
    // 체크 위치(꾸미기 홈 위젯 탭, 없으면 공통): 그쪽 동그라미만, 글과 동그라미 사이 8dp
    val end = c.now.checkEnd
    val ck = pick(this, end, ITEM_START, ITEM_END)
    val gap = (8 * ctx.resources.displayMetrics.density).roundToInt()
    setViewPadding(R.id.item_body, if (end) 0 else gap, 0, if (end) gap else 0, 0)
    // 완료하는 중(동그라미를 막 눌렀다): 채운 동그라미 + 체크, 글은 회색 줄 그음. 잠시 뒤 목록에서 빠진다(NotesWidgetProvider.complete)
    val done = t.id in NotesWidgetProvider.completing
    setTextViewText(R.id.item_text, if (done) struck(Rich.spanned(t.text)) else Rich.spanned(t.text))
    setTextViewTextSize(R.id.item_text, TypedValue.COMPLEX_UNIT_SP, titleSp)
    c.set(this, R.id.item_text, "setTextColor") { if (done) it.muted else it.text }
    val parts = CardMeta.parts(t.due, t.remindAt, t.repeatFreq, t.repeatDays, false, lang)
    if (parts.isEmpty()) {
      // 제목만: 보조 줄 자리까지 같은 높이에 세로 가운데, plainLines줄까지 …
      // (setHeight가 최대 줄 수를 픽셀 높이로 덮어써 …없이 잘리므로 줄 수는 그 뒤에 다시 준다)
      setViewVisibility(R.id.item_meta, View.GONE)
      setInt(R.id.item_text, "setHeight", blockH)
      setInt(R.id.item_text, "setMaxLines", plainLines)
    } else {
      setViewVisibility(R.id.item_meta, View.VISIBLE)
      setTextViewText(R.id.item_meta, metaLine(parts))
      setTextViewTextSize(R.id.item_meta, TypedValue.COMPLEX_UNIT_SP, metaSp)
      c.set(this, R.id.item_meta, "setTextColor") { it.muted }
      setInt(R.id.item_text, "setHeight", titleH)
      setInt(R.id.item_text, "setMaxLines", 1)
      setInt(R.id.item_meta, "setHeight", metaH)
      setInt(R.id.item_meta, "setMaxLines", 1)
    }
    // 일반은 빈 원, 반복은 원 테두리가 두 곡선 화살표(앱 카드와 같은 모양)
    setImageViewResource(ck.ring, if (t.repeatFreq != null) R.drawable.naegirok_check_repeat else R.drawable.naegirok_check_off)
    c.set(this, ck.ring, "setColorFilter") { it.circle }
    c.set(this, ck.fill, "setColorFilter") { it.accent }
    c.set(this, ck.tick, "setColorFilter") { it.onAccent }
    setDisplayedChild(ck.flip, if (done) 1 else 0)
    setContentDescription(ck.flip, if (readOnly) ctx.getString(R.string.widget_open_app) else ctx.getString(R.string.mark_done, Rich.plain(t.text)))
    // 동그라미 = 완료(반복은 이번 회차만, 앱과 같은 저장·동기화 경로), 글자 = 그 할 일 고치기.
    // 보기만 공유된 폴더: 완료·고치기 대신 앱의 그 폴더로(위젯에서 바꿔도 서버가 받지 않는다)
    val open = fill(NotesWidgetProvider.ITEM_OPEN, folder = t.folderId)
    setOnClickFillInIntent(ck.flip, if (readOnly) open else fill(NotesWidgetProvider.ITEM_TOGGLE, todo = t.id))
    // 글자뿐 아니라 줄 위아래 빈 곳을 눌러도 고치기(동그라미는 따로 완료)
    val edit = if (readOnly) open else fill(NotesWidgetProvider.ITEM_EDIT, todo = t.id)
    setOnClickFillInIntent(R.id.item_row, edit)
    setOnClickFillInIntent(R.id.item_body, edit)
    setContentDescription(R.id.item_body, ctx.getString(R.string.edit_todo) + ": " + Rich.plain(t.text))
  }

  /** 동그라미 한 벌의 id(줄 왼쪽 · 오른쪽 자리) */
  private class Check(val flip: Int, val ring: Int, val fill: Int, val tick: Int)
  private val ITEM_START = Check(R.id.item_check, R.id.item_ring, R.id.item_fill, R.id.item_tick)
  private val ITEM_END = Check(R.id.item_check_end, R.id.item_ring_end, R.id.item_fill_end, R.id.item_tick_end)
  private val ONE_START = Check(R.id.one_check, R.id.one_ring, R.id.one_fill, R.id.one_tick)
  private val ONE_END = Check(R.id.one_check_end, R.id.one_ring_end, R.id.one_fill_end, R.id.one_tick_end)

  /** 체크 위치 쪽 동그라미만 보이고 그 id를 돌려준다(꾸미기의 체크 위치, 사용자 요청 2026-10-24) */
  private fun pick(v: RemoteViews, end: Boolean, start: Check, endIds: Check): Check {
    v.setViewVisibility(start.flip, if (end) View.GONE else View.VISIBLE)
    v.setViewVisibility(endIds.flip, if (end) View.VISIBLE else View.GONE)
    return if (end) endIds else start
  }

  /** 완료하는 중인 글: 전체에 줄을 긋는다(꾸밈은 그대로) */
  private fun struck(text: CharSequence): CharSequence =
    SpannableStringBuilder(text).apply { setSpan(StrikethroughSpan(), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }

  /** 할 일 아래 줄: 조각을 '  ·  '로 잇고 기한이 지난 조각은 빨간색(잠금화면 위젯도 같은 줄을 쓴다) */
  internal fun metaLine(parts: List<CardMeta.Part>): CharSequence {
    val line = SpannableStringBuilder()
    parts.forEachIndexed { i, p ->
      if (i > 0) line.append("  ·  ")
      val start = line.length
      line.append(p.text)
      if (p.late) line.setSpan(ForegroundColorSpan(LATE), start, line.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
    return line
  }

  private fun paint(px: Float, letterSpacing: Float) = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    textSize = px
    this.letterSpacing = letterSpacing
    typeface = Typeface.create("sans-serif", Typeface.NORMAL)
  }

  /** 위젯 TextView와 같은 설정(글꼴 여백 포함, 단순 줄바꿈, 하이픈 없음, 대체 글꼴 줄 높이)으로 글을 배치해 잰다 */
  private fun layout(text: CharSequence, paint: TextPaint, width: Int, mult: Float): StaticLayout =
    StaticLayout.Builder.obtain(text, 0, text.length, paint, width.coerceAtLeast(1))
      .setLineSpacing(0f, mult)
      .setIncludePad(true)
      .setBreakStrategy(Layout.BREAK_STRATEGY_SIMPLE)
      .setHyphenationFrequency(Layout.HYPHENATION_FREQUENCY_NONE)
      .apply { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) setUseLineSpacingFromFallbacks(true) }
      .build()

  private fun openApp(ctx: Context, folderId: String?, widgetId: Int) =
    Intent(Intent.ACTION_VIEW, Uri.parse("naegirok://?folder=${folderId ?: "base"}&w=$widgetId"))
      .setPackage(ctx.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

  private fun activity(ctx: Context, code: Int, intent: Intent) =
    PendingIntent.getActivity(ctx, code, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

  private fun broadcast(ctx: Context, code: Int, intent: Intent) =
    PendingIntent.getBroadcast(ctx, code, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
}
