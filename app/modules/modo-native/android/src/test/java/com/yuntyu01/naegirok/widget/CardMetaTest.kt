package com.yuntyu01.naegirok.widget

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime

/** 앱 카드(app/src/__tests__/cardMeta.test.ts)와 같은 표기인지 */
class CardMetaTest {
  private val today = LocalDate.of(2026, 10, 18) // 일요일
  private val zone = ZoneId.of("Asia/Seoul")
  private fun at(d: LocalDate, h: Int, m: Int = 0) = ZonedDateTime.of(d.atTime(h, m), zone).toInstant().toEpochMilli()
  private fun text(due: String?, remind: Long?, freq: String?, days: Int?, done: Boolean = false, lang: String = "ko") =
    CardMeta.parts(due, remind, freq, days, done, lang, today, zone).map { it.text }

  @Test fun repeatAndDate() {
    assertEquals(listOf("매일", "오늘"), text("2026-10-18", null, "daily", null))
    assertEquals(listOf("월·수·금", "오늘 오후 8:00"), text("2026-10-18", at(today, 20), "weekly", 1 or 4 or 16))
    assertEquals(listOf("평일", "오늘"), text("2026-10-18", null, "weekly", 31))
    assertEquals(listOf("주말"), text(null, null, "weekly", 96))
    assertEquals(listOf("매주 목요일"), text(null, null, "weekly", 8))
  }

  @Test fun dateAndTime() {
    assertEquals(listOf("내일 오후 5:00"), text("2026-10-19", at(today.plusDays(1), 17), null, null))
    assertEquals(listOf("내일 · 10월 20일 오전 8:00"), text("2026-10-19", at(today.plusDays(2), 8), null, null))
    assertEquals(listOf("2027년 1월 3일"), text("2027-01-03", null, null, null))
    assertEquals(emptyList<String>(), text(null, null, null, null))
  }

  @Test fun overdueIsRedWithDays() {
    val parts = CardMeta.parts("2026-10-16", null, null, null, false, "ko", today, zone)
    assertEquals(listOf("10월 16일", "2일 지남"), parts.map { it.text })
    assertEquals(listOf(true, true), parts.map { it.late })
    assertEquals(listOf("1 day overdue"), CardMeta.parts("2026-10-17", null, null, null, false, "en", today, zone).drop(1).map { it.text })
    // 완료한 것은 빨갛지 않다
    assertEquals(listOf("10월 16일"), text("2026-10-16", null, null, null, done = true))
  }
}
