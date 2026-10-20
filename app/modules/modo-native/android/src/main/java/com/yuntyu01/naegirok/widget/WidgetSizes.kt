package com.yuntyu01.naegirok.widget

/**
 * 위젯 고르기 화면(런처)에 크기별로 따로 보이는 같은 위젯: 4×4. 기본(NotesWidgetProvider)은 3×3이고 잠금화면도 그것만.
 * 모양·동작은 모두 같다(위젯 id로 그리고, 누르는 동작은 NotesWidgetProvider가 받는다). 놓은 뒤에는 어느 것이든 크기를 바꿀 수 있다.
 * 사용자 요청 2026-10-21: 위젯을 넣을 때 3×3·4×4 같은 크기를 고를 수 있게
 */
class NotesWidgetProvider4x4 : NotesWidgetProvider()
