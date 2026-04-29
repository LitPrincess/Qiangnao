const https = require('https')

const DEFAULT_BASES = [
  'https://api.siliconflow.com/v1/chat/completions',
  'https://api.siliconflow.cn/v1/chat/completions',
]

function sanitizeKey(raw) {
  if (!raw) return ''
  return String(raw)
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/\r/g, '')
    .replace(/\n/g, '')
}

function maskKey(k) {
  if (!k) return '(empty)'
  if (k.length <= 10) return `${k.slice(0, 2)}***`
  return `${k.slice(0, 6)}...${k.slice(-4)}`
}

function pickBases() {
  const fromList = sanitizeKey(process.env.LLM_BASE_URLS)
  if (fromList) {
    const urls = fromList
      .split(',')
      .map((x) => sanitizeKey(x))
      .filter(Boolean)
    if (urls.length) return urls
  }
  const fromSingle = sanitizeKey(process.env.LLM_BASE_URL)
  if (fromSingle) return [fromSingle]
  return DEFAULT_BASES
}

function pickApiKey() {
  const fromLLM = sanitizeKey(process.env.LLM_API_KEY)
  if (fromLLM) return { key: fromLLM, source: 'LLM_API_KEY' }
  const fromOpenAI = sanitizeKey(process.env.OPENAI_API_KEY)
  if (fromOpenAI) return { key: fromOpenAI, source: 'OPENAI_API_KEY' }
  const fromSF = sanitizeKey(process.env.SF_API_KEY)
  if (fromSF) return { key: fromSF, source: 'SF_API_KEY' }
  const fromSilicon = sanitizeKey(process.env.SILICONFLOW_API_KEY)
  if (fromSilicon) return { key: fromSilicon, source: 'SILICONFLOW_API_KEY' }
  const fromApi = sanitizeKey(process.env.API_KEY)
  if (fromApi) return { key: fromApi, source: 'API_KEY' }
  return { key: '', source: 'NONE' }
}

function postJson(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body || {})
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...headers,
        },
      },
      (res) => {
        let raw = ''
        res.on('data', (c) => {
          raw += c
        })
        res.on('end', () => {
          let data = {}
          try {
            data = raw ? JSON.parse(raw) : {}
          } catch (e) {
            data = { message: raw || 'Invalid JSON response' }
          }
          resolve({ statusCode: res.statusCode || 0, data })
        })
      }
    )
    const timeoutMs = (() => {
      const raw = process.env.LLM_HTTP_TIMEOUT_MS
      const n = raw ? parseInt(String(raw), 10) : NaN
      // Keep a sane default for cloud network latency.
      return Number.isFinite(n) && n > 0 ? n : 15000
    })()
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Upstream timeout'))
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

async function requestWithFallback(body, key, bases) {
  let lastErr = null
  for (const url of bases) {
    try {
      return await postJson(url, body, {
        Authorization: `Bearer ${key}`,
      })
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr || new Error('All upstream requests failed')
}

exports.main = async (event) => {
  const { messages, model, maxTokens } = event || {}
  const picked = pickApiKey()
  const key = picked.key
  const bases = pickBases()
  const envPresence = {
    LLM_API_KEY: Boolean(sanitizeKey(process.env.LLM_API_KEY)),
    OPENAI_API_KEY: Boolean(sanitizeKey(process.env.OPENAI_API_KEY)),
    SF_API_KEY: Boolean(sanitizeKey(process.env.SF_API_KEY)),
    SILICONFLOW_API_KEY: Boolean(sanitizeKey(process.env.SILICONFLOW_API_KEY)),
    API_KEY: Boolean(sanitizeKey(process.env.API_KEY)),
    LLM_BASE_URL: Boolean(sanitizeKey(process.env.LLM_BASE_URL)),
    LLM_BASE_URLS: Boolean(sanitizeKey(process.env.LLM_BASE_URLS)),
    LLM_MODEL: Boolean(sanitizeKey(process.env.LLM_MODEL)),
  }
  const keyMeta = {
    source: picked.source,
    length: key.length,
    masked: maskKey(key),
    bases,
  }
  if (!key) {
    return {
      statusCode: 401,
      data: {
        error: {
          message:
            'API key missing in env: LLM_API_KEY / OPENAI_API_KEY / SF_API_KEY (check cloud env variables)',
        },
        keyMeta,
        envPresence,
      },
    }
  }
  const body = {
    // Prefer cloud env model (so you can switch providers without editing frontend).
    model: sanitizeKey(process.env.LLM_MODEL) || model || 'Qwen/Qwen2.5-7B-Instruct',
    messages: Array.isArray(messages) ? messages : [],
    max_tokens: maxTokens != null ? maxTokens : 220,
    temperature: 0.35,
  }
  try {
    const res = await requestWithFallback(body, key, bases)
    if (Number(res.statusCode) === 401) {
      let data = res.data
      if (typeof data === 'string') {
        data = { message: data }
      }
      return {
        statusCode: 401,
        data: {
          ...(data || {}),
          keyMeta,
        },
      }
    }
    return res
  } catch (e) {
    return {
      statusCode: 504,
      data: {
        error: {
          message: e && e.message ? e.message : 'Upstream request failed',
        },
        keyMeta,
      },
    }
  }
}
