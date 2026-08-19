Page({
  data: { user: null },
  async onShow() {
    const user = await getApp().loadSession(true)
    if (!user) return wx.redirectTo({ url: '/pages/profile/register' })
    if (user.status === 'APPROVED') return wx.switchTab({ url: '/pages/home/index' })
    this.setData({ user })
  },
  edit() { wx.redirectTo({ url: '/pages/profile/register' }) },
  refresh() { getApp().clearSession(); this.onShow() }
})
