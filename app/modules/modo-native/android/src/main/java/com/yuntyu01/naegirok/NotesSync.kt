package com.yuntyu01.naegirok

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.content.pm.ApplicationInfo
import android.database.sqlite.SQLiteDatabase
import android.os.Build
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * 위젯·잠금화면·알림·빠른 추가에서 바꾼 것을 앱을 열지 않아도 서버로 보낸다. 예전엔 outbox에 쌓아 두기만 해서
 * 잠금화면에서 완료해도 휴대폰 앱을 열기 전까지 PC에 보이지 않았다(사용자 요청 2026-10-23).
 * 앱(core/sync.ts pushAll)과 같은 outbox·같은 요청이다. 서버는 op_id로 한 번만 적용하므로 앱이 같은 때 같은 op를 보내도 괜찮다.
 * 서버가 거절한 op(forbidden·invalid·gone)는 앱이 처리하게(되돌리기·알리기·지우기) 남겨 둔다. 받기(pull)는 앱이 한다.
 */
object NotesSync {
  private const val JOB_ID = 0x6d6f646f
  /** 정식 빌드는 이 주소로만 토큰을 보낸다(sync.ts serviceBase와 같다) */
  private const val SERVICE = "https://modo.kodeploy.com"
  /** 서버가 한 번에 받는 수(sync.go) */
  private const val BATCH = 500
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
    val conn = URL("${acc.server}/api/sync/push").openConnection() as HttpURLConnection
    try {
      conn.requestMethod = "POST"
      conn.connectTimeout = 15_000
      conn.readTimeout = 45_000
      conn.doOutput = true
      conn.setRequestProperty("Content-Type", "application/json")
      conn.setRequestProperty("Authorization", "Bearer ${acc.token}")
      conn.outputStream.use { it.write(JSONObject().put("ops", list).toString().toByteArray()) }
      val code = conn.responseCode
      if (code !in 200..299) throw HttpStatus(code)
      val body = conn.inputStream.bufferedReader().use { it.readText() }
      val results = runCatching { JSONObject(body).getJSONArray("results") }.getOrElse { throw IOException("bad response", it) }
      return buildList {
        for (i in 0 until results.length()) {
          val r = results.optJSONObject(i) ?: continue
          if (r.optString("status") in ACKED) add(r.optString("op_id"))
        }
      }
    } finally {
      conn.disconnect()
    }
  }
}

/** :native 프로세스에서 outbox를 보내는 작업(NotesSync.request가 건다). 인터넷이 끊겨 실패하면 시스템이 나중에 다시 돌린다 */
class SyncJobService : JobService() {
  override fun onStartJob(params: JobParameters): Boolean {
    Thread({
      val result = try {
        NotesSync.pushAll(applicationContext)
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
