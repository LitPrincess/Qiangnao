function readProfile() {
  try {
    return wx.getStorageSync('mt_profile') || {}
  } catch (e) {
    return {}
  }
}

function saveProfile(data) {
  try {
    wx.setStorageSync('mt_profile', data)
  } catch (e) {}
}

Page({
  data: {
    nickname: '体验者',
    targetChewHz: 1.2,
    remindLevel: 'moderate',
    sessions: 0,
    totalAnalyses: 0,
    lastRiskPct: 0,
  },

  onShow() {
    const p = readProfile()
    this.setData({
      nickname: p.nickname || '体验者',
      targetChewHz: Number(p.targetChewHz || 1.2),
      remindLevel: p.remindLevel || 'moderate',
      sessions: Number(p.sessions || 0),
      totalAnalyses: Number(p.totalAnalyses || 0),
      lastRiskPct: Number(p.lastRiskPct || 0),
    })
  },

  onNickInput(e) {
    this.setData({ nickname: (e.detail && e.detail.value) || '' })
  },

  onTargetChange(e) {
    this.setData({ targetChewHz: Number(e.detail.value) })
  },

  setRemindSoft() {
    this.setData({ remindLevel: 'soft' })
  },

  setRemindModerate() {
    this.setData({ remindLevel: 'moderate' })
  },

  setRemindStrong() {
    this.setData({ remindLevel: 'strong' })
  },

  saveSettings() {
    const p = readProfile()
    const next = {
      ...p,
      nickname: (this.data.nickname || '体验者').trim() || '体验者',
      targetChewHz: this.data.targetChewHz,
      remindLevel: this.data.remindLevel,
    }
    saveProfile(next)
    wx.showToast({ title: '已保存', icon: 'success' })
  },

  clearStats() {
    const p = readProfile()
    saveProfile({
      ...p,
      sessions: 0,
      totalAnalyses: 0,
      lastRiskPct: 0,
    })
    this.onShow()
    wx.showToast({ title: '统计已清空', icon: 'none' })
  },
})
