package com.yuntyu01.naegirok

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import org.json.JSONObject
import java.io.File
import java.util.UUID

/**
 * 앱(JS, expo-sqlite)과 같은 SQLite 파일을 연다: <filesDir>/SQLite/naegirok.db (설치된 앱의 데이터를 지키려고 예전 이름 그대로)
 * 스키마는 app/src/core/schema.ts 와 같다. 쓰기는 JS Repo처럼 outbox에도 남겨 동기화되게 한다.
 * WAL을 켠 채로 열어야 JS 쪽 연결과 함께 써도 저널 모드가 바뀌지 않는다.
 */
object NotesDb {
  data class Folder(val id: String, val name: String)
  data class Todo(
    val id: String, val text: String, val doneAt: Long?, val due: String?, val folderId: String?, val remindAt: Long? = null,
    val repeatFreq: String? = null, val repeatDays: Int? = null,
  ) {
    val done get() = doneAt != null
  }

  fun file(ctx: Context) = File(ctx.filesDir, "SQLite/naegirok.db")

  /** DB가 아직 없으면(앱을 한 번도 안 열었으면) null */
  fun <T> use(ctx: Context, block: (SQLiteDatabase) -> T): T? {
    val f = file(ctx)
    if (!f.exists()) return null
    val db = SQLiteDatabase.openDatabase(
      f.path, null, SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.ENABLE_WRITE_AHEAD_LOGGING,
    )
    return try {
      db.rawQuery("PRAGMA busy_timeout = 3000", null).use { it.moveToFirst() }
      ensureSchema(db)
      block(db)
    } catch (e: android.database.sqlite.SQLiteException) {
      // 앱이 아직 표를 만들기 전 등 읽을 수 없는 DB: 위젯·빠른 추가가 멈추지 않게 DB가 없는 것으로 본다(빈 위젯)
      android.util.Log.w("NotesDb", "unreadable db", e)
      null
    } finally {
      db.close()
    }
  }

  /**
   * 영구 삭제 표시 열(purged)이 아직 있으면(앱이 v4로 옮기기 전) 그 행을 빼는 조건. 앱이 옮긴 뒤에는 열이 없다.
   * 앱이 다른 프로세스에서 언제 옮길지 몰라 DB를 열 때마다 다시 본다(PRAGMA 한 번이라 가볍다).
   */
  @Volatile private var live = ""

  /**
   * 앱을 새 버전으로 바꾼 뒤 앱을 열기 전에 위젯이 먼저 DB를 열 수 있다. 앱(schema.ts MIGRATE_V3)과 같은 열을 여기서도 맞춘다.
   */
  private fun ensureSchema(db: SQLiteDatabase) {
    val cols = db.rawQuery("PRAGMA table_info(todos)", null).use { c -> buildSet { while (c.moveToNext()) add(c.getString(1)) } }
    if (cols.isNotEmpty() && "repeat_freq" !in cols) {
      runCatching {
        db.execSQL("ALTER TABLE todos ADD COLUMN repeat_freq TEXT CHECK (repeat_freq IN ('daily', 'weekly', 'monthly'))")
        db.execSQL("ALTER TABLE todos ADD COLUMN repeat_days INTEGER CHECK (repeat_days BETWEEN 1 AND 127)")
      }
    }
    // 루틴을 한 날 기록(schema.ts MIGRATE_V5)
    if (cols.isNotEmpty() && "done_log" !in cols) runCatching { db.execSQL("ALTER TABLE todos ADD COLUMN done_log TEXT") }
    live = if ("purged" in cols) " AND purged = 0" else ""
  }

  fun <T> write(ctx: Context, block: (SQLiteDatabase) -> T): T? = use(ctx) { db ->
    db.beginTransactionNonExclusive()
    try {
      val r = block(db)
      db.setTransactionSuccessful()
      r
    } finally {
      db.endTransaction()
    }
  }

