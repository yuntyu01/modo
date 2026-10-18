import AppIntents
import SwiftUI
import UIKit
import WidgetKit

// 홈 화면(중간/크게)과 잠금화면(직사각형/한 줄) 위젯, 그리고 iOS 18 제어 센터 '빠른 추가'.
// 데이터는 App Group의 SQLite(NotesStore.swift, 앱 모듈과 같은 파일)를 직접 읽는다.
//
// 홈 위젯(Android HomeWidget.kt와 같은 규칙):
// - 기본 모드: 첫 쪽은 그 폴더의 메모만, 다음 쪽부터 할 일만. 점 = 메모 쪽 1 + 할 일 쪽 수.
// - 메모를 누르면 메모 읽기 모드(본문을 실제 줄바꿈으로 쪽에 나눔, 점 = 메모 쪽만). 다시 누르면 메모 쪽으로.
// - WidgetKit 위젯은 Button·Toggle(App Intents)과 Link만 받는다. 옆으로 밀기·스크롤 같은 제스처는 없어서 쪽은 점을 눌러 넘긴다.
// - 폴더: 앱과 같이 메모 위 폴더 탭을 누르면 그 폴더로(Button + App Intent). 처음 보일 폴더는 '위젯 편집'(길게 누르기)에서 고른다.
//   중간 크기는 높이가 모자라 탭을 로고 줄 오른쪽에, 크게는 Android처럼 로고 줄 아래 따로 둔다.
// - 크기: 중간 이상(작게는 머리 + 할 일 2줄 + 점 줄이 들어가지 않아 뺐다).

struct NotesEntry: TimelineEntry {
  let date: Date
  let snapshot: NotesStore.Snapshot?
  /// 보이는 폴더(nil = 기본). 지워졌거나 공유가 끊긴 폴더면 기본
  var folderId: String? = nil
  /// 보는 상태 열쇠: (폴더, 크기)
  var key: String = ""
  var view = NotesStore.WidgetView()
  /// 폴더 탭 열쇠: (위젯 편집에서 고른 폴더, 크기)
  var tabKey: String = ""
  var family: String = ""
  var folders: [NotesStore.Folder] = []
}

// MARK: - 폴더 고르기(위젯 편집)

struct FolderEntity: AppEntity {
  static var typeDisplayRepresentation: TypeDisplayRepresentation = "폴더"
  static var defaultQuery = FolderQuery()
  static let baseId = "base"
  let id: String
  let name: String
  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
}

struct FolderQuery: EntityQuery {
  func entities(for identifiers: [String]) async throws -> [FolderEntity] { Self.all().filter { identifiers.contains($0.id) } }
  func suggestedEntities() async throws -> [FolderEntity] { Self.all() }
  /// 예전 위젯(모든 위젯이 함께 쓰던 폴더)을 그대로 이어 받는다
  func defaultResult() async -> FolderEntity? {
    let all = Self.all()
    return all.first(where: { $0.id == (NotesStore.widgetFolder ?? FolderEntity.baseId) }) ?? all.first
  }

  static func all() -> [FolderEntity] {
    [FolderEntity(id: FolderEntity.baseId, name: L.current(nil).baseFolder)] + NotesStore.folders().map { FolderEntity(id: $0.id, name: $0.name) }
  }
}

struct NotesConfigIntent: WidgetConfigurationIntent {
  static var title: LocalizedStringResource = "modo 위젯"
  static var description = IntentDescription("위젯에 보일 폴더를 고릅니다.")
  @Parameter(title: "폴더") var folder: FolderEntity?
  init() {}
}

struct NotesProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> NotesEntry {
    let l = L.current(nil)
    return NotesEntry(date: .now, snapshot: .init(folderName: nil, memo: [l.sampleMemo], todos: [
      .init(id: "1", text: l.sampleTodos[0], doneAt: nil, due: nil),
      .init(id: "2", text: l.sampleTodos[1], doneAt: nil, due: nil),
    ], prefs: [:]))
  }

  func snapshot(for configuration: NotesConfigIntent, in context: Context) async -> NotesEntry {
    context.isPreview ? placeholder(in: context) : entry(configuration, context)
  }

  func timeline(for configuration: NotesConfigIntent, in context: Context) async -> Timeline<NotesEntry> {
    // 앱·위젯 버튼이 바꾸면 바로 다시 읽는다(버튼은 늘 다시 읽게 된다). 그 외엔 30분마다(시스템이 횟수를 제한함)
    Timeline(entries: [entry(configuration, context)], policy: .after(.now.addingTimeInterval(1800)))
  }

  private func entry(_ c: NotesConfigIntent, _ context: Context) -> NotesEntry {
    let configured = c.folder.map { $0.id == FolderEntity.baseId ? nil : $0.id } ?? NotesStore.widgetFolder
    let family = "\(context.family)"
    let tabKey = "\(configured ?? FolderEntity.baseId)|\(family)"
    // 폴더 탭으로 고른 폴더가 있으면 그 폴더
    let wanted: String? = NotesStore.widgetTab(tabKey).map { $0 == FolderEntity.baseId ? nil : $0 } ?? configured
    let snap = NotesStore.snapshot(folderId: wanted)
    // 지워졌거나 공유 권한이 사라진 폴더는 이름을 못 읽어 기본 폴더로 보인다(snapshot이 기본 폴더 할 일을 읽는다)
    let fid = snap?.folderName == nil ? nil : wanted
    let key = "\(fid ?? FolderEntity.baseId)|\(family)"
    return NotesEntry(
      date: .now, snapshot: snap, folderId: fid, key: key, view: NotesStore.widgetView(key), tabKey: tabKey, family: family, folders: NotesStore.folders())
  }
}

