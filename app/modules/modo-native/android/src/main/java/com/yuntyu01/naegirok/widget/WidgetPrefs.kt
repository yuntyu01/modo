package com.yuntyu01.naegirok.widget

import android.content.Context

/**
 * 위젯마다 따로 두는 설정: 폴더, 표시 내용, 글자 크기, 배경 불투명도(null이면 꾸미기의 위젯 테마 값).
 * 보는 상태도 위젯마다(다른 위젯의 폴더·쪽을 바꾸지 않는다):
 * - page: 기본 모드의 쪽(메모가 있으면 0 = 메모, 그다음부터 할 일)
 * - anchorTodo/anchorIndex: 보던 할 일 쪽의 첫 할 일. 크기를 바꾸거나 완료·삭제로 줄이 바뀌어도 그 할 일이 든 쪽을 다시 찾는다
 * - reading: 메모 읽기 모드. readPage/readOffset: 읽던 쪽과 그 쪽 첫 글자 위치(크기를 바꿔도 같은 글부터)
 */
data class WidgetPrefs(
  val folderId: String?,
  val show: Show,
  val textSize: Float,
  val opacity: Float?,
  val page: Int = 0,
  val anchorTodo: String? = null,
  val anchorIndex: Int = -1,
  val reading: Boolean = false,
  val readPage: Int = 0,
  val readOffset: Int = -1,
) {
  /** 폴더를 바꾸면 보는 상태는 처음부터 */
  fun withFolder(id: String?) =
    if (id == folderId) this else copy(folderId = id, page = 0, anchorTodo = null, anchorIndex = -1, reading = false, readPage = 0, readOffset = -1)

  enum class Show { BOTH, TODOS, MEMO }

  fun save(ctx: Context, id: Int) {
    ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
      .putString("folder_$id", folderId)
      .putString("show_$id", show.name)
      .putFloat("size_$id", textSize)
      .putFloat("opacity_$id", opacity ?: -1f)
      .putInt("page_$id", page)
      .putString("anchor_todo_$id", anchorTodo)
      .putInt("anchor_index_$id", anchorIndex)
      .putBoolean("reading_$id", reading)
      .putInt("read_page_$id", readPage)
      .putInt("read_offset_$id", readOffset)
      .apply()
  }

  companion object {
    private const val FILE = "naegirok_widgets"
    val SIZES = listOf(13f, 15f, 18f)

    private const val MIGRATED = "opacity_migrated_v2"
    private val OLD_OPACITY = listOf(0.92f, 0.7f, 0.45f, 0.65f)

    fun load(ctx: Context, id: Int): WidgetPrefs {
      val p = ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)
      // 예전 기본값(92%, 70%, 45%, 65%)을 그대로 저장해 둔 위젯은 새 기본값(꾸미기의 위젯 투명도)을 따른다: 한 번만.
      // 예전엔 읽을 때마다 값으로 판단해, 사용자가 직접 고른 70% 같은 값도 매번 버렸다
      if (!p.getBoolean(MIGRATED, false)) {
        val e = p.edit()
        for ((k, v) in p.all) if (k.startsWith("opacity_") && v is Float && v in OLD_OPACITY) e.remove(k)
        e.putBoolean(MIGRATED, true).apply()
      }
      return WidgetPrefs(
        folderId = p.getString("folder_$id", null),
        show = runCatching { Show.valueOf(p.getString("show_$id", "BOTH")!!) }.getOrDefault(Show.BOTH),
        textSize = p.getFloat("size_$id", 15f),
        opacity = p.getFloat("opacity_$id", -1f).takeIf { it >= 0f },
        page = p.getInt("page_$id", 0),
        anchorTodo = p.getString("anchor_todo_$id", null),
        anchorIndex = p.getInt("anchor_index_$id", -1),
        reading = p.getBoolean("reading_$id", false),
        readPage = p.getInt("read_page_$id", 0),
        readOffset = p.getInt("read_offset_$id", -1),
      )
    }

    fun delete(ctx: Context, id: Int) {
      ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
        .remove("folder_$id").remove("show_$id").remove("size_$id").remove("opacity_$id")
        .remove("page_$id").remove("anchor_todo_$id").remove("anchor_index_$id")
        .remove("reading_$id").remove("read_page_$id").remove("read_offset_$id").apply()
    }
  }
}
