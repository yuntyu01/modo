import Foundation
import SQLite3
import UserNotifications

/// 앱(JS, expo-sqlite)과 같은 SQLite 파일을 App Group 컨테이너에서 연다.
/// 스키마는 app/src/core/schema.ts, 쓰기 규칙(outbox 포함)은 Android NotesDb.kt와 같다.
/// 이 파일은 위젯 확장(targets/widget)에도 심볼릭 링크로 들어간다.
public enum NotesStore {
  public static let appGroup = "group.com.yuntyu01.naegirok"

  public struct Todo: Identifiable, Hashable {
    public let id: String
    public let text: String
    public let doneAt: Int64?
    public let due: String?
    public var remindAt: Int64? = nil
    /// 반복(core/repeat.ts와 같은 규칙). 반복이면 due가 다음 예정일
    public var repeatFreq: String? = nil
    public var repeatDays: Int? = nil
    public var done: Bool { doneAt != nil }
  }

  public struct Snapshot {
    public var folderName: String?
    public var memo: [String]
    public var todos: [Todo]
    public var prefs: [String: Any]
    public var folderCount: Int = 0
    /// 로그인해 있는지. 아니면 위젯은 내용 없이 안내만(누르면 앱의 로그인 화면)
    public var signedIn: Bool = true
    /// 위젯 점(•••)용: 지금 폴더의 자리(0 = 기본)
    public var pageIndex: Int = 0
  }

