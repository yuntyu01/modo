package com.yuntyu01.naegirok.widget

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.text.SpannableString
import android.text.Spanned
import android.text.style.StrikethroughSpan
import android.util.TypedValue
import android.widget.RemoteViews
import com.yuntyu01.naegirok.NotesDb
import com.yuntyu01.naegirok.Repeat
import com.yuntyu01.naegirok.SurfaceTheme
import com.yuntyu01.naegirok.WidgetEditActivity
import com.yuntyu01.naegirok.nativelib.R
import com.yuntyu01.naegirok.Words

/**
 * 위젯의 줄들(메모 한 덩어리 + 할 일들)을 위젯 높이(budgetDp)에 들어가는 만큼 만든다.
 * 줄마다 누르는 곳이 다르다: 동그라미 = 완료(방송), 글자 = 고치기 창(액티비티).
 */
object WidgetRows {
  private const val TODO_ROW_DP = 51
  private const val TODO_META_ROW_DP = 54
  private const val MEMO_LINE_DP = 26

  fun build(ctx: Context, widgetId: Int, prefs: WidgetPrefs, folderId: String?, theme: SurfaceTheme, budgetDp: Int, keyguard: Boolean = false): List<RemoteViews> =
    NotesDb.use(ctx) { db ->
      val scale = prefs.textSize / 15f
      var left = budgetDp.toFloat()
      // 위젯은 남은 할 일만(시안). 동그라미를 누르면 완료되어 목록에서 빠지고, 완료한 것은 앱에서 본다.
      val todos = if (prefs.show != WidgetPrefs.Show.MEMO) NotesDb.todos(db, folderId, false) else emptyList()
      buildList {
        if (prefs.show != WidgetPrefs.Show.TODOS) {
          val memo = NotesDb.memo(db, folderId)
          if (memo.isNotEmpty()) {
            // 할 일이 있으면 적어도 한 줄은 보이게 메모 줄 수를 줄인다(1~3줄).
            val reserve = if (todos.isNotEmpty()) TODO_ROW_DP * scale else 0f
            val lines = ((left - reserve - 10) / (MEMO_LINE_DP * scale)).toInt().coerceIn(1, 3)
            add(memoRow(ctx, widgetId, folderId, memo.joinToString("\n"), theme, prefs.textSize, lines))
            left -= minOf(lines, memo.size) * MEMO_LINE_DP * scale + 20
            // 잠금화면(시안): 메모와 할 일 사이 얇은 선
            if (keyguard && todos.isNotEmpty()) {
              add(RemoteViews(ctx.packageName, R.layout.widget_item_divider).apply {
                setInt(R.id.divider, "setColorFilter", SurfaceTheme.mixInt(theme.card, theme.text, 0.14))
              })
              left -= 17
            }
          }
        }
        run {
          for (t in todos) {
            val h = (if (t.due != null || t.remindAt != null || t.repeatFreq != null) TODO_META_ROW_DP else TODO_ROW_DP) * scale
            if (left < h) break
            add(todoRow(ctx, widgetId, t, theme, prefs.textSize))
            left -= h
          }
        }
      }
    } ?: emptyList()

