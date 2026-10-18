package com.yuntyu01.naegirok

/**
 * app/src/core/frac.ts 와 같은 분수 인덱스. 한쪽만 바꾸면 정렬이 어긋난다.
 * 키 = 정수부(첫 글자가 길이: a=2자 … z=27자, Z=2자 … A=27자) + 소수부. 맨 앞/뒤에 붙일 때는 정수부를 1씩 내리고 올려
 * 키 길이가 로그로만 는다. 예전 방식 키('V', 'zzV' 등)와 섞여도 문자열 순서만 쓰므로 그대로 정렬된다.
 */
object Frac {
  private const val DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
  private val BASE = DIGITS.length
  private val SMALLEST = "A" + "0".repeat(26)

  fun between(a: String?, b: String?): String {
    require(a == null || b == null || a < b) { "frac: $a >= $b" }
    if (b == null) return after(a)
    if (a == null) return before(b)
    if (isValid(a) && isValid(b)) {
      val ia = intPart(a)
      val ib = intPart(b)
      if (ia == ib) return ia + mid(a.drop(ia.length), b.drop(ib.length))!!
      val i = increment(ia)
      if (i != null && i < b) return i
      return ia + mid(a.drop(ia.length), null)!!
    }
    return mid(a, b) ?: mid(a, null)!!
  }

  private fun intLength(head: Char?): Int? = when (head) {
    null -> null
    in 'a'..'z' -> head - 'a' + 2
    in 'A'..'Z' -> 'Z' - head + 2
    else -> null
  }

  private fun isValid(key: String): Boolean {
    val n = intLength(key.firstOrNull()) ?: return false
    if (key.length < n || key == SMALLEST) return false
    return key.length == n || !key.endsWith('0')
  }

  private fun intPart(key: String) = key.substring(0, intLength(key[0])!!)

  private fun increment(int: String): String? {
    val digs = int.drop(1).toCharArray().toMutableList()
    for (i in digs.indices.reversed()) {
      val d = DIGITS.indexOf(digs[i]) + 1
      if (d < BASE) {
        digs[i] = DIGITS[d]
        return int[0] + digs.joinToString("")
      }
      digs[i] = '0'
    }
    if (int[0] == 'Z') return "a0"
    if (int[0] == 'z') return null
    val head = int[0] + 1
    if (head > 'a') digs.add('0') else digs.removeAt(digs.lastIndex)
    return head + digs.joinToString("")
  }

  private fun decrement(int: String): String? {
    val digs = int.drop(1).toCharArray().toMutableList()
    for (i in digs.indices.reversed()) {
      val d = DIGITS.indexOf(digs[i]) - 1
      if (d >= 0) {
        digs[i] = DIGITS[d]
        return int[0] + digs.joinToString("")
      }
      digs[i] = 'z'
    }
    if (int[0] == 'a') return "Zz"
    if (int[0] == 'A') return null
    val head = int[0] - 1
    if (head < 'Z') digs.add('z') else digs.removeAt(digs.lastIndex)
    return head + digs.joinToString("")
  }

  /** a < 결과 < b(b = null이면 위로 끝없음), 0으로 끝나지 않는다. 사이가 없으면(b = a + "0…") null. */
  private fun mid(a: String, b: String?): String? {
    if (b != null) {
      var n = 0
      while (n < b.length && (a.getOrNull(n) ?: '0') == b[n]) n++
      if (n == b.length) return null
      if (n > 0) return mid(a.drop(n), b.drop(n))?.let { b.substring(0, n) + it }
    }
    val da = if (a.isNotEmpty()) DIGITS.indexOf(a[0]) else 0
    val db = if (b != null) DIGITS.indexOf(b[0]) else BASE
    if (db - da > 1) return DIGITS[Math.round((da + db) / 2.0).toInt()].toString()
    if (b != null && b.drop(1).any { it != '0' }) return b.substring(0, 1)
    return DIGITS[da] + mid(a.drop(1), null)!!
  }

  private fun after(a: String?): String {
    if (a == null) return "a0"
    if (isValid(a)) {
      val ia = intPart(a)
      return increment(ia) ?: (ia + mid(a.drop(ia.length), null)!!)
    }
    val n = intLength(a[0]) ?: return increment(SMALLEST)!!
    if (a.length < n) {
      val padded = a.padEnd(n, '0')
      return if (padded == SMALLEST) increment(padded)!! else padded
    }
    return increment(a.substring(0, n)) ?: mid(a, null)!!
  }

  private fun before(b: String): String {
    if (isValid(b)) {
      val ib = intPart(b)
      if (ib == SMALLEST) return ib + mid("", b.drop(ib.length))!!
      if (ib < b) return ib
      return decrement(ib) ?: mid("", b)!!
    }
    val n = intLength(b[0])
    if (n == null) {
      if (b[0] == '0' && b.length > 1) return "0" + before(b.drop(1))
      return mid("", b) ?: b
    }
    val head = b.take(n).padEnd(n, '0')
    if (head < b && head != SMALLEST) return head
    return (if (head == SMALLEST) null else decrement(head)) ?: mid("", b) ?: b
  }
}
