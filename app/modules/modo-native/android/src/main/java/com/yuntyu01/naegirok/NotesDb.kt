package com.yuntyu01.naegirok

import android.content.Context
import android.database.DatabaseErrorHandler
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
  /** 위젯·알림이 보이는 남은 할 일(완료한 것은 앱에서 본다) */
  data class Todo(
    val id: String, val text: String, val due: String?, val folderId: String?, val remindAt: Long? = null,
    val repeatFreq: String? = null, val repeatDays: Int? = null,
  )

  fun file(ctx: Context) = File(ctx.filesDir, "SQLite/naegirok.db")

  /** DB가 아직 없으면(앱을 한 번도 안 열었으면) null */
  fun <T> use(ctx: Context, block: (SQLiteDatabase) -> T): T? {
    val f = file(ctx)
    if (!f.exists()) return null
    // 기본 오류 처리기는 손상됐다고 보면 파일을 지운다. 앱·위젯이 같이 쓰는 파일이라 여기서는 지우지 않는다(앱이 열어서 판단)
    val db = SQLiteDatabase.openDatabase(
      f.path, null, SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.ENABLE_WRITE_AHEAD_LOGGING, DatabaseErrorHandler { },
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

  /**
   * 이 기기에 로그인해 있는지(앱 kv 'account'에 토큰이 있는지). 로그인해야 쓸 수 있어서(사용자 요청 2026-10-19)
   * 로그인하지 않았으면 위젯·빠른 추가·잠금화면 알림·할 일 알림도 내용을 보이거나 바꾸지 않고 앱(로그인 화면)으로 보낸다.
   */
  fun signedIn(db: SQLiteDatabase): Boolean =
    db.rawQuery("SELECT value FROM kv WHERE key = 'account'", null).use { c ->
      c.moveToFirst() && runCatching { JSONObject(c.getString(0)).optString("token").isNotEmpty() }.getOrDefault(false)
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

  /** 한 폴더의 남은 할 일(all = true면 모든 폴더: 잠금화면 알림용) */
  fun todos(db: SQLiteDatabase, folderId: String?, limit: Int = 50, all: Boolean = false): List<Todo> {
    val (where, args) = undoneWhere(folderId, all)
    // 앞날에 시작하는 반복도 보인다(아래 줄에 '매월 20일 · 10월 20일'). 그날까지 숨기던 규칙은 뺐다(앱과 같다, 사용자 요청 2026-10-18)
    return db.rawQuery(
      "SELECT id, text, due_date, folder_id, remind_at, repeat_freq, repeat_days FROM todos WHERE $where ORDER BY position, id LIMIT $limit",
      args.toTypedArray(),
    ).use { c ->
      buildList {
        while (c.moveToNext()) {
          add(
            Todo(
              c.getString(0), c.getString(1), c.getString(2), c.getString(3),
              if (c.isNull(4)) null else c.getLong(4), c.getString(5), if (c.isNull(6)) null else c.getInt(6),
            ),
          )
        }
      }
    }
  }

  /** 남은 할 일 수. 목록은 LIMIT으로 자르지만 '할 일 N개'는 다 센다(예전엔 50·30에서 멈췄다) */
  fun countTodos(db: SQLiteDatabase, folderId: String?, all: Boolean = false): Int {
    val (where, args) = undoneWhere(folderId, all)
    return db.rawQuery("SELECT COUNT(*) FROM todos WHERE $where", args.toTypedArray()).use { c -> if (c.moveToFirst()) c.getInt(0) else 0 }
  }

  private fun undoneWhere(folderId: String?, all: Boolean): Pair<String, List<String>> {
    val where = StringBuilder("deleted_at IS NULL$live AND NOT $DONE_NOW")
    val args = mutableListOf(java.time.LocalDate.now().toString())
    if (!all) {
      val (w, a) = folderWhere(folderId)
      where.append(w)
      args.addAll(a)
    }
    return where.toString() to args
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

  /**
   * 보기 전용으로 공유받은 폴더인지(앱 canWrite와 같은 규칙). 위젯·알림·빠른 추가가 이런 폴더의 항목을 바꾸면 서버가 거절하고,
   * 그 거절 때문에 앱이 모든 항목을 처음부터 다시 받았다. 공유 표가 아직 없으면(앱을 한 번도 안 켠 새 설치) 보기 전용도 없다.
   */
  fun viewOnly(db: SQLiteDatabase, folderId: String?): Boolean = folderId != null && runCatching {
    db.rawQuery("SELECT 1 FROM shared_folders WHERE folder_id = ? AND role = 'view' LIMIT 1", arrayOf(folderId)).use { it.moveToFirst() }
  }.getOrDefault(false)

  private fun todoViewOnly(db: SQLiteDatabase, id: String): Boolean =
    db.rawQuery("SELECT folder_id FROM todos WHERE id = ?", arrayOf(id)).use { c -> c.moveToFirst() && !c.isNull(0) && viewOnly(db, c.getString(0)) }

  /** 완료/완료 취소. 완료 시각만 바꾸고 '마지막 수정'은 그대로(JS Repo와 같은 규칙). */
  fun setDone(db: SQLiteDatabase, id: String, done: Boolean, now: Long = System.currentTimeMillis()) {
    if (todoViewOnly(db, id)) return
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
    if (todoViewOnly(db, id)) return
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
    // 이번 회차를 이미 끝냈으면(다음 예정일 전) 그대로: 위젯이 옛 화면을 보여 주다 눌리면 다음 회차까지 한 번 더 넘겼다
    if (cur.doneAt != null && due != null && due > Repeat.localDate(now)) return
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

  fun addTodo(db: SQLiteDatabase, text: String, target: String?, top: Boolean, now: Long = System.currentTimeMillis()): String {
    // 보기 전용 폴더에는 넣지 못하니 기본 폴더로(빠른 추가가 이미 그렇게 고르지만, 그 사이 권한이 바뀌었을 수 있다)
    val folderId = if (viewOnly(db, target)) null else target
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
  fun appendMemo(db: SQLiteDatabase, text: String, target: String?, now: Long = System.currentTimeMillis()) {
    val folderId = if (viewOnly(db, target)) null else target
    var last = db.rawQuery("SELECT MAX(position) FROM paragraphs WHERE 1 = 1$live", null)
      .use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getString(0) else null }
    for (line in text.split("\n")) {
      last = Frac.between(last, null)
      insertParagraph(db, folderId, line, last, now)
    }
  }

  private fun insertParagraph(db: SQLiteDatabase, folderId: String?, text: String, position: String, now: Long) {
    val id = UUID.randomUUID().toString()
    db.execSQL(
      "INSERT INTO paragraphs (id, folder_id, text, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      arrayOf(id, folderId, text, position, now, now),
    )
    enqueue(
      db, "paragraph", id, true,
      JSONObject()
        .put("folder_id", change(null, folderId))
        .put("text", change(null, text))
        .put("position", change(null, position))
        .put("created_at", change(null, now))
        .put("updated_at", change(null, now)),
      now,
    )
  }

  fun todoText(db: SQLiteDatabase, id: String): String? =
    db.rawQuery("SELECT text FROM todos WHERE id = ? AND deleted_at IS NULL$live", arrayOf(id))
      .use { c -> if (c.moveToFirst()) c.getString(0) else null }

  /** 할 일 글 고치기(위젯에서 글자를 눌렀을 때). JS Repo처럼 글이 바뀔 때만 '마지막 수정'을 바꾼다. */
  fun setTodoText(db: SQLiteDatabase, id: String, text: String, now: Long = System.currentTimeMillis()) {
    if (todoViewOnly(db, id)) return
    val (old, oldUpdated) = db.rawQuery("SELECT text, updated_at FROM todos WHERE id = ?", arrayOf(id)).use { c ->
      if (!c.moveToFirst()) return
      c.getString(0) to c.getLong(1)
    }
    if (old == text) return
    db.execSQL("UPDATE todos SET text = ?, updated_at = ? WHERE id = ?", arrayOf(text, now, id))
    enqueue(db, "todo", id, false, JSONObject().put("text", change(old, text)).put("updated_at", change(oldUpdated, now)), now)
  }

  data class Para(val id: String, val text: String, val updatedAt: Long, val position: String)

  private fun memoRows(db: SQLiteDatabase, folderId: String?): List<Para> {
    val (where, args) = folderWhere(folderId)
    return db.rawQuery(
      "SELECT id, text, updated_at, position FROM paragraphs WHERE deleted_at IS NULL$live$where ORDER BY position, id",
      args.toTypedArray(),
    ).use { c -> buildList { while (c.moveToNext()) add(Para(c.getString(0), c.getString(1), c.getLong(2), c.getString(3))) } }
  }

  /**
   * 위젯에서 메모 전체를 고친 결과를 문단에 반영한다. 앞뒤로 같은 줄은 그대로 두고, 가운데 바뀐 줄만 차례로 기존 문단에 맞춰
   * 고치고(ID 유지), 늘어난 줄은 그 자리에 새 문단으로 끼우고, 줄어든 만큼은 휴지통으로 보낸다(되돌릴 수 있게).
   * 예전엔 줄 번호로만 맞춰, 위에 한 줄을 넣으면 그 아래 문단을 모두 고쳐 쓰고 마지막 줄을 새 문단으로 붙였다(다른 기기 편집과 부딪쳤다).
   */
  fun saveMemo(db: SQLiteDatabase, folderId: String?, text: String, now: Long = System.currentTimeMillis()) {
    if (viewOnly(db, folderId)) return
    val rows = memoRows(db, folderId)
    val edit = MemoEdit.of(rows.map { it.text }, if (text.isEmpty()) emptyList() else text.split("\n"))
    val mid = rows.subList(edit.from, edit.to)
    val kept = minOf(mid.size, edit.lines.size)
    for (i in 0 until kept) {
      val r = mid[i]
      val line = edit.lines[i]
      if (r.text == line) continue
      db.execSQL("UPDATE paragraphs SET text = ?, updated_at = ? WHERE id = ?", arrayOf(line, now, r.id))
      enqueue(db, "paragraph", r.id, false, JSONObject().put("text", change(r.text, line)).put("updated_at", change(r.updatedAt, now)), now)
    }
    val added = edit.lines.drop(kept)
    if (added.isNotEmpty()) {
      var prev = rows.getOrNull(edit.from + kept - 1)?.position
      val next = rows.getOrNull(edit.to)?.position
      // 끝에 붙이거나, 앞뒤 문단의 자리가 같아(다른 기기와 동시에 넣은 경우) 사이에 끼울 수 없으면 맨 끝에
      if (next == null || (prev != null && prev >= next)) {
        appendMemo(db, added.joinToString("\n"), folderId, now)
      } else {
        for (line in added) {
          prev = Frac.between(prev, next)
          insertParagraph(db, folderId, line, prev, now)
        }
      }
    }
    for (r in mid.drop(kept)) {
      db.execSQL("UPDATE paragraphs SET deleted_at = ? WHERE id = ?", arrayOf(now, r.id))
      enqueue(db, "paragraph", r.id, false, JSONObject().put("deleted_at", change(null, now)), now)
    }
  }

  /** 알림을 예약할 할 일(완료·삭제되지 않았고 알림 시각이 since 이후). 반복은 알림이 다음 회차 것이라 완료 표시와 상관없이 */
  fun pendingReminders(db: SQLiteDatabase, since: Long): List<Pair<Todo, Long>> =
    db.rawQuery(
      "SELECT id, text, due_date, folder_id, remind_at FROM todos WHERE remind_at > ? AND $REMINDABLE$live",
      arrayOf(since.toString()),
    ).use { c ->
      buildList {
        while (c.moveToNext()) add(Todo(c.getString(0), c.getString(1), c.getString(2), c.getString(3)) to c.getLong(4))
      }
    }

  /** 한 할 일의 알림(울리는 순간 다시 확인할 때). 그 사이 완료·삭제됐거나 알림을 뺐으면 null */
  fun reminder(db: SQLiteDatabase, id: String): Pair<Todo, Long>? =
    db.rawQuery(
      "SELECT id, text, due_date, folder_id, remind_at FROM todos WHERE id = ? AND remind_at > 0 AND $REMINDABLE$live",
      arrayOf(id),
    ).use { c -> if (c.moveToFirst()) Todo(c.getString(0), c.getString(1), c.getString(2), c.getString(3)) to c.getLong(4) else null }

  private const val REMINDABLE = "(done_at IS NULL OR repeat_freq IS NOT NULL) AND deleted_at IS NULL"

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
