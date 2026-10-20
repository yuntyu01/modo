package com.yuntyu01.naegirok

import com.yuntyu01.naegirok.nativelib.R
import android.app.Activity
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityNodeInfo
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.ImageButton
import android.widget.TextView
import android.widget.Toast

/**
 * '빠른 추가' 앱 아이콘(별도 런처 항목)·위젯 +·빠른 설정 타일이 여는 작은 입력창.
 * React Native를 띄우지 않아 누르자마자 키보드와 함께 열린다.
 * 앱과 같은 규칙: 오른쪽 체크 토글 하나(켜면 할 일, 끄면 메모 이어 쓰기), 토글을 바꿔도 초안 유지,
 * 한글 조합 중 엔터나 연속 입력으로 두 번 추가되지 않게 막는다.
 */
class QuickAddActivity : Activity() {
  override fun attachBaseContext(base: Context) = super.attachBaseContext(AppLocale.wrap(base))

  private lateinit var input: EditText
  private lateinit var toggle: ImageButton
  private lateinit var send: ImageButton
  private var todoMode = true
  private var submitting = false
  private var folderId: String? = null
  private lateinit var theme: SurfaceTheme

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.activity_quick_add)
    window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE or WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
    folderId = intent.getStringExtra(EXTRA_FOLDER)
    val prefs = getSharedPreferences("naegirok_quickadd", Context.MODE_PRIVATE)
    todoMode = savedInstanceState?.getBoolean("todo") ?: prefs.getBoolean("todo", true)

    // DB는 한 번만 연다(예전엔 설정·보기 전용·폴더 이름을 따로 열어, 첫 화면 전에 세 번 열었다)
    // null(앱 아이콘·타일) = 기본 폴더. 보기 전용으로 공유받은 폴더(넣으면 서버가 거절한다)나 지워진 폴더를 가리키는 위젯도 기본으로
    data class Start(val theme: SurfaceTheme, val top: Boolean, val name: String?, val signedIn: Boolean)
    val start = NotesDb.use(this) { db ->
      val p = NotesDb.prefs(db)
      val name = folderId?.takeIf { !NotesDb.viewOnly(db, it) }?.let { NotesDb.folderName(db, it) }
      Start(SurfaceTheme.from(this, p, "widget"), p.optString("newTodoAt", "bottom") == "top", name, NotesDb.signedIn(db))
    } ?: Start(SurfaceTheme.from(this, org.json.JSONObject()), false, null, false)
    // 로그인해야 쓸 수 있다: 로그인하지 않았으면(앱을 한 번도 안 열었어도) 앱의 로그인 화면으로(앱 아이콘·타일·위젯 + 모두 여기로 온다)
    if (!start.signedIn) {
      Toast.makeText(this, R.string.login_first, Toast.LENGTH_SHORT).show()
      ModoEvents.openApp(this)
      finish()
      return
    }
    theme = start.theme
    newTodoTop = start.top
    if (start.name == null) folderId = null
    // 어디에 저장되는지 항상 보여 준다(입력칸 안내)
    folderName = start.name ?: getString(R.string.base_folder)

    val dp = resources.displayMetrics.density
    findViewById<View>(R.id.qa_bar).background = GradientDrawable().apply {
      setColor(theme.card)
      cornerRadius = 32 * dp
    }
    input = findViewById(R.id.qa_input)
    toggle = findViewById(R.id.qa_toggle)
    send = findViewById(R.id.qa_send)
    input.setTextColor(theme.text)
    input.setHintTextColor(theme.muted)
    if (Build.VERSION.SDK_INT >= 29) {
      input.textCursorDrawable?.setTint(theme.accent)
      input.textSelectHandle?.setTint(theme.accent)
      input.textSelectHandleLeft?.setTint(theme.accent)
      input.textSelectHandleRight?.setTint(theme.accent)
    }
    input.highlightColor = (theme.accent and 0x00FFFFFF) or (0x8C shl 24)
    send.backgroundTintList = ColorStateList.valueOf(theme.accent)
    send.imageTintList = ColorStateList.valueOf(theme.onAccent)

    toggle.setOnClickListener {
      todoMode = !todoMode
      prefs.edit().putBoolean("todo", todoMode).apply()
      applyMode()
    }
    toggle.accessibilityDelegate = object : View.AccessibilityDelegate() {
      override fun onInitializeAccessibilityNodeInfo(host: View, info: AccessibilityNodeInfo) {
        super.onInitializeAccessibilityNodeInfo(host, info)
        info.className = "android.widget.Switch"
        info.isCheckable = true
        info.isChecked = todoMode
      }
    }
    send.setOnClickListener { submit() }
    input.setOnEditorActionListener { _, actionId, event ->
      val enter = actionId == EditorInfo.IME_ACTION_DONE ||
        (event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN)
      if (todoMode && enter) {
        submit()
        true
      } else {
        false
      }
    }
    input.addTextChangedListener(object : TextWatcher {
      override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
      override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
      override fun afterTextChanged(s: Editable?) = updateSend()
    })
    findViewById<View>(R.id.qa_root).setOnClickListener { finish() }
    findViewById<View>(R.id.qa_panel).setOnClickListener { }
    applyMode()
    input.requestFocus()
    input.post {
      (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).showSoftInput(input, InputMethodManager.SHOW_IMPLICIT)
    }
  }

  private var newTodoTop = false
  private var folderName: String? = null

  override fun onSaveInstanceState(outState: Bundle) {
    super.onSaveInstanceState(outState)
    outState.putBoolean("todo", todoMode)
  }

  /** 모드를 바꿔도 글자는 그대로 둔다. 할 일: 엔터=추가, 메모: 엔터=줄바꿈 + 보내기 버튼. */
  private fun applyMode() {
    val sel = input.selectionEnd
    if (todoMode) {
      input.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
      input.imeOptions = EditorInfo.IME_ACTION_DONE
      input.setHorizontallyScrolling(false)
      input.maxLines = 5
      input.hint = withFolder(getString(R.string.new_todo))
    } else {
      input.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
      input.imeOptions = EditorInfo.IME_ACTION_NONE
      input.maxLines = 8
      input.hint = withFolder(getString(R.string.continue_memo))
    }
    if (sel >= 0) input.setSelection(sel.coerceAtMost(input.length()))
    (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).restartInput(input)
    toggle.imageTintList = ColorStateList.valueOf(if (todoMode) theme.accent else theme.muted)
    toggle.background = if (todoMode) GradientDrawable().apply {
      shape = GradientDrawable.OVAL
      setColor(SurfaceTheme.mixInt(theme.card, if (theme.dark) 0xFFFFFFFF.toInt() else 0xFF000000.toInt(), 0.08))
    } else null
    toggle.contentDescription = getString(R.string.input_as_todo)
    if (Build.VERSION.SDK_INT >= 30) toggle.stateDescription = getString(if (todoMode) R.string.on else R.string.off)
    updateSend()
  }

  private fun withFolder(hint: String) = folderName?.let { "$hint · $it" } ?: hint

  private fun updateSend() {
    send.visibility = if (!todoMode && input.text.isNotBlank()) View.VISIBLE else View.GONE
  }

  private fun submit() {
    // 조합 중인 글자를 확정한 뒤 읽는다.
    input.clearComposingText()
    val text = input.text.toString().trimEnd().trimStart('\n')
    if (text.isBlank() || submitting) return
    submitting = true
    val asTodo = todoMode
    val folder = folderId
    val app = applicationContext
    Work.run {
      val ok = NotesDb.write(app) { db ->
        if (asTodo) NotesDb.addTodo(db, text.replace('\n', ' '), folder, newTodoTop) else NotesDb.appendMemo(db, text, folder)
      } != null
      // 창은 저장되자마자 닫고, 위젯·알림은 그 뒤에 맞춘다(예전엔 위젯을 다 그릴 때까지 창이 남아 있었다)
      runOnUiThread {
        if (ok) {
          Toast.makeText(this, if (asTodo) R.string.added_todo else R.string.added_memo, Toast.LENGTH_SHORT).show()
          finish()
        } else {
          submitting = false
          Toast.makeText(this, R.string.open_app_first, Toast.LENGTH_LONG).show()
        }
      }
      if (ok) ModoEvents.afterWrite(app, if (asTodo) "todos" else "paragraphs")
    }
  }

  companion object {
    const val EXTRA_FOLDER = "folder_id"
  }
}
