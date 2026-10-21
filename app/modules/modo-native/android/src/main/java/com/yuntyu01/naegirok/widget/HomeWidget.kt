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
import android.text.style.StyleSpan
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
    val opacity = t.opacity
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
      fun of(ctx: Context, prefs: org.json.JSONObject): Colors {
        val cur = SurfaceTheme.from(ctx, prefs)
        if (!SurfaceTheme.followsSystem(prefs)) return Pal(cur).let { Colors(it, it, cur.dark) }
        return Colors(Pal(SurfaceTheme.from(ctx, prefs, dark = false)), Pal(SurfaceTheme.from(ctx, prefs, dark = true)), cur.dark)
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

    // 폴더 탭(로고 오른쪽, 누르면 그 폴더의 첫 쪽으로): 기본 + 폴더들. 폭이 모자라면 지금 폴더를 가운데 두고 양옆을 채운 뒤
    // 가려진 쪽 끝에 바로 옆 폴더를 잘린 채로("제주…") 보여 준다(안 그리면 네 번째 폴더부터 있는지조차 몰랐다).
    // 위젯은 옆으로 밀 수 없어서, 잘린 탭을 누르면 그 폴더로 가며 가운데로 오고 그 옆이 드러난다
    v.removeAllViews(R.id.widget_tabs)
    val tabs = listOf<Pair<String?, String>>(null to ctx.getString(R.string.base_folder)) + data.folders.map { it.id to it.name }
    val curTab = tabs.indexOfFirst { it.first == data.folderId }.coerceAtLeast(0)
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
    val room = dp(wDp - PAD_START - PAD_END - MARK_W - MARK_GAP)
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
      v.addView(R.id.widget_tabs, tab)
    }
    if (first > 0) addTab(first - 1, R.layout.widget_home_tab_peek_start)
    for (i in first..last) addTab(i)
    if (last < tabs.size - 1) addTab(last + 1, R.layout.widget_home_tab_peek)

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
    setTextViewText(R.id.item_text, Rich.spanned(t.text))
    setTextViewTextSize(R.id.item_text, TypedValue.COMPLEX_UNIT_SP, titleSp)
    c.set(this, R.id.item_text, "setTextColor") { it.text }
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
    setImageViewResource(R.id.item_check, if (t.repeatFreq != null) R.drawable.naegirok_check_repeat else R.drawable.naegirok_check_off)
    c.set(this, R.id.item_check, "setColorFilter") { it.circle }
    setContentDescription(R.id.item_check, if (readOnly) ctx.getString(R.string.widget_open_app) else ctx.getString(R.string.mark_done, Rich.plain(t.text)))
    // 동그라미 = 완료(반복은 이번 회차만, 앱과 같은 저장·동기화 경로), 글자 = 그 할 일 고치기.
    // 보기만 공유된 폴더: 완료·고치기 대신 앱의 그 폴더로(위젯에서 바꿔도 서버가 받지 않는다)
    val open = fill(NotesWidgetProvider.ITEM_OPEN, folder = t.folderId)
    setOnClickFillInIntent(R.id.item_check, if (readOnly) open else fill(NotesWidgetProvider.ITEM_TOGGLE, todo = t.id))
    // 글자뿐 아니라 줄 위아래 빈 곳을 눌러도 고치기(동그라미는 따로 완료)
    val edit = if (readOnly) open else fill(NotesWidgetProvider.ITEM_EDIT, todo = t.id)
    setOnClickFillInIntent(R.id.item_row, edit)
    setOnClickFillInIntent(R.id.item_body, edit)
    setContentDescription(R.id.item_body, ctx.getString(R.string.edit_todo) + ": " + Rich.plain(t.text))
  }

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
