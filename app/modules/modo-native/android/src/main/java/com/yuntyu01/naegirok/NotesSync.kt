package com.yuntyu01.naegirok

import android.app.ActivityManager
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.content.pm.ApplicationInfo
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.os.Build
import android.util.Log
import com.yuntyu01.naegirok.nativelib.R
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * 위젯·잠금화면·알림·빠른 추가에서 바꾼 것을 앱을 열지 않아도 서버로 보낸다. 예전엔 outbox에 쌓아 두기만 해서
 * 잠금화면에서 완료해도 휴대폰 앱을 열기 전까지 PC에 보이지 않았다(사용자 요청 2026-10-23).
 * 앱(core/sync.ts pushAll)과 같은 outbox·같은 요청이다. 서버는 op_id로 한 번만 적용하므로 앱이 같은 때 같은 op를 보내도 괜찮다.
 * 서버가 거절한 op(forbidden·invalid·gone)는 앱이 처리하게(되돌리기·알리기·지우기) 남겨 둔다.
 *
 * 받기(pull)도 앱 없이 한다(pullAll): 예전엔 앱만 받아서, PC에서 고친 것이 휴대폰 앱을 열기 전까지 홈·잠금화면 위젯에
 * 보이지 않았다(사용자 제보 2026-10-30). 15분마다(안드로이드가 허락하는 가장 짧은 주기, 절전 중에는 시스템이 미룬다) 그리고
 * 위젯에서 바꿔 보낼 때마다 받아 위젯을 다시 그린다. 앱이 앞에 있으면 앱이 바로 받기(sync.ts live)로 받으니 받지 않는다.
 */
object NotesSync {
  private const val JOB_ID = 0x6d6f646f
  /** 앱 없이 주기적으로 받는 작업 */
  private const val PERIODIC_ID = 0x6d6f6470
  private const val PERIOD_MS = 15 * 60_000L
  /** 정식 빌드는 이 주소로만 토큰을 보낸다(sync.ts serviceBase와 같다) */
  private const val SERVICE = "https://modo.kodeploy.com"
  /** 서버가 한 번에 받는 수(sync.go) */
  private const val BATCH = 500
  /** 받기 한 번에 넘기는 쪽 수(그보다 많으면 다음 작업이 이어 받는다) */
  private const val MAX_PAGES = 20
  /** 서버가 받아 적용한(또는 충돌본을 만든) op: outbox에서 지운다 */
  private val ACKED = setOf("ok", "conflict")

  enum class Result { DONE, RETRY }

  private class Account(val token: String, val server: String)
  private class Op(val seq: Long, val opId: String, val entity: String, val entityId: String, val create: Boolean, val fields: String)
  private class HttpStatus(val code: Int) : IOException("HTTP $code")

  /** 인터넷이 되면 곧바로 보내게 건다(Android 12+는 서두르는 작업). 이미 걸려 있거나 도는 중이면 바꿔 건다 */
  fun request(ctx: Context) {
    val jobs = ctx.getSystemService(JobScheduler::class.java)
    fun job(fast: Boolean) = JobInfo.Builder(JOB_ID, ComponentName(ctx, SyncJobService::class.java))
      .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
      .apply { if (fast && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) setExpedited(true) }
      .build()
    try {
      jobs.schedule(job(true))
    } catch (e: RuntimeException) {
      // 서두르는 작업을 못 걸면(기기·정책) 보통 작업으로
      Log.w("NotesSync", "expedited job refused", e)
      runCatching { jobs.schedule(job(false)) }
    }
  }

  /**
   * 앱 없이 주기적으로 받게 걸어 둔다(이미 걸려 있으면 그대로: 다시 걸면 주기가 처음부터 시작된다).
   * 로그인하지 않았으면 끈다. 위젯·알림을 다시 맞출 때마다(ModoEvents.refresh) 부르고, 재부팅 뒤에도 남는다(setPersisted)
   */
  fun keepPulling(ctx: Context, signedIn: Boolean) {
    val jobs = ctx.getSystemService(JobScheduler::class.java)
    if (!signedIn) {
      jobs.cancel(PERIODIC_ID)
      return
    }
    if (jobs.getPendingJob(PERIODIC_ID) != null) return
    val job = JobInfo.Builder(PERIODIC_ID, ComponentName(ctx, SyncJobService::class.java))
      .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
      .setPeriodic(PERIOD_MS)
      .setPersisted(true)
      .build()
    runCatching { jobs.schedule(job) }.onFailure { Log.w("NotesSync", "periodic job refused", it) }
  }

