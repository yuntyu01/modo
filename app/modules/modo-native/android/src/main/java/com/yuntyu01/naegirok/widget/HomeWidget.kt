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
import com.yuntyu01.naegirok.NotesDb
import com.yuntyu01.naegirok.QuickAddActivity
import com.yuntyu01.naegirok.SurfaceTheme
import com.yuntyu01.naegirok.WidgetEditActivity
import com.yuntyu01.naegirok.nativelib.R
import kotlin.math.floor
import kotlin.math.roundToInt

/**
 * 홈 화면 위젯(시안): 로고 · 폴더 탭(한 줄, 앱과 같이 누르면 그 폴더로) / 쪽 내용 / 쪽 점 · +.
 *
 * - 기본 모드: 첫 쪽은 그 폴더의 메모만, 다음 쪽부터 할 일만(한 쪽에 같이 두지 않는다). 점 = 메모 쪽 1 + 할 일 쪽 수.
 *   메모가 없으면 할 일 쪽만, 할 일이 없으면 빈 할 일 쪽 하나(+로 추가).
 * - 메모를 누르면 메모 읽기 모드: 본문을 실제 줄바꿈으로 쪽에 나눠 보여 주고 점은 메모 쪽만. 다시 누르면 기본 모드의 메모 쪽으로.
 *   마지막 메모 쪽에서 할 일로 넘어가지 않는다. +는 할 일 쪽에만.
 * - 쪽 넘기기는 점을 누른다: 홈 위젯(RemoteViews)에는 가로로 밀기를 받는 뷰가 없다(목록형 뷰도 세로 스크롤·StackView 위아래 넘김뿐).
 *   홈 화면에서 옆으로 밀면 런처가 화면을 넘기고 그 터치는 위젯의 누르기로 오지 않는다.
 *
 * 메모 줄 수와 한 쪽 할 일 수는 위젯 크기(런처가 알려 준 dp)와 실제 글꼴·줄바꿈(StaticLayout, 시스템 글자 크기 반영)으로 잰다.
 * 글자·누르는 곳을 줄여 맞추지 않고, 크기가 크면 더 많이 담는다. 잠금화면 위젯은 NotesWidgetProvider의 예전 모양 그대로.
 */
object HomeWidget {
  // widget_home.xml·widget_home_todo.xml의 여백(dp). 쪽 계산이 이 값에 기대므로 함께 바꿀 것
  private const val PAD_START = 22f
  private const val PAD_END = 12f
  private const val PAD_TOP = 4f
  private const val PAD_BOTTOM = 34f
  /** 머리 한 줄: 맨 왼쪽 로고 + 폴더 탭(앱과 같이 메모 바로 위) */
  private const val HEADER = 36f
  /** 로고(높이 15, naegirok_mark 비율)와 탭 사이(widget_brand paddingEnd) */
  private const val MARK_W = 15f * 1148.5f / 432f
  private const val MARK_GAP = 14f
  /** 탭 사이(widget_home_tab.xml paddingEnd) */
  private const val TAB_GAP = 18f
  private const val TEXT_PAD_END = 10f
  private const val MEMO_PAD_V = 4f
  private const val ROW_PAD_V = 4f
  private const val ROW_CHECK = 44f
  /** 제목과 보조 줄 사이(앱 카드와 같이 0: 줄 높이 안의 글자 여백만으로 붙는다). widget_home_todo.xml과 같게 */
  private const val META_GAP = 0f
  /** 쪽 점 간격(시안 약 20dp). 양 끝 점은 바깥으로 DOT_EDGE만큼 더 눌린다 */
  private const val DOT = 20f
  private const val DOT_EDGE = 12f
  /** 남는 높이를 줄마다 나눠 줄 때 한 줄에 더하는 최대(크게 남아도 할 일이 쪽 가운데로 떠 보이지 않게) */
  private const val ROW_EXTRA_MAX = 16f
  /** 아래 줄 양쪽에서 점이 쓰지 않는 자리(+ 버튼 44 + 여백) */
  private const val DOT_RESERVE = 52f
  /** 메모 줄 간격(시안: 넉넉하게 — 최소 크기에서 메모 3줄이 할 일 2줄 자리와 맞는다). widget_home.xml과 같게 */
  private const val LINE_MULT = 1.3f
  /** 잰 값과 실제 그리기의 반올림 차이로 마지막 줄이 잘리지 않게 남기는 여유 */
  private const val SLACK = 2f

