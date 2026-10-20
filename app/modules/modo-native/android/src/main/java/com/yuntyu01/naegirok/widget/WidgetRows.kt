package com.yuntyu01.naegirok.widget

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.TypedValue
import android.widget.RemoteViews
import com.yuntyu01.naegirok.NotesDb
import com.yuntyu01.naegirok.SurfaceTheme
import com.yuntyu01.naegirok.WidgetEditActivity
import com.yuntyu01.naegirok.nativelib.R

/**
 * 잠금화면 위젯의 줄들(메모 한 덩어리 + 할 일들)을 위젯 높이(budgetDp)에 들어가는 만큼 만든다.
 * 줄마다 누르는 곳이 다르다: 동그라미 = 완료(방송), 글자 = 고치기 창(액티비티).
 */
object WidgetRows {
  private const val TODO_ROW_DP = 51
  private const val TODO_META_ROW_DP = 54
  private const val MEMO_LINE_DP = 26

  fun build(ctx: Context, widgetId: Int, prefs: WidgetPrefs, folderId: String?, theme: SurfaceTheme, budgetDp: Int): List<RemoteViews> =
    NotesDb.use(ctx) { db ->
      val scale = prefs.textSize / 15f
      var left = budgetDp.toFloat()
      // 위젯은 남은 할 일만(시안). 동그라미를 누르면 완료되어 목록에서 빠지고, 완료한 것은 앱에서 본다.
      val todos = if (prefs.show != WidgetPrefs.Show.MEMO) NotesDb.todos(db, folderId) else emptyList()
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
            if (todos.isNotEmpty()) {
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
      setTextViewText(R.id.item_text, t.text)
      setTextViewTextSize(R.id.item_text, TypedValue.COMPLEX_UNIT_SP, size)
      setTextColor(R.id.item_text, theme.text)
      // 홈 위젯·앱 카드와 같은 아래 줄: '매일 · 오늘 오후 5:00', '10월 16일 · 2일 지남'(지난 것은 빨간색)
      val parts = CardMeta.parts(t.due, t.remindAt, t.repeatFreq, t.repeatDays, false, ctx.resources.configuration.locales[0].language)
      if (parts.isNotEmpty()) {
        setTextViewText(R.id.item_meta, HomeWidget.metaLine(parts))
        setTextViewTextSize(R.id.item_meta, TypedValue.COMPLEX_UNIT_SP, size - 2.5f)
        setTextColor(R.id.item_meta, SurfaceTheme.mixInt(theme.text, theme.card, 0.22))
        setViewVisibility(R.id.item_meta, android.view.View.VISIBLE)
        // 시안: 두 줄짜리는 줄 높이 54, 동그라미가 글자 묶음보다 조금 위(첫 줄 쪽)
        setViewPadding(R.id.item_body, 0, dp(ctx, 7.5f), 0, dp(ctx, 6.5f))
        setViewPadding(R.id.item_check, dp(ctx, 7f), dp(ctx, 5.25f), dp(ctx, 7f), dp(ctx, 8.75f))
      } else {
        setViewVisibility(R.id.item_meta, android.view.View.GONE)
      }
      // 반복 할 일은 같은 크기의 동그라미를 두 곡선 화살표로(앱 카드와 같은 모양)
      setImageViewResource(R.id.item_check, if (t.repeatFreq != null) R.drawable.naegirok_check_repeat else R.drawable.naegirok_check_off)
      setInt(R.id.item_check, "setColorFilter", theme.circle)
      setContentDescription(R.id.item_check, ctx.getString(R.string.mark_done, t.text))
      // 동그라미 한 번 = 완료(반복은 이번 회차만)
      val toggle = Intent(ctx, NotesWidgetProvider::class.java).setAction(NotesWidgetProvider.ACTION_TOGGLE)
        .putExtra(NotesWidgetProvider.EXTRA_TODO, t.id)
        .setData(Uri.parse("naegirok://toggle/$widgetId/${t.id}"))
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
}