// MARK: - 위젯 버튼(App Intents)

/// 위젯에서 동그라미를 눌러 완료/완료 취소(iOS 17 인터랙티브 위젯)
struct ToggleTodoIntent: AppIntent {
  static var title: LocalizedStringResource = "할 일 완료 바꾸기"
  static var isDiscoverable = false
  @Parameter(title: "할 일") var todoId: String
  @Parameter(title: "완료") var done: Bool

  init() {}
  init(todoId: String, done: Bool) {
    self.todoId = todoId
    self.done = done
  }

  func perform() async throws -> some IntentResult {
    // 반복 할 일은 완료로 남기지 않고 다음 예정일로 넘긴다(이번 회차만)
    if done { NotesStore.complete(id: todoId) } else { NotesStore.uncheck(id: todoId) }
    return .result()
  }
}

/// 메모를 눌러 메모 읽기 모드 켜기/끄기(끄면 기본 모드의 메모 쪽으로)
struct WidgetMemoIntent: AppIntent {
  static var title: LocalizedStringResource = "위젯 메모 읽기"
  static var isDiscoverable = false
  @Parameter(title: "위젯") var key: String

  init() {}
  init(key: String) { self.key = key }

  func perform() async throws -> some IntentResult {
    var v = NotesStore.widgetView(key)
    if v.reading {
      v.reading = false
      v.page = 0
    } else {
      v.reading = true
      v.readPage = 0
    }
    NotesStore.setWidgetView(key, v)
    return .result()
  }
}

/// 폴더 탭을 눌러 그 폴더의 첫 쪽으로(Android ACTION_FOLDER와 같다)
struct WidgetFolderIntent: AppIntent {
  static var title: LocalizedStringResource = "위젯 폴더 바꾸기"
  static var isDiscoverable = false
  @Parameter(title: "탭") var tabKey: String
  @Parameter(title: "폴더") var folder: String
  @Parameter(title: "위젯") var viewKey: String

  init() {}
  init(tabKey: String, folder: String, viewKey: String) {
    self.tabKey = tabKey
    self.folder = folder
    self.viewKey = viewKey
  }

  func perform() async throws -> some IntentResult {
    NotesStore.setWidgetTab(tabKey, folder)
    NotesStore.setWidgetView(viewKey, NotesStore.WidgetView())
    return .result()
  }
}

/// 점을 눌러 그 쪽으로(읽기 모드면 메모 쪽, 아니면 메모 쪽 + 할 일 쪽)
struct WidgetPageIntent: AppIntent {
  static var title: LocalizedStringResource = "위젯 쪽 넘기기"
  static var isDiscoverable = false
  @Parameter(title: "위젯") var key: String
  @Parameter(title: "읽기") var reading: Bool
  @Parameter(title: "쪽") var page: Int

  init() {}
  init(key: String, reading: Bool, page: Int) {
    self.key = key
    self.reading = reading
    self.page = page
  }

  func perform() async throws -> some IntentResult {
    var v = NotesStore.widgetView(key)
    if reading { v.readPage = page } else { v.page = page }
    NotesStore.setWidgetView(key, v)
    return .result()
  }
}

// MARK: - 쪽 나누기(실제 글꼴·줄바꿈)

enum MemoPages {
  struct Page {
    let range: NSRange
    let lines: Int
  }

