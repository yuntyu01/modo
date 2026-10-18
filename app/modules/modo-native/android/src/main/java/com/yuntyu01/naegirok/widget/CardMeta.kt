package com.yuntyu01.naegirok.widget

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit

/**
 * 홈 위젯 할 일 아래 작은 줄: '매일 · 오늘', '월·수·금 · 오늘 오후 8:00', '10월 16일 · 2일 지남'.
 * 앱 카드(app/src/ui/format.ts의 repeatShort·cardWhen·cardLate)와 같은 규칙·문구다(바꾸면 함께 바꿀 것).
 * Android 의존이 없어 단위 테스트로 확인한다(src/test/.../CardMetaTest.kt).
 */
object CardMeta {
  /** 한 덩어리 글과, 기한이 지나 빨간색으로 그릴지 */
  data class Part(val text: String, val late: Boolean = false)

  private class W(
    val week: List<String>, // 일요일부터
    val weekLong: List<String>,
    val today: String,
    val tomorrow: String,
    val daily: String,
    val weekdays: String,
    val weekends: String,
    val monthly: (Int) -> String,
    val weeklyOne: (Int) -> String,
    val daysShort: (List<String>) -> String,
    val md: (Int, Int) -> String,
    val full: (Int, Int, Int) -> String,
    val time: (Int, Int) -> String,
    val late: (Int) -> String,
  )

  private fun h12(h: Int) = if (h % 12 == 0) 12 else h % 12
  private fun pad(n: Int) = n.toString().padStart(2, '0')
  private val MONTH_EN = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
  private val koWeek = listOf("일", "월", "화", "수", "목", "금", "토")
  private val enWeek = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
  private val jaWeek = listOf("日", "月", "火", "水", "木", "金", "土")
  private val zhWeek = listOf("日", "一", "二", "三", "四", "五", "六")

  private val KO = W(
    koWeek, koWeek.map { "${it}요일" }, "오늘", "내일", "매일", "평일", "주말",
    { "매월 ${it}일" }, { "매주 ${koWeek[it]}요일" }, { it.joinToString("·") },
    { m, d -> "${m}월 ${d}일" }, { y, m, d -> "${y}년 ${m}월 ${d}일" },
    { h, min -> "${if (h < 12) "오전" else "오후"} ${h12(h)}:${pad(min)}" }, { "${it}일 지남" },
  )
  private val EN = W(
    enWeek, listOf("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"), "Today", "Tomorrow", "Daily",
    "Weekdays", "Weekends", { "Monthly on day $it" },
    { "Every ${listOf("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")[it]}" }, { it.joinToString("·") },
    { m, d -> "${MONTH_EN[m - 1]} $d" }, { y, m, d -> "${MONTH_EN[m - 1]} $d, $y" },
    { h, min -> "${h12(h)}:${pad(min)} ${if (h < 12) "AM" else "PM"}" }, { if (it == 1) "1 day overdue" else "$it days overdue" },
  )
  private val JA = W(
    jaWeek, jaWeek.map { "${it}曜日" }, "今日", "明日", "毎日", "平日", "週末",
    { "毎月${it}日" }, { "毎週${jaWeek[it]}曜日" }, { it.joinToString("·") },
    { m, d -> "${m}月${d}日" }, { y, m, d -> "${y}年${m}月${d}日" },
    { h, min -> "${if (h < 12) "午前" else "午後"}${h12(h)}:${pad(min)}" }, { "${it}日経過" },
  )
  private val ZH = W(
    zhWeek, zhWeek.map { "星期$it" }, "今天", "明天", "每天", "工作日", "周末",
    { "每月${it}日" }, { "每星期${zhWeek[it]}" }, { "周" + it.joinToString("、") },
    { m, d -> "${m}月${d}日" }, { y, m, d -> "${y}年${m}月${d}日" },
    { h, min -> "${if (h < 12) "上午" else "下午"}${h12(h)}:${pad(min)}" }, { "逾期${it}天" },
  )

  private fun words(lang: String) = when (lang) { "ko" -> KO; "ja" -> JA; "zh" -> ZH; else -> EN }

  /** 반복 주기(짧게): 매일 / 평일 / 주말 / 월·수·금 / 매주 목요일 / 매월 16일 */
  fun repeatShort(freq: String, days: Int?, anchor: LocalDate?, lang: String): String {
    val w = words(lang)
    if (freq == "daily" || (freq == "weekly" && days == 127)) return w.daily
    if (freq == "monthly") return w.monthly(anchor?.dayOfMonth ?: 1)
    val mask = days?.takeIf { it != 0 } ?: anchor?.let { 1 shl (it.dayOfWeek.value - 1) } ?: 1
    if (mask == 31) return w.weekdays
    if (mask == 96) return w.weekends
    val picked = (0 until 7).filter { mask and (1 shl it) != 0 } // 월요일 = 0
    if (picked.size == 1) return w.weeklyOne((picked[0] + 1) % 7)
    return w.daysShort(picked.map { w.week[(it + 1) % 7] })
  }

  /** 오늘·내일 / 10월 19일 / 2027년 1월 3일 */
  fun date(d: LocalDate, lang: String, today: LocalDate): String {
    val w = words(lang)
    return when {
      d == today -> w.today
      d == today.plusDays(1) -> w.tomorrow
      d.year == today.year -> w.md(d.monthValue, d.dayOfMonth)
      else -> w.full(d.year, d.monthValue, d.dayOfMonth)
    }
  }

  /**
   * 아래 줄 전체. 없는 정보는 빼서 빈 구분점이 남지 않는다. 정보가 하나도 없으면 빈 목록(제목만 있는 줄).
   * 알림 날짜가 예정일과 같거나 예정일이 없으면 '내일 오후 5:00', 다르면 '10월 19일 · 10월 20일 오후 8:00'.
   */
  fun parts(
    due: String?, remindAt: Long?, repeatFreq: String?, repeatDays: Int?, done: Boolean, lang: String,
    today: LocalDate = LocalDate.now(), zone: ZoneId = ZoneId.systemDefault(),
  ): List<Part> {
    val w = words(lang)
    val dueDate = due?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
    val out = mutableListOf<Part>()
    if (repeatFreq != null) out.add(Part(repeatShort(repeatFreq, repeatDays, dueDate, lang)))
    val late = dueDate != null && !done && dueDate.isBefore(today)
    val remind = remindAt?.let { Instant.ofEpochMilli(it).atZone(zone) }
    val time = remind?.let { w.time(it.hour, it.minute) }
    val dueLabel = dueDate?.let { date(it, lang, today) }
    val whenText = when {
      time == null -> dueLabel
      dueDate == null || remind.toLocalDate() == dueDate -> "${dueLabel ?: date(remind.toLocalDate(), lang, today)} $time"
      else -> "$dueLabel · ${date(remind.toLocalDate(), lang, today)} $time"
    }
    if (whenText != null) out.add(Part(whenText, late))
    if (late) out.add(Part(w.late(ChronoUnit.DAYS.between(dueDate, today).toInt()), true))
    return out
  }
}
