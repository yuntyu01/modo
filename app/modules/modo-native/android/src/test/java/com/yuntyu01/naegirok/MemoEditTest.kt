package com.yuntyu01.naegirok

import org.junit.Assert.assertEquals
import org.junit.Test

class MemoEditTest {
  private fun apply(old: List<String>, e: MemoEdit) = old.subList(0, e.from) + e.lines + old.subList(e.to, old.size)

  @Test fun unchangedTouchesNothing() {
    val old = listOf("a", "b", "c")
    assertEquals(MemoEdit(3, 3, emptyList()), MemoEdit.of(old, old))
  }

  @Test fun insertedLineKeepsTheRestInPlace() {
    // 맨 위에 한 줄: 아래 문단은 그대로(예전엔 줄 번호로 맞춰 셋 다 고쳐 쓰고 마지막 줄을 새로 붙였다)
    assertEquals(MemoEdit(0, 0, listOf("new")), MemoEdit.of(listOf("a", "b", "c"), listOf("new", "a", "b", "c")))
    assertEquals(MemoEdit(1, 1, listOf("new")), MemoEdit.of(listOf("a", "b"), listOf("a", "new", "b")))
  }

  @Test fun removedAndChangedLines() {
    assertEquals(MemoEdit(1, 2, emptyList()), MemoEdit.of(listOf("a", "b", "c"), listOf("a", "c")))
    assertEquals(MemoEdit(1, 2, listOf("B")), MemoEdit.of(listOf("a", "b", "c"), listOf("a", "B", "c")))
    assertEquals(MemoEdit(0, 2, emptyList()), MemoEdit.of(listOf("a", "b"), emptyList()))
  }

  @Test fun repeatedLinesNeverOverlap() {
    // 같은 줄이 겹쳐도 앞뒤 일치가 서로 넘지 않는다
    assertEquals(MemoEdit(2, 2, listOf("x")), MemoEdit.of(listOf("x", "x"), listOf("x", "x", "x")))
    assertEquals(MemoEdit(2, 3, emptyList()), MemoEdit.of(listOf("x", "x", "x"), listOf("x", "x")))
  }

  @Test fun applyingTheEditGivesTheNewText() {
    val cases = listOf(
      listOf("a", "b", "c") to listOf("c", "b", "a"),
      listOf("", "a", "") to listOf("", "", "a", ""),
      emptyList<String>() to listOf("a"),
      listOf("a", "b", "c", "d") to listOf("a", "x", "y", "d"),
    )
    for ((old, new) in cases) assertEquals(new, apply(old, MemoEdit.of(old, new)))
  }
}