  const val KIND_BASE = "base"
  const val KIND_READ = "read"

  // 다크 바탕은 파란 기 없는 차콜(꾸미기에서 카드색을 직접 고르면 그 색). 글자·보조 글자·동그라미도 같은 회색 계열
  private val CHARCOAL = Color.rgb(42, 42, 44)
  private val NEUTRAL_TEXT = Color.rgb(245, 245, 247)
  private val NEUTRAL_MUTED = Color.rgb(161, 161, 166)
  private val NEUTRAL_CIRCLE = Color.rgb(176, 176, 181)
  /** 기한이 지난 날짜(앱 카드와 같은 빨간색) */
  private val LATE = Color.parseColor("#FF6B6B")

  /** memo = 읽기 모드 본문(문단 사이 빈 줄 그대로), preview = 메모 쪽 미리보기(빈 문단을 빼고 이어서) */
  private data class Data(
    val theme: SurfaceTheme, val folderId: String?, val memo: String, val preview: String, val todos: List<NotesDb.Todo>,
    val folders: List<NotesDb.Folder>,
  )

  /** 메모 문단을 한 글로. 앞뒤의 빈 문단은 빼고(앱 미니창과 같다) */
  private fun memoText(paragraphs: List<String>): String = paragraphs.dropWhile { it.isBlank() }.dropLastWhile { it.isBlank() }.joinToString("\n")

  /** 쪽 처음·끝의 빈 줄(문단 사이 구분)은 빼고 그 쪽의 글줄만: …가 빈 줄이 아니라 마지막 글줄 끝에 붙는다. 빈 줄만 있으면 null */
  private fun textLines(l: StaticLayout, text: String, r: IntRange): IntRange? {
    fun blank(i: Int) = text.substring(l.getLineStart(i), l.getLineEnd(i)).isBlank()
    var a = r.first
    var b = r.last
    while (a <= b && blank(a)) a++
    while (b >= a && blank(b)) b--
    return if (a <= b) a..b else null
  }

