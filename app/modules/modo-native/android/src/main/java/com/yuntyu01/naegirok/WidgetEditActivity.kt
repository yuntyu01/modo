package com.yuntyu01.naegirok

import android.app.Activity
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.ImageButton
import com.yuntyu01.naegirok.nativelib.R

/**
 * 위젯에서 글자를 누르면 뜨는 고치기 창(빠른 추가와 같은 모양: 키보드 위 입력줄 하나).
 * 할 일: 그 할 일의 글을 커서를 끝에 둔 채로 열고, 완료/엔터로 저장.
 * 메모: 그 폴더 메모 전체를 여러 줄로 열고(엔터 = 줄바꿈), 저장 버튼으로 저장. 바뀐 줄만 문단에 반영한다.
 * 바깥을 누르거나 뒤로 가도 고친 내용은 저장한다(잃지 않게). 잠금화면에서 누르면 시스템이 먼저 잠금 해제를 요구한다.
 */
class WidgetEditActivity : Activity() {
  override fun attachBaseContext(base: Context) = super.attachBaseContext(AppLocale.wrap(base))

  private lateinit var input: EditText
  private var todoId: String? = null
  private var memoFolder: String? = null
  /** 마지막으로 저장한(처음엔 연) 글. 이것과 다를 때만 저장한다 */
  private var original = ""
  /** 연 글이 입력칸에 그대로 들어갔는지. 아니면(잘렸으면) 저장하지 않는다: 메모는 글 전체로 문단을 맞춰, 잘린 뒤쪽 문단이 휴지통으로 갔다 */
  private var intact = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.activity_quick_add)
    window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE or WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
    todoId = intent.getStringExtra(EXTRA_TODO)
    val memo = intent.getStringExtra(EXTRA_MEMO_FOLDER)
    memoFolder = memo?.takeIf { it != BASE }

    var signedIn = false
    val loaded = NotesDb.use(this) { db ->
      signedIn = NotesDb.signedIn(db)
      val theme = SurfaceTheme.from(this, NotesDb.prefs(db), "widget")
      val text = if (todoId != null) NotesDb.todoText(db, todoId!!) else NotesDb.memo(db, memoFolder).joinToString("\n")
      val name = NotesDb.folderName(db, memoFolder) ?: getString(R.string.base_folder)
      Triple(theme, text, name)
    }
    // 로그인하지 않았으면 고치지 않고 앱의 로그인 화면으로(로그아웃한 뒤 남은 위젯을 눌렀을 때)
    if (!signedIn) {
      android.widget.Toast.makeText(this, R.string.login_first, android.widget.Toast.LENGTH_SHORT).show()
      ModoEvents.openApp(this)
      finish()
      return
    }
    if (loaded == null || loaded.second == null) {
      finish()
      return
    }
    val (theme, text, folderName) = loaded
    original = text ?: ""

    val dp = resources.displayMetrics.density
    findViewById<View>(R.id.qa_bar).background = GradientDrawable().apply {
      setColor(theme.card)
      cornerRadius = 32 * dp
    }
    input = findViewById(R.id.qa_input)
    val send = findViewById<ImageButton>(R.id.qa_send)
    findViewById<View>(R.id.qa_toggle).visibility = View.GONE
    input.setTextColor(theme.text)
    input.setHintTextColor(theme.muted)
    if (Build.VERSION.SDK_INT >= 29) {
      input.textCursorDrawable?.setTint(theme.accent)
      input.textSelectHandle?.setTint(theme.accent)
    }
    input.highlightColor = (theme.accent and 0x00FFFFFF) or (0x8C shl 24)
    send.visibility = View.VISIBLE
    send.backgroundTintList = ColorStateList.valueOf(theme.accent)
    send.imageTintList = ColorStateList.valueOf(theme.onAccent)
    send.contentDescription = getString(R.string.save)

    if (todoId != null) {
      input.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
      input.imeOptions = EditorInfo.IME_ACTION_DONE
      input.setHorizontallyScrolling(false)
      input.maxLines = 5
      input.hint = getString(R.string.edit_todo)
    } else {
      input.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
      input.imeOptions = EditorInfo.IME_ACTION_NONE
      input.maxLines = 10
      input.hint = getString(R.string.edit_memo) + " · " + folderName
    }
    // 빠른 추가 칸의 5000자 제한은 새로 쓰는 글에만: 이미 있는 긴 메모·할 일을 열면 잘리지 않게(앱의 고치기에도 제한이 없다)
    input.filters = emptyArray()
    input.setText(original)
    intact = input.text.toString() == original
    input.setSelection(input.length())

    send.setOnClickListener { saveAndClose() }
    input.setOnEditorActionListener { _, actionId, event ->
      val enter = actionId == EditorInfo.IME_ACTION_DONE || (event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN)
      if (todoId != null && enter) {
        saveAndClose()
        true
      } else {
        false
      }
    }
    findViewById<View>(R.id.qa_root).setOnClickListener { saveAndClose() }
    findViewById<View>(R.id.qa_panel).setOnClickListener { }
    input.requestFocus()
    input.post {
      (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).showSoftInput(input, InputMethodManager.SHOW_IMPLICIT)
    }
  }

  @Deprecated("Deprecated in Java")
  override fun onBackPressed() = saveAndClose()

  override fun onPause() {
    super.onPause()
    // 홈 버튼 등으로 벗어나도 고친 내용을 잃지 않게
    if (!isFinishing) save()
  }

  private fun save() {
    if (!intact || !::input.isInitialized) return
    input.clearComposingText()
    val text = input.text.toString().let { if (todoId != null) it.replace('\n', ' ').trim() else it.trimEnd() }
    // 할 일을 다 지우면 지우지 않고 그대로 둔다(삭제는 앱에서 실행 취소와 함께)
    if (text == original || (todoId != null && text.isBlank())) return
    // 홈 버튼으로 나갔다 돌아와 더 고치면 그것도 저장한다(예전엔 한 번 저장하면 그 창에선 다시 저장하지 않았다)
    original = text
    val id = todoId
    val folder = memoFolder
    val app = applicationContext
    // 저장은 차례로(Work): 두 번 저장해도 늦게 고친 글이 마지막에 들어간다
    Work.run {
      NotesDb.write(app) { db -> if (id != null) NotesDb.setTodoText(db, id, text) else NotesDb.saveMemo(db, folder, text) } ?: return@run
      ModoEvents.afterWrite(app, if (id != null) "todos" else "paragraphs")
    }
  }

  private fun saveAndClose() {
    save()
    finish()
  }

  companion object {
    const val EXTRA_TODO = "todo_id"
    const val EXTRA_MEMO_FOLDER = "memo_folder"
    const val BASE = "base"
  }
}