  fun prefs(db: SQLiteDatabase): JSONObject =
    db.rawQuery("SELECT value FROM kv WHERE key = 'prefs'", null).use { c ->
      if (c.moveToFirst()) runCatching { JSONObject(c.getString(0)) }.getOrDefault(JSONObject()) else JSONObject()
    }

  fun folders(db: SQLiteDatabase): List<Folder> =
    db.rawQuery("SELECT id, name FROM folders WHERE deleted_at IS NULL ORDER BY position, id", null).use { c ->
      buildList { while (c.moveToNext()) add(Folder(c.getString(0), c.getString(1))) }
    }

  fun folderName(db: SQLiteDatabase, id: String?): String? = id?.let {
    db.rawQuery("SELECT name FROM folders WHERE id = ? AND deleted_at IS NULL", arrayOf(it)).use { c ->
      if (c.moveToFirst()) c.getString(0) else null
    }
  }

  /**
   * 폴더 조건. null = 기본 폴더: 폴더가 없거나 없어진 폴더를 가리키는 항목(앱의 homeFolder와 같은 규칙).
   */
  private fun folderWhere(folderId: String?): Pair<String, List<String>> =
    if (folderId != null) " AND folder_id = ?" to listOf(folderId)
    else " AND (folder_id IS NULL OR folder_id NOT IN (SELECT id FROM folders WHERE deleted_at IS NULL))" to emptyList()

  /** 한 폴더의 할 일(all = true면 모든 폴더: 잠금화면 알림용) */
  fun todos(db: SQLiteDatabase, folderId: String?, includeDone: Boolean, limit: Int = 50, all: Boolean = false): List<Todo> {
    val where = StringBuilder("deleted_at IS NULL$live")
    val args = mutableListOf<String>()
    if (!all) {
      val (w, a) = folderWhere(folderId)
      where.append(w)
      args.addAll(a)
    }
    val today = java.time.LocalDate.now().toString()
    if (!includeDone) {
      where.append(" AND NOT $DONE_NOW")
      args.add(today)
    }
    // 앞날에 시작하는 반복도 보인다(아래 줄에 '매월 20일 · 10월 20일'). 그날까지 숨기던 규칙은 뺐다(앱과 같다, 사용자 요청 2026-10-18)
    return db.rawQuery(
      "SELECT id, text, CASE WHEN $DONE_NOW THEN done_at END AS done_now, due_date, folder_id, remind_at, repeat_freq, repeat_days " +
        "FROM todos WHERE $where ORDER BY done_now IS NOT NULL, done_now DESC, position, id LIMIT $limit",
      (listOf(today) + args).toTypedArray(),
    ).use { c ->
      buildList {
        while (c.moveToNext()) {
          add(
            Todo(
              c.getString(0), c.getString(1), if (c.isNull(2)) null else c.getLong(2), c.getString(3), c.getString(4),
              if (c.isNull(5)) null else c.getLong(5), c.getString(6), if (c.isNull(7)) null else c.getInt(7),
            ),
          )
        }
      }
    }
  }

  /** 그 폴더의 메모 문서(문단들) */
  fun memo(db: SQLiteDatabase, folderId: String?): List<String> {
    val (where, args) = folderWhere(folderId)
    return db.rawQuery(
      "SELECT text FROM paragraphs WHERE deleted_at IS NULL$live$where ORDER BY position, id",
      args.toTypedArray(),
    ).use { c -> buildList { while (c.moveToNext()) add(c.getString(0)) } }
  }

  /**
   * 완료 여부(? = 오늘). 반복 할 일은 체크하면 done_at을 남기고 다음 예정일로 넘어가, 그날이 오기 전까지만 완료이고
   * 그날이 되면 다시 할 일로 올라온다(앱 repo.isDoneNow와 같은 규칙).
   */
  private const val DONE_NOW = "(done_at IS NOT NULL AND NOT (repeat_freq IS NOT NULL AND due_date IS NOT NULL AND due_date <= ?))"

