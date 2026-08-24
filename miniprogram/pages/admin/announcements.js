const { call } = require('../../utils/cloud')

const pad = value => String(value).padStart(2, '0')
const dateText = value => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
const timeText = value => `${pad(value.getHours())}:${pad(value.getMinutes())}`
const initialForm = () => {
  const start = new Date(), end = new Date(Date.now() + 7 * 86400000)
  return { title: '', content: '', startDate: dateText(start), startTime: timeText(start), endDate: dateText(end), endTime: timeText(end), pushWechat: false }
}

Page({
  data: { items: [], counts: { ACTIVE: 0, DISABLED: 0, EXPIRED: 0 }, status: 'ALL', loading: false, editing: false, saving: false, form: initialForm() },
  async onShow() { await this.load() },
  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh() },
  async load() {
    this.setData({ loading: true })
    try {
      const result = await call('notification', 'adminListAnnouncements', { status: this.data.status, page: 1 })
      this.setData({ items: result.items || [], counts: result.counts || { ACTIVE: 0, DISABLED: 0, EXPIRED: 0 } })
    } finally { this.setData({ loading: false }) }
  },
  selectStatus(e) { this.setData({ status: e.currentTarget.dataset.status }); this.load() },
  openCreate() { this.setData({ editing: true, form: initialForm() }) },
  closeCreate() { if (!this.data.saving) this.setData({ editing: false }) },
  input(e) { this.setData({ [`form.${e.currentTarget.dataset.key}`]: e.detail.value }) },
  dateTimeChange(e) { this.setData({ [`form.${e.currentTarget.dataset.key}`]: e.detail.value }) },
  pushChange(e) { this.setData({ 'form.pushWechat': e.detail.value }) },
  noop() {},
  async publish() {
    if (this.data.saving) return
    const form = this.data.form, title = form.title.trim(), content = form.content.trim()
    if (!title || !content) return wx.showToast({ title: '请填写标题和正文', icon: 'none' })
    const startsAt = Date.parse(`${form.startDate}T${form.startTime}:00+08:00`), endsAt = Date.parse(`${form.endDate}T${form.endTime}:00+08:00`)
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || startsAt >= endsAt) return wx.showToast({ title: '公告有效期无效', icon: 'none' })
    this.setData({ saving: true })
    try {
      await call('notification', 'adminPublishAnnouncement', { title, content, startsAt, endsAt, pushWechat: form.pushWechat })
      wx.showToast({ title: '公告已发布' })
      this.setData({ editing: false })
      await this.load()
    } finally { this.setData({ saving: false }) }
  },
  async disable(e) {
    const id = e.currentTarget.dataset.id
    const confirmed = await new Promise(resolve => wx.showModal({ title: '停用该公告？', content: '停用后普通用户将不再看到该公告。', confirmText: '确认停用', confirmColor: '#b64a43', success: result => resolve(result.confirm) }))
    if (!confirmed) return
    await call('notification', 'adminDisableAnnouncement', { id })
    wx.showToast({ title: '公告已停用' })
    await this.load()
  },
  settings() { wx.navigateTo({ url: '/pages/admin/notification-settings' }) }
})
