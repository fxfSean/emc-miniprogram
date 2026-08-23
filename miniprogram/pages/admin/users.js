const { call } = require('../../utils/cloud')
const STATUS_META = {
  PENDING: { text: '待审核', className: 'pending' },
  APPROVED: { text: '已通过', className: 'approved' },
  REJECTED: { text: '已拒绝', className: 'rejected' },
  DISABLED: { text: '已禁用', className: 'disabled' }
}
Page({
  data: {
    users: [],
    status: 'ALL',
    keyword: '',
    counts: { ALL: 0, PENDING: 0, APPROVED: 0, REJECTED: 0, DISABLED: 0 },
    loading: true,
    actionUserId: ''
  },
  async onShow() { await this.load() },
  async load() {
    const requestId = (this.listRequestId || 0) + 1
    this.listRequestId = requestId
    this.setData({ loading: true })
    try {
      const result = await call('admin', 'listUsers', { status: this.data.status, keyword: this.data.keyword.trim() })
      if (requestId !== this.listRequestId) return
      const users = (result.users || []).map(user => ({
        ...user,
        statusText: STATUS_META[user.status] ? STATUS_META[user.status].text : user.status,
        statusClass: STATUS_META[user.status] ? STATUS_META[user.status].className : ''
      }))
      this.setData({ users, counts: result.counts || this.data.counts })
    } catch (error) {
      console.error('读取用户列表失败', error)
    } finally {
      if (requestId === this.listRequestId) this.setData({ loading: false })
    }
  },
  onKeywordInput(e) { this.setData({ keyword: e.detail.value }) },
  search() { this.load() },
  clearKeyword() { this.setData({ keyword: '' }); this.load() },
  selectStatus(e) {
    const status = e.currentTarget.dataset.status
    if (status === this.data.status) return
    this.setData({ status })
    this.load()
  },
  async approve(e) {
    const id = e.currentTarget.dataset.id
    if (this.data.actionUserId) return
    this.setData({ actionUserId: id })
    try {
      await call('admin', 'reviewUser', { id, decision: 'APPROVED' })
      wx.showToast({ title: '审核已通过', icon: 'success' })
      await this.load()
    } finally {
      this.setData({ actionUserId: '' })
    }
  },
  reject(e) {
    const id = e.currentTarget.dataset.id
    if (this.data.actionUserId) return
    wx.showModal({
      title: '拒绝用户资料',
      editable: true,
      placeholderText: '请输入拒绝原因',
      success: async result => {
        if (!result.confirm) return
        const note = String(result.content || '').trim()
        if (!note) return wx.showToast({ title: '请填写拒绝原因', icon: 'none' })
        this.setData({ actionUserId: id })
        try {
          await call('admin', 'reviewUser', { id, decision: 'REJECTED', note })
          wx.showToast({ title: '已拒绝该用户', icon: 'success' })
          await this.load()
        } finally {
          this.setData({ actionUserId: '' })
        }
      }
    })
  },
  disableUser(e) {
    const id = e.currentTarget.dataset.id
    if (this.data.actionUserId) return
    wx.showModal({
      title: '禁用用户账号',
      content: '禁用后该用户无法访问设备和预约功能，已有预约不会自动取消。',
      confirmText: '确认禁用',
      confirmColor: '#B64A43',
      success: result => { if (result.confirm) this.setUserEnabled(id, false) }
    })
  },
  enableUser(e) {
    const id = e.currentTarget.dataset.id
    if (this.data.actionUserId) return
    wx.showModal({
      title: '启用用户账号',
      content: '启用后该用户将恢复为已通过状态，可继续使用设备预约功能。',
      confirmText: '确认启用',
      success: result => { if (result.confirm) this.setUserEnabled(id, true) }
    })
  },
  async setUserEnabled(id, enabled) {
    this.setData({ actionUserId: id })
    try {
      await call('admin', 'setUserEnabled', { id, enabled })
      wx.showToast({ title: enabled ? '账号已启用' : '账号已禁用', icon: 'success' })
      await this.load()
    } finally {
      this.setData({ actionUserId: '' })
    }
  }
})
