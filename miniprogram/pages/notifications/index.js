const { call } = require('../../utils/cloud')
const { requestNotificationTemplates, saveSubscriptionResults } = require('../../utils/notifications')

const TYPE_LABELS = {
  REVIEW_RESULT: '审核结果', RESERVATION_CREATED: '预约成功', RESERVATION_CANCELLED: '预约取消',
  RESERVATION_REMINDER: '预约提醒', DEVICE_MAINTENANCE: '设备维护', ANNOUNCEMENT: '系统公告', NOTICE: '消息'
}

Page({
  data: { items: [], page: 1, hasMore: false, loading: false, loadingMore: false, unreadCount: 0, wechatConfigured: false },
  async onShow() { if (!this.loaded) await this.refresh(); else await this.loadSummary() },
  async onPullDownRefresh() { await this.refresh(); wx.stopPullDownRefresh() },
  async onReachBottom() { if (this.data.hasMore && !this.data.loadingMore) await this.loadMore() },
  decorate(items) {
    return (items || []).map(item => ({ ...item, typeLabel: TYPE_LABELS[item.type] || '消息', datePart: String(item.createdAtText || '').slice(5, 10), timePart: String(item.createdAtText || '').slice(11), expanded: false }))
  },
  async loadSummary() {
    const summary = await call('notification', 'summary')
    this.setData({ unreadCount: summary.unreadCount || 0, wechatConfigured: summary.wechatConfigured === true })
  },
  async refresh() {
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const [result, summary] = await Promise.all([call('notification', 'list', { page: 1 }), call('notification', 'summary')])
      this.loaded = true
      this.setData({ items: this.decorate(result.items), page: 1, hasMore: result.hasMore, unreadCount: summary.unreadCount || 0, wechatConfigured: summary.wechatConfigured === true })
    } finally { this.setData({ loading: false }) }
  },
  async loadMore() {
    this.setData({ loadingMore: true })
    try {
      const page = this.data.page + 1, result = await call('notification', 'list', { page })
      this.setData({ items: this.data.items.concat(this.decorate(result.items)), page, hasMore: result.hasMore })
    } finally { this.setData({ loadingMore: false }) }
  },
  async toggle(e) {
    const id = e.currentTarget.dataset.id, target = this.data.items.find(item => item._id === id)
    if (!target) return
    const expanded = !target.expanded
    this.setData({ items: this.data.items.map(item => item._id === id ? { ...item, expanded, read: expanded ? true : item.read } : item) })
    if (expanded && !target.read) {
      await call('notification', 'markRead', { id, kind: target.kind })
      await this.loadSummary()
    }
  },
  async markAll() {
    if (!this.data.unreadCount) return
    await call('notification', 'markAllRead')
    this.setData({ unreadCount: 0, items: this.data.items.map(item => ({ ...item, read: true })) })
    wx.showToast({ title: '已全部标记为已读' })
  },
  async enableWechat() {
    const results = await requestNotificationTemplates(['review', 'maintenance', 'announcement'])
    await saveSubscriptionResults(results)
    if (Object.values(results).includes('accept')) wx.showToast({ title: '微信提醒已开启' })
    else wx.showToast({ title: this.data.wechatConfigured ? '未开启微信提醒' : '管理员尚未配置模板', icon: 'none' })
  },
  openBusiness(e) {
    const item = this.data.items.find(row => row._id === e.currentTarget.dataset.id)
    if (!item || !item.navigation) return
    const page = item.navigation.page, params = item.navigation.params || {}
    if (page === 'MINE_RESERVATION') return wx.switchTab({ url: '/pages/mine/index' })
    if (page === 'PROFILE_STATUS') return wx.navigateTo({ url: '/pages/profile/status' })
    if (page === 'DEVICE_DETAIL' && params.id) return wx.navigateTo({ url: `/pages/device/detail?id=${encodeURIComponent(params.id)}` })
  }
})
