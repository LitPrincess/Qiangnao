/** LLM via WeChat cloud function proxy. */
const DEFAULT_MODEL = 'Qwen/Qwen2.5-7B-Instruct'
const CLOUD_ENV_ID = 'cloud1-2gqdzqj9e43361c0'

function getModel() {
  return DEFAULT_MODEL
}

function safeText(x) {
  if (x == null) return ''
  if (typeof x === 'string') return x
  try {
    return JSON.stringify(x)
  } catch (e) {
    return String(x)
  }
}

function extractApiError(data) {
  if (!data) return ''
  if (typeof data === 'string') return data
  if (data.error) {
    if (typeof data.error === 'string') return data.error
    if (data.error.message) return data.error.message
  }
  if (data.message) return data.message
  return safeText(data)
}

function extractAssistantText(data) {
  const msg =
    data &&
    data.choices &&
    data.choices[0] &&
    data.choices[0].message
  if (!msg) return ''
  const content = msg.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    const text = content
      .map((p) => {
        if (typeof p === 'string') return p
        if (p && typeof p.text === 'string') return p.text
        return ''
      })
      .join('\n')
      .trim()
    return text
  }
  return ''
}

function requestByCloud(payload) {
  if (!wx.cloud || !wx.cloud.callFunction) {
    return Promise.reject(new Error('云函数不可用'))
  }
  return wx.cloud
    .callFunction({
      config: { env: CLOUD_ENV_ID },
      name: 'llmProxy',
      data: {
        messages: payload.messages,
        model: payload.model,
        maxTokens: payload.max_tokens,
      },
    })
    .then((res) => {
      const result = (res && res.result) || {}
      const status = Number(result.statusCode || 0)
      const data = result.data
      if (status >= 400 || status === 0) {
        const details = extractApiError(data)
        throw new Error(`HTTP ${status}${details ? `: ${details}` : ''}`)
      }
      const text = extractAssistantText(data)
      if (text) return text
      const details = extractApiError(data)
      throw new Error(`响应无内容${details ? `: ${details}` : ''}`)
    })
    .catch((err) => {
      const msg = (err && (err.message || err.errMsg)) || '云函数调用失败'
      throw new Error(`云函数失败: ${msg}`)
    })
}

function chatCompletions({ messages, model, maxTokens }) {
  const m = model || getModel()
  const payload = {
    model: m,
    messages,
    max_tokens: maxTokens != null ? maxTokens : 800,
    temperature: 0.35,
  }

  return requestByCloud(payload)
}

module.exports = {
  chatCompletions,
  getModel,
  DEFAULT_MODEL,
}
