package com.yuntyu01.naegirok.widget

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

class WidgetPagesTest {
  @Test fun countAndClamp() {
    assertEquals(1, WidgetPages.count(0, 2))
    assertEquals(1, WidgetPages.count(2, 2))
    assertEquals(3, WidgetPages.count(5, 2))
    assertEquals(2, WidgetPages.clamp(7, 3))
    assertEquals(0, WidgetPages.clamp(-1, 3))
  }

  @Test fun memoLinesSplitIntoPagesThatFit() {
    // 줄 높이 26, 쪽 높이 80 → 3줄씩
    val tops = intArrayOf(0, 26, 52, 78, 104, 130, 156, 182)
    assertEquals(listOf(0 until 3, 3 until 6, 6 until 7), WidgetPages.splitLines(tops, 80))
    // 한 줄이 쪽보다 커도(아주 큰 글자) 한 줄씩은 담는다
    assertEquals(listOf(0 until 1, 1 until 2), WidgetPages.splitLines(intArrayOf(0, 100, 200), 50))
  }

  @Test fun memoPagesNeverDropOrRepeatLines() {
    val rnd = Random(7)
    repeat(500) {
      val n = rnd.nextInt(1, 60)
      val tops = IntArray(n + 1)
      for (i in 1..n) tops[i] = tops[i - 1] + rnd.nextInt(18, 40)
      val avail = rnd.nextInt(10, 300)
      val pages = WidgetPages.splitLines(tops, avail)
      // 이어 붙이면 0..n-1 이 정확히 한 번씩
      assertEquals((0 until n).toList(), pages.flatMap { it.toList() })
      for (p in pages) assertTrue(p.count() == 1 || tops[p.last + 1] - tops[p.first] <= avail)
    }
  }

  @Test fun basePageKeepsTheTodoYouWereLookingAt() {
    // 메모 쪽 + 할 일 9개, 한 쪽에 2개 → 할 일 쪽 5개. 4번째 할 일(번호 3)이 첫 줄인 쪽 = 할 일 2쪽 = 전체 2
    assertEquals(2, WidgetPages.basePage(page = 2, anchor = 3, hasMemoPage = true, perPage = 2, todoPages = 5))
    // 크게 늘려 한 쪽에 5개 → 같은 할 일은 할 일 1쪽(전체 1)
    assertEquals(1, WidgetPages.basePage(page = 2, anchor = 3, hasMemoPage = true, perPage = 5, todoPages = 2))
    // 메모 쪽은 크기를 바꿔도 메모 쪽
    assertEquals(0, WidgetPages.basePage(page = 0, anchor = -1, hasMemoPage = true, perPage = 5, todoPages = 2))
    // 점으로 고른 쪽(anchor 없음)은 그대로, 줄어들면 마지막 쪽으로
    assertEquals(3, WidgetPages.basePage(page = 3, anchor = -1, hasMemoPage = true, perPage = 2, todoPages = 5))
    assertEquals(2, WidgetPages.basePage(page = 5, anchor = -1, hasMemoPage = true, perPage = 2, todoPages = 2))
    // 메모가 없으면 할 일 쪽만(0부터)
    assertEquals(1, WidgetPages.basePage(page = 2, anchor = 3, hasMemoPage = false, perPage = 2, todoPages = 5))
  }

  @Test fun resizingNeverLosesOrRepeatsTodos() {
    // 어느 크기에서든 쪽들을 차례로 보면 모든 할 일이 한 번씩 나온다
    for (n in 0..23) for (per in 1..7) {
      val pages = WidgetPages.count(n, per)
      val seen = (0 until pages).flatMap { p -> (0 until n).drop(p * per).take(per) }
      assertEquals((0 until n).toList(), seen)
    }
  }

  @Test fun memoOffsetFindsItsPage() {
    val starts = intArrayOf(0, 40, 95, 130)
    assertEquals(0, WidgetPages.pageOfOffset(starts, 0))
    assertEquals(1, WidgetPages.pageOfOffset(starts, 60))
    assertEquals(3, WidgetPages.pageOfOffset(starts, 500))
  }

