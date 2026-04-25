/**
 * MasticTempo - chew tempo coach (demo engine)
 * Flow: calibrate -> hand/mouth state -> rush detect -> risk -> intervention
 * Replace with Bluetooth-fed features (pMUT + IMU) in production
 */

// Demo: short calibration window (slides map to ~5 min meal baseline)
const DEFAULT_CALIBRATION_MS = 30000
const MIN_CHEW_TARGET = 12
const MAX_CHEW_TARGET = 32

const clamp = (n, a, b) => Math.max(a, Math.min(b, n))
const mean = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0)
const stdev = (arr) => {
  if (arr.length < 2) return 0
  const m = mean(arr)
  return Math.sqrt(mean(arr.map((x) => (x - m) * (x - m))))
}

const EATING_MODES = {
  FOCUSED: 'focused',
  DISTRACTED: 'distracted',
  SOCIAL: 'social',
}

const modeSensitivity = {
  [EATING_MODES.FOCUSED]: 1.0,
  [EATING_MODES.DISTRACTED]: 0.88,
  [EATING_MODES.SOCIAL]: 0.75,
}

const InterventionLevel = {
  NONE: 0,
  SOFT: 1,
  MODERATE: 2,
  STRONG: 3,
}

function createMasticTempoState() {
  return {
    sessionStart: null,
    eatingMode: EATING_MODES.FOCUSED,
    calibrationEndAt: 0,
    calibrated: false,
    baselineChewIntervals: [],
    baselineFeedIntervals: [],
    targetChewsPerBite: 20,
    biteIndex: 0,
    chewCountThisBite: 0,
    lastChewAt: 0,
    firstMouthfulPending: true,
    lastFeedGestureAt: 0,
    feedIntervalHistory: [],
    lastRiskScore: 0,
    lastViolation: null,
    lastIntervention: null,
  }
}

/**
 * Shorter inter-bite times -> higher risk of entering "too fast" state
 */
function computeTrendRisk(s) {
  const f = s.feedIntervalHistory
  if (f.length < 3) return 0
  const recent = f.slice(-3)
  const older = f.slice(-6, -3)
  if (older.length < 2) return 0
  const mR = mean(recent)
  const mO = mean(older)
  if (mO <= 0) return 0
  const speedup = (mO - mR) / mO
  const base = clamp(speedup, 0, 1) * 0.85
  const sens = modeSensitivity[s.eatingMode] || 1
  return clamp(base / sens, 0, 1)
}

/**
 * Rush: next bite before chew target (hand leads mouth). Skip first "pick" with 0 chews.
 */
function checkRushBite(s, now) {
  if (s.firstMouthfulPending && s.chewCountThisBite === 0) return null
  const target = Math.round(
    s.targetChewsPerBite * (modeSensitivity[s.eatingMode] || 1)
  )
  const minTarget = Math.max(
    Math.round(MIN_CHEW_TARGET * (modeSensitivity[s.eatingMode] || 1)),
    5
  )
  const t = Math.max(target, minTarget)
  if (s.chewCountThisBite >= t) return null
  return {
    type: 'rush_bite',
    at: now,
    biteIndex: s.biteIndex,
    chews: s.chewCountThisBite,
    required: t,
  }
}

function mapIntervention(rush, risk) {
  if (rush) {
    if (rush.required - rush.chews > 8) return InterventionLevel.STRONG
    if (rush.required - rush.chews > 4) return InterventionLevel.MODERATE
    return InterventionLevel.SOFT
  }
  if (risk > 0.72) return InterventionLevel.SOFT
  return InterventionLevel.NONE
}

function feedbackFromLevel(level) {
  if (level === InterventionLevel.NONE)
    return { bpm: 0, hapticHz: 0, label: 'No intervention' }
  if (level === InterventionLevel.SOFT)
    return { bpm: 52, hapticHz: 1.2, label: 'Soft guidance' }
  if (level === InterventionLevel.MODERATE)
    return { bpm: 48, hapticHz: 2.0, label: 'Rhythm boost' }
  return { bpm: 44, hapticHz: 3.2, label: 'Strong resistance' }
}

class MasticTempoEngine {
  constructor(options = {}) {
    this.options = {
      calibrationMs: options.calibrationMs != null
        ? options.calibrationMs
        : DEFAULT_CALIBRATION_MS,
    }
    this.s = createMasticTempoState()
  }

  startSession() {
    const now = Date.now()
    this.s = createMasticTempoState()
    this.s.sessionStart = now
    this.s.calibrationEndAt = now + this.options.calibrationMs
    this.s.lastFeedGestureAt = now
    this.s.lastChewAt = 0
  }

