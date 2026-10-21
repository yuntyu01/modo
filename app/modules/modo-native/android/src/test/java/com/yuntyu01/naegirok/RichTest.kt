package com.yuntyu01.naegirok

import org.junit.Assert.assertEquals
import org.junit.Test

/** 앱(app/src/core/__tests__/rich.test.ts)과 같은 저장 형식인지 */
class RichTest {
  @Test fun plainTextIsUntouched() {
    for (s in listOf("장보기", "3시~5시 회의 ~~", "a < b && c > d", "<div>", "x &gt; y", "**별표**", "https://a.com/?q=1&r=2")) {
      assertEquals(listOf(Rich.Run(s)), Rich.parse(s))
      assertEquals(s, Rich.serialize(Rich.parse(s)))
      assertEquals(s, Rich.plain(s))
    }
  }

  @Test fun readsAndWritesMarks() {
    val src = "오늘 <b>꼭</b> <u>밑줄</u> <s>취소</s> <a href=\"https://naver.com\">네이버</a>"
    assertEquals(
      listOf(
        Rich.Run("오늘 "), Rich.Run("꼭", b = true), Rich.Run(" "), Rich.Run("밑줄", u = true), Rich.Run(" "),
        Rich.Run("취소", s = true), Rich.Run(" "), Rich.Run("네이버", href = "https://naver.com"),
      ),
      Rich.parse(src),
    )
    assertEquals(src, Rich.serialize(Rich.parse(src)))
    assertEquals("오늘 꼭 밑줄 취소 네이버", Rich.plain(src))
  }

  @Test fun nestedMarksMatchTheApp() {
    val runs = listOf(Rich.Run("a", b = true), Rich.Run("b", b = true, u = true), Rich.Run("c", u = true, href = "https://x.y"), Rich.Run("d"))
    val s = Rich.serialize(runs)
    assertEquals("<b>a<u>b</u></b><a href=\"https://x.y\"><u>c</u></a>d", s)
    assertEquals(runs, Rich.parse(s))
  }

  @Test fun tagLikeTextIsEscaped() {
    for (t in listOf("<b>굵게 아님</b>", "&lt;", "&amp;lt;", "<a href=\"x\">", "</a>", "<s", "a&b")) {
      val s = Rich.serialize(listOf(Rich.Run(t)))
      assertEquals(listOf(Rich.Run(t)), Rich.parse(s))
      assertEquals(s, Rich.escape(t))
    }
    assertEquals("&lt;b>x", Rich.escape("<b>x"))
    assertEquals("a < b", Rich.escape("a < b"))
  }

  @Test fun unsafeOrUnmatchedTagsKeepText() {
    assertEquals(listOf(Rich.Run("a</b>c")), Rich.parse("a</b>c"))
    assertEquals(listOf(Rich.Run("x")), Rich.parse("<a href=\"javascript:alert(1)\">x</a>"))
    assertEquals(listOf(Rich.Run("끝까지", b = true)), Rich.parse("<b>끝까지"))
  }
}
