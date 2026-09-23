<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { createBarcodeScanner } from '../domain/createBarcodeScanner'
import type { BarcodeScanner, ScanRegion } from '../domain/BarcodeScanner'

interface ScanEntry {
  code: string
  source: 'scan' | 'manual'
}

type ScanStatus = 'idle' | 'success' | 'error'

// Zielrahmen als Anteil der Kamera-Auflösung — dieselben Werte binden das sichtbare
// Rahmen-Overlay im Template UND grenzen den tatsächlich analysierten Bildausschnitt ein.
const REGION_WIDTH_RATIO = 0.7
const REGION_HEIGHT_RATIO = 0.4

const videoRef = ref<HTMLVideoElement | null>(null)
const cameraError = ref<string | null>(null)
const lastCode = ref<string | null>(null)
const recentCodes = ref<ScanEntry[]>([])
const manualInput = ref('')
const scanStatus = ref<ScanStatus>('idle')
const videoAspectRatio = ref<number | null>(null)

let stream: MediaStream | null = null
let scanner: BarcodeScanner | null = null
let rafId = 0
let cancelled = false
let lastAutoDetected: string | null = null
let statusTimeout = 0

function handleCode(code: string, source: ScanEntry['source']) {
  lastCode.value = code
  recentCodes.value.unshift({ code, source })
}

function getScanRegion(video: HTMLVideoElement): ScanRegion {
  const width = video.videoWidth * REGION_WIDTH_RATIO
  const height = video.videoHeight * REGION_HEIGHT_RATIO
  return {
    x: (video.videoWidth - width) / 2,
    y: (video.videoHeight - height) / 2,
    width,
    height,
  }
}

// Bleibt "success", solange jeden Frame erfolgreich gelesen wird (Timeout wird
// bei jedem Treffer neu gestartet); fällt ~1s nach dem letzten Treffer auf "idle" zurück.
function flashStatus(status: ScanStatus) {
  scanStatus.value = status
  clearTimeout(statusTimeout)
  statusTimeout = window.setTimeout(() => {
    scanStatus.value = 'idle'
  }, 1000)
}

async function loop() {
  if (!cancelled && videoRef.value && scanner && videoAspectRatio.value) {
    try {
      const region = getScanRegion(videoRef.value)
      const code = await scanner.scan(videoRef.value, region)
      if (code) {
        flashStatus('success')
        if (code !== lastAutoDetected) {
          lastAutoDetected = code
          handleCode(code, 'scan')
        }
      }
    } catch (e) {
      console.error('scan frame failed', e)
      flashStatus('error')
    }
  }
  rafId = requestAnimationFrame(loop)
}

function onManualSubmit() {
  const value = manualInput.value.trim()
  if (value) handleCode(value, 'manual')
  manualInput.value = ''
}

onMounted(async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraError.value = 'Kamera wird von diesem Browser nicht unterstützt.'
    return
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
  } catch {
    cameraError.value = 'Kamerazugriff nicht möglich. Nummer bitte manuell eingeben.'
    return
  }

  if (videoRef.value) {
    videoRef.value.srcObject = stream
    videoRef.value.addEventListener(
      'loadedmetadata',
      () => {
        if (videoRef.value) {
          videoAspectRatio.value = videoRef.value.videoWidth / videoRef.value.videoHeight
        }
      },
      { once: true },
    )
  }
  scanner = createBarcodeScanner()
  rafId = requestAnimationFrame(loop)
})

onUnmounted(() => {
  cancelled = true
  cancelAnimationFrame(rafId)
  clearTimeout(statusTimeout)
  stream?.getTracks().forEach((track) => track.stop())
})
</script>

<template>
  <main class="scan-view">
    <h1>Stamm scannen</h1>

    <p v-if="cameraError" class="camera-error">{{ cameraError }}</p>
    <div
      v-else
      class="video-wrap"
      :style="{ aspectRatio: String(videoAspectRatio ?? 4 / 3) }"
    >
      <video ref="videoRef" playsinline muted autoplay></video>
      <div
        class="scan-guide"
        :class="scanStatus"
        :style="{ width: REGION_WIDTH_RATIO * 100 + '%', height: REGION_HEIGHT_RATIO * 100 + '%' }"
      ></div>
      <span v-if="scanStatus === 'success'" class="status-badge success">✓</span>
      <span v-if="scanStatus === 'error'" class="status-badge error">✗</span>
    </div>

    <p v-if="lastCode" class="last-code">Zuletzt erkannt: <strong>{{ lastCode }}</strong></p>

    <form class="manual-form" @submit.prevent="onManualSubmit">
      <label for="manual-code">Nummer manuell eingeben</label>
      <input
        id="manual-code"
        v-model="manualInput"
        type="text"
        inputmode="text"
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
      />
      <button type="submit">Übernehmen</button>
    </form>

    <ul class="recent-codes">
      <li v-for="(entry, i) in recentCodes" :key="i">
        {{ entry.code }} <span class="source">({{ entry.source }})</span>
      </li>
    </ul>
  </main>
</template>

<style scoped>
.scan-view {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
}

.video-wrap {
  position: relative;
  overflow: hidden;
  background: #000;
}

.video-wrap video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.scan-guide {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  border: 3px solid rgba(255, 255, 255, 0.8);
  border-radius: 12px;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.4);
  transition: border-color 0.15s ease;
  pointer-events: none;
}

.scan-guide.success {
  border-color: #2e7d32;
}

.scan-guide.error {
  border-color: #b00020;
}

.status-badge {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  color: #fff;
}

.status-badge.success {
  background: #2e7d32;
}

.status-badge.error {
  background: #b00020;
}

.camera-error {
  color: #b00020;
}

.manual-form {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.manual-form label {
  flex-basis: 100%;
}

.manual-form input {
  flex: 1;
  min-width: 0;
  font-size: 16px;
  padding: 0.75rem;
  min-height: 48px;
}

.manual-form button {
  font-size: 16px;
  padding: 0.75rem 1.25rem;
  min-height: 48px;
}

.recent-codes {
  list-style: none;
  padding: 0;
  margin: 0;
}

.recent-codes .source {
  opacity: 0.6;
}
</style>
