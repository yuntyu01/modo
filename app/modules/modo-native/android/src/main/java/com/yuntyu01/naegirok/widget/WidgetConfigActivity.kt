package com.yuntyu01.naegirok.widget

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.TextView
import com.yuntyu01.naegirok.NotesDb
import com.yuntyu01.naegirok.nativelib.R
import com.yuntyu01.naegirok.SurfaceTheme
import kotlin.math.roundToInt

/**
 * 위젯을 놓을 때(그리고 Android 12+에선 길게 눌러 '위젯 설정'으로) 여는 설정:
 * 폴더, 표시 내용(메모/할 일), 글자 크기, 배경 불투명도.
 */
class WidgetConfigActivity : Activity() {
  override fun attachBaseContext(base: android.content.Context) = super.attachBaseContext(com.yuntyu01.naegirok.AppLocale.wrap(base))

  private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    widgetId = intent?.extras?.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
      ?: AppWidgetManager.INVALID_APPWIDGET_ID
    setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
    if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) return finish()

    val (folders, theme) = NotesDb.use(this) { db -> NotesDb.folders(db) to SurfaceTheme.from(this, NotesDb.prefs(db)) }
      ?: (emptyList<NotesDb.Folder>() to SurfaceTheme.from(this, org.json.JSONObject()))
    val cur = WidgetPrefs.load(this, widgetId)
    val dp = resources.displayMetrics.density
    val pad = (20 * dp).toInt()

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(pad, pad, pad, pad)
      background = GradientDrawable().apply { setColor(theme.card); cornerRadius = 24 * dp }
    }
    fun label(text: String) = TextView(this).apply {
      this.text = text
      setTextColor(theme.muted)
      textSize = 14f
      setPadding(0, (16 * dp).toInt(), 0, (6 * dp).toInt())
    }
    fun radios(options: List<Pair<String, Boolean>>): RadioGroup = RadioGroup(this).apply {
      options.forEachIndexed { i, (text, checked) ->
        addView(RadioButton(this@WidgetConfigActivity).apply {
          id = View.generateViewId()
          tag = i
          this.text = text
          textSize = 16f
          setTextColor(theme.text)
          buttonTintList = ColorStateList.valueOf(theme.accent)
          isChecked = checked
        })
      }
    }
    root.addView(TextView(this).apply {
      text = getString(R.string.widget_settings)
      textSize = 20f
      setTextColor(theme.text)
    })
    root.addView(label(getString(R.string.folder)))
    val folderOptions = listOf<NotesDb.Folder?>(null) + folders
    val folderGroup = radios(folderOptions.map { (it?.name ?: getString(R.string.base_folder)) to (it?.id == cur.folderId) })
    root.addView(folderGroup)
    root.addView(label(getString(R.string.widget_show)))
    val shows = WidgetPrefs.Show.entries
    val showLabels = listOf(R.string.show_both, R.string.show_todos, R.string.show_memo).map(::getString)
    val showGroup = radios(shows.mapIndexed { i, s -> showLabels[i] to (s == cur.show) })
    root.addView(showGroup)
    root.addView(label(getString(R.string.text_size)))
    val sizeLabels = listOf(R.string.size_s, R.string.size_m, R.string.size_l).map(::getString)
    val sizeGroup = radios(WidgetPrefs.SIZES.mapIndexed { i, s -> sizeLabels[i] to (s == cur.textSize) })
    root.addView(sizeGroup)
    val opacityLabel = label("")
    root.addView(opacityLabel)
    // 앱 꾸미기와 같게 '투명도'로 보인다(오른쪽 = 더 투명, 0~100%). 저장 값은 불투명도(1 - 투명도)
    // 잠금화면에 놓인 위젯이면 꾸미기의 잠금화면 위젯 투명도에서 시작한다
    val keyguard = AppWidgetManager.getInstance(this).getAppWidgetOptions(widgetId)
      .getInt(AppWidgetManager.OPTION_APPWIDGET_HOST_CATEGORY, -1) == android.appwidget.AppWidgetProviderInfo.WIDGET_CATEGORY_KEYGUARD
    val start = 100 - ((cur.opacity ?: if (keyguard) theme.lockOpacity else theme.opacity) * 100).roundToInt()
    fun showOpacity(v: Int) {
      opacityLabel.text = getString(R.string.bg_transparency, v)
    }
    showOpacity(start)
    val seek = SeekBar(this).apply {
      max = 100
      progress = start
      progressTintList = ColorStateList.valueOf(theme.accent)
      thumbTintList = ColorStateList.valueOf(theme.accent)
      setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
        override fun onProgressChanged(s: SeekBar?, v: Int, fromUser: Boolean) = showOpacity(v)
        override fun onStartTrackingTouch(s: SeekBar?) {}
        override fun onStopTrackingTouch(s: SeekBar?) {}
      })
    }
    root.addView(seek)
    root.addView(Button(this).apply {
      text = getString(R.string.done)
      setTextColor(theme.onAccent)
      background = GradientDrawable().apply { setColor(theme.accent); cornerRadius = 18 * dp }
      layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (52 * dp).toInt()).apply {
        topMargin = (20 * dp).toInt()
      }
      setOnClickListener {
        fun checked(g: RadioGroup) = (g.findViewById<RadioButton>(g.checkedRadioButtonId)?.tag as? Int) ?: 0
        // 보는 상태(쪽·메모 읽기)는 그대로 두고, 폴더를 바꿨을 때만 처음부터
        cur.withFolder(folderOptions[checked(folderGroup)]?.id).copy(
          show = shows[checked(showGroup)],
          textSize = WidgetPrefs.SIZES[checked(sizeGroup).coerceIn(0, 2)],
          // 슬라이더를 건드리지 않았으면 따로 저장하지 않고 꾸미기의 위젯 투명도를 따른다.
          opacity = if (seek.progress == start) cur.opacity else (100 - seek.progress) / 100f,
        ).save(this@WidgetConfigActivity, widgetId)
        // Activity가 아닌 applicationContext로 갱신한다.
        val app = applicationContext
        val mgr = AppWidgetManager.getInstance(app)
        NotesWidgetProvider.update(app, mgr, widgetId)
        setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
        finish()
      }
    })
    if (folderGroup.checkedRadioButtonId == -1) (folderGroup.getChildAt(0) as RadioButton).isChecked = true
    if (sizeGroup.checkedRadioButtonId == -1) (sizeGroup.getChildAt(1) as RadioButton).isChecked = true
    setContentView(ScrollView(this).apply {
      setPadding(pad / 2, pad * 2, pad / 2, pad)
      addView(root)
      foregroundGravity = Gravity.CENTER
    })
  }
}
