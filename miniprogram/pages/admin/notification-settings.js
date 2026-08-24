const { call } = require('../../utils/cloud')

const DEFINITIONS = [
  { key: 'review', label: '注册审核结果', sample: '{"result":"phrase1","time":"time2","note":"thing3"}' },
  { key: 'reservationCreated', label: '预约成功', sample: '{"device":"thing1","time":"time2","note":"thing3"}' },
  { key: 'reservationCancelled', label: '预约取消', sample: '{"device":"thing1","time":"time2","reason":"thing3"}' },
  { key: 'reminder', label: '预约开始提醒', sample: '{"device":"thing1","time":"time2","note":"thing3"}' },
  { key: 'maintenance', label: '设备维护', sample: '{"device":"thing1","time":"time2","reason":"thing3"}' },
  { key: 'announcement', label: '系统公告', sample: '{"title":"thing1","time":"time2","content":"thing3"}' }
]

Page({
  data: { reminderOptions: ['提前 15 分钟', '提前 30 分钟'], reminderIndex: 1, announcementWechatEnabled: false, templates: DEFINITIONS.map(item => ({ ...item, templateId: '', fieldsText: item.sample, configured: false })), loading: true, saving: false },
  async onShow() { if (!this.loaded) await this.load() },
  async load() {
    this.setData({ loading: true })
    try {
      const settings = await call('notification', 'adminGetSettings')
      const templates = DEFINITIONS.map(item => {
        const value = (settings.templates || {})[item.key] || {}
        return { ...item, templateId: value.templateId || '', fieldsText: JSON.stringify(value.fields && Object.keys(value.fields).length ? value.fields : JSON.parse(item.sample)), configured: Boolean(value.templateId) }
      })
      this.loaded = true
      this.setData({ reminderIndex: Number(settings.reminderMinutes) === 15 ? 0 : 1, announcementWechatEnabled: settings.announcementWechatEnabled === true, templates })
    } finally { this.setData({ loading: false }) }
  },
  reminderChange(e) { this.setData({ reminderIndex: Number(e.detail.value) }) },
  announcementChange(e) { this.setData({ announcementWechatEnabled: e.detail.value }) },
  templateInput(e) {
    const index = Number(e.currentTarget.dataset.index), field = e.currentTarget.dataset.field
    this.setData({ [`templates[${index}].${field}`]: e.detail.value, [`templates[${index}].configured`]: field === 'templateId' ? Boolean(e.detail.value.trim()) : this.data.templates[index].configured })
  },
  async save() {
    if (this.data.saving) return
    const templates = {}
    try {
      this.data.templates.forEach(item => { templates[item.key] = { templateId: item.templateId.trim(), fields: item.fieldsText.trim() ? JSON.parse(item.fieldsText) : {} } })
    } catch (error) { return wx.showToast({ title: '字段映射必须是有效 JSON', icon: 'none' }) }
    this.setData({ saving: true })
    try {
      await call('notification', 'adminSaveSettings', { settings: { reminderMinutes: this.data.reminderIndex === 0 ? 15 : 30, announcementWechatEnabled: this.data.announcementWechatEnabled, templates } })
      wx.showToast({ title: '通知设置已保存' })
      this.loaded = false
      await this.load()
    } finally { this.setData({ saving: false }) }
  }
})