  // 위젯 폴더 넘기기: 기본 → 폴더들 → 다시 기본. 위젯(StaticConfiguration)은 개별 식별자가 없어 하나를 함께 쓴다.
  static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }
  public static var widgetFolder: String? { defaults?.string(forKey: "widgetFolder") }

  public static func stepWidgetFolder(_ step: Int) {
    guard let db = open() else { return }
    defer { sqlite3_close(db) }
    var pages: [String?] = [nil]
    query(db, "SELECT id FROM folders WHERE deleted_at IS NULL ORDER BY position, id") { st in pages.append(text(st, 0)) }
    let cur = pages.firstIndex(where: { $0 == widgetFolder }) ?? 0
    let next = pages[((cur + step) % pages.count + pages.count) % pages.count]
    if let next { defaults?.set(next, forKey: "widgetFolder") } else { defaults?.removeObject(forKey: "widgetFolder") }
  }

  public struct Folder: Hashable {
    public let id: String
    public let name: String
  }

  /// 위젯 설정(폴더 고르기)에 보일 폴더들(앱의 폴더 순서)
  public static func folders() -> [Folder] {
    guard let db = open() else { return [] }
    defer { sqlite3_close(db) }
    var out: [Folder] = []
    query(db, "SELECT id, name FROM folders WHERE deleted_at IS NULL ORDER BY position, id") { st in
      if let id = text(st, 0) { out.append(Folder(id: id, name: text(st, 1) ?? "")) }
    }
    return out
  }

  /// 홈 위젯 보는 상태: 기본 모드의 쪽(메모가 있으면 0 = 메모, 다음부터 할 일), 메모 읽기 모드와 그 쪽.
  /// WidgetKit은 위젯 하나하나를 가리키는 값을 주지 않아 (폴더, 크기)마다 둔다: 다른 폴더·다른 크기 위젯끼리는 서로 바꾸지 않는다.
  public struct WidgetView: Codable, Equatable {
    public var page = 0
    public var reading = false
    public var readPage = 0
    public init() {}
  }

  public static func widgetView(_ key: String) -> WidgetView {
    guard let d = defaults?.data(forKey: "widgetView." + key), let v = try? JSONDecoder().decode(WidgetView.self, from: d) else { return WidgetView() }
    return v
  }

  public static func setWidgetView(_ key: String, _ v: WidgetView) {
    if let d = try? JSONEncoder().encode(v) { defaults?.set(d, forKey: "widgetView." + key) }
  }

  /// 홈 위젯 폴더 탭으로 고른 폴더("base" = 기본). 열쇠 = (위젯 편집에서 고른 폴더, 크기): 편집에서 폴더를 바꾸면 그 폴더부터 다시 보인다.
  /// nil = 탭을 누른 적 없음(편집에서 고른 폴더)
  public static func widgetTab(_ key: String) -> String? { defaults?.string(forKey: "widgetTab." + key) }

  public static func setWidgetTab(_ key: String, _ folder: String) { defaults?.set(folder, forKey: "widgetTab." + key) }

  static var url: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?.appendingPathComponent("naegirok.db")
  }

  static func open() -> OpaquePointer? {
    guard let url, FileManager.default.fileExists(atPath: url.path) else { return nil }
    var db: OpaquePointer?
    guard sqlite3_open_v2(url.path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK, let db else { return nil }
    sqlite3_busy_timeout(db, 3000)
    ensureSchema(db)
    return db
  }

  /// 영구 삭제 표시 열(purged)이 아직 있으면(앱이 v4로 옮기기 전) 그 행을 빼는 조건. 앱이 옮긴 뒤에는 열이 없다.
  /// 앱이 언제 옮길지 몰라 DB를 열 때마다 다시 본다(Android NotesDb.live와 같다).
  nonisolated(unsafe) static var live = ""

  /// 앱을 업데이트한 뒤 앱보다 위젯이 먼저 DB를 열 수 있어 앱(schema.ts MIGRATE_V3)과 같은 열을 맞춘다.
  private static func ensureSchema(_ db: OpaquePointer) {
    var cols: [String] = []
    query(db, "PRAGMA table_info(todos)") { st in if let n = text(st, 1) { cols.append(n) } }
    live = cols.contains("purged") ? " AND purged = 0" : ""
    // 루틴을 한 날 기록(schema.ts MIGRATE_V5)
    if !cols.isEmpty, !cols.contains("done_log") { exec(db, "ALTER TABLE todos ADD COLUMN done_log TEXT") }
    guard !cols.isEmpty, !cols.contains("repeat_freq") else { return }
    exec(db, "ALTER TABLE todos ADD COLUMN repeat_freq TEXT CHECK (repeat_freq IN ('daily', 'weekly', 'monthly'))")
    exec(db, "ALTER TABLE todos ADD COLUMN repeat_days INTEGER CHECK (repeat_days BETWEEN 1 AND 127)")
  }

  private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

  private static func query(_ db: OpaquePointer, _ sql: String, _ args: [Any?] = [], _ row: (OpaquePointer) -> Void) {
    var st: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &st, nil) == SQLITE_OK, let st else { return }
    defer { sqlite3_finalize(st) }
    bind(st, args)
    while sqlite3_step(st) == SQLITE_ROW { row(st) }
  }

  /// 문장이 끝까지 실행됐는지. BEGIN IMMEDIATE는 앱이 쓰는 중이면 busy_timeout 뒤 실패할 수 있어 결과를 보고 쓰기를 포기한다
  /// (예전엔 결과를 버려 트랜잭션 없이 UPDATE가 나가거나 outbox 없이 행만 바뀔 수 있었다)
  @discardableResult
  private static func exec(_ db: OpaquePointer, _ sql: String, _ args: [Any?] = []) -> Bool {
    var st: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &st, nil) == SQLITE_OK, let st else { return false }
    defer { sqlite3_finalize(st) }
    bind(st, args)
    return sqlite3_step(st) == SQLITE_DONE
  }

  private static func bind(_ st: OpaquePointer, _ args: [Any?]) {
    for (i, a) in args.enumerated() {
      let idx = Int32(i + 1)
      switch a {
      case let v as String: sqlite3_bind_text(st, idx, v, -1, transient)
      case let v as Int64: sqlite3_bind_int64(st, idx, v)
      case let v as Int: sqlite3_bind_int64(st, idx, Int64(v))
      default: sqlite3_bind_null(st, idx)
      }
    }
  }

  private static func text(_ st: OpaquePointer, _ i: Int32) -> String? {
    guard let c = sqlite3_column_text(st, i) else { return nil }
    return String(cString: c)
  }

  public static func snapshot(folderId: String?, limit: Int = 300) -> Snapshot? {
    guard let db = open() else { return nil }
    defer { sqlite3_close(db) }
    var s = Snapshot(folderName: nil, memo: [], todos: [], prefs: [:])
    query(db, "SELECT value FROM kv WHERE key = 'prefs'") { st in
      if let t = text(st, 0), let d = t.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] { s.prefs = o }
    }
    if !signedIn(db) {
      s.signedIn = false
      return s
    }
    // folderId nil = 기본 폴더(폴더 없음 또는 없어진 폴더를 가리키는 항목). 지워진 폴더를 가리키면 기본으로.
    if let folderId {
      query(db, "SELECT name FROM folders WHERE id = ? AND deleted_at IS NULL", [folderId]) { st in s.folderName = text(st, 0) }
    }
    let fid = s.folderName == nil ? nil : folderId
    let folderWhere = fid == nil
      ? " AND (folder_id IS NULL OR folder_id NOT IN (SELECT id FROM folders WHERE deleted_at IS NULL))"
      : " AND folder_id = ?"
    let args: [Any?] = fid == nil ? [] : [fid]
    var ids: [String] = []
    query(db, "SELECT id FROM folders WHERE deleted_at IS NULL ORDER BY position, id") { st in if let t = text(st, 0) { ids.append(t) } }
    s.folderCount = ids.count
    s.pageIndex = fid.flatMap { ids.firstIndex(of: $0).map { $0 + 1 } } ?? 0
    query(db, "SELECT text FROM paragraphs WHERE deleted_at IS NULL\(live)\(folderWhere) ORDER BY position, id", args) { st in
      s.memo.append(text(st, 0) ?? "")
    }
    // 위젯은 남은 할 일만 보여 준다(시안). 완료한 것은 앱에서 본다.
    // 완료: done_at이 있고, 반복이면 다음 예정일이 아직 안 왔을 때만(체크하면 그날까지 완료, 그날이 되면 다시 할 일 — 앱 repo.isDoneNow와 같다).
    // 앞날에 시작하는 반복도 보인다(그날까지 숨기던 규칙은 뺐다, 앱과 같다).
    let doneNow = "(done_at IS NOT NULL AND NOT (repeat_freq IS NOT NULL AND due_date IS NOT NULL AND due_date <= ?))"
    let doneWhere = " AND NOT \(doneNow)"
    let today = Repeat.format(Date())
    var todoArgs: [Any?] = [today]
    todoArgs += args
    todoArgs += [today]
    query(db, "SELECT id, text, CASE WHEN \(doneNow) THEN done_at END, due_date, remind_at, repeat_freq, repeat_days FROM todos WHERE deleted_at IS NULL\(live)\(folderWhere)\(doneWhere) ORDER BY position, id LIMIT \(limit)", todoArgs) { st in
      s.todos.append(Todo(
        id: text(st, 0) ?? "", text: text(st, 1) ?? "",
        doneAt: sqlite3_column_type(st, 2) == SQLITE_NULL ? nil : sqlite3_column_int64(st, 2),
        due: text(st, 3),
        remindAt: sqlite3_column_type(st, 4) == SQLITE_NULL ? nil : sqlite3_column_int64(st, 4),
        repeatFreq: text(st, 5),
        repeatDays: sqlite3_column_type(st, 6) == SQLITE_NULL ? nil : Int(sqlite3_column_int64(st, 6))))
    }
    return s
  }

  public static func pendingReminders(now: Int64) -> [(id: String, text: String, at: Int64)] {
    guard let db = open() else { return [] }
    defer { sqlite3_close(db) }
    // 로그아웃했으면 걸어 둔 알림을 모두 내린다(scheduleAll이 목록에 없는 것을 지운다)
    if !signedIn(db) { return [] }
    var out: [(String, String, Int64)] = []
    // 반복은 알림이 다음 회차 것이라 완료 표시와 상관없이 예약한다
    query(db, "SELECT id, text, remind_at FROM todos WHERE remind_at > ? AND (done_at IS NULL OR repeat_freq IS NOT NULL) AND deleted_at IS NULL\(live)", [now]) { st in
      out.append((text(st, 0) ?? "", text(st, 1) ?? "", sqlite3_column_int64(st, 2)))
    }
    return out.map { (id: $0.0, text: $0.1, at: $0.2) }
  }

  /// 보기 전용으로 공유받은 폴더의 할 일인지(Android NotesDb.todoViewOnly와 같다). 바꾸면 서버가 거절하고, 그 거절로 앱이 모든 항목을
  /// 처음부터 다시 받았다. 공유 표가 아직 없으면(앱을 한 번도 안 켠 새 설치) query가 아무것도 읽지 않아 보기 전용도 없다.
  /// 이 기기에 로그인해 있는지(앱 kv 'account'에 토큰이 있는지, Android NotesDb.signedIn과 같다). 로그인해야 쓸 수 있어서
  /// 로그인하지 않았으면 위젯은 안내만 보이고 체크·알림 예약도 하지 않는다.
  private static func signedIn(_ db: OpaquePointer) -> Bool {
    var ok = false
    query(db, "SELECT value FROM kv WHERE key = 'account'") { st in
      if let t = text(st, 0), let d = t.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
        let token = o["token"] as? String, !token.isEmpty { ok = true }
    }
    return ok
  }

  private static func todoViewOnly(_ db: OpaquePointer, _ id: String) -> Bool {
    var hit = false
    query(db, "SELECT 1 FROM todos t JOIN shared_folders s ON s.folder_id = t.folder_id WHERE t.id = ? AND s.role = 'view' LIMIT 1", [id]) { _ in hit = true }
    return hit
  }

  /// 완료/완료 취소. 완료 시각만 바꾸고 outbox에 남겨 앱이 동기화한다.
  public static func setDone(id: String, done: Bool) {
    guard let db = open() else { return }
    defer { sqlite3_close(db) }
    if todoViewOnly(db, id) || !signedIn(db) { return }
    let now = Int64(Date().timeIntervalSince1970 * 1000)
    guard exec(db, "BEGIN IMMEDIATE") else { return }
    var cur: Int64?? = .none
    query(db, "SELECT done_at FROM todos WHERE id = ?", [id]) { st in
      cur = .some(sqlite3_column_type(st, 0) == SQLITE_NULL ? nil : sqlite3_column_int64(st, 0))
    }
    guard case let .some(old) = cur, (old != nil) != done else { exec(db, "ROLLBACK"); return }
    let next: Int64? = done ? now : nil
    exec(db, "UPDATE todos SET done_at = ? WHERE id = ?", [next, id])
    enqueue(db, entity: "todo", id: id, create: false, fields: ["done_at": ["old": old as Any? ?? NSNull(), "new": next as Any? ?? NSNull()]], now: now)
    exec(db, "COMMIT")
  }

  /// 체크 풀기. 반복이 아니면 완료 취소, 이번 회차를 끝내 둔 반복이면 오늘 할 일로 되돌리고 '한 날' 기록에서 오늘을 뺀다(Android NotesDb.uncheck와 같다).
  public static func uncheck(id: String) {
    guard let db = open() else { return }
    defer { sqlite3_close(db) }
    if todoViewOnly(db, id) || !signedIn(db) { return }
    var found = false
    var freq: String?, due: String?, remind: Int64?, doneAt: Int64?, log: String?, updated: Int64 = 0
    guard exec(db, "BEGIN IMMEDIATE") else { return }
    query(db, "SELECT repeat_freq, due_date, remind_at, done_at, done_log, updated_at FROM todos WHERE id = ?", [id]) { st in
      found = true
      freq = text(st, 0)
      due = text(st, 1)
      remind = sqlite3_column_type(st, 2) == SQLITE_NULL ? nil : sqlite3_column_int64(st, 2)
      doneAt = sqlite3_column_type(st, 3) == SQLITE_NULL ? nil : sqlite3_column_int64(st, 3)
      log = text(st, 4)
      updated = sqlite3_column_int64(st, 5)
    }
    guard found else { exec(db, "ROLLBACK"); return }
    // 반복이 아니면 완료 취소만(setDone은 따로 열고 잠그니 먼저 놓는다)
    guard freq != nil else { exec(db, "ROLLBACK"); return setDone(id: id, done: false) }
    let now = Int64(Date().timeIntervalSince1970 * 1000)
    let today = Repeat.startOfDay(Date())
    let todayText = Repeat.format(today)
    let from = due.flatMap { Repeat.parse($0) } ?? today
    let newRemind = remind.map { Repeat.shift($0, from: from, to: today) }
    let days = (log ?? "").split(separator: ",").map(String.init).filter { $0.count == 10 && $0 != todayText }
    let newLog: String? = days.isEmpty ? nil : days.sorted().suffix(400).joined(separator: ",")
    // 예정일이 바뀌니 '마지막 수정'도 바꾼다(앱 reopenRepeat·Android uncheck와 같은 규칙)
    exec(db, "UPDATE todos SET done_at = NULL, due_date = ?, remind_at = ?, done_log = ?, updated_at = ? WHERE id = ?", [todayText, newRemind, newLog, now, id])
    var fields: [String: Any] = [
      "done_at": ["old": doneAt as Any? ?? NSNull(), "new": NSNull()],
      "due_date": ["old": due as Any? ?? NSNull(), "new": todayText],
      "done_log": ["old": log as Any? ?? NSNull(), "new": newLog as Any? ?? NSNull()],
      "updated_at": ["old": updated, "new": now],
    ]
    if newRemind != remind { fields["remind_at"] = ["old": remind as Any? ?? NSNull(), "new": newRemind as Any? ?? NSNull()] }
    enqueue(db, entity: "todo", id: id, create: false, fields: fields, now: now)
    exec(db, "COMMIT")
  }

  /// 동그라미를 눌렀을 때. 반복이 아니면 완료, 반복이면 다음 예정일로 넘기고 알림도 같은 날만큼 옮긴다(Android NotesDb.complete와 같다).
  public static func complete(id: String) {
    guard let db = open() else { return }
    defer { sqlite3_close(db) }
    if todoViewOnly(db, id) || !signedIn(db) { return }
    let now = Int64(Date().timeIntervalSince1970 * 1000)
    var found = false
    var freq: String?, days: Int?, due: String?, remind: Int64?, updated: Int64 = 0, doneAt: Int64?, log: String?
    // 읽기도 트랜잭션 안에서(예전엔 읽고 나서 BEGIN해, 그 사이 앱이 고친 값을 덮어썼다)
    guard exec(db, "BEGIN IMMEDIATE") else { return }
    query(db, "SELECT repeat_freq, repeat_days, due_date, remind_at, updated_at, done_at, done_log FROM todos WHERE id = ?", [id]) { st in
      found = true
      freq = text(st, 0)
      days = sqlite3_column_type(st, 1) == SQLITE_NULL ? nil : Int(sqlite3_column_int64(st, 1))
      due = text(st, 2)
      remind = sqlite3_column_type(st, 3) == SQLITE_NULL ? nil : sqlite3_column_int64(st, 3)
      updated = sqlite3_column_int64(st, 4)
      doneAt = sqlite3_column_type(st, 5) == SQLITE_NULL ? nil : sqlite3_column_int64(st, 5)
      log = text(st, 6)
    }
    guard found else { exec(db, "ROLLBACK"); return }
    // 반복이 아니면 완료만(setDone은 따로 열고 잠그니 먼저 놓는다)
    guard let freq else { exec(db, "ROLLBACK"); return setDone(id: id, done: true) }
    let today = Repeat.startOfDay(Date())
    let dueDate = due.flatMap(Repeat.parse)
    // 이번 회차를 이미 끝냈으면(다음 예정일 전) 그대로: 위젯이 옛 화면을 보여 주다 눌리면 다음 회차까지 한 번 더 넘겼다
    if doneAt != nil, let dueDate, dueDate > today { exec(db, "ROLLBACK"); return }
    let next = Repeat.nextDue(freq: freq, days: freq == "weekly" ? days : nil, due: dueDate, today: today)
    let nextText = Repeat.format(next)
    var newRemind: Int64? = nil
    if let remind {
      let from = dueDate ?? Repeat.startOfDay(Date(timeIntervalSince1970: TimeInterval(remind) / 1000))
      newRemind = Repeat.shift(remind, from: from, to: next)
    }
    // 이번 회차 완료: 다음 예정일까지는 완료로 남고, 오늘을 '한 날'로 남긴다(앱 core/doneLog.ts와 같은 모양)
    var dayset = Set((log ?? "").split(separator: ",").map(String.init).filter { $0.count == 10 })
    dayset.insert(Repeat.format(Date()))
    let newLog = dayset.sorted().suffix(400).joined(separator: ",")
    exec(db, "UPDATE todos SET due_date = ?, remind_at = ?, done_at = ?, done_log = ?, updated_at = ? WHERE id = ?", [nextText, newRemind, now, newLog, now, id])
    var fields: [String: Any] = [
      "due_date": ["old": due as Any? ?? NSNull(), "new": nextText],
      "done_at": ["old": doneAt as Any? ?? NSNull(), "new": now],
      "done_log": ["old": log as Any? ?? NSNull(), "new": newLog],
      "updated_at": ["old": updated, "new": now],
    ]
    if newRemind != remind { fields["remind_at"] = ["old": remind as Any? ?? NSNull(), "new": newRemind as Any? ?? NSNull()] }
    enqueue(db, entity: "todo", id: id, create: false, fields: fields, now: now)
    exec(db, "COMMIT")
  }

  private static func enqueue(_ db: OpaquePointer, entity: String, id: String, create: Bool, fields: [String: Any], now: Int64) {
    guard let data = try? JSONSerialization.data(withJSONObject: fields), let json = String(data: data, encoding: .utf8) else { return }
    exec(db, "INSERT INTO outbox (op_id, entity, entity_id, is_create, fields, created_at) VALUES (?, ?, ?, ?, ?, ?)",
         [UUID().uuidString.lowercased(), entity, id, create ? 1 : 0, json, now])
  }
}

