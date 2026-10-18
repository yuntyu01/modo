package com.yuntyu01.naegirok

import com.yuntyu01.naegirok.nativelib.R
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/** 빠른 설정 타일: 누르면 빠른 추가 창. 잠겨 있으면 시스템 잠금 해제를 먼저 거친다. */
class QuickAddTileService : TileService() {
  override fun onStartListening() {
    qsTile?.apply {
      state = Tile.STATE_INACTIVE
      label = getString(R.string.tile_label)
      updateTile()
    }
  }

  override fun onClick() {
    if (isLocked) unlockAndRun { open() } else open()
  }

  @SuppressLint("StartActivityAndCollapseDeprecated")
  private fun open() {
    val intent = Intent(this, QuickAddActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    if (Build.VERSION.SDK_INT >= 34) {
      startActivityAndCollapse(PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE))
    } else {
      @Suppress("DEPRECATION")
      startActivityAndCollapse(intent)
    }
  }
}
