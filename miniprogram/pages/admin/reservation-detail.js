const { call } = require('../../utils/cloud')

Page({
  data: {
    detail: null,
    loading: true,
    loadFailed: false,
    cancelVisible: false,
    cancelReason: '',
    cancelReasonCount: 0,
    cancelling: false,
    overrideVisible: false,
    overrideType: '',
    overrideReason: '',
    overrideReasonCount: 0,
    overriding: false
  },
  onLoad(options) {
    this.reservationId = String(options.id || '')
    if (!this.reservationId) {
      this.setData({ loading: false, loadFailed: true })
      wx.showToast({ title: '预约参数无效', icon: 'none' })
      return
    }
    this.loadDetail()
  },
  async onPullDownRefresh() {
    try { await this.loadDetail() } finally { wx.stopPullDownRefresh() }
  },
  async loadDetail() {
    if (!this.reservationId) return
    this.setData({ loading: true, loadFailed: false })
    try {
      const detail = await call('admin', 'reservationDetail', { id: this.reservationId })
      this.setData({ detail })
    } catch (error) {
      this.setData({ loadFailed: true })
    } finally {
      this.setData({ loading: false })
    }
  },
  retry() { this.loadDetail() },
  noop() {},
  cancel() {
    if (!this.data.detail || !this.data.detail.canCancel) return
    this.setData({ cancelVisible: true, cancelReason: '', cancelReasonCount: 0 })
  },
  cancelReasonInput(e) {
    const cancelReason = e.detail.value
    this.setData({ cancelReason, cancelReasonCount: cancelReason.length })
  },
  closeCancel() {
    if (this.data.cancelling) return
    this.setData({ cancelVisible: false, cancelReason: '', cancelReasonCount: 0 })
  },
  async confirmCancel() {
    const { detail, cancelReason, cancelling } = this.data
    if (!detail || cancelling) return
    const reason = String(cancelReason || '').trim()
    if (!reason) return wx.showToast({ title: '请填写取消原因', icon: 'none' })
    this.setData({ cancelling: true })
    try {
      await call('reservation', 'adminCancel', { id: detail._id, reason })
      wx.showToast({ title: '预约已取消' })
      this.setData({ cancelVisible: false, cancelReason: '', cancelReasonCount: 0 })
      await this.loadDetail()
    } finally {
      this.setData({ cancelling: false })
    }
  },
  openOverride(e) {
    const overrideType = e.currentTarget.dataset.type
    if (!['CHECK_IN', 'CHECK_OUT'].includes(overrideType)) return
    this.setData({ overrideVisible: true, overrideType, overrideReason: '', overrideReasonCount: 0 })
  },
  overrideReasonInput(e) {
    const overrideReason = e.detail.value
    this.setData({ overrideReason, overrideReasonCount: overrideReason.length })
  },
  closeOverride() {
    if (this.data.overriding) return
    this.setData({ overrideVisible: false, overrideType: '', overrideReason: '', overrideReasonCount: 0 })
  },
  async confirmOverride() {
    const { detail, overrideType, overrideReason, overriding } = this.data
    if (!detail || overriding) return
    const reason = String(overrideReason || '').trim()
    if (!reason) return wx.showToast({ title: '请填写操作原因', icon: 'none' })
    const action = overrideType === 'CHECK_IN' ? 'adminCheckIn' : 'adminCheckOut'
    this.setData({ overriding: true })
    try {
      await call('reservation', action, { id: detail._id, reason })
      wx.showToast({ title: overrideType === 'CHECK_IN' ? '代签到成功' : '代签退成功' })
      this.setData({ overrideVisible: false, overrideType: '', overrideReason: '', overrideReasonCount: 0 })
      await this.loadDetail()
    } finally {
      this.setData({ overriding: false })
    }
  }
})