  /** 보내고 받는다(앱 sync.ts once와 같은 차례). 보내기가 실패하면 받기도 다음에 */
  fun syncAll(ctx: Context): Result {
    val pushed = pushAll(ctx)
    return if (pushed == Result.DONE) pullAll(ctx) else pushed
  }

  /** outbox를 차례로 보낸다(작업 스레드에서). 겹친 작업은 차례를 기다린다(같은 op를 두 번 보내지 않게) */
  @Synchronized
  fun pushAll(ctx: Context): Result {
    var after = 0L
    while (true) {
      val (acc, ops) = NotesDb.write(ctx) { take(ctx, it, after) } ?: return Result.DONE
      if (ops.isEmpty()) return Result.DONE
      val first = after
      after = ops.last().seq
      var acked = emptyList<String>()
      try {
        acked = post(acc, ops)
      } catch (e: HttpStatus) {
        // 401: 로그인 만료(앱이 다시 로그인하게 한다). 그 밖 4xx: 앱이 보낼 때 같은 오류를 보인다. 5xx만 다시
        Log.w("NotesSync", "push refused", e)
        return if (e.code >= 500) Result.RETRY else Result.DONE
      } catch (e: IOException) {
        Log.w("NotesSync", "push failed", e)
        return Result.RETRY
      } finally {
        NotesDb.write(ctx) { release(it, first, after, acked) }
      }
    }
  }

  /**
   * after 다음 op를 집어 '보내는 중'으로 표시한다(그사이 앱이 새 편집을 여기에 합치지 않게, repo.ts takeOutbox와 같다).
   * 로그인하지 않았거나 서비스 주소가 아니면 보내지 않는다
   */
  private fun take(ctx: Context, db: SQLiteDatabase, after: Long): Pair<Account, List<Op>>? {
    val acc = account(ctx, db) ?: return null
    val ops = db.rawQuery(
      "SELECT seq, op_id, entity, entity_id, is_create, fields FROM outbox WHERE seq > ? ORDER BY seq LIMIT $BATCH",
      arrayOf(after.toString()),
    ).use { c ->
      buildList { while (c.moveToNext()) add(Op(c.getLong(0), c.getString(1), c.getString(2), c.getString(3), c.getInt(4) != 0, c.getString(5))) }
    }
    if (ops.isNotEmpty()) db.execSQL("UPDATE outbox SET inflight = 1 WHERE seq > ? AND seq <= ?", arrayOf(after, ops.last().seq))
    return acc to ops
  }

  /**
   * 받은 op는 지우고 나머지는 되돌린다. 서버가 이미 적용했을 수 있으니 '보낸 적 있음'(attempts)도 올린다
   * (repo.ts releaseInflight와 같다: 안 올리면 새 편집이 이 op에 합쳐져 버려진다)
   */
  private fun release(db: SQLiteDatabase, after: Long, upTo: Long, acked: List<String>) {
    acked.chunked(500).forEach { ids ->
      db.execSQL("DELETE FROM outbox WHERE op_id IN (${ids.joinToString(",") { "?" }})", ids.toTypedArray())
    }
    db.execSQL("UPDATE outbox SET inflight = 0, attempts = attempts + 1 WHERE seq > ? AND seq <= ? AND inflight = 1", arrayOf(after, upTo))
  }

  /** 받은 행에서 쓰는 열(repo.ts SYNC_FIELDS + SERVER_FIELDS와 같다: 함께 바꿀 것) */
  private val COLUMNS = linkedMapOf(
    "folders" to listOf("name", "position", "created_at", "updated_at", "deleted_at"),
    "todos" to listOf(
      "folder_id", "text", "done_at", "due_date", "remind_at", "repeat_freq", "repeat_days", "done_log", "position",
      "created_at", "updated_at", "deleted_at", "conflict_of",
    ),
    "paragraphs" to listOf("folder_id", "text", "position", "created_at", "updated_at", "deleted_at", "conflict_of"),
  )
  private val TABLES = mapOf("folder" to "folders", "todo" to "todos", "paragraph" to "paragraphs")