  @Test fun everyPageIsReachableThroughTheDotWindow() {
    for (count in 1..20) for (max in 3..7) {
      // 처음부터 창의 마지막 점을 계속 누르면 모든 쪽을 지난다
      var page = 0
      val visited = mutableSetOf(0)
      repeat(count) {
        val win = WidgetPages.dotWindow(page, count, max)
        assertTrue(page in win)
        assertTrue(win.count() == minOf(count, max))
        page = win.last
        visited.addAll(win)
      }
      assertEquals((0 until count).toSet(), visited)
    }
  }

  @Test fun resizeChainDoesNotDrift() {
    // 할 일 9개, 크게(한 쪽 6개)에서 할 일 2쪽(7번째부터)을 고른 뒤 런처가 중간 크기(4개)·작은 크기(2개)를 차례로 알려 와도
    // 기준은 처음 고른 쪽의 첫 할 일(번호 6) 그대로라 작은 크기에서는 그 할 일이 든 쪽(할 일 4쪽 = 전체 4)
    val ids = (0 until 9).map { "t$it" }
    var v = WidgetPages.resolveBase(page = 2, anchorId = null, anchorIndex = -1, ids = ids, hasMemoPage = true, perPage = 6, todoPages = 2)
    assertEquals(WidgetPages.Base(2, "t6", 6), v)
    for (per in listOf(4, 3, 2)) {
      v = WidgetPages.resolveBase(v.page, v.anchorId, v.anchorIndex, ids, true, per, WidgetPages.count(9, per))
      assertEquals("t6", v.anchorId)
      assertTrue(6 in (v.page - 1) * per until v.page * per)
    }
    assertEquals(4, v.page)
    // 다시 크게(6개) → 처음 그 쪽
    v = WidgetPages.resolveBase(v.page, v.anchorId, v.anchorIndex, ids, true, 6, 2)
    assertEquals(2, v.page)
  }

  @Test fun completingTheAnchorKeepsThePage() {
    val ids = (0 until 9).map { "t$it" }
    val v = WidgetPages.resolveBase(page = 2, anchorId = null, anchorIndex = -1, ids = ids, hasMemoPage = true, perPage = 2, todoPages = 5)
    assertEquals(WidgetPages.Base(2, "t2", 2), v)
    // t2를 완료(목록에서 빠짐) → 같은 자리에 온 t3가 기준, 같은 쪽
    val after = ids - "t2"
    val w = WidgetPages.resolveBase(v.page, v.anchorId, v.anchorIndex, after, true, 2, WidgetPages.count(after.size, 2))
    assertEquals(WidgetPages.Base(2, "t3", 2), w)
    // 끝 쪽의 할 일을 다 완료해 쪽이 없어지면 남은 마지막 쪽으로
    val few = ids.take(3)
    val z = WidgetPages.resolveBase(page = 5, anchorId = "t8", anchorIndex = 8, ids = few, hasMemoPage = true, perPage = 2, todoPages = 2)
    assertEquals(2, z.page)
  }

  @Test fun readingOffsetSurvivesResizes() {
    // 큰 크기에서 2쪽(글자 400부터)을 고름 → 작은 크기 쪽들 사이 어디서든 그 글자가 든 쪽
    val big = intArrayOf(0, 400)
    val (p, off) = WidgetPages.resolveRead(readPage = 1, offset = -1, starts = big)
    assertEquals(1 to 400, p to off)
    val mid = intArrayOf(0, 260, 520)
    val small = intArrayOf(0, 120, 250, 380, 470)
    assertEquals(1 to 400, WidgetPages.resolveRead(p, off, mid))
    assertEquals(3, WidgetPages.resolveRead(1, 400, small).first)
    assertEquals(400, WidgetPages.resolveRead(1, 400, small).second)
  }
}
