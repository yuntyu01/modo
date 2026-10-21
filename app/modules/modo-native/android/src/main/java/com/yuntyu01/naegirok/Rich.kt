package com.yuntyu01.naegirok

import android.graphics.Typeface
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan
import android.text.style.URLSpan
import android.text.style.UnderlineSpan

/**
 * 글 꾸미기(굵게·밑줄·취소선·링크) 저장 형식. 앱(app/src/core/rich.ts)과 같은 규칙:
 *   <b>…</b> <u>…</u> <s>…</s> <a href="https://…">…</a>
 * 꾸미지 않은 글은 예전과 같고, 글 속의 '<'·'&'는 태그나 &lt; &amp;로 읽힐 때만 &lt; &amp;로 적는다.
 * 위젯은 꾸민 대로 보여 주고(링크는 밑줄만), 알림·읽어 주기는 태그를 뺀 글, 위젯 고치기 창은 꾸밈을 지킨 채 고친다.
 */
object Rich {
  data class Run(val text: String, val b: Boolean = false, val u: Boolean = false, val s: Boolean = false, val href: String? = null) {
    fun sameMarks(o: Run) = b == o.b && u == o.u && s == o.s && href == o.href
    val plain get() = !b && !u && !s && href == null
  }

  private val TOKEN = Regex("<(/?)([bus])>|<a href=\"([^\"<>]*)\">|</a>|&(lt|amp);")
  private val TAG_AT = Regex("</?[bus]>|<a href=\"[^\"<>]*\">|</a>")
  private val SAFE = Regex("^(https?://|mailto:|tel:)", RegexOption.IGNORE_CASE)

  private fun safeHref(h: String) = if (SAFE.containsMatchIn(h)) h else null

  fun normalize(runs: List<Run>): List<Run> {
    val out = ArrayList<Run>()
    for (r in runs) {
      if (r.text.isEmpty()) continue
      val last = out.lastOrNull()
      if (last != null && last.sameMarks(r)) out[out.size - 1] = last.copy(text = last.text + r.text) else out.add(r)
    }
    return out
  }

  fun parse(src: String): List<Run> {
    if (src.isEmpty()) return emptyList()
    if (src.indexOf('<') < 0 && src.indexOf('&') < 0) return listOf(Run(src))
    val out = ArrayList<Run>()
    var b = 0
    var u = 0
    var s = 0
    // 허락하지 않는 주소("")도 닫는 태그와 짝을 맞추려고 쌓아 둔다
    val links = ArrayList<String>()
    val buf = StringBuilder()
    fun flush() {
      if (buf.isEmpty()) return
      out.add(Run(buf.toString(), b > 0, u > 0, s > 0, links.lastOrNull()?.takeIf { it.isNotEmpty() }))
      buf.setLength(0)
    }
    var last = 0
    for (m in TOKEN.findAll(src)) {
      buf.append(src, last, m.range.first)
      last = m.range.last + 1
      val close = m.groupValues[1].isNotEmpty()
      val mark = m.groupValues[2]
      val href = m.groups[3]?.value
      val ent = m.groupValues[4]
      when {
        ent.isNotEmpty() -> buf.append(if (ent == "lt") '<' else '&')
        mark.isNotEmpty() -> {
          val depth = when (mark) { "b" -> b; "u" -> u; else -> s }
          if (!close || depth > 0) {
            flush()
            val d = if (close) -1 else 1
            when (mark) { "b" -> b += d; "u" -> u += d; else -> s += d }
          } else {
            buf.append(m.value)
          }
        }
        href != null -> {
          flush()
          links.add(safeHref(href) ?: "")
        }
        links.isNotEmpty() -> {
          flush()
          links.removeAt(links.size - 1)
        }
        else -> buf.append(m.value)
      }
    }
    buf.append(src, last, src.length)
    flush()
    return normalize(out)
  }

  /** 태그를 뺀 글(알림·읽어 주기·비었는지 보기) */
  fun plain(src: String): String =
    if (src.indexOf('<') < 0 && src.indexOf('&') < 0) src else parse(src).joinToString("") { it.text }

  /** 꾸미지 않은 글(빠른 추가)을 저장할 글로: 태그처럼 읽힐 글자만 바꿔 적는다 */
  fun escape(t: String): String {
    if (t.indexOf('<') < 0 && t.indexOf('&') < 0) return t
    val out = StringBuilder()
    for (i in t.indices) {
      val c = t[i]
      when {
        c == '<' && TAG_AT.find(t, i)?.range?.first == i -> out.append("&lt;")
        c == '&' && (t.startsWith("lt;", i + 1) || t.startsWith("amp;", i + 1)) -> out.append("&amp;")
        else -> out.append(c)
      }
    }
    return out.toString()
  }