  setEatingMode(mode) {
    if (Object.values(EATING_MODES).indexOf(mode) >= 0) {
      this.s.eatingMode = mode
    }
  }

  _finalizeCalibration() {
    const s = this.s
    const cMean = s.baselineChewIntervals.length
      ? 1000 / mean(s.baselineChewIntervals)
      : 1.2
    s.targetChewsPerBite = Math.round(
      clamp(18 + (cMean - 1) * 4, MIN_CHEW_TARGET, MAX_CHEW_TARGET)
    )
    s.calibrated = true
  }

  registerChew() {
    const now = Date.now()
    const s = this.s
    if (!s.sessionStart) this.startSession()
    if (s.lastChewAt) {
      const sec = (now - s.lastChewAt) / 1000
      if (sec > 0.05 && sec < 3) {
        s.baselineChewIntervals.push(1 / sec)
        if (now < s.calibrationEndAt) {
          s.baselineChewIntervals = s.baselineChewIntervals.slice(-30)
        }
      }
    }
    s.lastChewAt = now
    s.chewCountThisBite += 1
    s.firstMouthfulPending = false
    if (now >= s.calibrationEndAt && !s.calibrated) {
      this._finalizeCalibration()
    }
    return this.snapshot()
  }

  registerNewBiteFromHand() {
    const now = Date.now()
    const s = this.s
    if (!s.sessionStart) this.startSession()
    if (!s.lastFeedGestureAt) s.lastFeedGestureAt = now
    const interval = (now - s.lastFeedGestureAt) / 1000
    if (interval > 0.3) {
      s.feedIntervalHistory.push(interval)
      s.baselineFeedIntervals.push(interval)
      if (now < s.calibrationEndAt) {
        s.baselineFeedIntervals = s.baselineFeedIntervals.slice(-20)
      } else {
        s.feedIntervalHistory = s.feedIntervalHistory.slice(-10)
      }
    }
    s.lastFeedGestureAt = now
    s.lastRiskScore = computeTrendRisk(s)
    if (s.chewCountThisBite > 0) s.firstMouthfulPending = false
    const wasOpeningFirstPick =
      s.firstMouthfulPending && s.chewCountThisBite === 0
    let violation = null
    if (s.calibrated || (now >= s.calibrationEndAt && !s.calibrated)) {
      if (!s.calibrated) this._finalizeCalibration()
      violation = checkRushBite(s, now)
    }
    if (violation) s.lastViolation = violation
    s.biteIndex += 1
    s.chewCountThisBite = 0
    s.lastChewAt = 0
    if (s.calibrated) {
      const level = mapIntervention(violation, s.lastRiskScore)
      s.lastIntervention = { ...feedbackFromLevel(level), level }
    } else {
      s.lastIntervention = {
        bpm: 0,
        hapticHz: 0,
        level: 0,
        label: 'Calibrating',
      }
    }
    if (wasOpeningFirstPick) s.firstMouthfulPending = false
    return this.snapshot()
  }

  getSnapshot() {
    return this.snapshot()
  }

  snapshot() {
    const s = this.s
    const now = Date.now()
    const calibrating = s.sessionStart && !s.calibrated && now < s.calibrationEndAt
    const target = s.calibrated
      ? Math.max(
        Math.round(s.targetChewsPerBite * (modeSensitivity[s.eatingMode] || 1)),
        Math.round(MIN_CHEW_TARGET * (modeSensitivity[s.eatingMode] || 1))
      )
      : 0
    return {
      sessionStart: s.sessionStart,
      eatingMode: s.eatingMode,
      calibrated: s.calibrated,
      calibrating,
      calibrationProgress: s.sessionStart
        ? clamp(
          (now - s.sessionStart) / (s.calibrationEndAt - s.sessionStart),
          0,
          1
        )
        : 0,
      biteIndex: s.biteIndex,
      chewCountThisBite: s.chewCountThisBite,
      targetChewsThisBite: target,
      baselineSummary: s.calibrated
        ? {
            targetChewsPerBite: s.targetChewsPerBite,
            avgFeedIntervalS: s.feedIntervalHistory.length
              ? mean(s.feedIntervalHistory)
              : 0,
            chewRateVar: stdev(s.baselineChewIntervals),
          }
        : null,
      lastRiskScore: s.lastRiskScore,
      lastViolation: s.lastViolation,
      lastIntervention: s.lastIntervention || { level: 0, label: '-' },
    }
  }
}

module.exports = {
  MasticTempoEngine,
  EATING_MODES,
  DEFAULT_CALIBRATION_MS,
  InterventionLevel,
}
