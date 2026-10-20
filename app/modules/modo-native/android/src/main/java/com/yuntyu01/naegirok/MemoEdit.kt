package com.yuntyu01.naegirok

/**
 * 위젯에서 메모 전체를 고친 결과의 바뀐 부분: 앞뒤로 같은 줄은 그대로 두고, 문단 [from, to)를 lines로 바꾼다.
 * Android 의존이 없어 단위 테스트로 확인한다(src/test/.../MemoEditTest.kt).
 */
data class MemoEdit(val from: Int, val to: Int, val lines: List<String>) {
  companion object {
    fun of(old: List<String>, new: List<String>): MemoEdit {
      var head = 0
      while (head < old.size && head < new.size && old[head] == new[head]) head++
      var tail = 0
      while (tail < old.size - head && tail < new.size - head && old[old.size - 1 - tail] == new[new.size - 1 - tail]) tail++
      return MemoEdit(head, old.size - tail, new.subList(head, new.size - tail))
    }
  }
}