/// 반복 할 일의 날짜 규칙. app/src/core/repeat.ts, Android Repeat.kt와 같다(바꾸면 함께 바꿀 것).
public enum Repeat {
  // 한 번만 만든다(예전엔 쓸 때마다 새로 만들어 nextDue의 400번 반복에서도 만들었다). 시간대가 바뀌면 따라간다
  static let cal: Calendar = { var c = Calendar(identifier: .gregorian); c.timeZone = .autoupdatingCurrent; return c }()

  static func startOfDay(_ d: Date) -> Date { cal.startOfDay(for: d) }

  static func parse(_ s: String) -> Date? {
    let p = s.split(separator: "-").compactMap { Int($0) }
    guard p.count == 3 else { return nil }
    return cal.date(from: DateComponents(year: p[0], month: p[1], day: p[2]))
  }

  public static func format(_ d: Date) -> String {
    let c = cal.dateComponents([.year, .month, .day], from: d)
    return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
  }

  /// 월=1, 화=2, 수=4 … 일=64
  static func bit(_ d: Date) -> Int { 1 << ((cal.component(.weekday, from: d) + 5) % 7) }

  static func matches(freq: String, days: Int?, date: Date, anchor: Date) -> Bool {
    switch freq {
    case "daily": return true
    case "weekly": return ((days.flatMap { $0 == 0 ? nil : $0 } ?? bit(anchor)) & bit(date)) != 0
    case "monthly":
      let last = cal.range(of: .day, in: .month, for: date)?.count ?? 31
      return cal.component(.day, from: date) == min(cal.component(.day, from: anchor), last)
    default: return false
    }
  }

