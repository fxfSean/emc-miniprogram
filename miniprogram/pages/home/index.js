const { call } = require('../../utils/cloud')
const { requireApproved } = require('../../utils/auth')
const HISTORY_KEY = 'deviceSearchHistory'
const HISTORY_LIMIT = 10
Page({
  data: { keyword: '', devices: [], loading: true, searchPanelVisible: false, searchHistory: [], suggestions: [] },
  async onShow() { if (await requireApproved()) await this.loadDevices() },
  async onPullDownRefresh() { await this.loadDevices(); wx.stopPullDownRefresh() },
  onUnload() { if (this.blurTimer) clearTimeout(this.blurTimer) },
  onFocus() {
    if (this.blurTimer) clearTimeout(this.blurTimer)
    this.setData({ searchPanelVisible: true, searchHistory: this.readHistory(), suggestions: this.getSuggestions(this.data.keyword) })
  },
  onBlur() { this.blurTimer = setTimeout(() => this.setData({ searchPanelVisible: false }), 150) },
  onInput(e) {
    const keyword = e.detail.value
    this.setData({ keyword, searchPanelVisible: true, suggestions: this.getSuggestions(keyword) })
  },
  async loadDevices() {
    this.setData({ loading: true })
    try {
      const devices = await call('device', 'list', { keyword: this.data.keyword })
      if (!this.data.keyword.trim()) this.allDevices = devices
      this.setData({ devices })
    }
    finally { this.setData({ loading: false }) }
  },
  readHistory() {
    const history = wx.getStorageSync(HISTORY_KEY)
    return Array.isArray(history) ? history.filter(item => typeof item === 'string' && item.trim()).slice(0, HISTORY_LIMIT) : []
  },
  saveHistory(keyword) {
    const value = String(keyword || '').trim()
    if (!value) return
    const history = [value, ...this.readHistory().filter(item => item !== value)].slice(0, HISTORY_LIMIT)
    wx.setStorageSync(HISTORY_KEY, history)
    this.setData({ searchHistory: history })
  },
  getSuggestions(keyword) {
    const value = String(keyword || '').trim().toLowerCase()
    if (!value || !Array.isArray(this.allDevices)) return []
    return this.allDevices.filter(item => [item.name, item.deviceNo, item.model, item.location].some(field => String(field || '').toLowerCase().includes(value))).slice(0, 8)
  },
  async executeSearch(keyword, remember = true) {
    const value = String(keyword || '').trim()
    if (remember) this.saveHistory(value)
    this.setData({ keyword: value, searchPanelVisible: false, suggestions: [] })
    await this.loadDevices()
  },
  search() { this.executeSearch(this.data.keyword) },
  selectHistory(e) { this.executeSearch(e.currentTarget.dataset.keyword) },
  selectSuggestion(e) { this.executeSearch(e.currentTarget.dataset.keyword) },
  async clearSearch() {
    if (this.blurTimer) clearTimeout(this.blurTimer)
    this.setData({ keyword: '', suggestions: [], searchHistory: this.readHistory(), searchPanelVisible: true })
    await this.loadDevices()
  },
  deleteHistory(e) {
    const keyword = e.currentTarget.dataset.keyword
    const history = this.readHistory().filter(item => item !== keyword)
    wx.setStorageSync(HISTORY_KEY, history)
    this.setData({ searchHistory: history, searchPanelVisible: true })
  },
  noop() {},
  open(e) { wx.navigateTo({ url: `/pages/device/detail?id=${e.currentTarget.dataset.id}` }) },
  onShareAppMessage() {
    return { title: 'EMC 智造实验室设备预约', path: '/pages/home/index' }
  },
  onShareTimeline() {
    return { title: 'EMC 智造实验室设备预约' }
  }
})
