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

// Every list is one row, and the work orders row alone is a third of a
// megabyte. Pulling every row every 20 seconds on every open phone used up
// the free plan's monthly data in days and Supabase shut the app off
// (Oct 26). So reads say when the row was last saved (updated_at), and
// stamps() fetches just those times: the app only downloads a row when its
// time has changed.
window.storage = {
  async get(key) {
    const { data, error } = await sb
      .from('kv').select('value,updated_at').eq('key', key).maybeSingle()
    if (error) throw error
    if (!data) throw new Error('not found')
    return { key, value: data.value, updatedAt: data.updated_at }
  },
  async set(key, value) {
    const { data, error } = await sb.from('kv')
      .upsert({ key, value, updated_at: new Date().toISOString() })
      .select('updated_at').maybeSingle()
    if (error) throw error
    return { key, value, updatedAt: data?.updated_at || null }
  },
  // { key: updated_at } for the given keys, a few hundred bytes in all.
  async stamps(keys) {
    const { data, error } = await sb.from('kv').select('key,updated_at').in('key', keys)
    if (error) throw error
    return Object.fromEntries((data || []).map((r) => [r.key, r.updated_at]))
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
