import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

window.storage = {
  async get(key) {
    const { data, error } = await sb
      .from('kv').select('value').eq('key', key).maybeSingle()
    if (error) throw error
    if (!data) throw new Error('not found')
    return { key, value: data.value }
  },
  async set(key, value) {
    const { error } = await sb.from('kv')
      .upsert({ key, value, updated_at: new Date().toISOString() })
    if (error) throw error
    return { key, value }
  },
  async delete(key) {
    await sb.from('kv').delete().eq('key', key)
    return { key, deleted: true }
  },
  async list(prefix = '') {
    const { data } = await sb.from('kv').select('key').like('key', `${prefix}%`)
    return { keys: (data || []).map(r => r.key) }
  }
}

