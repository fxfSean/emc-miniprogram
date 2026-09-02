const { call } = require('../../utils/cloud')
const { requireApproved } = require('../../utils/auth')
const HISTORY_KEY = 'deviceSearchHistory'
const HISTORY_LIMIT = 10
const FEATURE_FILTERS = [
  { id: 'HEAT_TREATMENT', label: '热处理', keywords: ['电阻炉', '干燥箱'] },
  { id: 'SAMPLE_PREPARATION', label: '制样加工', keywords: ['切割机', '磨抛机', '抛光机', '镶嵌机'] },
  { id: 'MICROSCOPY', label: '显微表征', keywords: ['扫描电镜', '透射电子显微镜', '偏光显微镜'] },
  { id: 'POWDER_PROCESSING', label: '粉体加工', keywords: ['球磨机', '罐磨机'] },
  { id: 'MECHANICAL_TESTING', label: '力学测试', keywords: ['万能试验机', '硬度计'] },
  { id: 'COMPOSITION_ANALYSIS', label: '分析测试', keywords: ['氧氮氢分析仪', '粉体特性测试仪'] }
]
Page({
  data: { keyword: '', devices: [], loading: true, searchPanelVisible: false, searchHistory: [], suggestions: [], quickLocations: [], quickFeatures: [] },
  async onShow() { if (await requireApproved()) await this.loadDevices() },
  async onPullDownRefresh() { await this.loadDevices(); wx.stopPullDownRefresh() },
  onUnload() { if (this.blurTimer) clearTimeout(this.blurTimer) },
  onFocus() {
    if (this.blurTimer) clearTimeout(this.blurTimer)
    this.setData({ searchPanelVisible: true, searchHistory: this.readHistory(), suggestions: this.getSuggestions(this.data.keyword) })
  },
  onBlur() { this.blurTimer = setTimeout(() => this.setData({ searchPanelVisible: false }), 150) },
  hideSearchPanel() {
    if (this.blurTimer) clearTimeout(this.blurTimer)
    this.setData({ searchPanelVisible: false })
  },
  onInput(e) {
    const keyword = e.detail.value
    this.activeFeatureId = ''
    this.setData({ keyword, searchPanelVisible: true, suggestions: this.getSuggestions(keyword) })
  },
  async loadDevices() {
    this.setData({ loading: true })
    try {
      const feature = FEATURE_FILTERS.find(item => item.id === this.activeFeatureId)
      const devices = await call('device', 'list', { keyword: this.data.keyword, keywords: feature ? feature.keywords : [] })
      if (!this.data.keyword.trim()) {
        this.allDevices = devices
        this.setData({ quickLocations: this.getQuickLocations(devices), quickFeatures: this.getQuickFeatures(devices) })
      }
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
  getQuickLocations(devices) {
    const counts = {}
    devices.forEach(item => {
      const location = String(item.location || '').trim()
      const match = location.match(/\d{3,}[A-Za-z]?/)
      const label = match ? match[0].toUpperCase() : location.replace(/^实验室\s*/i, '')
      if (label) counts[label] = (counts[label] || 0) + 1
    })
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b)).slice(0, 8)
  },
  getQuickFeatures(devices) {
    return FEATURE_FILTERS.map(feature => ({
      ...feature,
      count: devices.filter(device => feature.keywords.some(keyword => String(device.name || '').includes(keyword))).length
    })).filter(feature => feature.count)
  },
  async executeSearch(keyword, remember = true, featureId = '') {
    const value = String(keyword || '').trim()
    if (remember) this.saveHistory(value)
    this.activeFeatureId = featureId
    this.setData({ keyword: value, searchPanelVisible: false, suggestions: [] })
    await this.loadDevices()
  },
  search() {
    const feature = FEATURE_FILTERS.find(item => item.label === this.data.keyword.trim())
    this.executeSearch(this.data.keyword, true, feature ? feature.id : '')
  },
  selectHistory(e) {
    const keyword = e.currentTarget.dataset.keyword
    const feature = FEATURE_FILTERS.find(item => item.label === keyword)
    this.executeSearch(keyword, true, feature ? feature.id : '')
  },
  selectSuggestion(e) { this.executeSearch(e.currentTarget.dataset.keyword) },
  selectQuickLocation(e) { this.executeSearch(e.currentTarget.dataset.keyword) },
  selectQuickFeature(e) {
    const feature = FEATURE_FILTERS.find(item => item.id === e.currentTarget.dataset.id)
    if (feature) this.executeSearch(feature.label, true, feature.id)
  },
  async clearSearch() {
    if (this.blurTimer) clearTimeout(this.blurTimer)
    this.activeFeatureId = ''
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
  quickReserve(e) {
    const deviceId = e.currentTarget.dataset.id
    if (deviceId) wx.navigateTo({ url: `/pages/reservation/create?deviceId=${deviceId}` })
  },
  open(e) { wx.navigateTo({ url: `/pages/device/detail?id=${e.currentTarget.dataset.id}` }) },
  onShareAppMessage() {
    return { title: 'EMC 智造实验室设备预约', path: '/pages/home/index' }
  },
  onShareTimeline() {
    return { title: 'EMC 智造实验室设备预约' }
  }
})
