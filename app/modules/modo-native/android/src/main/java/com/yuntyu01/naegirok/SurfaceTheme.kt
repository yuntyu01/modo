package com.yuntyu01.naegirok

import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import org.json.JSONObject
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * 위젯·빠른 추가 창의 색. 앱 꾸미기 설정(kv 'prefs')을 읽어 app/src/ui/theme.ts 와 같은 규칙으로 만든다.
 * 위젯 테마가 '앱 테마 따르기'면 앱 색, 아니면 위젯 전용 색을 쓴다.
 */
data class SurfaceTheme(
  val dark: Boolean,
  val accent: Int,
  /** 로고 심볼 색: 꾸미기의 '로고도 테마색으로'(기본 켬)면 테마색, 끄면 대표색 */
  val mark: Int,
  val onAccent: Int,
  val card: Int,
  val text: Int,
  val muted: Int,
  val circle: Int,
  val opacity: Float,
  /** 잠금화면 위젯의 배경 불투명도(홈과 따로, 사용자 요청 2026-10-22). 미니창 등 다른 곳은 opacity와 같다 */
  val lockOpacity: Float = opacity,
  /** 꾸미기에서 카드색을 직접 골랐는지(홈 위젯은 고르지 않았을 때만 파란 기 없는 차콜을 쓴다) */
  val tinted: Boolean = false,
  /** 홈 화면 위젯의 동그라미를 오른쪽에(꾸미기 홈 위젯 탭의 체크 위치, 없으면 공통 체크 위치: 사용자 요청 2026-10-24) */
  val checkEnd: Boolean = false,
  /** 잠금화면 위젯의 동그라미를 오른쪽에(잠금 위젯 탭의 체크 위치, 없으면 공통) */
  val lockCheckEnd: Boolean = checkEnd,
) {
  companion object {
    /** 대표색: src/brand.ts와 같은 값(src/__tests__/brand.test.ts가 확인). 테마 설정이 아직 없으면 이 색 */
    const val BRAND = "#85ADE2"
    /** 위젯 배경 불투명도 기본값(투명도 60%) */
    const val DEFAULT_OPACITY = 0.4
    /** 예전 기본색은 앱처럼 대표색으로(prefs.ts mergePrefs) */
    private fun brandAccent(hex: String) = if (hex.uppercase() in listOf("#72CDF4", "#96D3FD", "#85ADE2") - BRAND) BRAND else hex

    /** 앱 화면 설정이 '시스템'이면(라이트·다크가 기기를 따른다) true */
    fun followsSystem(prefs: JSONObject) = prefs.optString("themeMode", "system") == "system"

    /** dark: 라이트·다크를 정해서 만든다(홈 위젯이 두 벌을 미리 넣어 둘 때). null이면 설정·기기를 따른다 */
    fun from(ctx: Context, prefs: JSONObject, surfaceKey: String = "widget", dark: Boolean? = null): SurfaceTheme {
      val mode = prefs.optString("themeMode", "system")
      val systemDark = (ctx.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
      @Suppress("NAME_SHADOWING")
      val dark = dark ?: if (mode == "system") systemDark else mode == "dark"
      val surface = prefs.optJSONObject(surfaceKey)
      val linked = surface?.optBoolean("linked", true) ?: true
      val accentHex = brandAccent(if (!linked) surface!!.optString("accent", BRAND) else prefs.optString("accent", BRAND))
      val cardHex = (if (!linked) surface!!.opt("card") else prefs.opt("card")).let { if (it is String) it else null }
      val baseCard = if (dark) "#1E2024" else "#FFFFFF"
      val cardColor = if (cardHex != null) mix(baseCard, cardHex, if (dark) 0.32 else 0.16) else Color.parseColor(baseCard)
      // 바탕과 같은 무채색(라이트의 화이트, 다크의 블랙)은 회색으로 흐리지 않고 반대쪽 무채색으로(앱 theme.ts와 같은 규칙)
      val raw = Color.parseColor(accentHex)
      val hsv = FloatArray(3).also { Color.colorToHSV(raw, it) }
      val flat = hsv[1] < 0.2f && contrast(raw, Color.parseColor(baseCard)) < 2
      val accent = if (flat) Color.parseColor(if (dark) "#F2F3F5" else "#1B1C20") else ensureContrast(raw, Color.parseColor(baseCard))
      // 체크 위치: 위젯 탭에서 고른 것, 없으면 공통(앱 기본값 state/prefs.ts DEFAULT_PREFS.checkSide = 오른쪽). 테마 따르기와 상관없다
      fun side(v: Any?) = (v as? String)?.takeIf { it == "left" || it == "right" }
      val common = side(prefs.opt("checkSide")) ?: "right"
      return SurfaceTheme(
        dark = dark,
        accent = accent,
        mark = if (prefs.optBoolean("logoAccent", true)) accent else Color.parseColor(BRAND),
        onAccent = if (luminance(accent) > 0.45) Color.parseColor("#0B0C0E") else Color.WHITE,
        card = cardColor,
        text = Color.parseColor(if (dark) "#FFFFFF" else "#15171A"),
        muted = Color.parseColor(if (dark) "#9C9FA6" else "#7A7F87"),
        circle = Color.parseColor(if (dark) "#A9ADB8" else "#9AA0A8"),
        // 앱 기본값(state/prefs.ts DEFAULT_PREFS.widget.opacity·lockOpacity, 투명도 60%)과 같게. 0(배경 완전 투명)부터 1까지
        opacity = (surface?.optDouble("opacity", DEFAULT_OPACITY) ?: DEFAULT_OPACITY).toFloat().coerceIn(0f, 1f),
        lockOpacity = (surface?.optDouble("lockOpacity", DEFAULT_OPACITY) ?: DEFAULT_OPACITY).toFloat().coerceIn(0f, 1f),
        tinted = cardHex != null,
        checkEnd = (side(surface?.opt("checkSide")) ?: common) == "right",
        lockCheckEnd = (side(surface?.opt("lockCheckSide")) ?: common) == "right",
      )
    }

    fun mix(a: String, b: String, t: Double): Int = mixInt(Color.parseColor(a), Color.parseColor(b), t)

    fun mixInt(x: Int, y: Int, t: Double): Int {
      fun ch(f: (Int) -> Int) = (f(x) + (f(y) - f(x)) * t).roundToInt().coerceIn(0, 255)
      return Color.rgb(ch(Color::red), ch(Color::green), ch(Color::blue))
    }

    fun luminance(c: Int): Double {
      fun lin(v: Int): Double = (v / 255.0).let { if (it <= 0.03928) it / 12.92 else ((it + 0.055) / 1.055).pow(2.4) }
      return 0.2126 * lin(Color.red(c)) + 0.7152 * lin(Color.green(c)) + 0.0722 * lin(Color.blue(c))
    }

    private fun contrast(a: Int, b: Int): Double {
      val (x, y) = listOf(luminance(a), luminance(b)).sortedDescending()
      return (x + 0.05) / (y + 0.05)
    }

    /** 배경과 대비가 3 미만이면 흰색/검은색 쪽으로 옮긴다(다크에서 블랙 테마색도 보이게). */
    fun ensureContrast(color: Int, bg: Int): Int {
      val toward = if (luminance(bg) < 0.5) Color.WHITE else Color.BLACK
      var c = color
      var i = 1
      while (i <= 20 && contrast(c, bg) < 2) {
        c = mixInt(color, toward, i * 0.05)
        i++
      }
      return c
    }
  }
}