  fun render(ctx: Context, mgr: AppWidgetManager, id: Int): RemoteViews {
    val saved = WidgetPrefs.load(ctx, id)
    val data = NotesDb.use(ctx) { db ->
      val name = NotesDb.folderName(db, saved.folderId)
      // 지워졌거나 공유 권한이 사라진 폴더(앱이 지운 것으로 남긴다)는 기본 폴더로
      val fid = if (name != null) saved.folderId else null
      val memo = NotesDb.memo(db, fid)
      Data(
        SurfaceTheme.from(ctx, NotesDb.prefs(db)),
        fid,
        memo.let(::memoText),
        memo.flatMap { it.split('\n') }.filter { it.isNotBlank() }.joinToString("\n"),
        NotesDb.todos(db, fid, includeDone = false, limit = 500),
        NotesDb.folders(db),
      )
    } ?: Data(SurfaceTheme.from(ctx, org.json.JSONObject()), null, "", "", emptyList(), emptyList())
    var wp = saved.withFolder(data.folderId)

    // 크기: 세로 화면에서 위젯 폭 = 최소 폭, 높이 = 최대 높이(AppWidgetManager 옵션 설명)
    val dm = ctx.resources.displayMetrics
    fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, dm)
    fun sp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, v, dm)
    val opts = mgr.getAppWidgetOptions(id)
    val wDp = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0).takeIf { it > 0 } ?: 320
    val hDp = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0).takeIf { it > 0 } ?: 200
    val textW = dp(wDp - PAD_START - PAD_END - TEXT_PAD_END).roundToInt()
    // 머리(로고 · 폴더 탭)와 아래 줄 사이(쪽 내용 자리)
    val areaH = dp(hDp - PAD_TOP - PAD_BOTTOM - HEADER)

    val titleSp = wp.textSize + 1
    val metaSp = wp.textSize - 2
    val memoSp = wp.textSize + 1

    val hasMemo = wp.show != WidgetPrefs.Show.TODOS && data.memo.isNotBlank()
    val showTodos = wp.show != WidgetPrefs.Show.MEMO

    // 메모 쪽 나누기: 같은 글꼴·폭·줄 간격으로 실제 줄바꿈을 재고, 쪽 높이에 들어가는 줄씩(누락·중복 없이 줄 단위)
    val memoPaint = paint(sp(memoSp), -0.016f)
    val fm = memoPaint.fontMetricsInt
    // 쪽마다 첫 줄 위·끝 줄 아래에 글꼴 여백이 다시 붙는다
    val memoAvail = (areaH - dp(MEMO_PAD_V * 2) - dp(SLACK)).toInt() - ((fm.ascent - fm.top) + (fm.bottom - fm.descent))
    fun pagesOf(l: StaticLayout, body: String): List<IntRange> {
      val tops = IntArray(l.lineCount + 1) { i -> if (i < l.lineCount) l.getLineTop(i) else l.getLineBottom(l.lineCount - 1) }
      // 쪽마다 글줄만(빈 줄만 남는 쪽은 뺀다 — 빈 줄은 문단 사이 구분이라 빠지는 내용이 없다)
      return WidgetPages.splitLines(tops, memoAvail).mapNotNull { textLines(l, body, it) }.ifEmpty { listOf(0..0) }
    }
    val memoLayout = if (hasMemo) layout(data.memo, memoPaint, textW, LINE_MULT) else null
    val memoPages = memoLayout?.let { pagesOf(it, data.memo) } ?: listOf(0 until 0)
    // 메모 쪽(기본 모드)은 빈 문단 없이 이어 보인 미리보기: 처음부터 들어가는 줄까지, 넘치면 마지막 줄 …
    val previewLines = if (hasMemo) pagesOf(layout(data.preview, memoPaint, textW, LINE_MULT), data.preview)[0].last + 1 else 0
    val pageStarts = IntArray(memoPages.size) { i -> memoLayout?.getLineStart(memoPages[i].first) ?: 0 }

    // 할 일 한 줄 높이: 보조 줄이 있든 없든 같게(제목 + 2 + 보조 줄, 동그라미 44보다 작으면 44)
    val titlePaint = paint(sp(titleSp), -0.02f)
    val titleH = layout("가g", titlePaint, 4096, 1f).height
    val metaH = layout("가g", paint(sp(metaSp), 0f), 4096, 1f).height
    val blockH = titleH + dp(META_GAP).roundToInt() + metaH
    val rowH = dp(ROW_PAD_V * 2) + maxOf(dp(ROW_CHECK), blockH.toFloat())
    // 제목만인 줄은 앱 카드처럼 두 줄까지(넘치면 …). 두 줄이 줄 높이(동그라미 44 또는 제목 + 보조 줄) 안에 들 때만, 아니면(큰 글자) 한 줄
    val plainLines = if (layout("가g\n가g", titlePaint, 4096, 1f).height <= maxOf(dp(ROW_CHECK), blockH.toFloat())) 2 else 1
    val perPage = maxOf(1, floor((areaH - dp(SLACK)) / rowH).toInt())
    // 한 쪽에 다 넣고 남는 높이(한 줄이 안 되는 만큼)는 줄마다 나눠 넣는다: 마지막 할 일 아래에 몰려 점과 멀어지지 않게.
    // 줄 높이는 여전히 모두 같다(마지막 쪽에 할 일이 적어도 같은 높이)
    val rowExtra = ((areaH - dp(SLACK) - perPage * rowH) / perPage).coerceIn(0f, dp(ROW_EXTRA_MAX))
    val rowPad = (dp(ROW_PAD_V) + rowExtra / 2).toInt()
    // 할 일이 없어도 할 일 쪽 하나(+로 바로 추가)
    val todoPages = if (showTodos) WidgetPages.count(data.todos.size, perPage) else 0
    val memoFirst = if (hasMemo) 1 else 0
    val total = memoFirst + todoPages

    // 보던 쪽 되찾기: 할 일 쪽이면 그 쪽 첫 할 일(없어졌으면 그 자리)이 든 쪽, 읽기 모드면 읽던 글자가 든 메모 쪽
    val reading = hasMemo && (wp.reading || !showTodos)
    if (reading) {
      val (page, offset) = WidgetPages.resolveRead(wp.readPage, wp.readOffset, pageStarts)
      wp = wp.copy(readPage = page, readOffset = offset)
    } else {
      val base = WidgetPages.resolveBase(wp.page, wp.anchorTodo, wp.anchorIndex, data.todos.map { it.id }, hasMemo, perPage, todoPages)
      wp = wp.copy(page = base.page, reading = false, anchorTodo = base.anchorId, anchorIndex = base.anchorIndex)
    }
    // 크기·완료·삭제·동기화로 바뀐 쪽, 없어진 폴더를 고친 상태로 남긴다
    if (wp != saved) wp.save(ctx, id)

    val t = data.theme
    val neutral = t.dark && !t.tinted
    val card = if (neutral) CHARCOAL else t.card
    val text = if (neutral) NEUTRAL_TEXT else t.text
    val muted = if (neutral) NEUTRAL_MUTED else t.muted
    val circle = if (neutral) NEUTRAL_CIRCLE else t.circle
    val dotOff = SurfaceTheme.mixInt(text, card, 0.62)

    val v = RemoteViews(ctx.packageName, R.layout.widget_home)
    v.setInt(R.id.widget_bg, "setColorFilter", card)
    v.setInt(R.id.widget_bg, "setImageAlpha", ((wp.opacity ?: t.opacity) * 255).roundToInt())

    // 머리 왼쪽 로고(글자 없이) → 앱의 그 폴더. 쪽을 바꿔도 그대로
    v.setInt(R.id.widget_mark, "setColorFilter", t.mark)
    v.setOnClickPendingIntent(R.id.widget_brand, activity(ctx, id, openApp(ctx, data.folderId, id)))
    v.setContentDescription(R.id.widget_brand, ctx.getString(R.string.widget_open_app))

    // 폴더 탭(로고 오른쪽, 누르면 그 폴더의 첫 쪽으로): 기본 + 폴더들. 폭이 모자라면 지금 폴더가 보이게 그 근처만
    v.removeAllViews(R.id.widget_tabs)
    val tabs = listOf<Pair<String?, String>>(null to ctx.getString(R.string.base_folder)) + data.folders.map { it.id to it.name }
    val curTab = tabs.indexOfFirst { it.first == data.folderId }.coerceAtLeast(0)
    val tabPaint = paint(sp(15f), 0f)
    val boldPaint = paint(sp(15f), 0f).apply { typeface = Typeface.create("sans-serif", Typeface.BOLD) }
    val widths = tabs.mapIndexed { i, (_, name) -> (if (i == curTab) boldPaint else tabPaint).measureText(name) + dp(TAB_GAP) }
    var first = curTab
    var last = curTab
    var used = widths[curTab]
    val room = dp(wDp - PAD_START - PAD_END - MARK_W - MARK_GAP)
    while (true) {
      val right = last + 1 < tabs.size && used + widths[last + 1] <= room
      if (right) { last++; used += widths[last] }
      val left = first > 0 && used + widths[first - 1] <= room
      if (left) { first--; used += widths[first] }
      if (!right && !left) break
    }
    for (i in first..last) {
      val (fid, name) = tabs[i]
      val tab = RemoteViews(ctx.packageName, R.layout.widget_home_tab)
      val sel = i == curTab
      tab.setTextViewText(R.id.tab, if (sel) SpannableString(name).apply { setSpan(StyleSpan(Typeface.BOLD), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) } else name)
      tab.setTextColor(R.id.tab, if (sel) text else muted)
      val go = Intent(ctx, NotesWidgetProvider::class.java).setAction(NotesWidgetProvider.ACTION_FOLDER)
        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
        .putExtra(NotesWidgetProvider.EXTRA_FOLDER, fid ?: "")
        .setData(Uri.parse("naegirok://widget-folder/$id/${fid ?: "base"}"))
      tab.setOnClickPendingIntent(R.id.tab, broadcast(ctx, id, go))
      tab.setContentDescription(R.id.tab, ctx.getString(if (sel) R.string.widget_folder_tab_current else R.string.widget_folder_tab, name))
      v.addView(R.id.widget_tabs, tab)
    }

    val onMemoPage = !reading && hasMemo && wp.page == 0
    val todoPage = if (!reading && showTodos && wp.page >= memoFirst) wp.page - memoFirst else -1

    // 메모(쪽 하나): 기본 모드는 처음부터 들어가는 줄까지(넘치면 마지막 줄 …), 읽기 모드는 그 쪽 본문. 누르면 읽기 모드 켜기/끄기
    if (memoLayout != null && (onMemoPage || reading)) {
      val r = memoPages[wp.readPage.coerceIn(0, memoPages.size - 1)]
      val body = if (reading) data.memo.substring(memoLayout.getLineStart(r.first), memoLayout.getLineEnd(r.last)).trimEnd('\n') else data.preview
      v.setViewVisibility(R.id.widget_memo, View.VISIBLE)
      v.setTextViewText(R.id.widget_memo, body)
      v.setTextViewTextSize(R.id.widget_memo, TypedValue.COMPLEX_UNIT_SP, memoSp)
      v.setTextColor(R.id.widget_memo, text)
      v.setInt(R.id.widget_memo, "setMaxLines", if (reading) r.last - r.first + 1 else previewLines)
      if (showTodos) {
        val tap = Intent(ctx, NotesWidgetProvider::class.java).setAction(NotesWidgetProvider.ACTION_MEMO)
          .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id).setData(Uri.parse("naegirok://widget-memo/$id"))
        v.setOnClickPendingIntent(R.id.widget_memo, broadcast(ctx, id, tap))
        v.setContentDescription(R.id.widget_memo, ctx.getString(if (reading) R.string.widget_memo_collapse else R.string.widget_memo_expand, body))
      }
    } else {
      v.setViewVisibility(R.id.widget_memo, View.GONE)
    }

    // 할 일 쪽(이 쪽 할 일만)
    v.removeAllViews(R.id.widget_rows)
    val lang = ctx.resources.configuration.locales[0].language
    val slice = if (todoPage >= 0) data.todos.drop(todoPage * perPage).take(perPage) else emptyList()
    v.setViewVisibility(R.id.widget_rows, if (slice.isNotEmpty()) View.VISIBLE else View.GONE)
    for (todo in slice) v.addView(R.id.widget_rows, todoRow(ctx, id, todo, lang, text, muted, circle, titleSp, metaSp, titleH, metaH, blockH, plainLines, rowPad))
    // 빈 할 일 쪽(메모만 있을 때 둘째 쪽, 또는 둘 다 없을 때)
    val empty = (todoPage >= 0 && slice.isEmpty()) || (!hasMemo && !showTodos)
    v.setViewVisibility(R.id.widget_empty, if (empty) View.VISIBLE else View.GONE)
    v.setTextViewText(R.id.widget_empty, ctx.getString(if (hasMemo) R.string.lock_empty else R.string.widget_empty))
    v.setTextColor(R.id.widget_empty, muted)

    // 쪽 점: 기본 모드 = 메모 쪽 + 할 일 쪽, 읽기 모드 = 메모 쪽만. 한 쪽뿐이면 숨긴다.
    // 점은 시안처럼 20dp 간격으로 모으고 누르는 곳도 20×40dp(겹치지 않음), 양 끝 점은 바깥으로 32dp.
    // 쪽이 많아 다 못 그리면 지금 쪽 근처만 그리고 양 끝 점을 작게(누르면 그쪽으로 따라간다)
    v.removeAllViews(R.id.widget_dots)
    val kind = if (reading) KIND_READ else KIND_BASE
    val pages = if (reading) memoPages.size else total
    val cur = if (reading) wp.readPage else wp.page
    if (pages > 1) {
      val maxDots = ((wDp - 2 * DOT_RESERVE - 2 * DOT_EDGE) / DOT).toInt().coerceIn(3, 7)
      val win = WidgetPages.dotWindow(cur, pages, maxDots)
      val small = dp(1.5f).roundToInt()
      for (i in win) {
        val d = RemoteViews(
          ctx.packageName,
          when (i) {
            win.first -> R.layout.widget_home_dot_first
            win.last -> R.layout.widget_home_dot_last
            else -> R.layout.widget_home_dot
          },
        )
        d.setInt(R.id.dot, "setColorFilter", if (i == cur) text else dotOff)
        if ((i == win.first && i > 0) || (i == win.last && i < pages - 1)) d.setViewPadding(R.id.dot, small, small, small, small)
        val label = when {
          reading -> ctx.getString(R.string.widget_page_memo, i + 1, pages)
          i < memoFirst -> ctx.getString(R.string.widget_page_memo_only)
          else -> ctx.getString(R.string.widget_page_todo, i - memoFirst + 1, todoPages)
        }
        d.setContentDescription(R.id.dot_hit, if (i == cur) ctx.getString(R.string.widget_page_current, label) else label)
        val go = Intent(ctx, NotesWidgetProvider::class.java).setAction(NotesWidgetProvider.ACTION_GO)
          .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
          .putExtra(NotesWidgetProvider.EXTRA_KIND, kind)
          .putExtra(NotesWidgetProvider.EXTRA_INDEX, i)
          .setData(Uri.parse("naegirok://widget-go/$id/$kind/$i"))
        d.setOnClickPendingIntent(R.id.dot_hit, broadcast(ctx, id, go))
        v.addView(R.id.widget_dots, d)
      }
    }

    // +: 할 일 쪽에서만(이 폴더의 할 일 입력). 메모 쪽·읽기 모드에서는 숨긴다
    val showAdd = todoPage >= 0 || (!hasMemo && !showTodos)
    v.setViewVisibility(R.id.widget_add, if (showAdd) View.VISIBLE else View.GONE)
    // 레이아웃에 적힌 글은 런처 언어로 풀려서, 앱 언어로 다시 넣는다
    v.setContentDescription(R.id.widget_add, ctx.getString(R.string.add))
    v.setInt(R.id.widget_add, "setColorFilter", text)
    val add = Intent(ctx, QuickAddActivity::class.java)
      .putExtra(QuickAddActivity.EXTRA_FOLDER, data.folderId)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
      .setData(Uri.parse("naegirok://quickadd/$id"))
    v.setOnClickPendingIntent(R.id.widget_add, activity(ctx, id, add))
    return v
  }

  private fun todoRow(
    ctx: Context, widgetId: Int, t: NotesDb.Todo, lang: String, text: Int, muted: Int, circle: Int,
    titleSp: Float, metaSp: Float, titleH: Int, metaH: Int, blockH: Int, plainLines: Int, rowPad: Int,
  ) = RemoteViews(ctx.packageName, R.layout.widget_home_todo).apply {
    setViewPadding(R.id.item_row, 0, rowPad, 0, rowPad)
    setTextViewText(R.id.item_text, t.text)
    setTextViewTextSize(R.id.item_text, TypedValue.COMPLEX_UNIT_SP, titleSp)
    setTextColor(R.id.item_text, text)
    val parts = CardMeta.parts(t.due, t.remindAt, t.repeatFreq, t.repeatDays, t.done, lang)
    if (parts.isEmpty()) {
      // 제목만: 보조 줄 자리까지 같은 높이에 세로 가운데, plainLines줄까지 …
      // (setHeight가 최대 줄 수를 픽셀 높이로 덮어써 …없이 잘리므로 줄 수는 그 뒤에 다시 준다)
      setViewVisibility(R.id.item_meta, View.GONE)
      setInt(R.id.item_text, "setHeight", blockH)
      setInt(R.id.item_text, "setMaxLines", plainLines)
    } else {
      val line = SpannableStringBuilder()
      parts.forEachIndexed { i, p ->
        if (i > 0) line.append("  ·  ")
        val start = line.length
        line.append(p.text)
        if (p.late) line.setSpan(ForegroundColorSpan(LATE), start, line.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      }
      setViewVisibility(R.id.item_meta, View.VISIBLE)
      setTextViewText(R.id.item_meta, line)
      setTextViewTextSize(R.id.item_meta, TypedValue.COMPLEX_UNIT_SP, metaSp)
      setTextColor(R.id.item_meta, muted)
      setInt(R.id.item_text, "setHeight", titleH)
      setInt(R.id.item_text, "setMaxLines", 1)
      setInt(R.id.item_meta, "setHeight", metaH)
      setInt(R.id.item_meta, "setMaxLines", 1)
    }
    // 일반은 빈 원, 반복은 원 테두리가 두 곡선 화살표(앱 카드와 같은 모양)
    setImageViewResource(R.id.item_check, if (t.repeatFreq != null) R.drawable.naegirok_check_repeat else R.drawable.naegirok_check_off)
    setInt(R.id.item_check, "setColorFilter", circle)
    setContentDescription(R.id.item_check, ctx.getString(R.string.mark_done, t.text))
    // 동그라미 = 완료(반복은 이번 회차만, 앱과 같은 저장·동기화 경로), 글자 = 그 할 일 고치기
    val toggle = Intent(ctx, NotesWidgetProvider::class.java).setAction(NotesWidgetProvider.ACTION_TOGGLE)
      .putExtra(NotesWidgetProvider.EXTRA_TODO, t.id).putExtra(NotesWidgetProvider.EXTRA_DONE, false)
      .setData(Uri.parse("naegirok://toggle/$widgetId/${t.id}/false"))
    setOnClickPendingIntent(R.id.item_check, broadcast(ctx, widgetId, toggle))
    val edit = Intent(ctx, WidgetEditActivity::class.java)
      .putExtra(WidgetEditActivity.EXTRA_TODO, t.id)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
      .setData(Uri.parse("naegirok://edit/todo/${t.id}/$widgetId"))
    setOnClickPendingIntent(R.id.item_body, activity(ctx, widgetId, edit))
    setContentDescription(R.id.item_body, ctx.getString(R.string.edit_todo) + ": " + t.text)
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