  /// 글을 폭에 맞춰 배치(TextKit, 위젯 글자와 같은 글꼴·줄 간격·한글 단어 줄바꿈)하고 높이에 들어가는 줄씩 쪽으로 나눈다.
  /// 쪽 처음·끝의 빈 줄(문단 사이 구분)은 빼서, 빠지거나 겹치는 글 없이 줄 단위로 나뉜다.
  static func split(_ text: String, font: UIFont, spacing: CGFloat, width: CGFloat, height: CGFloat) -> [Page] {
    guard !text.isEmpty, width > 0 else { return [] }
    let style = NSMutableParagraphStyle()
    style.lineSpacing = spacing
    style.lineBreakStrategy = .standard
    let storage = NSTextStorage(string: text, attributes: [.font: font, .paragraphStyle: style])
    let manager = NSLayoutManager()
    let container = NSTextContainer(size: CGSize(width: width, height: .greatestFiniteMagnitude))
    container.lineFragmentPadding = 0
    manager.addTextContainer(container)
    storage.addLayoutManager(manager)
    var lines: [(range: NSRange, height: CGFloat)] = []
    manager.enumerateLineFragments(forGlyphRange: NSRange(location: 0, length: manager.numberOfGlyphs)) { rect, _, _, glyphs, _ in
      lines.append((manager.characterRange(forGlyphRange: glyphs, actualGlyphRange: nil), rect.height))
    }
    let ns = text as NSString
    func blank(_ i: Int) -> Bool { ns.substring(with: lines[i].range).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    var pages: [Page] = []
    var start = 0
    while start < lines.count {
      var end = start
      var used = lines[start].height
      while end + 1 < lines.count, used + lines[end + 1].height <= height {
        end += 1
        used += lines[end].height
      }
      var a = start
      var b = end
      while a <= b, blank(a) { a += 1 }
      while b >= a, blank(b) { b -= 1 }
      if a <= b {
        let first = lines[a].range.location
        let last = NSMaxRange(lines[b].range)
        pages.append(Page(range: NSRange(location: first, length: last - first), lines: b - a + 1))
      }
      start = end + 1
    }
    return pages
  }
}

// MARK: - 할 일 아래 작은 줄(앱 format.ts·Android CardMeta.kt와 같은 문구)

enum CardMeta {
  struct Part {
    let text: String
    let late: Bool
  }

  static func repeatShort(_ t: NotesStore.Todo, _ l: L) -> String {
    let freq = t.repeatFreq ?? ""
    if freq == "daily" || (freq == "weekly" && t.repeatDays == 127) { return l.daily }
    let anchor = t.due.flatMap(Repeat.parse)
    if freq == "monthly" { return l.monthly(anchor.map { Repeat.cal.component(.day, from: $0) } ?? 1) }
    let mask = t.repeatDays.flatMap { $0 == 0 ? nil : $0 } ?? anchor.map(Repeat.bit) ?? 1
    if mask == 31 { return l.weekdays }
    if mask == 96 { return l.weekends }
    let picked = (0..<7).filter { mask & (1 << $0) != 0 } // 월요일 = 0
    if picked.count == 1 { return l.weeklyOne((picked[0] + 1) % 7) }
    return l.daysShort(picked.map { l.week[($0 + 1) % 7] })
  }

  /// 오늘·내일 / 10월 19일 / 2027년 1월 3일
  static func date(_ d: Date, _ l: L, today: Date) -> String {
    let cal = Repeat.cal
    let day = cal.startOfDay(for: d)
    let now = cal.startOfDay(for: today)
    if day == now { return l.today }
    if day == cal.date(byAdding: .day, value: 1, to: now) { return l.tomorrow }
    let c = cal.dateComponents([.year, .month, .day], from: d)
    return c.year == cal.component(.year, from: today) ? l.monthDay(c.month ?? 1, c.day ?? 1) : l.fullDate(c.year ?? 0, c.month ?? 1, c.day ?? 1)
  }