  /** 위젯에서 체크를 풀 때. 반복이면 오늘 할 일로 되돌리고(알림도 같은 날만큼), 아니면 완료 취소(앱 Cards와 같다). */
  fun uncheck(db: SQLiteDatabase, id: String, now: Long = System.currentTimeMillis()) {
    data class Cur(val freq: String?, val due: String?, val remind: Long?, val doneAt: Long?, val log: String?)
    val cur = db.rawQuery("SELECT repeat_freq, due_date, remind_at, done_at, done_log FROM todos WHERE id = ?", arrayOf(id)).use { c ->
      if (!c.moveToFirst()) return
      Cur(c.getString(0), c.getString(1), if (c.isNull(2)) null else c.getLong(2), if (c.isNull(3)) null else c.getLong(3), c.getString(4))
    }
    if (cur.freq == null) return setDone(db, id, false, now)
    val today = Repeat.localDate(now)
    val due = cur.due?.let { runCatching { java.time.LocalDate.parse(it) }.getOrNull() } ?: today
    val remind = cur.remind?.let { Repeat.shift(it, due, today) }
    val log = doneLog(cur.log, today.toString(), add = false)
    db.execSQL("UPDATE todos SET done_at = NULL, due_date = ?, remind_at = ?, done_log = ? WHERE id = ?", arrayOf(today.toString(), remind, log, id))
    val fields = JSONObject().put("done_at", change(cur.doneAt, null)).put("due_date", change(cur.due, today.toString())).put("done_log", change(cur.log, log))
    if (remind != cur.remind) fields.put("remind_at", change(cur.remind, remind))
    enqueue(db, "todo", id, false, fields, now)
  }

  /** 완료/완료 취소. 완료 시각만 바꾸고 '마지막 수정'은 그대로(JS Repo와 같은 규칙). */
  fun setDone(db: SQLiteDatabase, id: String, done: Boolean, now: Long = System.currentTimeMillis()) {
    val cur = db.rawQuery("SELECT done_at FROM todos WHERE id = ?", arrayOf(id)).use { c ->
      if (!c.moveToFirst()) return
      if (c.isNull(0)) null else c.getLong(0)
    }
    if ((cur != null) == done) return
    val next = if (done) now else null
    db.execSQL("UPDATE todos SET done_at = ? WHERE id = ?", arrayOf(next, id))
    enqueue(db, "todo", id, false, JSONObject().put("done_at", change(cur, next)), now)
  }

  /**
   * 동그라미를 눌렀을 때. 반복이 아니면 완료, 반복이면 다음 예정일로 넘기고 알림도 같은 날만큼 옮긴다(JS Repo.complete와 같다).
   */
  fun complete(db: SQLiteDatabase, id: String, now: Long = System.currentTimeMillis()) {
    data class Cur(val freq: String?, val days: Int?, val due: String?, val remind: Long?, val updated: Long, val doneAt: Long?, val log: String?)
    val cur = db.rawQuery("SELECT repeat_freq, repeat_days, due_date, remind_at, updated_at, done_at, done_log FROM todos WHERE id = ?", arrayOf(id)).use { c ->
      if (!c.moveToFirst()) return
      Cur(
        c.getString(0), if (c.isNull(1)) null else c.getInt(1), c.getString(2), if (c.isNull(3)) null else c.getLong(3), c.getLong(4),
        if (c.isNull(5)) null else c.getLong(5), c.getString(6),
      )
    }
    val freq = cur.freq ?: return setDone(db, id, true, now)
    val due = cur.due?.let { runCatching { java.time.LocalDate.parse(it) }.getOrNull() }
    val next = Repeat.nextDue(freq, if (freq == "weekly") cur.days else null, due, Repeat.localDate(now))
    val remind = cur.remind?.let { Repeat.shift(it, due ?: Repeat.localDate(it), next) }
    // 이번 회차 완료: 다음 예정일까지는 완료로 남고(DONE_NOW), 오늘을 '한 날'로 남긴다(앱 core/doneLog.ts와 같은 모양)
    val log = doneLog(cur.log, Repeat.localDate(now).toString(), add = true)
    db.execSQL("UPDATE todos SET due_date = ?, remind_at = ?, done_at = ?, done_log = ?, updated_at = ? WHERE id = ?", arrayOf(next.toString(), remind, now, log, now, id))
    val fields = JSONObject()
      .put("due_date", change(cur.due, next.toString()))
      .put("done_at", change(cur.doneAt, now))
      .put("done_log", change(cur.log, log))
      .put("updated_at", change(cur.updated, now))
    if (remind != cur.remind) fields.put("remind_at", change(cur.remind, remind))
    enqueue(db, "todo", id, false, fields, now)
  }