  private fun activity(ctx: Context, intent: Intent) =
    PendingIntent.getActivity(ctx, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

  private fun memoRow(ctx: Context, widgetId: Int, folderId: String?, text: String, theme: SurfaceTheme, size: Float, lines: Int) =
    RemoteViews(ctx.packageName, R.layout.widget_item_memo).apply {
      setTextViewText(R.id.item_text, text)
      setInt(R.id.item_text, "setMaxLines", lines)
      setTextColor(R.id.item_text, theme.text)
      // 시안: 메모는 할 일보다 한 단계 크다
      setTextViewTextSize(R.id.item_text, TypedValue.COMPLEX_UNIT_SP, size + 1)
      val edit = Intent(ctx, WidgetEditActivity::class.java)
        .putExtra(WidgetEditActivity.EXTRA_MEMO_FOLDER, folderId ?: WidgetEditActivity.BASE)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        .setData(Uri.parse("naegirok://edit/memo/${folderId ?: "base"}/$widgetId"))
      setOnClickPendingIntent(R.id.item_text, activity(ctx, edit))
    }

  private fun todoRow(ctx: Context, widgetId: Int, t: NotesDb.Todo, theme: SurfaceTheme, size: Float) =
    RemoteViews(ctx.packageName, R.layout.widget_item_todo).apply {
      // 취소선은 스팬으로(RemoteViews는 setPaintFlags를 원격 호출할 수 없다)
      val label = if (t.done) {
        SpannableString(t.text).apply { setSpan(StrikethroughSpan(), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }
      } else {
        t.text
      }
      setTextViewText(R.id.item_text, label)
      setTextViewTextSize(R.id.item_text, TypedValue.COMPLEX_UNIT_SP, size)
      setTextColor(R.id.item_text, if (t.done) theme.muted else theme.text)
      // '내일 · 17:00' (날짜는 강조색)
      val meta = meta(ctx, t, theme)
      if (meta != null) {
        setTextViewText(R.id.item_meta, meta)
        setTextViewTextSize(R.id.item_meta, TypedValue.COMPLEX_UNIT_SP, size - 2.5f)
        setTextColor(R.id.item_meta, SurfaceTheme.mixInt(theme.text, theme.card, 0.22))
        setViewVisibility(R.id.item_meta, android.view.View.VISIBLE)
        // 시안: 두 줄짜리는 줄 높이 54, 동그라미가 글자 묶음보다 조금 위(첫 줄 쪽)
        setViewPadding(R.id.item_body, 0, dp(ctx, 7.5f), 0, dp(ctx, 6.5f))
        setViewPadding(R.id.item_check, dp(ctx, 7f), dp(ctx, 5.25f), dp(ctx, 7f), dp(ctx, 8.75f))
      } else {
        setViewVisibility(R.id.item_meta, android.view.View.GONE)
      }
      // 반복 할 일은 같은 크기의 동그라미를 두 곡선 화살표로(앱 카드와 같은 모양), 완료는 다른 할 일처럼 채운 원 + 체크
      val check = when {
        t.done -> R.drawable.naegirok_check_on
        t.repeatFreq != null -> R.drawable.naegirok_check_repeat
        else -> R.drawable.naegirok_check_off
      }
      setImageViewResource(R.id.item_check, check)
      setInt(R.id.item_check, "setColorFilter", if (t.done) theme.accent else theme.circle)
      setContentDescription(R.id.item_check, ctx.getString(if (t.done) R.string.mark_undone else R.string.mark_done, t.text))
      // 동그라미 한 번 = 완료/완료 취소
      val toggle = Intent(ctx, NotesWidgetProvider::class.java).setAction(NotesWidgetProvider.ACTION_TOGGLE)
        .putExtra(NotesWidgetProvider.EXTRA_TODO, t.id).putExtra(NotesWidgetProvider.EXTRA_DONE, t.done)
        .setData(Uri.parse("naegirok://toggle/$widgetId/${t.id}/${t.done}"))
      setOnClickPendingIntent(
        R.id.item_check,
        PendingIntent.getBroadcast(ctx, 0, toggle, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT),
      )
      // 글자 = 그 할 일 고치기
      val edit = Intent(ctx, WidgetEditActivity::class.java)
        .putExtra(WidgetEditActivity.EXTRA_TODO, t.id)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        .setData(Uri.parse("naegirok://edit/todo/${t.id}/$widgetId"))
      setOnClickPendingIntent(R.id.item_body, activity(ctx, edit))
      setContentDescription(R.id.item_body, ctx.getString(R.string.edit_todo) + ": " + t.text)
    }

  private fun dp(ctx: Context, v: Float) = (v * ctx.resources.displayMetrics.density).toInt()

  /** 앱과 같은 날짜 표기: 오늘 / 내일 / 10월 17일 (토) · 17:00 */
  private fun meta(ctx: Context, t: NotesDb.Todo, theme: SurfaceTheme): CharSequence? {
    if (t.due == null && t.remindAt == null && t.repeatFreq == null) return null
    val words = Words.of(ctx.resources.configuration.locales[0].language)
    val out = android.text.SpannableStringBuilder()
    val today = java.time.LocalDate.now()
    val dueDate = t.due?.let { runCatching { java.time.LocalDate.parse(it) }.getOrNull() }
    // 반복: 매일(반복 여부는 동그라미가 보여 준다) (예정일이 오늘이면 날짜는 빼고, 밀렸으면 날짜도)
    t.repeatFreq?.let { freq -> out.append(Repeat.label(freq, t.repeatDays, dueDate, ctx.resources.configuration.locales[0].language)) }
    t.due?.let { due ->
      if (t.repeatFreq != null && dueDate == today) return@let
      if (out.isNotEmpty()) out.append("  ·  ")
      val d = runCatching { java.time.LocalDate.parse(due) }.getOrNull() ?: return@let
      val label = when (d) {
        today -> words.today
        today.plusDays(1) -> words.tomorrow
        else -> words.mdw(d.monthValue, d.dayOfMonth, d.dayOfWeek.value % 7)
      }
      val late = d.isBefore(today) && !t.done
      val color = if (late) android.graphics.Color.parseColor("#FF6B6B") else theme.accent
      out.append(label, android.text.style.ForegroundColorSpan(color), android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      // 기한이 지났으면 며칠 지났는지도(앱 카드와 같은 '2일 지남', 같은 빨간색)
      if (late) {
        out.append("  ·  ")
        val days = java.time.temporal.ChronoUnit.DAYS.between(d, today).toInt()
        out.append(words.late(days), android.text.style.ForegroundColorSpan(color), android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      }
    }
    t.remindAt?.let {
      if (out.isNotEmpty()) out.append("  ·  ")
      val time = java.time.Instant.ofEpochMilli(it).atZone(java.time.ZoneId.systemDefault()).toLocalTime()
      out.append(String.format(java.util.Locale.ROOT, "%02d:%02d", time.hour, time.minute))
    }
    return out
  }
}
