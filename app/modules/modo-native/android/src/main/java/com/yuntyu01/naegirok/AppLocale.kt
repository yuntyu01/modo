package com.yuntyu01.naegirok

import android.app.LocaleManager
import android.content.Context
import android.content.res.Configuration
import android.os.Build
import org.json.JSONObject
import java.util.Locale

/**
 * 위젯·빠른 추가·알림 문구를 앱과 같은 언어로. 앱(JS)은 꾸미기의 언어 설정, 없으면 앱별 언어(시스템 설정 → 앱 언어),
 * 그다음 기기 언어를 따른다. 위젯을 그리는 :native 프로세스엔 앱별 언어가 적용되지 않는 경우가 있어 직접 맞춘다.
 */
object AppLocale {
  /** 앱(app/src/i18n.ts LANGS)과 같은 지원 언어. 그 밖의 언어 기기는 앱처럼 영어로(기본 values는 한국어라서 직접 고른다) */
  private val SUPPORTED = setOf("ko", "en", "ja", "zh")

  /** prefs: 이미 읽은 앱 설정(있으면 DB를 다시 열지 않는다) */
  fun locale(ctx: Context, prefs: JSONObject? = null): Locale {
    val pref = (prefs ?: NotesDb.use(ctx) { NotesDb.prefs(it) })?.optString("language", "system") ?: "system"
    if (pref in SUPPORTED) return Locale.forLanguageTag(pref)
    val candidates = buildList {
      if (Build.VERSION.SDK_INT >= 33) {
        val app = ctx.getSystemService(LocaleManager::class.java)?.applicationLocales
        if (app != null) for (i in 0 until app.size()) add(app[i])
      }
      val sys = ctx.resources.configuration.locales
      for (i in 0 until sys.size()) add(sys[i])
    }
    return candidates.firstOrNull { it.language in SUPPORTED }?.let { Locale.forLanguageTag(it.language) } ?: Locale.ENGLISH
  }

  fun wrap(ctx: Context, prefs: JSONObject? = null): Context {
    val config = Configuration(ctx.resources.configuration)
    config.setLocale(locale(ctx, prefs))
    return ctx.createConfigurationContext(config)
  }
}
