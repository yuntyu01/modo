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
}
