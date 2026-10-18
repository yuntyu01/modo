package api

import (
	"net/http"
	"strings"
)

// 서버가 직접 그리는 웹 페이지(보기 전용 공유 링크, 외부 로그인 오류)는 브라우저 언어(Accept-Language)를 따른다.
// 앱 화면 문구는 앱(app/src/i18n.ts, app/src/locales)이 맡는다.
type pageText struct {
	Scope        string // %s = 폴더 이름
	LinkGone     string
	LoginTitle   string
	LoginExpired string
	LoginRetry   string
}

var pageTexts = map[string]pageText{
	"ko": {
		Scope:        "이 링크를 가진 사람은 누구나 '%s' 폴더만 볼 수 있어요. 다른 폴더와 메모는 보이지 않아요.",
		LinkGone:     "공유가 끝났거나 없는 링크입니다",
		LoginTitle:   "로그인을 마치지 못했어요",
		LoginExpired: "로그인 요청이 만료됐거나 이미 쓰였어요.",
		LoginRetry:   "이 창을 닫고 앱에서 다시 시도해 주세요.",
	},
	"en": {
		Scope:        "Anyone with this link can view only the '%s' folder. Other folders and memos stay private.",
		LinkGone:     "This link has expired or doesn't exist",
		LoginTitle:   "Sign-in couldn't be completed",
		LoginExpired: "This sign-in request expired or was already used.",
		LoginRetry:   "Close this window and try again in the app.",
	},
	"ja": {
		Scope:        "このリンクを知っている人は誰でも「%s」フォルダだけを見られます。ほかのフォルダやメモは表示されません。",
		LinkGone:     "共有が終了したか、存在しないリンクです",
		LoginTitle:   "ログインを完了できませんでした",
		LoginExpired: "ログインのリクエストが期限切れか、すでに使われています。",
		LoginRetry:   "このウィンドウを閉じて、アプリでもう一度お試しください。",
	},
	"zh": {
		Scope:        "任何拥有此链接的人都只能查看“%s”文件夹，其他文件夹和备忘不会显示。",
		LinkGone:     "共享已结束或链接不存在",
		LoginTitle:   "未能完成登录",
		LoginExpired: "登录请求已过期或已被使用。",
		LoginRetry:   "请关闭此窗口，在应用中重试。",
	},
}

// 머리글에서 지원하는 첫 언어(q 값 순서는 브라우저가 이미 선호 순으로 보낸다고 본다). 머리글이 없으면 한국어.
func pageLang(r *http.Request) string {
	h := r.Header.Get("Accept-Language")
	if h == "" {
		return "ko"
	}
	for _, part := range strings.Split(h, ",") {
		tag := strings.ToLower(strings.TrimSpace(strings.SplitN(part, ";", 2)[0]))
		primary := strings.SplitN(tag, "-", 2)[0]
		if _, ok := pageTexts[primary]; ok {
			return primary
		}
	}
	return "en"
}
