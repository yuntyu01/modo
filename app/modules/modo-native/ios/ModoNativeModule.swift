import ExpoModulesCore
import UserNotifications
import WidgetKit

/// JS(src/native/bridge.ts) 계약의 iOS 쪽. 위젯 갱신과 리마인더 예약.
public class ModoNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ModoNative")

    OnCreate { Self.refreshAll() }

    AsyncFunction("refresh") { Self.refreshAll() }

    // iOS는 앱에서 위젯·제어 센터 항목을 바로 추가하는 API가 없다(설정 화면이 방법을 안내).
    AsyncFunction("requestPinWidget") { false }
    AsyncFunction("requestAddTile") { "unsupported" }

    AsyncFunction("lockScreenWidgetSupport") { () -> [String: Any] in
      if #available(iOS 16.0, *) { return ["supported": true, "reason": "iOS 16+"] }
      return ["supported": false, "reason": "iOS < 16"]
    }

    AsyncFunction("notificationPermission") { (promise: Promise) in
      UNUserNotificationCenter.current().getNotificationSettings { s in promise.resolve(Self.status(s.authorizationStatus)) }
    }

    AsyncFunction("requestNotificationPermission") { (promise: Promise) in
      UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
        promise.resolve(granted ? "granted" : "denied")
        if granted { Reminders.scheduleAll() }
      }
    }

    AsyncFunction("canScheduleExactAlarms") { true }
    AsyncFunction("openExactAlarmSettings") {}
  }

  static func refreshAll() {
    WidgetCenter.shared.reloadAllTimelines()
    Reminders.scheduleAll()
  }

  static func status(_ s: UNAuthorizationStatus) -> String {
    switch s {
    case .authorized, .provisional, .ephemeral: return "granted"
    case .denied: return "denied"
    default: return "undetermined"
    }
  }
}

/// 할 일 알림. remind_at은 절대 시각이라 시간대가 바뀌어도 같은 순간에 울린다.
/// iOS는 예약 알림이 64개로 제한돼 가까운 순으로 60개만 둔다. 앱이 앞으로 올 때마다 다시 맞춘다.
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
