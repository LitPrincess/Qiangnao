const MAX_POINTS = 24
// Stable demo mode: slower scheduler to avoid AppService timeout.
const TICK_MS = 500
const DRAW_MS = 500
const TARGET_CHEWS_PER_HAND = 12

let logId = 0

function clip(n, a, b) {
  return Math.max(a, Math.min(b, n))
}

function nowText() {
  const d = new Date()
  const p = (n) => (n < 10 ? `0${n}` : `${n}`)
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

Page({
  data: {
    demoMode: 'manual',
    inputMode: 'frequency',
    chewSetHz: 1.2,
    handSetHz: 0.25,
    isRunning: false,
    chewObsHz: '0.00',
    handObsHz: '0.00',
    chewPerHand: '0.00',
    rushRiskPct: 0,
    riskPct: 0,
    predPct: 0,
    interventionLabel: 'None',
    logs: [],
    stableMode: true,
  },

  loop: 0,
  renderTimer: 0,
  lastUiUpdateAt: 0,
  charts: {},
  dpr: 1,
  simState: { chewCarry: 0, handCarry: 0 },
  lastRisk: 0,
  lastIntervention: 'None',
  chewEvents: [],
  handEvents: [],
  chewObsSeries: [],
  chewSetSeries: [],
  handObsSeries: [],
  handSetSeries: [],
  riskSeries: [],
  predSeries: [],

  onReady() {
    this.initCanvases()
  },

  onUnload() {
    if (this.loop) clearInterval(this.loop)
    if (this.renderTimer) clearTimeout(this.renderTimer)
    this.loop = 0
    this.renderTimer = 0
  },

  onHide() {
    if (this.loop) clearInterval(this.loop)
    this.loop = 0
    this.setData({ isRunning: false })
  },

  addPoint(arr, val) {
    if (!Array.isArray(arr)) return
    arr.push(val)
    while (arr.length > MAX_POINTS) arr.shift()
  },

  ensureState() {
    if (!Array.isArray(this.chewEvents)) this.chewEvents = []
    if (!Array.isArray(this.handEvents)) this.handEvents = []
    if (!Array.isArray(this.chewObsSeries)) this.chewObsSeries = []
    if (!Array.isArray(this.chewSetSeries)) this.chewSetSeries = []
    if (!Array.isArray(this.handObsSeries)) this.handObsSeries = []
    if (!Array.isArray(this.handSetSeries)) this.handSetSeries = []
    if (!Array.isArray(this.riskSeries)) this.riskSeries = []
    if (!Array.isArray(this.predSeries)) this.predSeries = []
    if (!this.simState || typeof this.simState !== 'object') {
      this.simState = { chewCarry: 0, handCarry: 0 }
    }
    if (typeof this.lastRisk !== 'number') this.lastRisk = 0
    if (typeof this.lastIntervention !== 'string') this.lastIntervention = 'None'
  },

  pushLog(msg) {
    logId += 1
    this.setData({
      logs: [{ id: logId, t: nowText(), msg }, ...this.data.logs].slice(0, 40),
    })
  },

  clearLogs() {
    this.setData({ logs: [] })
  },

  switchToManual() {
    if (this.data.demoMode === 'manual') return
    this.setData({ demoMode: 'manual' })
    this.pushLog('切换到手动模拟')
  },

  switchToAuto() {
    if (this.data.demoMode === 'auto') return
    this.setData({ demoMode: 'auto', inputMode: 'frequency' })
    this.pushLog('切换到自动演示')
  },

  switchInputFrequency() {
    if (this.data.inputMode === 'frequency') return
    this.setData({ inputMode: 'frequency' })
    this.pushLog('输入方式: 频率调节')
  },

  switchInputTap() {
    if (this.data.inputMode === 'tap') return
    this.setData({ inputMode: 'tap' })
    this.pushLog('输入方式: 手动点击')
  },

  onChewSetChange(e) {
    this.setData({ chewSetHz: Number(e.detail.value) })
  },

  onHandSetChange(e) {
    this.setData({ handSetHz: Number(e.detail.value) })
  },

  manualChew() {
    if (this.data.inputMode !== 'tap') return
    this.registerChew(Date.now())
    this.updateFrame()
  },

  manualHand() {
    if (this.data.inputMode !== 'tap') return
    this.registerHand(Date.now())
    this.updateFrame()
  },

  toggleRun() {
    this.ensureState()
    if (this.data.isRunning) {
      if (this.loop) clearInterval(this.loop)
      this.loop = 0
      this.setData({ isRunning: false })
      this.pushLog('演示已停止')
      return
    }
    if (this.loop) clearInterval(this.loop)
    this.loop = 0
    this.setData({ isRunning: true })
    this.pushLog(this.data.demoMode === 'auto' ? '自动演示开始' : '手动模拟开始')
    this.loop = setInterval(() => this.step(), TICK_MS)
  },

  resetSession() {
    if (this.loop) clearInterval(this.loop)
    this.loop = 0
    this.simState = { chewCarry: 0, handCarry: 0 }
    this.lastRisk = 0
    this.lastIntervention = 'None'
    this.chewEvents = []
    this.handEvents = []
    this.chewObsSeries = []
    this.chewSetSeries = []
    this.handObsSeries = []
    this.handSetSeries = []
    this.riskSeries = []
    this.predSeries = []
    this.setData({
      isRunning: false,
      chewObsHz: '0.00',
      handObsHz: '0.00',
      chewPerHand: '0.00',
      rushRiskPct: 0,
      riskPct: 0,
      predPct: 0,
      interventionLabel: 'None',
      logs: [],
    })
    this.lastUiUpdateAt = 0
    this.scheduleRender()
  },

  registerChew(ts) {
    this.chewEvents.push(ts)
  },

  registerHand(ts) {
    this.handEvents.push(ts)
  },

  trimEvents(now) {
    this.ensureState()
    const minTs = now - 12000
    while (this.chewEvents.length && this.chewEvents[0] < minTs) this.chewEvents.shift()
    while (this.handEvents.length && this.handEvents[0] < minTs) this.handEvents.shift()
  },

  generateAutoEvents() {
    const dt = TICK_MS / 1000
    this.simState.chewCarry += this.data.chewSetHz * dt
    this.simState.handCarry += this.data.handSetHz * dt
    const now = Date.now()
    while (this.simState.chewCarry >= 1) {
      this.registerChew(now)
      this.simState.chewCarry -= 1
    }
    while (this.simState.handCarry >= 1) {
      this.registerHand(now)
      this.simState.handCarry -= 1
    }
  },

  computeMetrics() {
    this.ensureState()
    const now = Date.now()
    this.trimEvents(now)
    const windowMs = 10000
    const minTs = now - windowMs
    const chewCount = this.chewEvents.filter((t) => t >= minTs).length
    const handCount = this.handEvents.filter((t) => t >= minTs).length
    const sec = windowMs / 1000
    const chewObsHz = chewCount / sec
    const handObsHz = handCount / sec
    const chewPerHand = handCount > 0 ? chewCount / handCount : 0
    const rushRisk = handCount > 0
      ? clip((TARGET_CHEWS_PER_HAND - chewPerHand) / TARGET_CHEWS_PER_HAND, 0, 1)
      : 0
    const overHandRisk = clip((handObsHz - this.data.handSetHz) / (this.data.handSetHz + 0.05), 0, 1)
    const underChewRisk = clip((this.data.chewSetHz - chewObsHz) / (this.data.chewSetHz + 0.05), 0, 1)
    const risk = (handCount === 0 && chewCount === 0)
      ? 0
      : clip(0.55 * rushRisk + 0.3 * overHandRisk + 0.15 * underChewRisk, 0, 1)
    const pred = clip(risk + (risk - this.lastRisk) * 0.7, 0, 1)
    this.lastRisk = risk
    let interventionLabel = 'None'
    if (risk > 0.75 || rushRisk > 0.6) interventionLabel = 'Strong'
    else if (risk > 0.45 || rushRisk > 0.35) interventionLabel = 'Moderate'
    else if (risk > 0.2) interventionLabel = 'Soft'
    return {
      chewObsHz,
      handObsHz,
      chewPerHand,
      rushRisk,
      risk,
      pred,
      interventionLabel,
    }
  },

  updateFrame() {
    this.ensureState()
    const m = this.computeMetrics()
    this.addPoint(this.chewObsSeries, m.chewObsHz)
    this.addPoint(this.chewSetSeries, this.data.chewSetHz)
    this.addPoint(this.handObsSeries, m.handObsHz)
    this.addPoint(this.handSetSeries, this.data.handSetHz)
    this.addPoint(this.riskSeries, m.risk)
    this.addPoint(this.predSeries, m.pred)
    const now = Date.now()
    // Throttle UI data commit frequency in stable mode.
    if (!this.lastUiUpdateAt || now - this.lastUiUpdateAt >= DRAW_MS) {
      this.lastUiUpdateAt = now
      this.setData({
        chewObsHz: m.chewObsHz.toFixed(2),
        handObsHz: m.handObsHz.toFixed(2),
        chewPerHand: m.chewPerHand.toFixed(2),
        rushRiskPct: Math.round(m.rushRisk * 100),
        riskPct: Math.round(m.risk * 100),
        predPct: Math.round(m.pred * 100),
        interventionLabel: m.interventionLabel,
      })
    }
    if (m.interventionLabel !== this.lastIntervention) {
      this.lastIntervention = m.interventionLabel
      this.pushLog(`干预等级切换为 ${m.interventionLabel}`)
    }
    this.scheduleRender()
  },

  step() {
    this.ensureState()
    if (!this.data.isRunning) return
    // Frequency mode always drives continuous synthetic events from sliders.
    // Tap mode only updates from manual +1 buttons.
    if (this.data.demoMode === 'auto' || this.data.inputMode === 'frequency') {
      this.generateAutoEvents()
    }
    this.updateFrame()
  },

  initCanvases() {
    const q = wx.createSelectorQuery().in(this)
    q.select('#chewCanvas').fields({ node: true, size: true })
    q.select('#handCanvas').fields({ node: true, size: true })
    q.select('#riskCanvas').fields({ node: true, size: true })
    q.exec((res) => {
      if (!res || !res[0] || !res[0].node) return
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      this.dpr = (info && info.pixelRatio) || 1
      const build = (item) => {
        const node = item.node
        const w = Math.max(10, item.width || 300)
        const h = Math.max(10, item.height || 150)
        node.width = w * this.dpr
        node.height = h * this.dpr
        const ctx = node.getContext('2d')
        ctx.scale(this.dpr, this.dpr)
        return { ctx, w, h }
      }
      this.charts = {
        chew: build(res[0]),
        hand: build(res[1]),
        risk: build(res[2]),
      }
      this.scheduleRender()
    })
  },

  drawLine(chart, seriesA, colorA, maxY, seriesB, colorB, axis) {
    if (!chart || !chart.ctx) return
    const ctx = chart.ctx
    const w = chart.w
    const h = chart.h
    const left = 36
    const right = 12
    const top = 12
    const bottom = 28
    const plotW = w - left - right
    const plotH = h - top - bottom
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#f8fafe'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = '#cfd8e8'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(left, top)
    ctx.lineTo(left, h - bottom)
    ctx.lineTo(w - right, h - bottom)
    ctx.stroke()
    ctx.strokeStyle = '#e2e8f2'
    ctx.beginPath()
    ctx.moveTo(left, top + plotH / 2)
    ctx.lineTo(w - right, top + plotH / 2)
    ctx.stroke()
    ctx.fillStyle = '#6d7a95'
    ctx.font = '9px sans-serif'
    ctx.fillText(axis.y, 4, 12)
    ctx.fillText(axis.x, w - 28, h - 5)
    const draw = (arr, c) => {
      if (!arr.length) return
      ctx.strokeStyle = c
      ctx.lineWidth = 2
      ctx.beginPath()
      arr.forEach((v, i) => {
        const x = left + (i * plotW) / (MAX_POINTS - 1)
        const y = h - bottom - (clip(v, 0, maxY) / maxY) * plotH
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()
    }
    draw(seriesA, colorA)
    if (seriesB) draw(seriesB, colorB)
  },

  renderAll() {
    this.drawLine(this.charts.chew, this.chewObsSeries, '#35b9a6', 3.0, this.chewSetSeries, '#9eaac2', { x: 't', y: 'Hz' })
    this.drawLine(this.charts.hand, this.handObsSeries, '#4f88ff', 1.0, this.handSetSeries, '#9eaac2', { x: 't', y: 'Hz' })
    this.drawLine(this.charts.risk, this.riskSeries, '#de5e53', 1.0, this.predSeries, '#d9a441', { x: 't', y: 'risk' })
  },

  scheduleRender() {
    if (this.renderTimer) return
    this.renderTimer = setTimeout(() => {
      this.renderTimer = 0
      this.renderAll()
    }, DRAW_MS)
  },

  goExplain() {
    wx.navigateTo({ url: '/pages/explain/index' })
  },
})