  fun addTodo(db: SQLiteDatabase, text: String, folderId: String?, top: Boolean, now: Long = System.currentTimeMillis()): String {
    val edge = db.rawQuery(
      "SELECT ${if (top) "MIN" else "MAX"}(position) FROM todos WHERE 1 = 1$live", null,
    ).use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getString(0) else null }
    val position = if (top) Frac.between(null, edge) else Frac.between(edge, null)
    val id = UUID.randomUUID().toString()
    db.execSQL(
      "INSERT INTO todos (id, folder_id, text, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      arrayOf(id, folderId, text, position, now, now),
    )
    enqueue(
      db, "todo", id, true,
      JSONObject()
        .put("folder_id", change(null, folderId))
        .put("text", change(null, text))
        .put("position", change(null, position))
        .put("created_at", change(null, now))
        .put("updated_at", change(null, now)),
      now,
    )
    return id
  }

  /** 메모 끝에 이어 쓰기(줄마다 문단 하나). 새 메모 문서를 만들지 않는다. */
  fun appendMemo(db: SQLiteDatabase, text: String, folderId: String?, now: Long = System.currentTimeMillis()) {
    var last = db.rawQuery("SELECT MAX(position) FROM paragraphs WHERE 1 = 1$live", null)
      .use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getString(0) else null }
    for (line in text.split("\n")) {
      val id = UUID.randomUUID().toString()
      last = Frac.between(last, null)
      db.execSQL(
        "INSERT INTO paragraphs (id, folder_id, text, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        arrayOf(id, folderId, line, last, now, now),
      )
      enqueue(
        db, "paragraph", id, true,
        JSONObject()
          .put("folder_id", change(null, folderId))
          .put("text", change(null, line))
          .put("position", change(null, last))
          .put("created_at", change(null, now))
          .put("updated_at", change(null, now)),
        now,
      )
    }
  }

  fun todoText(db: SQLiteDatabase, id: String): String? =
    db.rawQuery("SELECT text FROM todos WHERE id = ? AND deleted_at IS NULL$live", arrayOf(id))
      .use { c -> if (c.moveToFirst()) c.getString(0) else null }

  /** 할 일 글 고치기(위젯에서 글자를 눌렀을 때). JS Repo처럼 글이 바뀔 때만 '마지막 수정'을 바꾼다. */
  fun setTodoText(db: SQLiteDatabase, id: String, text: String, now: Long = System.currentTimeMillis()) {
    val (old, oldUpdated) = db.rawQuery("SELECT text, updated_at FROM todos WHERE id = ?", arrayOf(id)).use { c ->
      if (!c.moveToFirst()) return
      c.getString(0) to c.getLong(1)
    }
    if (old == text) return
    db.execSQL("UPDATE todos SET text = ?, updated_at = ? WHERE id = ?", arrayOf(text, now, id))
    enqueue(db, "todo", id, false, JSONObject().put("text", change(old, text)).put("updated_at", change(oldUpdated, now)), now)
  }

  data class Para(val id: String, val text: String, val updatedAt: Long)

  private fun memoRows(db: SQLiteDatabase, folderId: String?): List<Para> {
    val (where, args) = folderWhere(folderId)
    return db.rawQuery(
      "SELECT id, text, updated_at FROM paragraphs WHERE deleted_at IS NULL$live$where ORDER BY position, id",
      args.toTypedArray(),
    ).use { c -> buildList { while (c.moveToNext()) add(Para(c.getString(0), c.getString(1), c.getLong(2))) } }
  }

  /**
   * 위젯에서 메모 전체를 고친 결과를 문단에 반영한다. 줄 순서대로 기존 문단을 맞춰 바뀐 줄만 고치고(ID 유지),
   * 늘어난 줄은 끝에 새 문단으로, 줄어든 만큼은 휴지통으로 보낸다(되돌릴 수 있게).
   */
  fun saveMemo(db: SQLiteDatabase, folderId: String?, text: String, now: Long = System.currentTimeMillis()) {
    val rows = memoRows(db, folderId)
    val lines = if (text.isEmpty()) emptyList() else text.split("\n")
    for (i in 0 until minOf(rows.size, lines.size)) {
      val r = rows[i]
      if (r.text == lines[i]) continue
      db.execSQL("UPDATE paragraphs SET text = ?, updated_at = ? WHERE id = ?", arrayOf(lines[i], now, r.id))
      enqueue(db, "paragraph", r.id, false, JSONObject().put("text", change(r.text, lines[i])).put("updated_at", change(r.updatedAt, now)), now)
    }
    if (lines.size > rows.size) appendMemo(db, lines.drop(rows.size).joinToString("\n"), folderId, now)
    for (r in rows.drop(lines.size)) {
      db.execSQL("UPDATE paragraphs SET deleted_at = ? WHERE id = ?", arrayOf(now, r.id))
      enqueue(db, "paragraph", r.id, false, JSONObject().put("deleted_at", change(null, now)), now)
    }
  }

  /** 알림을 예약할 할 일(완료·삭제되지 않았고 알림 시각이 since 이후). 반복은 알림이 다음 회차 것이라 완료 표시와 상관없이 */
  fun pendingReminders(db: SQLiteDatabase, since: Long): List<Pair<Todo, Long>> =
    db.rawQuery(
      "SELECT id, text, done_at, due_date, folder_id, remind_at FROM todos " +
        "WHERE remind_at > ? AND (done_at IS NULL OR repeat_freq IS NOT NULL) AND deleted_at IS NULL$live",
      arrayOf(since.toString()),
    ).use { c ->
      buildList {
        while (c.moveToNext()) add(Todo(c.getString(0), c.getString(1), null, c.getString(3), c.getString(4)) to c.getLong(5))
      }
    }

  /** 루틴을 한 날 기록에 오늘을 더하거나 뺀다: 'YYYY-MM-DD,…' 정렬·중복 없이 최근 400개(앱 core/doneLog.ts와 같다) */
  private fun doneLog(log: String?, day: String, add: Boolean): String? {
    val days = (log?.split(',')?.filter { it.matches(Regex("\\d{4}-\\d{2}-\\d{2}")) } ?: emptyList()).toMutableSet()
    if (add) days.add(day) else days.remove(day)
    return days.sorted().takeLast(400).joinToString(",").ifEmpty { null }
  }

  private fun change(old: Any?, new: Any?) =
    JSONObject().put("old", old ?: JSONObject.NULL).put("new", new ?: JSONObject.NULL)

  private fun enqueue(db: SQLiteDatabase, entity: String, id: String, create: Boolean, fields: JSONObject, now: Long) {
    db.execSQL(
      "INSERT INTO outbox (op_id, entity, entity_id, is_create, fields, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      arrayOf(UUID.randomUUID().toString(), entity, id, if (create) 1 else 0, fields.toString(), now),
    )
  }
}