  /**
   * 다른 기기에서 바뀐 것을 받아 이 기기 DB에 넣고, 바뀌었으면 앱에 알리고 위젯·잠금화면 알림을 다시 그린다.
   * 넣는 규칙은 앱(repo.ts applyRemote)과 같다: 아직 안 보낸 내 변경이 있는 칸은 두고, 같은 값은 다시 쓰지 않는다.
   * 공유 목록·남의 항목 정리·친구 목록(sweepForeign 등)은 앱이 다음에 받을 때 맞춘다(여기서는 항목만).
   */
  @Synchronized
  fun pullAll(ctx: Context): Result {
    if (appInFront(ctx)) return Result.DONE
    val names by lazy { AppLocale.wrap(ctx) }
    val touched = mutableSetOf<String>()
    try {
      repeat(MAX_PAGES) {
        val (acc, since, fd) = NotesDb.use(ctx) { db ->
          account(ctx, db)?.let { Triple(it, (kv(db, "sync_cursor") as? Number)?.toLong() ?: 0L, kv(db, "foreign_digest") as? String ?: "") }
        } ?: return Result.DONE
        val page = get(acc, "/api/sync/pull?since=$since&limit=1000${if (fd.isNotEmpty()) "&fd=${java.net.URLEncoder.encode(fd, "UTF-8")}" else ""}")
        friendBaseNames(page) { owner -> names.getString(R.string.friend_base, owner) }
        val cursor = page.optLong("cursor", since)
        val kept = NotesDb.write(ctx) { db ->
          // 그사이 로그아웃했거나 앱이 먼저 받았으면(커서가 앞섰으면) 이 쪽은 버리고 다시 묻는다
          if (account(ctx, db)?.token != acc.token) return@write null
          if (((kv(db, "sync_cursor") as? Number)?.toLong() ?: 0L) != since) return@write false
          touched += apply(db, page)
          if (cursor != since) db.execSQL(
            "INSERT INTO kv (key, value) VALUES ('sync_cursor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            arrayOf(cursor.toString()),
          )
          true
        } ?: return Result.DONE
        if (kept && !page.optBoolean("more")) return Result.DONE
      }
      return Result.DONE
    } catch (e: HttpStatus) {
      Log.w("NotesSync", "pull refused", e)
      return if (e.code >= 500) Result.RETRY else Result.DONE
    } catch (e: IOException) {
      Log.w("NotesSync", "pull failed", e)
      return Result.RETRY
    } finally {
      if (touched.isNotEmpty()) {
        ModoEvents.dataChanged(ctx, touched.toList())
        ModoEvents.requestRefresh(ctx, touched.toList())
      }
    }
  }

  /** 앱 화면이 앞에 있는지(앱 프로세스가 보이는 중). :native의 고치기 창·빠른 추가는 앱이 아니다 */
  private fun appInFront(ctx: Context): Boolean =
    ctx.getSystemService(ActivityManager::class.java)?.runningAppProcesses.orEmpty().any {
      it.processName == ctx.packageName && it.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
    }

  /** 친구가 공유한 '전체'(폴더 id = 주인 사용자 id)는 '민지의 전체'로(sync.ts pullAll과 같다) */
  private fun friendBaseNames(page: JSONObject, name: (String) -> String) {
    val shared = page.optJSONArray("shared") ?: return
    val folders = page.optJSONArray("folders") ?: return
    for (i in 0 until shared.length()) {
      val s = shared.optJSONObject(i) ?: continue
      val owner = s.optJSONObject("owner") ?: continue
      val id = s.optString("folder_id")
      if (owner.optString("id") != id) continue
      // optString은 JSON null을 "null"로 돌려준다
      fun text(key: String) = if (owner.isNull(key)) "" else owner.optString(key)
      val who = text("name").trim().ifEmpty { text("email").substringBefore('@') }.ifEmpty { "?" }
      for (j in 0 until folders.length()) folders.optJSONObject(j)?.takeIf { it.optString("id") == id }?.put("name", name(who))
    }
  }

