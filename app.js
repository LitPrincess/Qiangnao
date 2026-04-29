const CLOUD_ENV_ID = 'cloud1-2gqdzqj9e43361c0'

App({
  onLaunch() {
    if (!wx.cloud) return
    try {
      wx.cloud.init({ env: CLOUD_ENV_ID, traceUser: false })
    } catch (e) {}
  },
})
