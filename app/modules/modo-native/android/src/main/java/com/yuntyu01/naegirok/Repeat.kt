package com.yuntyu01.naegirok

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit

/**
 * 반복 할 일의 날짜 규칙. app/src/core/repeat.ts 와 같다(바꾸면 함께 바꿀 것).
 * 반복이면 due_date가 다음 예정일이고, 완료하면 done_at 대신 due_date를 다음 예정일로 넘긴다.
 */
object Repeat {
  /** 월=1, 화=2, 수=4 … 일=64 */
  fun bit(d: LocalDate) = 1 shl (d.dayOfWeek.value - 1)

  fun matches(freq: String, days: Int?, date: LocalDate, anchor: LocalDate): Boolean = when (freq) {
    "daily" -> true
    "weekly" -> ((days?.takeIf { it != 0 } ?: bit(anchor)) and bit(date)) != 0
    "monthly" -> date.dayOfMonth == minOf(anchor.dayOfMonth, date.lengthOfMonth())
    else -> false
  }

  /** 밀린 날은 건너뛰고(오늘 뒤), 미리 한 것이면 그 예정일 뒤의 첫 예정일 */
  fun nextDue(freq: String, days: Int?, due: LocalDate?, today: LocalDate): LocalDate {
    val anchor = due ?: today
    val after = if (due != null && due.isAfter(today)) due else today
    for (i in 1 until 400) {
      val d = after.plusDays(i.toLong())
      if (matches(freq, days, d, anchor)) return d
    }
    return after.plusDays(1)
  }

  /** 알림 시각을 같은 현지 시각 그대로 옮긴다 */
  fun shift(ms: Long, from: LocalDate, to: LocalDate): Long {
    val zone = ZoneId.systemDefault()
    return Instant.ofEpochMilli(ms).atZone(zone).plusDays(ChronoUnit.DAYS.between(from, to)).toInstant().toEpochMilli()
  }

  fun localDate(ms: Long): LocalDate = Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault()).toLocalDate()

  /** 표시: 매일 · 매주 월·수·금 · 매주 목요일 · 매월 16일 (앱 format.ts describeRepeat과 같은 문구). lang: ko/en/ja/zh */
  fun label(freq: String, days: Int?, anchor: LocalDate?, lang: String): String {
    val w = Words.of(lang)
    if (freq == "daily" || (freq == "weekly" && days == 127)) return w.daily
    if (freq == "monthly") return w.monthly(anchor?.dayOfMonth ?: 1)
    val mask = days?.takeIf { it != 0 } ?: anchor?.let { bit(it) } ?: 1
    val picked = (0 until 7).filter { mask and (1 shl it) != 0 } // 월요일 = 0
    if (picked.size == 1) return w.weeklyOne((picked[0] + 1) % 7)
    return w.weeklyMany(picked.map { w.week[(it + 1) % 7] })
  }
}

/** 위젯의 날짜·반복 표기(app/src/ui/format.ts의 WORDS와 같다). 요일 배열은 일요일부터. */
class Words(
  val week: List<String>,
  val weekLong: List<String>,
  val today: String,
  val tomorrow: String,
  val mdw: (Int, Int, Int) -> String,
  val daily: String,
  val monthly: (Int) -> String,
  val weeklyOne: (Int) -> String,
  val weeklyMany: (List<String>) -> String,
  /** 기한이 지난 날 수: 2일 지남 */
  val late: (Int) -> String,
) {
  companion object {
    private val MONTH_EN = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
    private val koWeek = listOf("일", "월", "화", "수", "목", "금", "토")
    private val koLong = koWeek.map { "${it}요일" }
    private val enWeek = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
    private val enLong = listOf("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")
    private val jaWeek = listOf("日", "月", "火", "水", "木", "金", "土")
    private val jaLong = jaWeek.map { "${it}曜日" }
    private val zhWeek = listOf("日", "一", "二", "三", "四", "五", "六")
    private val zhLong = zhWeek.map { "星期$it" }

    private val KO = Words(koWeek, koLong, "오늘", "내일", { m, d, w -> "${m}월 ${d}일 (${koWeek[w]})" }, "매일",
      { "매월 ${it}일" }, { "매주 ${koLong[it]}" }, { "매주 " + it.joinToString("·") }, { "${it}일 지남" })
    private val EN = Words(enWeek, enLong, "Today", "Tomorrow", { m, d, w -> "${enWeek[w]}, ${MONTH_EN[m - 1]} $d" }, "Daily",
      { "Monthly on day $it" }, { "Every ${enLong[it]}" }, { "Weekly " + it.joinToString("·") }, { if (it == 1) "1 day overdue" else "$it days overdue" })
    private val JA = Words(jaWeek, jaLong, "今日", "明日", { m, d, w -> "${m}月${d}日(${jaWeek[w]})" }, "毎日",
      { "毎月${it}日" }, { "毎週${jaLong[it]}" }, { "毎週 " + it.joinToString("·") }, { "${it}日経過" })
    private val ZH = Words(zhWeek, zhLong, "今天", "明天", { m, d, w -> "${m}月${d}日（周${zhWeek[w]}）" }, "每天",
      { "每月${it}日" }, { "每${zhLong[it]}" }, { "每周" + it.joinToString("、") }, { "逾期${it}天" })

    fun of(lang: String) = when (lang) { "ko" -> KO; "ja" -> JA; "zh" -> ZH; else -> EN }
  }
}