  static func nextDue(freq: String, days: Int?, due: Date?, today: Date) -> Date {
    let anchor = due ?? today
    let after = (due.map { $0 > today } ?? false) ? due! : today
    for i in 1..<400 {
      if let d = cal.date(byAdding: .day, value: i, to: after), matches(freq: freq, days: days, date: d, anchor: anchor) { return d }
    }
    return cal.date(byAdding: .day, value: 1, to: after) ?? after
  }

  /// 알림 시각을 같은 현지 시각 그대로 옮긴다
  static func shift(_ ms: Int64, from: Date, to: Date) -> Int64 {
    let n = cal.dateComponents([.day], from: startOfDay(from), to: startOfDay(to)).day ?? 0
    let d = cal.date(byAdding: .day, value: n, to: Date(timeIntervalSince1970: TimeInterval(ms) / 1000)) ?? Date()
    return Int64(d.timeIntervalSince1970 * 1000)
  }

  /// 표시: 매일 · 매주 월·수·금 · 매주 목요일 · 매월 16일 (앱 format.ts describeRepeat과 같은 문구)
  public static func label(freq: String, days: Int?, due: String?, _ l: L) -> String {
    if freq == "daily" || (freq == "weekly" && days == 127) { return l.daily }
    let anchor = due.flatMap(parse)
    if freq == "monthly" { return l.monthly(anchor.map { cal.component(.day, from: $0) } ?? 1) }
    let mask = days.flatMap { $0 == 0 ? nil : $0 } ?? anchor.map(bit) ?? 1
    let picked = (0..<7).filter { mask & (1 << $0) != 0 } // 월요일 = 0
    if picked.count == 1 { return l.weeklyOne((picked[0] + 1) % 7) }
    return l.weeklyMany(picked.map { l.week[($0 + 1) % 7] })
  }
}

