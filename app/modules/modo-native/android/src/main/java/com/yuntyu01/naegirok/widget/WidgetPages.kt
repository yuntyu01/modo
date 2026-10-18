package com.yuntyu01.naegirok.widget

/**
 * 홈 위젯의 쪽 계산(Android 의존 없음, 단위 테스트: src/test/.../WidgetPagesTest.kt).
 * 기본 모드: [메모 쪽(메모가 있으면)] + [할 일 쪽들]. 메모 읽기 모드는 메모 본문 쪽만 따로 센다.
 */
object WidgetPages {
  /** n개를 한 쪽에 per개씩 둘 때 쪽 수. 없으면 1쪽(빈 쪽) */
  fun count(n: Int, per: Int): Int = if (n <= 0) 1 else (n + per.coerceAtLeast(1) - 1) / per.coerceAtLeast(1)

  /** 지운·완료·동기화로 쪽이 줄었으면 마지막 쪽으로 */
  fun clamp(page: Int, count: Int): Int = page.coerceIn(0, (count - 1).coerceAtLeast(0))

  /**
   * 메모 줄을 쪽으로 나눈다. tops[i] = i번째 줄 위(px), tops[n] = 마지막 줄 아래. 반환: 쪽마다 [첫 줄, 끝 줄) 범위.
   * 한 쪽 높이(avail)에 들어가는 만큼 줄을 담고, 한 줄이 쪽보다 커도(아주 큰 글자) 한 줄은 담아 멈추지 않는다.
   */
  fun splitLines(tops: IntArray, avail: Int): List<IntRange> {
    val n = tops.size - 1
    if (n <= 0) return listOf(0 until 0)
    val pages = mutableListOf<IntRange>()
    var start = 0
    while (start < n) {
      var end = start + 1
      while (end < n && tops[end + 1] - tops[start] <= avail) end++
      pages.add(start until end)
      start = end
    }
    return pages
  }

  /** 점이 쪽 수보다 적게 들어가면 지금 쪽이 들어가는 max개만(가운데 쪽으로 따라간다) */
  fun dotWindow(page: Int, count: Int, max: Int): IntRange {
    if (count <= max) return 0 until count
    val first = (page - max / 2).coerceIn(0, count - max)
    return first until first + max
  }

  /**
   * 기본 모드에서 보여 줄 쪽. 할 일 쪽을 보고 있었으면 그 쪽 첫 할 일(anchor, 없어졌으면 그 자리 번호)이 든 쪽을 다시 찾는다:
   * 크기를 바꿔 한 쪽 개수가 달라져도, 완료·삭제·동기화로 줄이 줄어도 보던 할 일 근처에 머문다.
   * anchor < 0 이면(점을 눌러 쪽을 골랐을 때) 저장된 쪽 그대로. 메모 쪽(0)은 그대로 메모 쪽.
   */
  fun basePage(page: Int, anchor: Int, hasMemoPage: Boolean, perPage: Int, todoPages: Int): Int {
    val first = if (hasMemoPage) 1 else 0
    val total = first + todoPages
    val p = if (anchor >= 0 && page >= first) first + (anchor / perPage.coerceAtLeast(1)).coerceAtMost(todoPages - 1) else page
    return clamp(p, total)
  }

  /** 읽던 글자 위치(offset)가 든 메모 쪽. starts = 쪽마다 첫 글자 위치(오름차순) */
  fun pageOfOffset(starts: IntArray, offset: Int): Int = starts.indexOfLast { it <= offset }.coerceAtLeast(0)

  /** 기본 모드에서 보여 줄 쪽과, 다음에도 쓸 기준(보던 쪽의 첫 할 일) */
  data class Base(val page: Int, val anchorId: String?, val anchorIndex: Int)

  /**
   * 기준은 사용자가 점으로 쪽을 고를 때만 새로 정한다(anchorId·anchorIndex가 없을 때 = 고른 쪽의 첫 할 일).
   * 크기를 바꾸는 동안 런처가 중간 크기를 여러 번 알려 와도 기준을 그때그때 쪽 첫 줄로 덮어쓰지 않아 앞쪽으로 밀리지 않는다.
   * 기준 할 일이 완료·삭제로 없어지면 그 자리(번호)에 온 할 일이 새 기준이다.
   */
  fun resolveBase(page: Int, anchorId: String?, anchorIndex: Int, ids: List<String>, hasMemoPage: Boolean, perPage: Int, todoPages: Int): Base {
    val first = if (hasMemoPage) 1 else 0
    val at = anchorId?.let { ids.indexOf(it) }?.takeIf { it >= 0 }
      ?: anchorIndex.takeIf { it >= 0 && ids.isNotEmpty() }?.coerceAtMost(ids.size - 1)
      ?: -1
    val p = basePage(page, at, hasMemoPage, perPage, todoPages.coerceAtLeast(1)).coerceAtMost((first + todoPages - 1).coerceAtLeast(0))
    if (p < first) return Base(p, null, -1)
    if (at >= 0) return Base(p, ids[at], at)
    val top = (p - first) * perPage.coerceAtLeast(1)
    return Base(p, ids.getOrNull(top), if (ids.isEmpty()) -1 else top)
  }

  /** 메모 읽기 모드의 쪽과 기준 글자 위치. 기준은 쪽을 고를 때(offset < 0)만 그 쪽 첫 글자로 정하고, 크기가 바뀌어도 그대로 둔다 */
  fun resolveRead(readPage: Int, offset: Int, starts: IntArray): Pair<Int, Int> =
    if (offset >= 0) pageOfOffset(starts, offset) to offset
    else clamp(readPage, starts.size).let { it to starts[it] }
}