  /** 한 쪽을 넣는다(repo.ts applyRemote). 바뀐 표를 돌려준다 */
  private fun apply(db: SQLiteDatabase, page: JSONObject): Set<String> {
    val touched = mutableSetOf<String>()
    val rows = COLUMNS.keys.associateWith { t -> page.optJSONArray(t).let { a -> List(a?.length() ?: 0) { a!!.optJSONObject(it) }.filterNotNull() } }
    val pending = pendingFields(db, rows.values.flatten().map { it.optString("id") })
    for ((table, list) in rows) {
      val columns = COLUMNS.getValue(table)
      for (remote in list) {
        val id = remote.optString("id")
        if (id.isEmpty()) continue
        val mine = pending[id]
        val local = db.rawQuery("SELECT ${columns.joinToString(", ")} FROM $table WHERE id = ?", arrayOf(id)).use { c ->
          if (c.moveToFirst()) columns.indices.map { localValue(c, it) } else null
        }
        if (local == null) {
          // 여기서 영구 삭제하고 아직 못 보낸 항목은 되살리지 않는다
          if (mine?.contains("purged") == true) continue
          db.execSQL(
            "INSERT INTO $table (id, ${columns.joinToString(", ")}) VALUES (?${", ?".repeat(columns.size)})",
            arrayOf<Any?>(id, *columns.map { sqlValue(remote.opt(it)) }.toTypedArray()),
          )
          touched += table
          continue
        }
        val changed = columns.withIndex().filter { (i, f) -> mine?.contains(f) != true && sqlValue(remote.opt(f)) != local[i] }.map { it.value }
        if (changed.isEmpty()) continue
        db.execSQL(
          "UPDATE $table SET ${changed.joinToString(", ") { "$it = ?" }} WHERE id = ?",
          arrayOf<Any?>(*changed.map { sqlValue(remote.opt(it)) }.toTypedArray(), id),
        )
        touched += table
      }
    }
    val deleted = page.optJSONArray("deleted")
    for (i in 0 until (deleted?.length() ?: 0)) {
      val d = deleted!!.optJSONObject(i) ?: continue
      val table = TABLES[d.optString("entity")]?.takeIf { it != "folders" } ?: continue
      val id = d.optString("id")
      db.execSQL("DELETE FROM $table WHERE id = ?", arrayOf(id))
      // 지워진 항목에 대한 내 변경은 보낼 곳이 없다
      db.execSQL("DELETE FROM outbox WHERE entity_id = ? AND inflight = 0", arrayOf(id))
      touched += table
    }
    return touched
  }

  /** 이 id들 중 아직 안 보낸 로컬 변경이 있는 것과 그 필드 */
  private fun pendingFields(db: SQLiteDatabase, ids: List<String>): Map<String, Set<String>> {
    val out = mutableMapOf<String, MutableSet<String>>()
    ids.chunked(500).forEach { part ->
      db.rawQuery("SELECT entity_id, fields FROM outbox WHERE entity_id IN (${part.joinToString(",") { "?" }})", part.toTypedArray()).use { c ->
        while (c.moveToNext()) {
          val keys = runCatching { JSONObject(c.getString(1)).keys().asSequence().toList() }.getOrDefault(emptyList())
          out.getOrPut(c.getString(0)) { mutableSetOf() } += keys
        }
      }
    }
    return out
  }

  /** 앱 kv의 값(JSON) */
  private fun kv(db: SQLiteDatabase, key: String): Any? =
    db.rawQuery("SELECT value FROM kv WHERE key = ?", arrayOf(key)).use { c ->
      if (c.moveToFirst()) runCatching { JSONTokener(c.getString(0)).nextValue() }.getOrNull() else null
    }