/// 위젯·알림 문구(앱 src/i18n.ts, Android res/values-*, format.ts와 같은 뜻). 앱 언어 설정 → 기기 언어 → 영어.
/// 요일 배열은 일요일부터.
public struct L {
  public let lang: String
  static let supported = ["ko", "en", "ja", "zh"]

  public static func current(_ prefs: [String: Any]?) -> L {
    if let pref = prefs?["language"] as? String, supported.contains(pref) { return L(lang: pref) }
    for id in Locale.preferredLanguages {
      let code = String(id.prefix(2)).lowercased()
      if supported.contains(code) { return L(lang: code) }
    }
    return L(lang: "en")
  }

  func pick(_ ko: String, _ en: String, _ ja: String, _ zh: String) -> String {
    switch lang {
    case "ko": return ko
    case "ja": return ja
    case "zh": return zh
    default: return en
    }
  }

  public var week: [String] {
    switch lang {
    case "ko": return ["일", "월", "화", "수", "목", "금", "토"]
    case "ja": return ["日", "月", "火", "水", "木", "金", "土"]
    case "zh": return ["日", "一", "二", "三", "四", "五", "六"]
    default: return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    }
  }
  public func weekLong(_ w: Int) -> String {
    switch lang {
    case "ko": return week[w] + "요일"
    case "ja": return week[w] + "曜日"
    case "zh": return "星期" + week[w]
    default: return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][w]
    }
  }

  public var baseFolder: String { pick("기본", "General", "デフォルト", "默认") }
  public var prevFolder: String { pick("이전 폴더", "Previous folder", "前のフォルダ", "上一个文件夹") }
  public var nextFolder: String { pick("다음 폴더", "Next folder", "次のフォルダ", "下一个文件夹") }
  public var today: String { pick("오늘", "Today", "今日", "今天") }
  public var tomorrow: String { pick("내일", "Tomorrow", "明日", "明天") }
  /// 기한이 지난 날 수: 2일 지남
  public func late(_ n: Int) -> String { pick("\(n)일 지남", n == 1 ? "1 day overdue" : "\(n) days overdue", "\(n)日経過", "逾期\(n)天") }
  public var noTodos: String { pick("할 일 없음", "No to-dos", "ToDoなし", "没有待办") }
  public var more: String { pick("더 보기", "More", "もっと見る", "查看更多") }
  public var tagline: String { pick("떠오른 생각과 해야 할 일을 한곳에.", "Simple, modern Memo & ToDo.", "メモとToDoを、ひとつに。", "备忘与待办，尽在一处。") }
  public var quickAdd: String { pick("modo 빠른 추가", "modo quick add", "modo クイック追加", "modo 快速添加") }
  /// 위젯 고르기 화면의 미리보기
  public var sampleMemo: String { pick("회의 때 배포 일정 확인하기", "Check the release date at the meeting", "会議でリリース日を確認する", "开会时确认发布日期") }
  public var sampleTodos: [String] {
    switch lang {
    case "ko": return ["회의 자료 정리", "책 20쪽 읽기"]
    case "ja": return ["会議資料をまとめる", "本を20ページ読む"]
    case "zh": return ["整理会议资料", "读20页书"]
    default: return ["Prepare meeting notes", "Read 20 pages"]
    }
  }
  public var reminderTitle: String { pick("할 일 알림", "To-do reminder", "ToDoのリマインダー", "待办提醒") }
  public func markDone(_ text: String) -> String { pick("\(text) 완료하기", "Complete \(text)", "\(text)を完了", "完成“\(text)”") }
  public func markUndone(_ text: String) -> String { pick("\(text) 완료 취소", "Uncomplete \(text)", "\(text)の完了を取り消す", "取消完成“\(text)”") }
  public var daily: String { pick("매일", "Daily", "毎日", "每天") }
  public func monthly(_ d: Int) -> String { pick("매월 \(d)일", "Monthly on day \(d)", "毎月\(d)日", "每月\(d)日") }
  public func weeklyOne(_ w: Int) -> String {
    pick("매주 \(weekLong(w))", "Every \(weekLong(w))", "毎週\(weekLong(w))", "每\(weekLong(w))")
  }
  public func weeklyMany(_ names: [String]) -> String {
    pick("매주 " + names.joined(separator: "·"), "Weekly " + names.joined(separator: "·"), "毎週 " + names.joined(separator: "·"), "每周" + names.joined(separator: "、"))
  }
  /// 10월 17일 (토) / Sat, Oct 17
  public func monthDayWeek(_ d: Date) -> String {
    let c = Calendar.current.dateComponents([.month, .day, .weekday], from: d)
    let m = c.month ?? 1, day = c.day ?? 1, w = (c.weekday ?? 1) - 1
    let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    return pick("\(m)월 \(day)일 (\(week[w]))", "\(week[w]), \(months[m - 1]) \(day)", "\(m)月\(day)日(\(week[w]))", "\(m)月\(day)日（周\(week[w])）")
  }
}