  static func parts(_ t: NotesStore.Todo, _ l: L, today: Date = Date()) -> [Part] {
    let cal = Repeat.cal
    var out: [Part] = []
    if t.repeatFreq != nil { out.append(Part(text: repeatShort(t, l), late: false)) }
    let due = t.due.flatMap(Repeat.parse)
    let lateDays = due.map { cal.dateComponents([.day], from: cal.startOfDay(for: $0), to: cal.startOfDay(for: today)).day ?? 0 } ?? 0
    let late = lateDays > 0 && !t.done
    let remind = t.remindAt.map { Date(timeIntervalSince1970: TimeInterval($0) / 1000) }
    let time = remind.map { l.time(cal.component(.hour, from: $0), cal.component(.minute, from: $0)) }
    var when: String? = due.map { date($0, l, today: today) }
    if let time, let remind {
      if due == nil || cal.isDate(remind, inSameDayAs: due!) {
        when = "\(when ?? date(remind, l, today: today)) \(time)"
      } else {
        when = "\(when!) · \(date(remind, l, today: today)) \(time)"
      }
    }
    if let when { out.append(Part(text: when, late: late)) }
    if late { out.append(Part(text: l.late(lateDays), late: true)) }
    return out
  }
}

extension L {
  var weekdays: String { pick("평일", "Weekdays", "平日", "工作日") }
  var weekends: String { pick("주말", "Weekends", "週末", "周末") }
  func daysShort(_ names: [String]) -> String { lang == "zh" ? "周" + names.joined(separator: "、") : names.joined(separator: "·") }
  func monthDay(_ m: Int, _ d: Int) -> String {
    let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    return pick("\(m)월 \(d)일", "\(months[m - 1]) \(d)", "\(m)月\(d)日", "\(m)月\(d)日")
  }
  func fullDate(_ y: Int, _ m: Int, _ d: Int) -> String {
    let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    return pick("\(y)년 \(m)월 \(d)일", "\(months[m - 1]) \(d), \(y)", "\(y)年\(m)月\(d)日", "\(y)年\(m)月\(d)日")
  }
  func time(_ h: Int, _ m: Int) -> String {
    let h12 = h % 12 == 0 ? 12 : h % 12
    let mm = String(format: "%02d", m)
    return pick("\(h < 12 ? "오전" : "오후") \(h12):\(mm)", "\(h12):\(mm) \(h < 12 ? "AM" : "PM")", "\(h < 12 ? "午前" : "午後")\(h12):\(mm)", "\(h < 12 ? "上午" : "下午")\(h12):\(mm)")
  }
  var memoPage: String { pick("메모 쪽", "Memo page", "メモのページ", "备忘页") }
  func todoPage(_ i: Int, _ n: Int) -> String { pick("할 일 \(i)/\(n)쪽", "To-dos page \(i) of \(n)", "ToDo \(n)ページ中\(i)ページ", "待办 第\(i)页，共\(n)页") }
  func readPage(_ i: Int, _ n: Int) -> String { pick("메모 \(i)/\(n)쪽", "Memo page \(i) of \(n)", "メモ \(n)ページ中\(i)ページ", "备忘 第\(i)页，共\(n)页") }
  func currentPage(_ label: String) -> String { pick("\(label), 지금 보는 쪽", "\(label), current page", "\(label)、表示中", "\(label)，当前页") }
  var expandMemo: String { pick("눌러서 메모 펼치기", "Tap to expand the memo", "タップでメモを広げる", "点按展开备忘") }
  var collapseMemo: String { pick("눌러서 메모 접기", "Tap to collapse the memo", "タップでメモを閉じる", "点按收起备忘") }
  var noTodosLeft: String { pick("남은 할 일이 없어요", "No to-dos left", "残りのToDoはありません", "没有剩余待办") }
  var emptyWidget: String { pick("비어 있어요. + 로 바로 적어 보세요", "Empty. Tap + to add one", "空です。+ で追加できます", "空空如也，点 + 添加") }
  var add: String { pick("추가", "Add", "追加", "添加") }
  var openApp: String { pick("modo 열기", "Open modo", "modoを開く", "打开 modo") }
  func folderTab(_ name: String) -> String { pick("\(name) 폴더", "\(name) folder", "\(name)フォルダ", "\(name)文件夹") }
  func currentFolderTab(_ name: String) -> String { pick("\(name) 폴더, 지금 보는 폴더", "\(name) folder, current", "\(name)フォルダ、表示中", "\(name)文件夹，当前") }
}

// MARK: - 그리기

struct NotesWidgetView: View {
  @Environment(\.widgetFamily) var family
  let entry: NotesEntry

  /// 대표색: src/brand.ts와 같은 값(src/__tests__/brand.test.ts가 확인). 예전 기본색은 앱처럼 대표색으로
  static let brand = "#85ADE2"
  var accent: Color {
    let hex = entry.snapshot?.prefs["accent"] as? String ?? Self.brand
    return Color(hex: ["#72CDF4", "#96D3FD", "#85ADE2"].filter { $0 != Self.brand }.contains(hex.uppercased()) ? Self.brand : hex)
  }
  /// 문구 언어: 앱 언어 설정 → 기기 언어 → 영어(NotesStore.L)
  var l: L { L.current(entry.snapshot?.prefs) }

  /// 할 일 동그라미(잠금화면): 반복 할 일은 원을 이루는 두 곡선 화살표, 완료는 채운 원 + 체크
  func checkSymbol(_ t: NotesStore.Todo) -> String {
    t.done ? "checkmark.circle.fill" : t.repeatFreq != nil ? "arrow.triangle.2.circlepath" : "circle"
  }

