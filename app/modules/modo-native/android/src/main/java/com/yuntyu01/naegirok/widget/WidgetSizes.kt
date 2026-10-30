package com.yuntyu01.naegirok.widget

/**
 * 위젯 고르기 화면(런처)에 크기별로 따로 보이는 같은 위젯: 4×4. 기본(NotesWidgetProvider)은 3×3이고 잠금화면도 그것만.
 * 모양·동작은 모두 같다(위젯 id로 그리고, 누르는 동작은 NotesWidgetProvider가 받는다). 놓은 뒤에는 어느 것이든 크기를 바꿀 수 있다.
 * 사용자 요청 2026-10-21: 위젯을 넣을 때 3×3·4×4 같은 크기를 고를 수 있게.
 * Android 16+는 크기 판을 위젯 고르기(런처·잠금화면)에서 빼고 앱의 크기 버튼(requestPinWidget)으로만 놓는다:
 * 삼성 잠금화면 고르기에 modo가 4개 나왔다(xml-v36, 사용자 요청 2026-10-30). 잠금화면은 기본 하나만
 */
class NotesWidgetProvider4x4 : NotesWidgetProvider()

/** 2×2(작게, 사용자 요청 2026-10-22): 좁으면 폴더 이름 · 할 일 하나씩, 넉넉하면 목록(HomeWidget.responsive) */
class NotesWidgetProvider2x2 : NotesWidgetProvider()

/**
 * 한 줄(4×1): 폴더 고르기와 할 일 하나씩 넘기기(HomeWidget.strip). 삼성 잠금화면의 넓은 칸처럼 낮은 자리에 알맞다.
 * 크게 늘리면 다른 위젯처럼 목록이 된다(사용자 요청 2026-10-21)
 */
class NotesWidgetProvider4x1 : NotesWidgetProvider()
