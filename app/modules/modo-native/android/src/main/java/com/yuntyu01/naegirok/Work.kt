package com.yuntyu01.naegirok

import android.content.BroadcastReceiver
import android.util.Log
import java.util.concurrent.Executors

/**
 * :native 프로세스의 DB 일(쓰기·위젯 다시 그리기·알림)은 스레드 하나에서 차례로 한다.
 * 예전엔 일마다 스레드를 따로 띄워, 겹친 새로 고침이 같은 위젯을 동시에 그리고 쓰기끼리 잠금을 다퉜다
 * (고치기 창에서 두 번 저장하면 늦게 고친 글이 먼저 들어갈 수도 있었다).
 */
object Work {
  private val exec = Executors.newSingleThreadExecutor { r -> Thread(r, "modo-work") }

  fun run(block: () -> Unit) = exec.execute { guarded(block) }

  /** 방송을 받는 쪽: 일이 끝날 때까지 프로세스를 붙잡아 둔다(goAsync) */
  fun run(receiver: BroadcastReceiver, block: () -> Unit) {
    val pending = receiver.goAsync()
    exec.execute {
      try {
        guarded(block)
      } finally {
        pending.finish()
      }
    }
  }

  // 한 일이 실패해도 위젯 프로세스가 죽지 않게(다음 일은 그대로 돈다)
  private fun guarded(block: () -> Unit) {
    try {
      block()
    } catch (e: Exception) {
      Log.w("modo", "background work failed", e)
    }
  }
}