  var body: some View {
    let todos = entry.snapshot?.todos ?? []
    let memo = entry.snapshot?.memo ?? []
    switch family {
    case .accessoryInline:
      Text(todos.first(where: { !$0.done })?.text ?? l.noTodos)
        .containerBackground(Color(red: 0.106, green: 0.11, blue: 0.125).opacity(0.85), for: .widget)
    case .accessoryRectangular:
      // 잠금화면(시안): 심볼 + 폴더 이름 / 메모 한 줄 / 할 일 한 줄(누르면 잠금 해제 후 동작)
      VStack(alignment: .leading, spacing: 3) {
        HStack(spacing: 6) {
          MarkShape().stroke(style: StrokeStyle(lineWidth: 2.2, lineCap: .round, lineJoin: .round)).frame(width: 22, height: 8.3)
          Text(entry.snapshot?.folderName ?? l.baseFolder).font(.system(size: 14, weight: .bold)).lineLimit(1)
        }
        if let first = memo.first { Text(first).font(.system(size: 13)).lineLimit(1) }
        if let t = todos.first(where: { !$0.done }) {
          HStack(spacing: 6) {
            Image(systemName: checkSymbol(t)).font(.system(size: 12))
            Text(t.text).font(.system(size: 12)).lineLimit(1)
          }
        }
      }
      .containerBackground(Color(red: 0.106, green: 0.11, blue: 0.125).opacity(0.85), for: .widget)
    default:
      HomeWidgetView(entry: entry, l: l, mark: (entry.snapshot?.prefs["logoAccent"] as? Bool ?? true) ? accent : Color(hex: Self.brand))
        // 파란 기 없는 차콜, 반투명
        .containerBackground(Color(red: 42 / 255, green: 42 / 255, blue: 44 / 255).opacity(0.85), for: .widget)
    }
  }
}

/// 홈 화면 위젯 한 장(머리 · 쪽 내용 · 점과 +). 쪽 수는 위젯 크기와 실제 글꼴(시스템 글자 크기 반영)로 센다.
struct HomeWidgetView: View {
  @Environment(\.widgetFamily) var family
  let entry: NotesEntry
  let l: L
  let mark: Color
  @ScaledMetric(relativeTo: .body) var memoSize: CGFloat = 17
  @ScaledMetric(relativeTo: .body) var titleSize: CGFloat = 16
  @ScaledMetric(relativeTo: .footnote) var metaSize: CGFloat = 13

  // 여백·줄(pt). 쪽 계산이 기대는 값이라 아래 그리기와 함께 바꿀 것
  static let padH: CGFloat = 16
  static let padTop: CGFloat = 6
  static let padBottom: CGFloat = 4
  static let header: CGFloat = 28
  /// 폴더 탭 줄(크게만 따로, 중간은 로고 줄에). 탭 사이 tabGap
  static let tabs: CGFloat = 28
  static let tabGap: CGFloat = 18
  static let tabSize: CGFloat = 15
  static let footer: CGFloat = 28
  static let check: CGFloat = 44
  /// 제목과 보조 줄 사이(앱 카드·Android 위젯과 같이 0)
  static let metaGap: CGFloat = 0
  static let memoSpacing: CGFloat = 6
  /// 쪽 점 간격(시안 약 20). 양 끝 점은 바깥으로 dotEdge만큼 더 눌린다
  static let dot: CGFloat = 20
  static let dotEdge: CGFloat = 12
  static let slack: CGFloat = 2

  static let text = Color(white: 0.96)
  static let muted = Color(white: 0.64)
  static let circle = Color(white: 0.7)
  static let dotOff = Color(white: 0.45)
  static let late = Color(hex: "#FF6B6B")

  var folderParam: String { entry.folderId ?? FolderEntity.baseId }
  /// 중간 크기는 높이가 모자라(할 일 2줄) 폴더 탭을 로고 줄 오른쪽에
  var tabsInHeader: Bool { family == .systemMedium }