extension NotesStore {
  /// 앱의 언어 설정(위젯 밖, 예: 알림 예약에서)
  public static func strings() -> L {
    guard let db = open() else { return L.current(nil) }
    defer { sqlite3_close(db) }
    var prefs: [String: Any]?
    query(db, "SELECT value FROM kv WHERE key = 'prefs'") { st in
      if let t = text(st, 0), let d = t.data(using: .utf8) { prefs = try? JSONSerialization.jsonObject(with: d) as? [String: Any] }
    }
    return L.current(prefs)
  }
}

/// 할 일 알림. remind_at은 절대 시각이라 시간대가 바뀌어도 같은 순간에 울린다.
/// iOS는 예약 알림이 64개로 제한돼 가까운 순으로 60개만 둔다. 앱이 앞으로 올 때마다 다시 맞춘다.
/// 위젯에서 완료했을 때도 다시 맞추도록 위젯 확장과 같이 쓰는 이 파일에 둔다.
enum Reminders {
  static let prefix = "todo-"

  static func scheduleAll() {
    let center = UNUserNotificationCenter.current()
    let now = Int64(Date().timeIntervalSince1970 * 1000)
    let items = NotesStore.pendingReminders(now: now).sorted { $0.at < $1.at }.prefix(60)
    center.getPendingNotificationRequests { reqs in
      let keep = Set(items.map { prefix + $0.id })
      center.removePendingNotificationRequests(withIdentifiers: reqs.map(\.identifier).filter { $0.hasPrefix(prefix) && !keep.contains($0) })
      let l = NotesStore.strings()
      for it in items {
        let content = UNMutableNotificationContent()
        content.title = l.reminderTitle
        content.body = it.text
        content.sound = .default
        let date = Date(timeIntervalSince1970: TimeInterval(it.at) / 1000)
        let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
        let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
        center.add(UNNotificationRequest(identifier: prefix + it.id, content: content, trigger: trigger))
      }
    }
  }
}
