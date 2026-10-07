import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import sharp from 'sharp'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { materializeRemoteImage } from '../src/remote-image.js'

const directories: string[] = []

const createRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'santi-og-remote-limit-'))

  directories.push(root)

  return root
}

afterEach(async () => {
  vi.unstubAllGlobals()

  await Promise.all(directories.splice(0).map(root => rm(root, { force: true, recursive: true })))
})

describe('bounded remote preset downloads', () => {
  test.each([undefined, '1'])('cancels an oversized chunked response with content-length %s', async length => {
    const root = await createRoot()
    let canceled = false
    let pulls = 0

    const body = new ReadableStream<Uint8Array>({
      cancel() {
        canceled = true
      },
      pull(controller) {
        pulls += 1

        controller.enqueue(new Uint8Array(4))
      }
    }, { highWaterMark: 0 })

    const headers = new Headers({ 'content-type': 'image/png' })

    if (length !== undefined) headers.set('content-length', length)

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(body, { headers }))))

    await expect(materializeRemoteImage({
      sha256: '0'.repeat(64),
      type: 'image/png',
      url: 'https://images.example/card.png'
    }, root, { maxBytes: 5 })).rejects.toThrow('exceeds 5 bytes')

    expect(canceled).toBe(true)

    expect(pulls).toBe(2)

    expect(body.locked).toBe(false)

    expect(await readdir(root)).toEqual([])
  })

  test('cancels before reading a response declaring a size above the limit', async () => {
    const root = await createRoot()
    let canceled = false
    const pull = vi.fn()

    const body = new ReadableStream<Uint8Array>({
      cancel() {
        canceled = true
      },
      pull
    }, { highWaterMark: 0 })

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(body, {
      headers: { 'content-length': '100', 'content-type': 'image/png' }
    }))))

    await expect(materializeRemoteImage({
      sha256: '0'.repeat(64),
      type: 'image/png',
      url: 'https://images.example/card.png'
    }, root, { maxBytes: 5 })).rejects.toThrow('exceeds 5 bytes')

    expect(canceled).toBe(true)

    expect(pull).not.toHaveBeenCalled()

    expect(body.locked).toBe(false)
  })

  test('accepts chunked bytes exactly at the limit and reuses the verified cache', async () => {
    const root = await createRoot()

    const bytes = await sharp({ create: { background: '#000', channels: 3, height: 2, width: 2 } })
      .png().toBuffer()

    const sha256 = createHash('sha256').update(bytes).digest('hex')

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 10))

        controller.enqueue(bytes.subarray(10))

        controller.close()
      }
    })

    const fetchImage = vi.fn(() => Promise.resolve(new Response(body, { headers: { 'content-type': 'image/png' } })))

    vi.stubGlobal('fetch', fetchImage)

    const source = { sha256, type: 'image/png' as const, url: 'https://images.example/card.png' }
    const options = { maxBytes: bytes.byteLength }
    const destination = await materializeRemoteImage(source, root, options)

    expect(await readFile(destination)).toEqual(bytes)

    expect(await materializeRemoteImage(source, root, options)).toBe(destination)

    expect(fetchImage).toHaveBeenCalledTimes(1)

    expect(body.locked).toBe(false)
  })

  test('preserves stream errors and releases the reader without writing cache files', async () => {
    const root = await createRoot()

    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('Response stream failed'))
      }
    }, { highWaterMark: 0 })

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(body, { headers: { 'content-type': 'image/png' } }))))

    await expect(materializeRemoteImage({
      sha256: '0'.repeat(64),
      type: 'image/png',
      url: 'https://images.example/card.png'
    }, root)).rejects.toThrow('Response stream failed')

    expect(body.locked).toBe(false)

    expect(await readdir(root)).toEqual([])
  })
})