  /// 앞뒤의 빈 문단은 빼고(앱 미니창과 같다)
  static func trimBlank(_ paragraphs: [String]) -> [String] {
    let blank: (String) -> Bool = { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    guard let a = paragraphs.firstIndex(where: { !blank($0) }), let b = paragraphs.lastIndex(where: { !blank($0) }) else { return [] }
    return Array(paragraphs[a...b])
  }

  var body: some View {
    GeometryReader { geo in content(geo.size) }
  }

  @ViewBuilder
  func content(_ size: CGSize) -> some View {
    let s = entry.snapshot
    let paragraphs = s?.memo ?? []
    let full = Self.trimBlank(paragraphs).joined(separator: "\n")
    let preview = paragraphs.flatMap { $0.components(separatedBy: "\n") }.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }.joined(separator: "\n")
    let todos = s?.todos ?? []
    let width = size.width - Self.padH * 2
    let area = size.height - Self.padTop - Self.padBottom - Self.header - Self.footer - (tabsInHeader ? 0 : Self.tabs)
    let font = UIFont.systemFont(ofSize: memoSize)
    let pages = MemoPages.split(full, font: font, spacing: Self.memoSpacing, width: width, height: area - Self.slack)
    let previewLines = MemoPages.split(preview, font: font, spacing: Self.memoSpacing, width: width, height: area - Self.slack).first?.lines ?? 0
    let rowH = max(Self.check, ceil(UIFont.systemFont(ofSize: titleSize).lineHeight + Self.metaGap + UIFont.systemFont(ofSize: metaSize).lineHeight))
    let perPage = max(1, Int((area - Self.slack) / rowH))
    // 남는 높이(한 줄이 안 되는 만큼)는 줄마다 나눠 마지막 할 일과 점이 멀어지지 않게(한 줄에 최대 16)
    let rowFill = min(rowH + 16, (area - Self.slack) / CGFloat(perPage))
    let hasMemo = !pages.isEmpty
    let first = hasMemo ? 1 : 0
    let todoPages = max(1, (todos.count + perPage - 1) / perPage)
    let total = first + todoPages
    let reading = hasMemo && entry.view.reading
    // 완료·삭제·동기화로 쪽이 줄었으면 남은 마지막 쪽(다음에 점을 누르면 그 값이 저장된다)
    let page = min(max(entry.view.page, 0), total - 1)
    let readPage = min(max(entry.view.readPage, 0), max(pages.count - 1, 0))
    let todoPage = !reading && page >= first ? page - first : -1

    VStack(alignment: .leading, spacing: 0) {
      headerRow(width).frame(height: Self.header)
      if !tabsInHeader { tabRow(width).frame(height: Self.tabs) }
      Group {
        if reading {
          memoButton(String((full as NSString).substring(with: pages[readPage].range)), lines: pages[readPage].lines, hint: l.collapseMemo)
        } else if todoPage < 0 {
          memoButton(preview, lines: previewLines, hint: l.expandMemo)
        } else {
          let slice = Array(todos.dropFirst(todoPage * perPage).prefix(perPage))
          if slice.isEmpty {
            Text(hasMemo ? l.noTodosLeft : l.emptyWidget).font(.system(size: 14)).foregroundStyle(Self.muted)
              .frame(maxWidth: .infinity, maxHeight: .infinity)
          } else {
            VStack(spacing: 0) {
              ForEach(slice) { t in row(t, height: rowFill) }
              Spacer(minLength: 0)
            }
          }
        }
      }
      .frame(width: width, height: area, alignment: .topLeading)
      footer(reading: reading, pages: reading ? pages.count : total, current: reading ? readPage : page, memoFirst: first, todoPages: todoPages, showAdd: todoPage >= 0, width: width)
        .frame(height: Self.footer)
    }
    .padding(.horizontal, Self.padH)
    .padding(.top, Self.padTop)
    .padding(.bottom, Self.padBottom)
  }

  static let markW: CGFloat = 15 * 1148.5 / 432

  /// 머리: 로고 + modo(앱의 그 폴더). 중간 크기는 오른쪽에 폴더 탭
  func headerRow(_ width: CGFloat) -> some View {
    let brandW = Self.markW + 8 + ceil(("modo" as NSString).size(withAttributes: [.font: UIFont.systemFont(ofSize: 18, weight: .medium)]).width)
    return HStack(spacing: 0) {
      Link(destination: URL(string: "naegirok://?folder=\(folderParam)")!) {
        HStack(spacing: 8) {
          // 예전 머리(글자 17에 심볼 높이 ×1.1, 선 ×0.42)와 같은 비율로 높이 15
          MarkShape().stroke(mark, style: StrokeStyle(lineWidth: 15 / 1.1 * 0.42 * 145.5 / 432, lineCap: .round, lineJoin: .round))
            .frame(width: Self.markW, height: 15)
          Text("modo").font(.system(size: 18, weight: .medium)).foregroundStyle(Self.text)
        }
      }
      .accessibilityLabel(l.openApp)
      if tabsInHeader {
        tabRow(width - brandW - Self.tabGap).padding(.leading, Self.tabGap)
      }
      Spacer(minLength: 0)
    }
  }