  fun serialize(runs: List<Run>): String {
    val out = StringBuilder()
    // 열린 태그: "a"는 주소와 함께
    val stack = ArrayList<Pair<Char, String?>>()
    fun has(r: Run, k: Char) = when (k) { 'a' -> r.href != null; 'b' -> r.b; 'u' -> r.u; else -> r.s }
    for (r in runs) {
      if (r.text.isEmpty()) continue
      var keep = 0
      while (keep < stack.size && stack[keep].let { (k, h) -> if (k == 'a') r.href != null && r.href == h else has(r, k) }) keep++
      while (stack.size > keep) out.append("</").append(stack.removeAt(stack.size - 1).first).append('>')
      for (k in charArrayOf('a', 'b', 'u', 's')) {
        if (!has(r, k) || stack.any { it.first == k }) continue
        stack.add(k to r.href)
        if (k == 'a') out.append("<a href=\"").append(r.href).append("\">") else out.append('<').append(k).append('>')
      }
      out.append(escape(r.text))
    }
    while (stack.isNotEmpty()) out.append("</").append(stack.removeAt(stack.size - 1).first).append('>')
    return out.toString()
  }

  /**
   * 화면에 넣을 글. edit = 위젯 고치기 창(링크 주소를 지키고, 끝에 이어 쓴 글은 앞 글의 꾸밈을 따른다 · 링크는 따르지 않는다).
   * 위젯에서는 링크를 밑줄로만(위젯 글자색이 낮·밤을 따라가게 색은 바꾸지 않는다).
   */
  fun spanned(src: String, edit: Boolean = false): CharSequence {
    val runs = parse(src)
    if (runs.all { it.plain }) return runs.joinToString("") { it.text }
    val sb = SpannableStringBuilder()
    val grow = if (edit) Spanned.SPAN_EXCLUSIVE_INCLUSIVE else Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
    for (r in runs) {
      val start = sb.length
      sb.append(r.text)
      val end = sb.length
      if (r.b) sb.setSpan(StyleSpan(Typeface.BOLD), start, end, grow)
      if (r.u || (r.href != null && !edit)) sb.setSpan(UnderlineSpan(), start, end, grow)
      if (r.s) sb.setSpan(StrikethroughSpan(), start, end, grow)
      if (r.href != null && edit) sb.setSpan(URLSpan(r.href), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
    return sb
  }

  /** 고치기 창의 글(꾸밈 span 포함)을 저장할 글로. 줄마다 따로(메모는 줄 = 문단) */
  fun fromSpanned(cs: CharSequence): String {
    val sp = cs as? Spanned ?: return cs.toString().split('\n').joinToString("\n") { escape(it) }
    val lines = ArrayList<String>()
    var lineStart = 0
    val text = cs.toString()
    while (true) {
      val nl = text.indexOf('\n', lineStart)
      val lineEnd = if (nl < 0) text.length else nl
      val runs = ArrayList<Run>()
      var i = lineStart
      while (i < lineEnd) {
        val next = sp.nextSpanTransition(i, lineEnd, Any::class.java).coerceAtMost(lineEnd)
        // 한글 조합 중 표시(밑줄) 같은 입력기의 span은 꾸밈이 아니다
        fun live(o: Any) = (sp.getSpanFlags(o) and Spanned.SPAN_COMPOSING) == 0
        val b = sp.getSpans(i, next, StyleSpan::class.java).any { live(it) && (it.style and Typeface.BOLD) != 0 && covers(sp, it, i, next) }
        val u = sp.getSpans(i, next, UnderlineSpan::class.java).any { live(it) && it.javaClass == UnderlineSpan::class.java && covers(sp, it, i, next) }
        val s = sp.getSpans(i, next, StrikethroughSpan::class.java).any { live(it) && covers(sp, it, i, next) }
        val href = sp.getSpans(i, next, URLSpan::class.java).firstOrNull { covers(sp, it, i, next) }?.url?.let { safeHref(it) }
        runs.add(Run(text.substring(i, next), b, u, s, href))
        i = if (next > i) next else lineEnd
      }
      lines.add(serialize(normalize(runs)))
      if (nl < 0) break
      lineStart = nl + 1
    }
    return lines.joinToString("\n")
  }

  private fun covers(sp: Spanned, o: Any, a: Int, b: Int) = sp.getSpanStart(o) <= a && sp.getSpanEnd(o) >= b && a < b
}
