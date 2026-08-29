Page({
  data: { user: null, statusIcon: '', statusTitle: '', statusCopy: '', statusClass: '' },
  async onShow() {
    const user = await getApp().loadSession(true)
    if (!user) return wx.redirectTo({ url: '/pages/profile/register' })
    if (user.status === 'APPROVED') return wx.switchTab({ url: '/pages/home/index' })
    const views = {
      PENDING: { icon: 'time', title: '资料审核中', copy: '管理员确认成员身份后即可预约设备', className: 'pending' },
      REJECTED: { icon: 'close-circle', title: '资料未通过审核', copy: user.reviewNote || '请核对资料后重新提交', className: 'rejected' },
      DISABLED: { icon: 'prohibited', title: '账号已被禁用', copy: '该账号暂时无法使用设备与预约功能，如有疑问请联系实验室管理员。', className: 'disabled' }
    }
    const view = views[user.status] || views.PENDING
    this.setData({ user, statusIcon: view.icon, statusTitle: view.title, statusCopy: view.copy, statusClass: view.className })
  },
  edit() { wx.redirectTo({ url: '/pages/profile/register' }) },
  messages() { wx.navigateTo({ url: '/pages/notifications/index' }) },
  refresh() { getApp().clearSession(); this.onShow() }
})