  /// 폴더 탭(앱과 같이: 글자만, 지금 폴더는 굵은 흰 글자). 누르면 그 폴더의 첫 쪽. 폭이 모자라면 지금 폴더가 보이게 그 근처만(Android와 같은 규칙)
  func tabRow(_ room: CGFloat) -> some View {
    let all: [(id: String, name: String)] = [(FolderEntity.baseId, l.baseFolder)] + entry.folders.map { ($0.id, $0.name) }
    let cur = all.firstIndex(where: { $0.id == folderParam }) ?? 0
    let widths = all.enumerated().map { i, f in
      ceil((f.name as NSString).size(withAttributes: [.font: UIFont.systemFont(ofSize: Self.tabSize, weight: i == cur ? .bold : .regular)]).width) + Self.tabGap
    }
    var first = cur
    var last = cur
    var used = widths[cur]
    while true {
      let right = last + 1 < all.count && used + widths[last + 1] <= room
      if right { last += 1; used += widths[last] }
      let left = first > 0 && used + widths[first - 1] <= room
      if left { first -= 1; used += widths[first] }
      if !right && !left { break }
    }
    return HStack(spacing: 0) {
      ForEach(first...last, id: \.self) { i in
        let sel = i == cur
        Button(intent: WidgetFolderIntent(tabKey: entry.tabKey, folder: all[i].id, viewKey: "\(all[i].id)|\(entry.family)")) {
          Text(all[i].name).font(.system(size: Self.tabSize, weight: sel ? .bold : .regular)).foregroundStyle(sel ? Self.text : Self.muted).lineLimit(1)
            .padding(.trailing, Self.tabGap)
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(sel ? l.currentFolderTab(all[i].name) : l.folderTab(all[i].name))
      }
      Spacer(minLength: 0)
    }
  }

  func memoButton(_ body: String, lines: Int, hint: String) -> some View {
    Button(intent: WidgetMemoIntent(key: entry.key)) {
      Text(body)
        .font(.system(size: memoSize))
        .lineSpacing(Self.memoSpacing)
        .lineLimit(max(lines, 1))
        .truncationMode(.tail)
        .foregroundStyle(Self.text)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel("\(body). \(hint)")
  }

  /// 할 일 한 줄(상자·구분선 없음). 보조 줄이 있든 없든 같은 높이, 제목만이면 세로 가운데
  func row(_ t: NotesStore.Todo, height: CGFloat) -> some View {
    HStack(spacing: 6) {
      Button(intent: ToggleTodoIntent(todoId: t.id, done: true)) {
        Group {
          if t.repeatFreq != nil {
            RepeatRing().frame(width: 24, height: 24)
          } else {
            Circle().stroke(Self.circle, lineWidth: 1.6).frame(width: 22.4, height: 22.4)
          }
        }
        .frame(width: Self.check, height: Self.check)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .padding(.leading, -10)
      .accessibilityLabel(l.markDone(t.text))
      Link(destination: URL(string: "naegirok://?folder=\(folderParam)&edit=\(t.id)")!) {
        VStack(alignment: .leading, spacing: Self.metaGap) {
          Text(t.text).font(.system(size: titleSize)).foregroundStyle(Self.text).lineLimit(1)
          let parts = CardMeta.parts(t, l)
          if !parts.isEmpty {
            parts.enumerated().reduce(Text("")) { acc, item in
              let piece = Text(item.element.text).foregroundColor(item.element.late ? Self.late : Self.muted)
              return item.offset == 0 ? piece : acc + Text("  ·  ").foregroundColor(Self.muted) + piece
            }
            .font(.system(size: metaSize)).lineLimit(1)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
    .frame(height: height)
  }

  /// 쪽 점(시안처럼 20pt 간격, 누르는 곳 20×28pt·양 끝 32×28pt, 겹치지 않음) · +(할 일 쪽에서만). 쪽이 많으면 지금 쪽 근처만 그리고 양 끝을 작게
  func footer(reading: Bool, pages: Int, current: Int, memoFirst: Int, todoPages: Int, showAdd: Bool, width: CGFloat) -> some View {
    let maxDots = min(7, max(3, Int((width - 2 * 44 - 2 * Self.dotEdge) / Self.dot)))
    let start = pages <= maxDots ? 0 : min(max(current - maxDots / 2, 0), pages - maxDots)
    let window = Array(start..<min(pages, start + maxDots))
    return ZStack {
      if pages > 1 {
        HStack(spacing: 0) {
          ForEach(window, id: \.self) { i in
            let edge = (i == window.first && i > 0) || (i == window.last && i < pages - 1)
            let label = reading ? l.readPage(i + 1, pages) : (i < memoFirst ? l.memoPage : l.todoPage(i - memoFirst + 1, todoPages))
            Button(intent: WidgetPageIntent(key: entry.key, reading: reading, page: i)) {
              Circle().fill(i == current ? Self.text : Self.dotOff)
                .frame(width: edge ? 5 : 7, height: edge ? 5 : 7)
                .frame(width: Self.dot, height: Self.footer)
                // 양 끝 점은 바깥으로 더 눌리게(점 자리는 그대로)
                .padding(.leading, i == window.first ? Self.dotEdge : 0)
                .padding(.trailing, i == window.last ? Self.dotEdge : 0)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(i == current ? l.currentPage(label) : label)
          }
        }
      }
      if showAdd {
        HStack {
          Spacer()
          Link(destination: URL(string: "naegirok://quickadd" + (entry.folderId.map { "?folder=\($0)" } ?? ""))!) {
            Image(systemName: "plus").font(.system(size: 18, weight: .regular)).foregroundStyle(Self.text)
              .frame(width: 44, height: Self.footer)
          }
          .accessibilityLabel(l.add)
        }
      }
    }
    .frame(maxWidth: .infinity)
  }
}

/// 반복 할 일 동그라미: 원 테두리 자체가 시계 방향 두 곡선 화살표(앱 Icons.tsx RepeatRingIcon과 같은 수치)
struct RepeatRing: View {
  var body: some View {
    ZStack {
      RepeatRingArcs().stroke(HomeWidgetView.circle, style: StrokeStyle(lineWidth: 1.6, lineCap: .round))
      RepeatRingHeads().fill(HomeWidgetView.circle)
    }
  }
}

private func ringPoint(_ rect: CGRect, _ deg: Double, inset: CGFloat = 0.8) -> CGPoint {
  let r = min(rect.width, rect.height) / 2 - inset
  let a = deg * .pi / 180
  return CGPoint(x: rect.midX + r * CGFloat(sin(a)), y: rect.midY - r * CGFloat(cos(a)))
}

private let ringArc = 138.0

struct RepeatRingArcs: Shape {
  func path(in rect: CGRect) -> Path {
    var p = Path()
    // 12시에서 시계 방향 각도로 점을 이어 호를 그린다(좌표계 방향에 기대지 않게)
    for from in [220.0, 40.0] {
      p.move(to: ringPoint(rect, from))
      for i in 1...48 { p.addLine(to: ringPoint(rect, from + ringArc * Double(i) / 48)) }
    }
    return p
  }
}

struct RepeatRingHeads: Shape {
  func path(in rect: CGRect) -> Path {
    var p = Path()
    let size = min(rect.width, rect.height)
    let r = size / 2 - 0.8
    let head = max(size * 0.17, 1.6 * 2.3)
    let half = max(size * 0.12, 1.6 * 1.5)
    for from in [220.0, 40.0] {
      let to = from + ringArc
      let base = ringPoint(rect, to)
      let tip = ringPoint(rect, to + Double(head / r) * 180 / .pi)
      let a = to * .pi / 180
      let nx = CGFloat(sin(a)) * half
      let ny = -CGFloat(cos(a)) * half
      p.move(to: tip)
      p.addLine(to: CGPoint(x: base.x + nx, y: base.y + ny))
      p.addLine(to: CGPoint(x: base.x - nx, y: base.y - ny))
      p.closeSubpath()
    }
    return p
  }
}

/// modo 심볼(m + 체크): 받은 로고를 맞춘 선 경로(앱의 Logo.tsx와 같은 수치)를 상자에 맞춰 그린다.
struct MarkShape: Shape {
  func path(in rect: CGRect) -> Path {
    let x0 = 51.8, y0 = 438.8, w = 1148.5, h = 432.0
    let s = min(rect.width / w, rect.height / h)
    func p(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: rect.minX + (x - x0) * s, y: rect.minY + (y - y0) * s) }
    let r = 173.5
    var path = Path()
    path.move(to: p(298 - r, 794.45)); path.addLine(to: p(298 - r, 764.5))
    path.addArc(center: p(298, 764.5), radius: r * s, startAngle: .degrees(180), endAngle: .degrees(0), clockwise: false)
    path.addLine(to: p(298 + r, 796.25))
    path.move(to: p(669.5 - r, 796.25)); path.addLine(to: p(669.5 - r, 764.5))
    path.addArc(center: p(669.5, 764.5), radius: r * s, startAngle: .degrees(180), endAngle: .degrees(0), clockwise: false)
    path.addLine(to: p(669.5 + r, 779.5)); path.addLine(to: p(883, 798)); path.addLine(to: p(1127.5, 511.5))
    return path
  }
}

struct NotesWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: "ModoNotes", intent: NotesConfigIntent.self, provider: NotesProvider()) { entry in
      NotesWidgetView(entry: entry)
    }
    .configurationDisplayName("modo")
    .description(Text(verbatim: L.current(nil).tagline))
    // 홈: 중간 이상(머리 + 할 일 2줄 + 점 줄). 잠금화면은 그대로
    .supportedFamilies([.systemMedium, .systemLarge, .accessoryRectangular, .accessoryInline])
    .contentMarginsDisabled()
  }
}

/// 제어 센터·잠금화면 컨트롤(iOS 18): 누르면 앱의 빠른 추가 화면
@available(iOS 18.0, *)
struct OpenQuickAddIntent: AppIntent {
  static var title: LocalizedStringResource = "빠른 추가"
  static var openAppWhenRun = true
  func perform() async throws -> some IntentResult & OpensIntent {
    .result(opensIntent: OpenURLIntent(URL(string: "naegirok://quickadd")!))
  }
}

@available(iOS 18.0, *)
struct QuickAddControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "ModoQuickAdd") {
      ControlWidgetButton(action: OpenQuickAddIntent()) {
        Label(L.current(nil).quickAdd, systemImage: "plus.square")
      }
    }
    .displayName(LocalizedStringResource(stringLiteral: L.current(nil).quickAdd))
  }
}

@main
struct ModoWidgets: WidgetBundle {
  var body: some Widget {
    NotesWidget()
    if #available(iOS 18.0, *) { QuickAddControl() }
  }
}

extension Color {
  init(hex: String) {
    var v: UInt64 = 0
    Scanner(string: hex.replacingOccurrences(of: "#", with: "")).scanHexInt64(&v)
    self.init(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
  }
}
