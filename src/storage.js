import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

// Reference photos live as files in the wo-photos bucket, not inside the
// work orders row. That row saves on every edit, so a few phone pictures
// packed into it would slow every save for everyone.
window.photoStore = {
  async upload(blob) {
    const path = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.jpg`
    const { error } = await sb.storage.from('wo-photos')
      .upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' })
    if (error) throw error
    return sb.storage.from('wo-photos').getPublicUrl(path).data.publicUrl
  }
}

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

