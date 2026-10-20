import ExpoModulesCore
import UserNotifications
import WidgetKit

/// JS(src/native/bridge.ts) 계약의 iOS 쪽. 위젯 갱신과 리마인더 예약.
public class ModoNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ModoNative")

    OnCreate { Self.refreshAll() }

    AsyncFunction("refresh") { (tables: [String]?) in Self.refreshAll(tables) }

    // iOS는 앱에서 위젯·제어 센터 항목을 바로 추가하는 API가 없다(설정 화면이 방법을 안내).
    AsyncFunction("requestPinWidget") { (_: String?) -> Bool in false }

    AsyncFunction("lockScreenWidgetSupport") { () -> [String: Any] in
      // 위젯 확장은 iOS 17부터(targets/widget/expo-target.config.js deploymentTarget)
      if #available(iOS 17.0, *) { return ["supported": true, "reason": "iOS 17+"] }
      return ["supported": false, "reason": "iOS < 17"]
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

  /// tables = 바뀐 표(nil·빈 목록 = 전부). 문단(메모)만 바뀌었으면 알림 예약은 그대로(할 일만 쓴다)
  static func refreshAll(_ tables: [String]? = nil) {
    WidgetCenter.shared.reloadAllTimelines()
    let onlyParagraphs = tables.map { !$0.isEmpty && $0.allSatisfy { $0 == "paragraphs" } } ?? false
    if !onlyParagraphs { Reminders.scheduleAll() }
  }

  static func status(_ s: UNAuthorizationStatus) -> String {
    switch s {
    case .authorized, .provisional, .ephemeral: return "granted"
    case .denied: return "denied"
    default: return "undetermined"
    }
  }
}