  /** 받은 JSON 값을 SQLite에 넣는 값으로(앱 toSql처럼: 없음 = NULL, 정수는 Long) */
  private fun sqlValue(v: Any?): Any? = when (v) {
    null, JSONObject.NULL -> null
    is Int -> v.toLong()
    is Long, is String -> v
    is Boolean -> if (v) 1L else 0L
    is Number -> v.toDouble().let { if (it % 1.0 == 0.0 && Math.abs(it) < 9e15) it.toLong() else it }
    else -> v.toString()
  }

  private fun localValue(c: Cursor, i: Int): Any? = when (c.getType(i)) {
    Cursor.FIELD_TYPE_NULL -> null
    Cursor.FIELD_TYPE_INTEGER -> c.getLong(i)
    Cursor.FIELD_TYPE_FLOAT -> c.getDouble(i)
    else -> c.getString(i)
  }

  private fun account(ctx: Context, db: SQLiteDatabase): Account? {
    val json = db.rawQuery("SELECT value FROM kv WHERE key = 'account'", null).use { c ->
      if (c.moveToFirst()) runCatching { JSONObject(c.getString(0)) }.getOrNull() else null
    } ?: return null
    val token = json.optString("token")
    val server = json.optString("server").trimEnd('/')
    if (token.isEmpty() || server.isEmpty()) return null
    val debuggable = ctx.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
    if (!debuggable && server != SERVICE) return null
    return Account(token, server)
  }

  /** /api/sync/push. 서버가 받은 op_id 목록을 돌려준다 */
  private fun post(acc: Account, ops: List<Op>): List<String> {
    val list = JSONArray()
    for (o in ops) {
      // 읽을 수 없는 필드는 보내지 않는다(앱이 보낼 때 정리한다)
      val fields = runCatching { JSONObject(o.fields) }.getOrNull() ?: continue
      list.put(JSONObject().put("op_id", o.opId).put("entity", o.entity).put("id", o.entityId).put("create", o.create).put("fields", fields))
    }
    if (list.length() == 0) return emptyList()
    val body = request(acc, "/api/sync/push", JSONObject().put("ops", list).toString())
    val results = runCatching { JSONObject(body).getJSONArray("results") }.getOrElse { throw IOException("bad response", it) }
    return buildList {
      for (i in 0 until results.length()) {
        val r = results.optJSONObject(i) ?: continue
        if (r.optString("status") in ACKED) add(r.optString("op_id"))
      }
    }
  }

  /** GET(/api/sync/pull 등) */
  private fun get(acc: Account, path: String): JSONObject =
    runCatching { JSONObject(request(acc, path, null)) }.getOrElse { if (it is IOException) throw it else throw IOException("bad response", it) }

  /** body가 있으면 POST(JSON). 2xx가 아니면 HttpStatus */
  private fun request(acc: Account, path: String, body: String?): String {
    val conn = URL("${acc.server}$path").openConnection() as HttpURLConnection
    try {
      conn.connectTimeout = 15_000
      conn.readTimeout = 45_000
      conn.setRequestProperty("Authorization", "Bearer ${acc.token}")
      if (body != null) {
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        conn.outputStream.use { it.write(body.toByteArray()) }
      }
      val code = conn.responseCode
      if (code !in 200..299) throw HttpStatus(code)
      return conn.inputStream.bufferedReader().use { it.readText() }
    } finally {
      conn.disconnect()
    }
  }
}

/**
 * :native 프로세스에서 outbox를 보내고 다른 기기에서 바뀐 것을 받는 작업(NotesSync.request·keepPulling이 건다).
 * 인터넷이 끊겨 실패하면 시스템이 나중에 다시 돌린다
 */
class SyncJobService : JobService() {
  override fun onStartJob(params: JobParameters): Boolean {
    Thread({
      val result = try {
        NotesSync.syncAll(applicationContext)
      } catch (e: Exception) {
        Log.w("NotesSync", "push crashed", e)
        NotesSync.Result.RETRY
      }
      jobFinished(params, result == NotesSync.Result.RETRY)
    }, "modo-sync").start()
    return true
  }

  // 시스템이 멈추면(인터넷 끊김·바꿔 건 작업) 다시 건다. 도는 스레드는 지금 보내던 묶음만 끝내고 정리한다
  override fun onStopJob(params: JobParameters) = true
}
