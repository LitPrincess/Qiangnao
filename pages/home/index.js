Page({
  data: {
    profile: {
      sessions: 0,
      totalAnalyses: 0,
      lastRiskPct: 0,
    },
  },

  onShow() {
    let p = {}
    try {
      p = wx.getStorageSync('mt_profile') || {}
    } catch (e) {}
    this.setData({
      profile: {
        sessions: Number(p.sessions || 0),
        totalAnalyses: Number(p.totalAnalyses || 0),
        lastRiskPct: Number(p.lastRiskPct || 0),
      },
    })
  },

  goDemo() {
    wx.navigateTo({ url: '/pages/index/index' })
  },

  goExplain() {
    wx.navigateTo({ url: '/pages/explain/index' })
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/index' })
  },
})
